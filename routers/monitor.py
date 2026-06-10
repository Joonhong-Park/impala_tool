from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse, StreamingResponse

from services.config_loader import Config, CoordinatorConfig
from services.impala_client import ImpalaClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/monitor", tags=["monitor"])

# 허용 가능한 detail_type 집합 (ImpalaClient._DETAIL_PATHS 키와 동일)
_DETAIL_TYPES: frozenset[str] = frozenset({"summary", "plan", "profile"})

# 다운로드 포맷 → (확장자, MIME 타입)
_DOWNLOAD_TYPES: dict[str, tuple[str, str]] = {
    "text":   ("txt",    "text/plain"),
    "json":   ("json",   "application/json"),
    "thrift": ("thrift", "application/octet-stream"),
}

_client: Optional[ImpalaClient] = None
_config: Optional[Config] = None


def init(client: ImpalaClient, config: Config) -> None:
    global _client, _config
    _client = client
    _config = config


def _resolve_coord(host: str) -> CoordinatorConfig:
    coord = _config.find_coordinator(host)
    if coord is None:
        raise HTTPException(status_code=400, detail=f"알 수 없는 coordinator: {host}")
    return coord


@router.get("/coordinators")
async def get_coordinators():
    return {
        "clusters": [
            {
                "id": cl.id,
                "color": cl.color,
                "ops":  [{"host": c.host, "port": c.port} for c in cl.ops_coordinators],
                "user": [{"host": c.host, "port": c.port} for c in cl.user_coordinators],
            }
            for cl in _config.clusters
        ]
    }


@router.get("/queries/{coord_host:path}")
async def get_queries(coord_host: str):
    coord = _resolve_coord(coord_host)
    try:
        return await _client.fetch_queries(coord.host, coord.port)
    except Exception as e:
        logger.error("fetch_queries %s | %s", coord_host, e)
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/cancel/{coord_host:path}/{query_id}")
async def cancel_query(coord_host: str, query_id: str):
    coord = _resolve_coord(coord_host)
    try:
        ok = await _client.cancel_query(coord.host, coord.port, query_id)
    except Exception as e:
        logger.error("cancel_query %s/%s | %s", coord_host, query_id, e)
        raise HTTPException(status_code=502, detail=str(e))
    if not ok:
        raise HTTPException(status_code=502, detail="Cancel 실패")
    return {"ok": True}


@router.get("/detail/{coord_host:path}/{query_id}/{detail_type}")
async def get_detail(coord_host: str, query_id: str, detail_type: str):
    if detail_type not in _DETAIL_TYPES:
        raise HTTPException(status_code=400, detail="detail_type은 summary/plan/profile 중 하나")
    coord = _resolve_coord(coord_host)
    try:
        text = await _client.fetch_detail(coord.host, coord.port, query_id, detail_type)
        return PlainTextResponse(text)
    except Exception as e:
        logger.error("fetch_detail %s/%s/%s | %s", coord_host, query_id, detail_type, e)
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/download/{coord_host:path}/{query_id}/{fmt}")
async def download_profile(coord_host: str, query_id: str, fmt: str):
    spec = _DOWNLOAD_TYPES.get(fmt)
    if spec is None:
        raise HTTPException(status_code=400, detail="fmt은 text/json/thrift 중 하나")

    ext, media_type = spec
    coord = _resolve_coord(coord_host)
    filename = f"profile_{query_id}.{ext}"

    async def safe_stream():
        try:
            async for chunk in _client.stream_download(coord.host, coord.port, query_id, fmt):
                yield chunk
        except Exception as e:
            logger.error("stream_download %s/%s/%s | %s", coord_host, query_id, fmt, e)

    return StreamingResponse(
        safe_stream(),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

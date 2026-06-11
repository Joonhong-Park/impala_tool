from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException

from services.config_loader import Config, CoordinatorConfig
from services.impala_client import ImpalaClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/monitor", tags=["monitor"])


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

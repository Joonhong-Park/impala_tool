from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, Response, StreamingResponse

from services import cm_client
from services.cm_client import build_filter, resolve_time_range
from services.config_loader import ClusterConfig, Config

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/explorer", tags=["explorer"])

_config: Optional[Config] = None


def init(config: Config) -> None:
    global _config
    _config = config


@dataclass
class _QueryRequest:
    """클라이언트에서 받은 검색 파라미터를 정규화한 구조체."""
    params: dict
    cluster_ids: Optional[list[str]]
    query_type: Optional[str]
    query_state: Optional[str]
    conditions: list[dict]


def _parse_conditions(raw: Optional[str]) -> list[dict]:
    """조건 JSON 문자열을 파싱한다. 파싱 실패 시 빈 리스트."""
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return []


def _build_request(
    conditions: Optional[str],
    query_type: Optional[str],
    query_state: Optional[str],
    hours: Optional[int],
    from_time: Optional[str],
    to_time: Optional[str],
    clusters: Optional[str],
) -> _QueryRequest:
    cond_list = _parse_conditions(conditions)
    from_iso, to_iso = resolve_time_range(hours, from_time, to_time)

    params = {"from": from_iso, "to": to_iso}

    cluster_ids = [c.strip() for c in clusters.split(",")] if clusters else None

    return _QueryRequest(
        params=params,
        cluster_ids=cluster_ids,
        query_type=query_type,
        query_state=query_state,
        conditions=cond_list,
    )


def _find_cluster(cluster_id: str) -> Optional[ClusterConfig]:
    return next((c for c in _config.clusters if c.id == cluster_id), None)


@router.get("/clusters")
async def list_clusters():
    return {"clusters": [{"id": c.id, "color": c.color} for c in _config.clusters]}



@router.get("/queries/stream")
async def stream_queries(
    conditions: Optional[str] = Query(None),
    query_type: Optional[str] = Query(None),
    query_state: Optional[str] = Query(None),
    hours: Optional[int] = Query(None),
    from_time: Optional[str] = Query(None),
    to_time: Optional[str] = Query(None),
    clusters: Optional[str] = Query(None),
):
    req = _build_request(conditions, query_type, query_state, hours, from_time, to_time, clusters)
    filter_applied = build_filter(req.query_type, req.query_state, req.conditions)

    async def generate():
        async for event in cm_client.stream_all_clusters(
            params=req.params,
            cluster_ids=req.cluster_ids,
            query_type=req.query_type,
            query_state=req.query_state,
            conditions=req.conditions,
        ):
            if event["type"] == "done":
                event["filter_applied"] = filter_applied
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/profile/{cluster_id}/{query_id}")
async def get_profile(cluster_id: str, query_id: str):
    cluster = _find_cluster(cluster_id)
    if not cluster:
        return JSONResponse({"error": "cluster not found"}, status_code=404)

    try:
        resp = await cm_client.fetch_query_profile(cluster, query_id)
        if resp.status_code == 404:
            return JSONResponse({"error": "프로파일을 찾을 수 없습니다. 보관 기간이 지났거나 아직 생성되지 않은 프로파일입니다."}, status_code=404)
        resp.raise_for_status()
        profile_text = resp.text
        if "__CLOUDERA_PRE_LOGIN_FORM__" in profile_text[:500]:
            return JSONResponse({"error": "CM 인증 실패: config.yaml의 cm.username / cm.password를 확인하세요."}, status_code=401)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    return Response(
        content=profile_text,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{query_id}_profile.txt"'},
    )

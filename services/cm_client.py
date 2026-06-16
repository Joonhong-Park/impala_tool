from __future__ import annotations

import asyncio
import json
import logging
import math
import re
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator, Optional

import httpx

from services.config_loader import ClusterConfig, CmGlobalConfig, Config

logger = logging.getLogger(__name__)

_config: Optional[Config] = None


def init(config: Config) -> None:
    global _config
    _config = config


# ── 순수 함수 ──────────────────────────────────────────────────────

def build_filter(
    query_type: Optional[str] = None,
    query_state: Optional[str] = None,
    conditions: Optional[list[dict]] = None,
) -> str:
    """적용된 필터 조건을 표시용 문자열로 조합한다. CM API에는 전달하지 않음."""
    parts: list[str] = []
    if query_type:
        parts.append(f'queryType = "{query_type}"')

    for cond in (conditions or []):
        field = cond.get("field", "")
        value = (cond.get("value") or "").strip()
        if not value:
            continue
        if field == "user":
            safe = value.replace('"', '\\"')
            parts.append(f'user = "{safe}"')
        elif field == "keyword":
            parts.append(f'statement rlike "(?i).*{re.escape(value)}.*"')

    if query_state:
        states = [s.strip() for s in query_state.split(",") if s.strip()]
        if len(states) == 1:
            parts.append(f'queryState = "{states[0]}"')
        elif len(states) > 1:
            parts.append(f'queryState rlike "({"|".join(states)})"')

    return " AND ".join(parts)


def resolve_time_range(
    hours: Optional[int] = None,
    from_time: Optional[str] = None,
    to_time: Optional[str] = None,
) -> tuple[str, str]:
    """from/to가 모두 지정되면 그대로 반환, 아니면 hours 기준 ISO 문자열로 계산.
    - from_time + to_time: 그대로 반환
    - to_time만: to 기준 hours 이전을 from으로
    - from_time만: from 기준 hours 이후를 to로
    - 둘 다 없음: 현재 시각 기준 최근 hours
    """
    span = hours if hours is not None else 24
    if from_time and to_time:
        return from_time, to_time
    if from_time:
        from_dt = _parse_dt(from_time)
        return from_time, (from_dt + timedelta(hours=span)).isoformat()
    if to_time:
        end_dt = _parse_dt(to_time)
        return (end_dt - timedelta(hours=span)).isoformat(), to_time
    now = datetime.now(timezone.utc)
    return (now - timedelta(hours=span)).isoformat(), now.isoformat()


def _parse_dt(s: str) -> datetime:
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def _has_active_conditions(conditions: Optional[list[dict]]) -> bool:
    return any((c.get("value") or "").strip() for c in (conditions or []))


def _matches_conditions(
    q: dict,
    query_type: Optional[str],
    query_state: Optional[str],
    conditions: list[dict],
) -> bool:
    if query_type and q.get("queryType") != query_type:
        return False
    if query_state:
        states = [s.strip() for s in query_state.split(",") if s.strip()]
        if states and q.get("queryState") not in states:
            return False
    for cond in conditions:
        field = cond.get("field", "")
        value = (cond.get("value") or "").strip()
        if not value:
            continue
        if field == "user" and q.get("user", "") != value:
            return False
        if field == "keyword" and value.lower() not in q.get("statement", "").lower():
            return False
    return True


# ── HTTP 호출 ────────────────────────────────────────────────────

def _cm_url(cluster: ClusterConfig) -> str:
    return (
        f"https://{cluster.cm.host}:{cluster.cm.port}"
        f"/api/{cluster.cm.api_version}"
        f"/clusters/{cluster.cm.cluster_name}/services/impala/impalaQueries"
    )


async def fetch_query_profile(cluster: ClusterConfig, query_id: str) -> httpx.Response:
    cfg = _config
    url = f"https://{cluster.cm.host}:{cluster.cm.port}/cmf/impala/downloadProfile"
    auth = (cfg.cm.username, cfg.cm.password)
    async with httpx.AsyncClient(verify=False, auth=auth, timeout=cfg.cm.request_timeout) as client:
        return await client.get(url, params={"queryId": query_id, "format": "PRETTY_PRINT"})


def _safe_json(resp: httpx.Response) -> dict:
    """응답을 JSON으로 파싱한다. non-UTF-8 바이트는 U+FFFD로 대체 후 재시도."""
    try:
        return resp.json()
    except UnicodeDecodeError:
        return json.loads(resp.content.decode("utf-8", errors="replace"))


async def _fetch_cluster(
    client: httpx.AsyncClient,
    cluster: ClusterConfig,
    cm: CmGlobalConfig,
    params: dict,
) -> dict:
    """단일 클러스터에서 쿼리 목록을 가져오고, 실패 시 error 필드에 사유를 담아 반환."""
    try:
        resp = await client.get(_cm_url(cluster), params=params, timeout=cm.request_timeout)
        resp.raise_for_status()
        queries = _safe_json(resp).get("queries", [])
        for q in queries:
            q["_cluster"] = cluster.id
        return {"cluster": cluster.id, "queries": queries, "error": None}
    except httpx.TimeoutException:
        logger.warning("cluster=%s | timeout", cluster.id)
        return {"cluster": cluster.id, "queries": [], "error": "timeout"}
    except httpx.HTTPStatusError as e:
        logger.warning("cluster=%s | HTTP %s", cluster.id, e.response.status_code)
        return {"cluster": cluster.id, "queries": [], "error": f"HTTP {e.response.status_code}"}
    except Exception as e:
        logger.error("cluster=%s | %s", cluster.id, e)
        return {"cluster": cluster.id, "queries": [], "error": str(e)}


async def _gather_clusters(
    client: httpx.AsyncClient,
    targets: list[ClusterConfig],
    cm: CmGlobalConfig,
    params: dict,
) -> list[dict]:
    return list(await asyncio.gather(*(_fetch_cluster(client, cl, cm, params) for cl in targets)))


def _resolve_targets(cluster_ids: Optional[list[str]]) -> list[ClusterConfig]:
    if not cluster_ids:
        return list(_config.clusters)
    return [c for c in _config.clusters if c.id in cluster_ids]


def _sort_by_start_desc(queries: list[dict]) -> None:
    queries.sort(key=lambda q: q.get("startTime", ""), reverse=True)


async def stream_all_clusters(
    params: dict,
    cluster_ids: Optional[list[str]] = None,
    query_type: Optional[str] = None,
    query_state: Optional[str] = None,
    conditions: Optional[list[dict]] = None,
) -> AsyncGenerator[dict, None]:
    """모든 대상 클러스터에서 쿼리를 수집한다.

    조건이 없으면 1회 요청으로 끝내고, 조건이 있으면 시간 구간을 청크로 잘라
    progress 이벤트를 흘려보내며 누적 결과를 done 이벤트로 마무리한다.
    """
    cfg = _config
    targets = _resolve_targets(cluster_ids)
    auth = (cfg.cm.username, cfg.cm.password)

    async with httpx.AsyncClient(verify=False, auth=auth) as client:
        has_filters = _has_active_conditions(conditions) or query_type or query_state
        if not has_filters:
            async for ev in _stream_single_shot(client, targets, cfg.cm, params, query_type, query_state):
                yield ev
            return

        async for ev in _stream_chunked(client, targets, cfg.cm, params, query_type, query_state, conditions or []):
            yield ev


async def _stream_single_shot(
    client: httpx.AsyncClient,
    targets: list[ClusterConfig],
    cm: CmGlobalConfig,
    params: dict,
    query_type: Optional[str],
    query_state: Optional[str],
) -> AsyncGenerator[dict, None]:
    """조건이 없을 때: 단일 요청으로 클러스터별 결과를 모은다."""
    yield {"type": "progress", "chunk": 0, "total": 0, "collected": 0, "new_queries": []}

    results = await _gather_clusters(client, targets, cm, {**params, "limit": _config.explorer.chunk_limit})

    all_queries: list[dict] = []
    cluster_results: list[dict] = []
    for res in results:
        filtered = [q for q in res["queries"] if _matches_conditions(q, query_type, query_state, [])]
        all_queries.extend(filtered)
        cluster_results.append({
            "cluster": res["cluster"],
            "count": len(filtered),
            "error": res["error"],
        })

    _sort_by_start_desc(all_queries)
    yield {
        "type": "done",
        "queries": all_queries,
        "cluster_results": cluster_results,
        "total": len(all_queries),
    }


async def _stream_chunked(
    client: httpx.AsyncClient,
    targets: list[ClusterConfig],
    cm: CmGlobalConfig,
    params: dict,
    query_type: Optional[str],
    query_state: Optional[str],
    conditions: list[dict],
) -> AsyncGenerator[dict, None]:
    """조건이 있을 때: 시간 구간을 청크로 잘라 점진적으로 결과를 흘려보낸다."""
    now = datetime.now(timezone.utc)
    from_dt = _parse_dt(params["from"]) if params.get("from") else now - timedelta(hours=24)
    to_dt   = _parse_dt(params["to"])   if params.get("to")   else now

    chunk_delta = timedelta(hours=_config.explorer.chunk_hours)
    total_chunks = math.ceil((to_dt - from_dt) / chunk_delta)

    collected: list[dict] = []
    seen_ids: set[str] = set()
    cluster_counts: dict[str, int] = {t.id: 0 for t in targets}
    cluster_errors: dict[str, Optional[str]] = {t.id: None for t in targets}

    cursor_to = to_dt
    chunk_no = 0
    while cursor_to > from_dt:
        chunk_from = max(from_dt, cursor_to - chunk_delta)
        chunk_no += 1
        prev_count = len(collected)

        chunk_params = {
            "limit": _config.explorer.chunk_limit,
            "from": chunk_from.isoformat(),
            "to": cursor_to.isoformat(),
        }
        results = await _gather_clusters(client, targets, cm, chunk_params)

        for res in results:
            if res["error"]:
                cluster_errors[res["cluster"]] = res["error"]
            for q in res["queries"]:
                qid = q.get("queryId")
                if qid:
                    if qid in seen_ids:
                        continue
                    seen_ids.add(qid)
                if _matches_conditions(q, query_type, query_state, conditions):
                    collected.append(q)
                    cluster_counts[res["cluster"]] += 1

        logger.info("chunk | %d/%d | collected=%d", chunk_no, total_chunks, len(collected))
        yield {
            "type": "progress",
            "chunk": chunk_no,
            "total": total_chunks,
            "collected": len(collected),
            "new_queries": collected[prev_count:],
        }
        cursor_to = chunk_from

    _sort_by_start_desc(collected)
    cluster_results = [
        {"cluster": cid, "count": cluster_counts[cid], "error": cluster_errors[cid]}
        for cid in cluster_counts
    ]
    yield {
        "type": "done",
        "queries": collected,
        "cluster_results": cluster_results,
        "total": len(collected),
    }

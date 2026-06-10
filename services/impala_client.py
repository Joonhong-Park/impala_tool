from __future__ import annotations

from typing import AsyncGenerator, Union

import httpx


class ImpalaClient:
    """impalad HTTP endpoint 비동기 호출 클라이언트."""

    # 상세 조회 타입 → endpoint 경로
    _DETAIL_PATHS: dict[str, str] = {
        "summary": "/query_summary",
        "plan":    "/query_plan_text",
        "profile": "/query_profile_plain_text",
    }

    # 다운로드 포맷 → (endpoint 경로, 추가 query param)
    _DOWNLOAD_SPECS: dict[str, tuple[str, dict]] = {
        "text":   ("/query_profile_plain_text", {}),
        "json":   ("/query_profile",            {"json": ""}),
        "thrift": ("/query_profile",            {"thrift": ""}),
    }

    def __init__(self, ca_bundle: Union[str, bool]) -> None:
        self._verify = ca_bundle

    def _url(self, host: str, port: int, path: str) -> str:
        return f"https://{host}:{port}{path}"

    def _client(self, timeout: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(verify=self._verify, timeout=timeout)

    async def fetch_queries(self, host: str, port: int) -> dict:
        async with self._client(timeout=30) as c:
            resp = await c.get(self._url(host, port, "/queries"), params={"json": ""})
            resp.raise_for_status()
            return resp.json()

    async def cancel_query(self, host: str, port: int, query_id: str) -> bool:
        async with self._client(timeout=15) as c:
            resp = await c.get(
                self._url(host, port, "/cancel_query"),
                params={"query_id": query_id},
            )
            return resp.status_code == 200

    async def fetch_detail(self, host: str, port: int, query_id: str, detail_type: str) -> str:
        path = self._DETAIL_PATHS[detail_type]
        async with self._client(timeout=60) as c:
            resp = await c.get(self._url(host, port, path), params={"query_id": query_id})
            resp.raise_for_status()
            return resp.text

    async def stream_download(
        self, host: str, port: int, query_id: str, fmt: str,
    ) -> AsyncGenerator[bytes, None]:
        path, extra = self._DOWNLOAD_SPECS[fmt]
        params = {"query_id": query_id, **extra}
        async with self._client(timeout=120) as c:
            async with c.stream("GET", self._url(host, port, path), params=params) as resp:
                resp.raise_for_status()
                async for chunk in resp.aiter_bytes():
                    yield chunk

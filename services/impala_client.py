from __future__ import annotations

import ssl
from typing import Union

import httpx


class ImpalaClient:
    """impalad HTTP endpoint 비동기 호출 클라이언트."""

    def __init__(self, ca_bundle: Union[str, bool]) -> None:
        self._verify = ca_bundle

    def _url(self, host: str, port: int, path: str) -> str:
        return f"https://{host}:{port}{path}"

    def _client(self, timeout: float) -> httpx.AsyncClient:
        ctx = ssl.create_default_context()
        if isinstance(self._verify, str) and self._verify:
            ctx.load_verify_locations(cafile=self._verify)
        return httpx.AsyncClient(verify=ctx, timeout=timeout)

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

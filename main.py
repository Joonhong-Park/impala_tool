from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from routers import explorer, monitor
from services import cm_client
from services.config_loader import load_config
from services.impala_client import ImpalaClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler()],
)

BASE_DIR     = Path(__file__).parent
CONFIG_PATH  = BASE_DIR / "config.yaml"
TEMPLATE     = BASE_DIR / "templates" / "index.html"
STATIC_DIR   = BASE_DIR / "static"

config = load_config(CONFIG_PATH)

# 서비스/라우터 의존성 초기화
impala_client = ImpalaClient(ca_bundle=config.app.ca_bundle)
monitor.init(impala_client, config)
cm_client.init(config, verify=config.app.ca_bundle)
explorer.init(config)

app = FastAPI(title="Impala Tool")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.include_router(monitor.router)
app.include_router(explorer.router)


@app.get("/", response_class=HTMLResponse)
async def index() -> str:
    return TEMPLATE.read_text(encoding="utf-8")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=config.app.port, reload=False)

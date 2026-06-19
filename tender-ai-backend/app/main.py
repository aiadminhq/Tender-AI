# -*- coding: utf-8 -*-
"""FastAPI 入口：掛載 v1 查詢／行為 API，並以 X-API-Key 保護（設定後才啟用）。"""
from __future__ import annotations

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import api_router
from app.core.config import settings
from app.core.errors import EntityNotFound
from app.core.security import require_api_key

app = FastAPI(title="Tender AI API", version="0.1.0")

# 前端（Vite 開發站）跨源呼叫：白名單由 CORS_ORIGINS 設定（預設本機 5173／5174），
# 另以 CORS_ORIGIN_REGEX 放行本機任意埠（含 Claude Preview 代理動態埠）。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(EntityNotFound)
async def _entity_not_found_handler(
    request: Request, exc: EntityNotFound
) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": exc.detail})


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api_router, dependencies=[Depends(require_api_key)])

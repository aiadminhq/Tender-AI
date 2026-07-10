# -*- coding: utf-8 -*-
"""FastAPI 入口：掛載 v1 查詢／行為 API，並以 X-API-Key 保護（設定後才啟用）。"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import api_router
from app.core.config import settings
from app.core.errors import (
    AuthNotConfigured,
    DomainValidationError,
    EntityNotFound,
    PermissionDenied,
)
from app.core.security import require_api_key
from app.services.cursor import CursorError
from app.services.embedding import EmbeddingError

logger = logging.getLogger("tender_ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 啟動期 fail-closed 體檢：AUTH_SECRET 漏設時即時告警（否則只會在每個需 token 的請求
    # 才以 503 浮現，難以歸因）。不阻擋啟動——Layer A 唯讀端點與 /health 仍可服務。
    if not settings.auth_secret:
        logger.warning(
            "AUTH_SECRET 未設定：登入無法簽發 token、所有需登入端點將回 503。"
            "請於 .env 設定強隨機 AUTH_SECRET 後重啟。"
        )
    yield

app = FastAPI(title="Tender AI API", version="0.1.0", lifespan=lifespan)

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


@app.exception_handler(PermissionDenied)
async def _permission_denied_handler(
    request: Request, exc: PermissionDenied
) -> JSONResponse:
    return JSONResponse(status_code=403, content={"detail": exc.detail})


@app.exception_handler(CursorError)
async def _cursor_error_handler(
    request: Request, exc: CursorError
) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": exc.detail})


@app.exception_handler(DomainValidationError)
async def _domain_validation_handler(
    request: Request, exc: DomainValidationError
) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": exc.detail})


@app.exception_handler(AuthNotConfigured)
async def _auth_not_configured_handler(
    request: Request, exc: AuthNotConfigured
) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": exc.detail})


@app.exception_handler(EmbeddingError)
async def _embedding_error_handler(
    request: Request, exc: EmbeddingError
) -> JSONResponse:
    # 語意檢索依賴的 embedding 後端（Ollama）不可用時，回可辨識的「離線降級」503，
    # 而非不透明 500。前端據 code=semantic_degraded 顯示「語意搜尋離線降級」狀態，
    # 不與真實錯誤混淆、也不假裝結果正常（見 roadmap P2-6、CLAUDE.md 雲端無 Ollama）。
    logger.warning("語意檢索離線降級：embedding 後端不可用（%s）", exc)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "語意檢索暫時無法使用：向量後端（Ollama）目前不可連線。",
            "code": "semantic_degraded",
        },
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api_router, dependencies=[Depends(require_api_key)])

# -*- coding: utf-8 -*-
"""簡易 API Key 驗證（單一團隊內網用）。

設定 APP_API_KEY 後，所有 v1 端點需帶 X-API-Key 標頭；
未設定（空字串）時不啟用驗證（開發／CI 預設關閉）。
"""
from __future__ import annotations

from fastapi import Header, HTTPException, status

from app.core.config import settings


async def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if not settings.app_api_key:
        return  # 未設金鑰：不啟用驗證
    if x_api_key != settings.app_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing X-API-Key",
        )

# -*- coding: utf-8 -*-
"""登入 API（Phase 2 真鑑權：驗密碼後簽發 HMAC token）。

  POST /api/v1/auth/login   以信箱＋密碼驗證身分，回傳帳戶資料＋簽發 token

信任邊界（Phase 2）：驗密碼後由伺服器端簽發 stateless HMAC token；
前端將 token 存 localStorage 並以 Authorization: Bearer <token> 帶入後續請求。
token 只含 uid，role／whitelist_active 每次請求從 DB 即時驗證。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import issue_token
from app.core.config import settings
from app.db.session import get_session
from app.schemas.user import LoginIn, LoginOut, SupabaseLoginIn
from app.services import account as asvc

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginOut)
async def login(
    body: LoginIn,
    session: AsyncSession = Depends(get_session),
) -> LoginOut:
    user = await asvc.authenticate(session, body.email, body.password)
    out = LoginOut.model_validate(user)
    # 仍是預設密碼時提示前端於設定頁建議修改（不強制）。
    # 依儲存雜湊推導（與 /me 同一事實來源），重整後狀態才一致。
    out.password_is_default = asvc.is_default_password(user)
    out.token = issue_token(user)
    out.expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.auth_token_ttl_hours)
    return out


@router.post("/supabase", response_model=LoginOut)
async def login_with_supabase(
    body: SupabaseLoginIn,
    session: AsyncSession = Depends(get_session),
) -> LoginOut:
    """交換 Supabase access token 為 Tender AI 自有 HMAC token。"""
    user = await asvc.authenticate_supabase(session, body.access_token)
    out = LoginOut.model_validate(user)
    out.password_is_default = asvc.is_default_password(user)
    out.token = issue_token(user)
    out.expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.auth_token_ttl_hours)
    return out

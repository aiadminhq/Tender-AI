# -*- coding: utf-8 -*-
"""登入 API（Phase 2 輕量機制）。

  POST /api/v1/auth/login   以信箱＋密碼驗證身分，回傳帳戶資料

信任邊界：本機制**不簽發 token**——驗密碼後由前端依回傳帳戶自行記住身分
（沿用 Phase 1 作法，身分／角色仍可偽造，僅作合作範圍內的便利登入）。
Phase 3 才改伺服器端 session／JWT。回應一律不含 token 或密碼。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.user import LoginIn, LoginOut
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
    return out

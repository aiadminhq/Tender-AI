# -*- coding: utf-8 -*-
"""白名單登入（@hqdesign.tw）API：POST /auth/login。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.db.session import get_session
from app.schemas.auth import AuthUserOut, LoginRequest, LoginResponse
from app.services.auth import authenticate

router = APIRouter(tags=["auth"])


@router.post("/auth/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> LoginResponse:
    user = await authenticate(session, body.email, body.password)
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "帳號、密碼錯誤，或尚未開通白名單",
        )
    token = create_access_token(user.id, user.email or "", user.role)
    return LoginResponse(access_token=token, user=AuthUserOut.model_validate(user))

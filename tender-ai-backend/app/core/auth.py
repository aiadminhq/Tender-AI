# -*- coding: utf-8 -*-
"""白名單登入（@hqdesign.tw）：app 自簽 JWT（HS256）+ Django 相容 pbkdf2 密碼驗證。

密碼雜湊沿用既有 users.password_hash（pbkdf2_sha256，與舊系統相容），
新登入一律走這裡簽發的 JWT，不依賴 Supabase Auth 或任何第三方身分服務。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import NamedTuple

import jwt
from fastapi import Header, HTTPException, status
from passlib.hash import django_pbkdf2_sha256

from app.core.config import settings


def verify_password(plain: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return django_pbkdf2_sha256.verify(plain, hashed)
    except ValueError:
        return False


def is_whitelisted_domain(email: str) -> bool:
    return email.strip().lower().endswith(settings.company_domain.lower())


def create_access_token(user_id: int, email: str, role: str | None) -> str:
    if not settings.jwt_secret:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "JWT_SECRET 未設定，無法簽發登入憑證",
        )
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


class CurrentUser(NamedTuple):
    id: int
    email: str
    role: str | None


async def get_current_user(
    authorization: str | None = Header(default=None),
) -> CurrentUser:
    """驗證前端帶入的 Bearer JWT；缺漏／過期／簽章不符一律 401。"""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    token = authorization.split(" ", 1)[1]
    if not settings.jwt_secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "auth not configured")
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token") from exc
    return CurrentUser(id=int(claims["sub"]), email=claims["email"], role=claims.get("role"))

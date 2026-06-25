"""Phase 2 鑑權：stdlib HMAC 簽章 stateless token。

格式：base64url(payload).base64url(hmac_sha256(payload, AUTH_SECRET))
payload：{"uid": <int>, "exp": <unix>, "iat": <unix>}
token 只放 uid；role / whitelist_active 每次請求從 DB 即時撈（近即時撤銷，免 session 表）。
零新相依（hmac/hashlib/base64/json）。日後升 JWT/SSO 只改本檔。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import PermissionDenied
from app.db.session import get_session
from app.models.behavior import User


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _secret() -> bytes:
    secret = settings.auth_secret
    if not secret:
        raise RuntimeError("AUTH_SECRET 未設定，拒絕簽發／驗證 token（避免空祕密誤上線）")
    return secret.encode("utf-8")


def _sign(payload_b64: str) -> str:
    sig = hmac.new(_secret(), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return _b64url_encode(sig)


def issue_token(user) -> str:
    now = int(time.time())
    exp = now + settings.auth_token_ttl_hours * 3600
    payload = {"uid": int(user.id), "iat": now, "exp": exp}
    payload_b64 = _b64url_encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    )
    return f"{payload_b64}.{_sign(payload_b64)}"


def decode_token(token: str) -> dict | None:
    if not token or not isinstance(token, str) or "." not in token:
        # 仍需確認 secret 存在（缺值要 raise，符合 spec §2.2）
        _secret()
        return None
    payload_b64, _, sig_b64 = token.partition(".")
    expected = _sign(payload_b64)
    if not hmac.compare_digest(sig_b64, expected):
        return None
    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or "exp" not in payload or "uid" not in payload:
        return None
    try:
        if int(payload["exp"]) < int(time.time()):
            return None
    except (TypeError, ValueError):
        return None
    return payload


async def get_current_user(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> User:
    """從 Bearer token 推導使用者身分；無/壞/過期/查無 uid → 401；whitelist_active=False → 403。"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="缺少 Bearer token")
    token = authorization[len("Bearer "):].strip()
    payload = decode_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token 無效或已過期")
    user = await session.get(User, int(payload["uid"]))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="查無此使用者")
    if not user.whitelist_active:
        raise PermissionDenied("帳號未在白名單或已停用，請洽管理員")
    return user


async def require_admin_user(user: User = Depends(get_current_user)) -> User:
    """確認使用者為管理員；否則 403。"""
    if user.role != "admin":
        raise PermissionDenied("需要管理員權限")
    return user

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

from app.core.config import settings


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

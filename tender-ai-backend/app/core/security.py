# -*- coding: utf-8 -*-
"""簡易 API Key 驗證 + 密碼雜湊工具（單一團隊內網用）。

設定 APP_API_KEY 後，所有 v1 端點需帶 X-API-Key 標頭；
未設定（空字串）時不啟用驗證（開發／CI 預設關閉）。

密碼雜湊（Phase 2）：用 Python 標準庫 ``hashlib.pbkdf2_hmac``（SHA-256），
免新增編譯型相依、離線環境亦可運作；每帳號獨立鹽，passlib 風格字串儲存。
明文密碼**永不**落地或記錄；只存雜湊字串於 ``users.password_hash``。
"""
from __future__ import annotations

import hashlib
import hmac
import os

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


# --------------------------------------------------------------------------- #
# 密碼雜湊（pbkdf2_sha256）
# --------------------------------------------------------------------------- #
_PBKDF2_ALGO = "pbkdf2_sha256"
_PBKDF2_ITERATIONS = 200_000
_SALT_BYTES = 16


def hash_password(password: str) -> str:
    """把明文密碼雜湊成可儲存字串：``pbkdf2_sha256$<iter>$<salt_hex>$<hash_hex>``。

    每次呼叫產生新鹽，故同一密碼每次雜湊結果不同（防彩虹表／比對）。
    """
    if not password:
        raise ValueError("password must not be empty")
    salt = os.urandom(_SALT_BYTES)
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS
    )
    return f"{_PBKDF2_ALGO}${_PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    """以定速比對驗證明文密碼是否符合儲存的雜湊字串。

    格式不符／帳號尚未設密碼（stored 為 None／空）一律回 False，不丟例外。
    """
    if not stored or not password:
        return False
    try:
        algo, iter_s, salt_hex, hash_hex = stored.split("$", 3)
        if algo != _PBKDF2_ALGO:
            return False
        iterations = int(iter_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except (ValueError, AttributeError):
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(dk, expected)

# -*- coding: utf-8 -*-
"""白名單登入（@hqdesign.tw）認證服務。"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import is_whitelisted_domain, verify_password
from app.models.behavior import User


async def authenticate(session: AsyncSession, email: str, password: str) -> User | None:
    """email/password 皆正確、且帳號在白名單(@hqdesign.tw)內生效才回傳 User；否則 None。

    刻意不區分「帳號不存在」／「密碼錯誤」／「未開通白名單」的錯誤訊息，避免帳號列舉。
    """
    normalized = email.strip().lower()
    if not is_whitelisted_domain(normalized):
        return None
    user = (
        await session.execute(select(User).where(User.email == normalized))
    ).scalar_one_or_none()
    if user is None or not user.whitelist_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user

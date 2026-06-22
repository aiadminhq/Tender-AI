# -*- coding: utf-8 -*-
"""個人資料／白名單／同意／個人偏好輪廓服務（Phase 1）。

承載計畫 `plans/profile-and-learning-db/plan.mdx` 的兩段式同意與白名單治理：
- 第 1 段：管理員 `set_whitelist`（界定合作範圍；只改 whitelist_active）。
- 第 2 段：本人 `set_consent`（把行為具名匯入團隊共享庫；可撤回，撤回只停止
  後續匯入、不回溯重算，consent_at 不清空）。

**信任邊界（Phase 1）**：身分由呼叫端帶入、未驗證；管理權限與「本人」判定為
Phase 2 工作。此處只強制可驗證的業務規則（白名單前置、信箱網域），其餘標 TODO。
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import DomainValidationError, EntityNotFound, PermissionDenied
from app.models.behavior import User
from app.models.preference import PreferenceProfile
from app.services.behavior import get_or_create_default_user

# 合作範圍網域：白名單帳號原則上須為此網域（見 CLAUDE.md Layer B 治理）
ALLOWED_EMAIL_DOMAIN = "@hqdesign.tw"


async def get_me(session: AsyncSession, user_id: int | None) -> User:
    """取得當前登入者帳戶。

    Phase 1：user_id 省略時回傳佔位（預設）帳號；給定 id 則須存在，否則 404。
    """
    if user_id is None:
        return await get_or_create_default_user(session)
    user = await session.get(User, user_id)
    if user is None:
        raise EntityNotFound(f"user {user_id} not found")
    return user


async def set_consent(
    session: AsyncSession, user_id: int | None, consent_shared: bool
) -> User:
    """本人設定／撤回共享同意（第 2 段）。

    前置：帳號須在白名單內（whitelist_active），否則 403——未開通者無從匯入
    團隊庫。同意（True）寫入 consent_at；撤回（False）保留 consent_at、僅停止
    後續匯入。Phase 2 須再加「限本人」的伺服器端驗證。
    """
    user = await get_me(session, user_id)
    if not user.whitelist_active:
        raise PermissionDenied("account not in whitelist; ask admin to activate first")
    # TODO(Phase 2): 驗證呼叫端確為本人（session 推導），管理員不可代呼叫
    user.consent_shared = consent_shared
    if consent_shared and user.consent_at is None:
        # 首次同意時點；撤回不清空 consent_at，故僅在尚未記錄時寫入
        user.consent_at = func.now()
    await session.flush()
    await session.refresh(user)
    return user


async def get_preference_profile(
    session: AsyncSession, user_id: int | None
) -> PreferenceProfile | None:
    """取得本人個人化偏好輪廓（衍生表，只讀不算）。

    尚未經學習任務產出時回傳 None（API 層回空輪廓、不 404）。讀取路徑不建立
    任何資料。
    """
    if user_id is None:
        user = (
            await session.execute(select(User).where(User.name == "default"))
        ).scalar_one_or_none()
        if user is None:
            return None
        uid = user.id
    else:
        if await session.get(User, user_id) is None:
            raise EntityNotFound(f"user {user_id} not found")
        uid = user_id
    return (
        await session.execute(
            select(PreferenceProfile).where(PreferenceProfile.user_id == uid)
        )
    ).scalar_one_or_none()


async def list_whitelist(session: AsyncSession) -> list[User]:
    """列出所有帳號與其白名單／同意狀態（管理頁用）。"""
    rows = (
        (await session.execute(select(User).order_by(User.id))).scalars().all()
    )
    return list(rows)


async def set_whitelist(
    session: AsyncSession, email: str, whitelist_active: bool
) -> User:
    """管理員開通／停用白名單帳號（第 1 段；只改 whitelist_active）。

    信箱須為 @hqdesign.tw 網域，否則 422。帳號不存在時預先建立（pre-provision，
    供同事尚未登入即可開通）。**不得**在此改任何人的 consent_shared。
    """
    email_norm = (email or "").strip().lower()
    if not email_norm.endswith(ALLOWED_EMAIL_DOMAIN):
        raise DomainValidationError(f"email must be under {ALLOWED_EMAIL_DOMAIN}")
    user = (
        await session.execute(select(User).where(User.email == email_norm))
    ).scalar_one_or_none()
    if user is None:
        # 預先建立帳號（name 取信箱本地部分；role 預設 member）
        user = User(
            name=email_norm.split("@", 1)[0],
            email=email_norm,
            role="member",
            whitelist_active=whitelist_active,
        )
        session.add(user)
    else:
        user.whitelist_active = whitelist_active
    await session.flush()
    await session.refresh(user)
    return user

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
from app.core.security import hash_password, verify_password
from app.models.behavior import User
from app.models.preference import PreferenceProfile
from app.services.behavior import get_or_create_default_user

# 合作範圍網域：白名單帳號原則上須為此網域（見 CLAUDE.md Layer B 治理）
ALLOWED_EMAIL_DOMAIN = "@hqdesign.tw"

# 種子帳號預設密碼（見 jobs/seed_members.py）。前端據此提示「建議修改密碼」。
DEFAULT_SEED_PASSWORD = "admin"
# 密碼最短長度（內部工具，從寬；預設 "admin" 為 5 字元）
MIN_PASSWORD_LENGTH = 4


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


def is_default_password(user: User) -> bool:
    """帳號是否仍使用預設種子密碼（admin）。

    依**儲存的雜湊**比對（單一事實來源），故任何讀取路徑（含 /me）皆可推導，
    不需仰賴登入當下帶入的明文。前端據此於設定頁提示「建議修改密碼」（不強制）。
    尚未設密碼的帳號回 False。
    """
    if not user.password_hash:
        return False
    return verify_password(DEFAULT_SEED_PASSWORD, user.password_hash)


def _validate_new_password(password: str) -> None:
    """新密碼基本規則：非空且不短於最短長度，否則 422。"""
    if not password or len(password) < MIN_PASSWORD_LENGTH:
        raise DomainValidationError(
            f"password must be at least {MIN_PASSWORD_LENGTH} characters"
        )


async def authenticate(session: AsyncSession, email: str, password: str) -> User:
    """以信箱＋密碼驗證身分（Phase 2 輕量登入）。

    信箱或密碼錯誤、帳號尚未設密碼一律回同一個 403（不洩漏帳號是否存在）。
    成功回傳 User；本機制不簽發 token，前端依回傳帳戶自行記住身分。
    """
    email_norm = (email or "").strip().lower()
    user = (
        await session.execute(select(User).where(User.email == email_norm))
    ).scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        raise PermissionDenied("invalid email or password")
    return user


async def change_password(
    session: AsyncSession,
    user_id: int | None,
    old_password: str,
    new_password: str,
) -> User:
    """本人修改密碼：須通過舊密碼驗證，新密碼通過基本規則後落地（只存雜湊）。

    舊密碼錯誤／帳號尚未設密碼 → 403；新密碼不合規 → 422。Phase 2 須再加
    「限本人」的伺服器端驗證（目前 user_id 由 body 帶入、未驗證）。
    """
    user = await get_me(session, user_id)
    if not verify_password(old_password, user.password_hash):
        raise PermissionDenied("old password does not match")
    _validate_new_password(new_password)
    # TODO(Phase 2): 驗證呼叫端確為本人（session 推導）
    user.password_hash = hash_password(new_password)
    await session.flush()
    await session.refresh(user)
    return user


async def admin_set_password(
    session: AsyncSession, user_id: int, new_password: str
) -> User:
    """管理員修改／重置某帳號密碼（不需舊密碼）。

    帳號不存在 → 404；新密碼不合規 → 422。權限把關在 API 層（require_admin）。
    """
    user = await session.get(User, user_id)
    if user is None:
        raise EntityNotFound(f"user {user_id} not found")
    _validate_new_password(new_password)
    user.password_hash = hash_password(new_password)
    await session.flush()
    await session.refresh(user)
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

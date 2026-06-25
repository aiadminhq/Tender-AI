# -*- coding: utf-8 -*-
"""白名單管理 API（管理員，第 1 段同意）。

  GET  /api/v1/admin/whitelist   列出所有帳號與其白名單／同意狀態
  POST /api/v1/admin/whitelist   開通／停用白名單帳號（只改 whitelist_active）

**Phase 1 暫時性權限檢查**：以 header `X-User-Role: admin` 把關（標 TODO）；
非管理員 403、信箱非 @hqdesign.tw 422。Phase 2 改由伺服器端 session 推導 role
並強制驗證，忽略 header 帶入值。管理員**不得**改任何人的 consent_shared。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import PermissionDenied
from app.db.session import get_session
from app.schemas.user import AdminPasswordIn, MeOut, WhitelistIn, WhitelistOut
from app.services import account as asvc

router = APIRouter(prefix="/admin", tags=["admin"])


# TODO(Phase 2): 改由 session 推導 role 並伺服器端強制；目前僅暫時性 header 檢查
async def require_admin(x_user_role: str | None = Header(default=None)) -> None:
    if x_user_role != "admin":
        raise PermissionDenied("admin role required")


@router.get(
    "/whitelist",
    response_model=list[WhitelistOut],
    dependencies=[Depends(require_admin)],
)
async def list_whitelist(
    session: AsyncSession = Depends(get_session),
) -> list[WhitelistOut]:
    rows = await asvc.list_whitelist(session)
    return [WhitelistOut.model_validate(r) for r in rows]


@router.post(
    "/whitelist",
    response_model=WhitelistOut,
    dependencies=[Depends(require_admin)],
)
async def set_whitelist(
    body: WhitelistIn,
    session: AsyncSession = Depends(get_session),
) -> WhitelistOut:
    user = await asvc.set_whitelist(session, body.email, body.whitelist_active)
    await session.commit()
    return WhitelistOut.model_validate(user)


@router.delete(
    "/whitelist/{email}",
    status_code=204,
    dependencies=[Depends(require_admin)],
)
async def delete_account(
    email: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    """自名單移除帳號（連帶清除其 Layer B 衍生列；ON DELETE CASCADE）。

    信箱非 @hqdesign.tw → 422；查無帳號 → 404；系統佔位帳號 → 403。
    成功回 204（無內容）。前端刪除須真正落地，否則重整時 hydration 會復活帳號。
    """
    await asvc.delete_account(session, email)
    await session.commit()


@router.post(
    "/users/{user_id}/password",
    response_model=MeOut,
    dependencies=[Depends(require_admin)],
)
async def admin_set_password(
    user_id: int,
    body: AdminPasswordIn,
    session: AsyncSession = Depends(get_session),
) -> MeOut:
    """管理員修改／重置某帳號密碼（不需舊密碼）。回傳帳戶（不含密碼）。"""
    user = await asvc.admin_set_password(session, user_id, body.new_password)
    await session.commit()
    return MeOut.model_validate(user)

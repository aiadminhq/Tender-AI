# -*- coding: utf-8 -*-
"""當前使用者 API：帳戶／共享同意／個人化偏好輪廓（Phase 1）。

  GET  /api/v1/me                     帳戶＋白名單＋同意狀態
  PUT  /api/v1/me/consent             本人設定／撤回共享同意（第 2 段）
  GET  /api/v1/me/preference-profile  AI 從本人行為學到的個人化偏好

信任邊界：Phase 1 身分由 body／query 帶入、未驗證；Phase 2 改由 session 推導。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.user import ConsentIn, ConsentOut, MeOut, PreferenceProfileOut
from app.services import account as asvc

router = APIRouter(tags=["me"])


@router.get("/me", response_model=MeOut)
async def get_me(
    user_id: int | None = None,
    session: AsyncSession = Depends(get_session),
) -> MeOut:
    user = await asvc.get_me(session, user_id)
    await session.commit()  # 佔位帳號可能於此建立
    return MeOut.model_validate(user)


@router.put("/me/consent", response_model=ConsentOut)
async def put_consent(
    body: ConsentIn,
    session: AsyncSession = Depends(get_session),
) -> ConsentOut:
    user = await asvc.set_consent(session, body.user_id, body.consent_shared)
    await session.commit()
    return ConsentOut.model_validate(user)


@router.get("/me/preference-profile", response_model=PreferenceProfileOut)
async def get_preference_profile(
    user_id: int | None = None,
    session: AsyncSession = Depends(get_session),
) -> PreferenceProfileOut:
    profile = await asvc.get_preference_profile(session, user_id)
    if profile is None:
        # 尚未學出輪廓：回空輪廓（不 404）
        return PreferenceProfileOut()
    return PreferenceProfileOut.model_validate(profile)

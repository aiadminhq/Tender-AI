# -*- coding: utf-8 -*-
"""當前使用者 API：帳戶／共享同意／個人化偏好輪廓（Phase 2）。

  GET  /api/v1/me                     帳戶＋白名單＋同意狀態
  PUT  /api/v1/me/consent             本人設定／撤回共享同意（第 2 段）
  PUT  /api/v1/me/password            本人修改密碼（須帶舊密碼）
  GET  /api/v1/me/preference-profile  AI 從本人行為學到的個人化偏好
  GET  /api/v1/me/abandoned-keyword-candidates  規則頁建議迴避字根（唯讀）
  GET  /api/v1/me/tender-decisions    決策回顧（唯讀）
  POST /api/v1/me/keywords            推理卡手動關鍵字覆寫（add／remove）

身分由 token 推導（Phase 2）：所有 /me/* 端點改以 get_current_user dependency
取得當前使用者，移除 Phase 1 的 user_id query/body 參數。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.db.session import get_session
from app.models.behavior import User
from app.schemas.reasoning import (
    AbandonedKeywordCandidatesOut,
    CriteriaProfileOut,
    ManualKeywordIn,
    TenderDecisionsOut,
)
from app.schemas.user import (
    ConsentIn,
    ConsentOut,
    MeOut,
    PasswordChangeIn,
    PreferenceProfileOut,
)
from app.services import abandoned_keywords as akc_svc
from app.services import account as asvc
from app.services import manual_keywords as mksvc
from app.services import reasoning as reasoning_svc
from app.services import tender_decisions as td_svc

router = APIRouter(tags=["me"])


@router.get("/me", response_model=MeOut)
async def get_me(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MeOut:
    out = MeOut.model_validate(user)
    out.password_is_default = asvc.is_default_password(user)
    return out


@router.put("/me/consent", response_model=ConsentOut)
async def put_consent(
    body: ConsentIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ConsentOut:
    updated = await asvc.set_consent(session, user.id, body.consent_shared)
    await session.commit()
    return ConsentOut.model_validate(updated)


@router.put("/me/password", response_model=MeOut)
async def put_password(
    body: PasswordChangeIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MeOut:
    """本人修改密碼（設定頁）：須帶舊密碼，驗證後換新。回傳帳戶（不含密碼）。"""
    updated = await asvc.change_password(
        session, user.id, body.old_password, body.new_password
    )
    await session.commit()
    out = MeOut.model_validate(updated)
    out.password_is_default = asvc.is_default_password(updated)
    return out


@router.get("/me/preference-profile", response_model=PreferenceProfileOut)
async def get_preference_profile(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PreferenceProfileOut:
    profile = await asvc.get_preference_profile(session, user.id)
    if profile is None:
        # 尚未學出輪廓：回空輪廓（不 404）
        return PreferenceProfileOut()
    return PreferenceProfileOut.model_validate(profile)


@router.get(
    "/me/abandoned-keyword-candidates",
    response_model=AbandonedKeywordCandidatesOut,
)
async def get_abandoned_keyword_candidates(
    min_count: int = 2,
    limit: int = 40,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AbandonedKeywordCandidatesOut:
    """規則頁「建議迴避字根」：由本人淘汰過的標案標題聚合字根／詞候選（唯讀）。

    僅為附證據（count／示例標題）的**建議**；真正歸負分需本人於規則頁按下「加入迴避」
    走 ``POST /me/keywords``（kind=negative），此端點不寫任何權重（負分人工專屬紅線）。
    """
    data = await akc_svc.abandoned_keyword_candidates(
        session, user.id, min_count=min_count, limit=limit
    )
    return AbandonedKeywordCandidatesOut.model_validate(data)


@router.get("/me/tender-decisions", response_model=TenderDecisionsOut)
async def get_tender_decisions(
    limit: int = 200,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TenderDecisionsOut:
    """決策回顧 / 評分管理：彙整本人按過星星／打勾／叉叉的標案處置清單（唯讀）。

    由 Layer B 行為訊號（速覽 pass 事件、tender_user_state 狀態／收藏／星等）重建，
    供前端「決策回顧」頁水合後重新檢視存留／淘汰。此端點不寫任何權重／狀態（唯讀）。
    """
    data = await td_svc.user_tender_decisions(session, user.id, limit=limit)
    return TenderDecisionsOut.model_validate(data)


@router.post("/me/keywords", response_model=CriteriaProfileOut)
async def post_keyword_override(
    body: ManualKeywordIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CriteriaProfileOut:
    """推理卡手動關鍵字覆寫：add／remove 一個偏好／迴避／常點開的詞。

    action=add → excluded=False（新增）；remove → excluded=True（隱藏／撤回）。
    回傳合併覆寫後的最新判準輪廓。kind=negative 為「負分人工專屬」合規路徑。
    """
    await mksvc.upsert_manual_keyword(
        session, user.id, body.term, body.kind, excluded=(body.action == "remove")
    )
    await session.commit()
    profile = await reasoning_svc.build_criteria_profile(session, user.id)
    return reasoning_svc.profile_to_out(profile)

# -*- coding: utf-8 -*-
"""當前使用者 API：帳戶／共享同意／個人化偏好輪廓（Phase 1）。

  GET  /api/v1/me                     帳戶＋白名單＋同意狀態
  PUT  /api/v1/me/consent             本人設定／撤回共享同意（第 2 段）
  GET  /api/v1/me/preference-profile  AI 從本人行為學到的個人化偏好
  POST /api/v1/me/keywords            推理卡手動關鍵字覆寫（add／remove）

信任邊界：Phase 1 身分由 body／query 帶入、未驗證；Phase 2 改由 session 推導。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
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
    user_id: int | None = None,
    session: AsyncSession = Depends(get_session),
) -> MeOut:
    user = await asvc.get_me(session, user_id)
    await session.commit()  # 佔位帳號可能於此建立
    out = MeOut.model_validate(user)
    out.password_is_default = asvc.is_default_password(user)
    return out


@router.put("/me/consent", response_model=ConsentOut)
async def put_consent(
    body: ConsentIn,
    session: AsyncSession = Depends(get_session),
) -> ConsentOut:
    user = await asvc.set_consent(session, body.user_id, body.consent_shared)
    await session.commit()
    return ConsentOut.model_validate(user)


@router.put("/me/password", response_model=MeOut)
async def put_password(
    body: PasswordChangeIn,
    session: AsyncSession = Depends(get_session),
) -> MeOut:
    """本人修改密碼（設定頁）：須帶舊密碼，驗證後換新。回傳帳戶（不含密碼）。"""
    user = await asvc.change_password(
        session, body.user_id, body.old_password, body.new_password
    )
    await session.commit()
    out = MeOut.model_validate(user)
    out.password_is_default = asvc.is_default_password(user)
    return out


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


@router.get(
    "/me/abandoned-keyword-candidates",
    response_model=AbandonedKeywordCandidatesOut,
)
async def get_abandoned_keyword_candidates(
    user_id: int | None = None,
    min_count: int = 2,
    limit: int = 40,
    session: AsyncSession = Depends(get_session),
) -> AbandonedKeywordCandidatesOut:
    """規則頁「建議迴避字根」：由本人淘汰過的標案標題聚合字根／詞候選（唯讀）。

    僅為附證據（count／示例標題）的**建議**；真正歸負分需本人於規則頁按下「加入迴避」
    走 ``POST /me/keywords``（kind=negative），此端點不寫任何權重（負分人工專屬紅線）。
    """
    user = await asvc.get_me(session, user_id)
    await session.commit()  # 佔位帳號可能於此建立
    data = await akc_svc.abandoned_keyword_candidates(
        session, user.id, min_count=min_count, limit=limit
    )
    return AbandonedKeywordCandidatesOut.model_validate(data)


@router.get("/me/tender-decisions", response_model=TenderDecisionsOut)
async def get_tender_decisions(
    user_id: int | None = None,
    limit: int = 200,
    session: AsyncSession = Depends(get_session),
) -> TenderDecisionsOut:
    """決策回顧 / 評分管理：彙整本人按過星星／打勾／叉叉的標案處置清單（唯讀）。

    由 Layer B 行為訊號（速覽 pass 事件、tender_user_state 狀態／收藏／星等）重建，
    供前端「決策回顧」頁水合後重新檢視存留／淘汰。此端點不寫任何權重／狀態（唯讀）。
    """
    user = await asvc.get_me(session, user_id)
    await session.commit()  # 佔位帳號可能於此建立
    data = await td_svc.user_tender_decisions(session, user.id, limit=limit)
    return TenderDecisionsOut.model_validate(data)


@router.post("/me/keywords", response_model=CriteriaProfileOut)
async def post_keyword_override(
    body: ManualKeywordIn,
    session: AsyncSession = Depends(get_session),
) -> CriteriaProfileOut:
    """推理卡手動關鍵字覆寫：add／remove 一個偏好／迴避／常點開的詞。

    action=add → excluded=False（新增）；remove → excluded=True（隱藏／撤回）。
    回傳合併覆寫後的最新判準輪廓。kind=negative 為「負分人工專屬」合規路徑。
    """
    user = await asvc.get_me(session, body.user_id)
    await mksvc.upsert_manual_keyword(
        session, user.id, body.term, body.kind, excluded=(body.action == "remove")
    )
    await session.commit()
    profile = await reasoning_svc.build_criteria_profile(session, user.id)
    return reasoning_svc.profile_to_out(profile)

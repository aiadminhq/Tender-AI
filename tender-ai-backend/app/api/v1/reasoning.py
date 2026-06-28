# -*- coding: utf-8 -*-
"""SL3 意圖與推理 API（Layer A 輸出，唯讀）。

端點：
- ``GET /tenders/{id}/reasoning``：單一標案的可中標推理（fit + reason codes + 結論）。
- ``GET /tenders/{id}/keyword-candidates``：速覽判斷原因表單的字／詞候選（唯讀）。
- ``GET /reasoning/profile``：操作者判準輪廓（系統「學到」的承標標準，可被檢視）。

回傳皆為公開欄位與聚合統計；個別評語原文／人名／email 不對非合作範圍對象外洩（Layer B 明細限白名單合作範圍）。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.reasoning import (
    CriteriaProfileOut,
    KeywordCandidatesOut,
    TenderReasoningOut,
)
from app.services import keyword_candidates as kc_svc
from app.services import reasoning as reasoning_svc

router = APIRouter(tags=["reasoning"])


@router.get(
    "/tenders/{tender_id}/keyword-candidates",
    response_model=KeywordCandidatesOut,
)
async def tender_keyword_candidates(
    tender_id: int,
    user_id: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> KeywordCandidatesOut:
    """速覽判斷原因表單：字／詞候選＋正向命中＋系統負向建議。

    ``recommended_negative`` 僅為系統建議（附理由）；真正歸負分需本人於表單確認後
    走 ``POST /me/keywords``，此端點不寫任何權重（負分人工專屬紅線）。查無 → 404。
    """
    return await kc_svc.keyword_candidates(session, tender_id, user_id)


@router.get("/tenders/{tender_id}/reasoning", response_model=TenderReasoningOut)
async def tender_reasoning(
    tender_id: int,
    user_id: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> TenderReasoningOut:
    """為何（不）值得投標：逐條可解釋推理。查無標案 → 404。"""
    return await reasoning_svc.explain_tender(session, tender_id, user_id)


@router.get("/reasoning/profile", response_model=CriteriaProfileOut)
async def criteria_profile(
    user_id: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> CriteriaProfileOut:
    """操作者承標判準輪廓：類別/地點/來源 lift、預算區間、學習關鍵字、點擊偏好。"""
    profile = await reasoning_svc.build_criteria_profile(session, user_id)
    return reasoning_svc.profile_to_out(profile)

# -*- coding: utf-8 -*-
"""SL3 意圖與推理 API（Layer A 輸出，唯讀）。

兩個端點：
- ``GET /tenders/{id}/reasoning``：單一標案的可中標推理（fit + reason codes + 結論）。
- ``GET /reasoning/profile``：操作者判準輪廓（系統「學到」的承標標準，可被檢視）。

回傳皆為公開欄位與聚合統計；個別評語原文／人名／email 不外洩（Layer B 隔離）。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.reasoning import CriteriaProfileOut, TenderReasoningOut
from app.services import reasoning as reasoning_svc

router = APIRouter(tags=["reasoning"])


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

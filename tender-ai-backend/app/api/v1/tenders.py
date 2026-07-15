# -*- coding: utf-8 -*-
"""標案查詢 API（Layer A，唯讀）。"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.tender import (
    SortKey,
    TenderDetail,
    TenderListResponse,
    TenderQuery,
)
from app.services import query as query_svc

router = APIRouter(prefix="/tenders", tags=["tenders"])


def get_today() -> date:
    """提供判定「有效案」的基準日（Asia/Taipei）。
    以 FastAPI 依賴注入表述，讓測試可用 dependency_overrides 凍結為固定日期，
    正式環境則走真實台灣今日。
    """
    return query_svc.taipei_today()


@router.get("", response_model=TenderListResponse)
async def list_tenders(
    tier: list[str] = Query(default=[]),
    cat: list[str] = Query(default=[]),
    city: list[str] = Query(default=[]),
    src: list[str] = Query(default=[]),
    deadline: int | None = Query(default=None),
    budget_min: int | None = Query(default=None),
    budget_max: int | None = Query(default=None),
    focus: list[str] = Query(default=[]),
    avoid: list[str] = Query(default=[]),
    q: str | None = Query(default=None),
    sort: SortKey = Query(default="feas"),
    include_expired: bool = Query(
        default=False,
        description="預設 False 只回有效案（deadline 未過或無截止日）；True 才含已截止案。",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    cursor: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    today: date = Depends(get_today),
) -> TenderListResponse:
    query = TenderQuery(
        tier=tier,
        cat=cat,
        city=city,
        src=src,
        deadline=deadline,
        budget_min=budget_min,
        budget_max=budget_max,
        focus=focus,
        avoid=avoid,
        q=q,
        sort=sort,
        include_expired=include_expired,
        page=page,
        page_size=page_size,
        cursor=cursor,
    )
    items, count, next_cursor = await query_svc.list_tenders(session, query, today=today)
    return TenderListResponse(
        items=items,
        count=count,
        page=page,
        page_size=page_size,
        next_cursor=next_cursor,
    )


@router.get("/{tender_id}", response_model=TenderDetail)
async def get_tender(
    tender_id: int,
    user_id: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> TenderDetail:
    return await query_svc.get_tender_detail(session, tender_id, user_id)

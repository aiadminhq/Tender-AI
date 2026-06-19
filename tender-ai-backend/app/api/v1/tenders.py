# -*- coding: utf-8 -*-
"""標案查詢 API（Layer A，唯讀）。"""
from __future__ import annotations

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
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
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
        page=page,
        page_size=page_size,
    )
    items, count = await query_svc.list_tenders(session, query)
    return TenderListResponse(
        items=items, count=count, page=page, page_size=page_size
    )


@router.get("/{tender_id}", response_model=TenderDetail)
async def get_tender(
    tender_id: int,
    user_id: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> TenderDetail:
    return await query_svc.get_tender_detail(session, tender_id, user_id)

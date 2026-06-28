# -*- coding: utf-8 -*-
"""語意檢索 API（Layer C，唯讀）：語意搜尋 + 相似標案。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.search import (
    DecisionRecommendation,
    SemanticHit,
    SemanticSearchResponse,
)
from app.services import search as search_svc

router = APIRouter(prefix="/search", tags=["search"])


@router.get("/semantic", response_model=SemanticSearchResponse)
async def semantic_search(
    q: str = Query(min_length=1, description="自然語言查詢字串"),
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
) -> SemanticSearchResponse:
    items = await search_svc.semantic_search(session, q, limit=limit)
    return SemanticSearchResponse(items=items, count=len(items), query=q)


@router.get("/similar/{tender_id}", response_model=list[SemanticHit])
async def similar_tenders(
    tender_id: int,
    limit: int = Query(default=10, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
) -> list[SemanticHit]:
    return await search_svc.similar_tenders(session, tender_id, limit=limit)


@router.get("/recommend/{tender_id}", response_model=DecisionRecommendation)
async def recommend_from_decisions(
    tender_id: int,
    limit: int = Query(default=5, ge=1, le=50),
    session: AsyncSession = Depends(get_session),
) -> DecisionRecommendation:
    """以相似的已評估案例（決策向量）給候選標案一個可解釋的承接傾向。"""
    return await search_svc.recommend_from_decisions(session, tender_id, limit=limit)

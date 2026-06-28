# -*- coding: utf-8 -*-
"""索引／向量覆蓋率狀態 API（Layer A/C 聚合，唯讀）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.index_status import IndexStatusResponse
from app.services import index_status as index_svc

router = APIRouter(prefix="/index", tags=["index"])


@router.get("/status", response_model=IndexStatusResponse)
async def index_status(
    session: AsyncSession = Depends(get_session),
) -> IndexStatusResponse:
    """彙整三張向量表覆蓋率、標案向量覆蓋率與 category 缺口。"""
    return await index_svc.index_status(session)

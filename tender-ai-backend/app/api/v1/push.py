# -*- coding: utf-8 -*-
"""SL5 主動推播 API。

- ``POST /push/run``：觸發一次每日推播批次（手動或排程），寫入 push_logs。
- ``GET  /push/digest``：通知面板資料（最新一批推播卡 + 跨批次未讀數），唯讀。
- ``POST /push/read``：標記已讀（單筆或全部）。

輸出皆為 Layer A 安全內容（標案公開欄位 + 可解釋聚合分數/理由），user_id 嚴格隔離。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.push import (
    PushDigestOut,
    PushReadRequest,
    PushReadResult,
    PushRunRequest,
    PushRunResult,
)
from app.services import push as push_svc

router = APIRouter(prefix="/push", tags=["push"])


@router.post("/run", response_model=PushRunResult)
async def run_push(
    body: PushRunRequest,
    session: AsyncSession = Depends(get_session),
) -> PushRunResult:
    """依承標判準挑高潛力標案，產生（或補齊）當日推播。同日重跑 idempotent。"""
    result = await push_svc.run_push(
        session,
        body.user_id,
        limit=body.limit,
        min_score=body.min_score,
        lookback_days=body.lookback_days,
    )
    await session.commit()
    return result


@router.get("/digest", response_model=PushDigestOut)
async def push_digest(
    user_id: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> PushDigestOut:
    """通知面板：最新一批推播卡 + 跨全部批次的未讀數。查無使用者 → 空摘要。"""
    return await push_svc.get_digest(session, user_id)


@router.post("/read", response_model=PushReadResult)
async def push_read(
    body: PushReadRequest,
    session: AsyncSession = Depends(get_session),
) -> PushReadResult:
    """標記已讀：push_id 給定 → 單筆；省略 → 該使用者全部未讀。"""
    marked = await push_svc.mark_read(session, body.user_id, push_id=body.push_id)
    await session.commit()
    return PushReadResult(marked=marked)

# -*- coding: utf-8 -*-
"""SL6 自我進化 API。

- ``POST /evolution/run``：跑一輪自我進化（學習權重 → 讀 top 判準詞 → 聚合行為信號
  → 寫稽核日誌）。手動（前端按鈕）或排程觸發。
- ``GET  /evolution/status``：進化現況（最新日誌 + 歷史時間軸 + 當前生效權重），唯讀。

輸出皆為 Layer A 聚合統計與公開衍生詞彙，**不含人名／email 或個別評語原文**。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.session import get_session, get_session_factory
from app.schemas.learning import (
    EvolutionLogOut,
    EvolutionRunRequest,
    EvolutionStatusOut,
)
from app.services import evolution as evo_svc

router = APIRouter(prefix="/evolution", tags=["evolution"])


@router.post("/run", response_model=EvolutionLogOut)
async def run_evolution(
    body: EvolutionRunRequest,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> EvolutionLogOut:
    """跑一輪自我進化並回傳該筆稽核日誌。

    ``run_evolution`` 自管 session（呼叫既有 ``learn_keywords`` 並另開 session 寫
    ``evolution_logs``），故此端點注入的是 session **factory** 而非單一請求級 session；
    測試以 ``dependency_overrides`` 覆寫 ``get_session_factory`` 即可整路改走測試庫。
    """
    log = await evo_svc.run_evolution(
        session_factory=session_factory,
        trigger=body.trigger,
        min_support=body.min_support,
    )
    return EvolutionLogOut(**log)


@router.get("/status", response_model=EvolutionStatusOut)
async def evolution_status(
    history_limit: int = Query(default=10, ge=1, le=50),
    session: AsyncSession = Depends(get_session),
) -> EvolutionStatusOut:
    """進化現況：最新日誌 + 歷史時間軸 + 當前生效權重（即時驅動排序）。"""
    status = await evo_svc.get_evolution_status(
        session, history_limit=history_limit
    )
    return EvolutionStatusOut(**status)

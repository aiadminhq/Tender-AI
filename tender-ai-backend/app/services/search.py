# -*- coding: utf-8 -*-
"""語意檢索服務（Layer C）：語意搜尋 + 相似標案。

以 pgvector cosine distance（``<=>``）對 ``tender_vectors`` 做近鄰查詢，再 join
Layer A 主檔 + 最新每日快照組成清單列（沿用 query.py 的 helper，語義一致）。
查詢向量由 ``embedding.embed_query`` 產生；測試以 monkeypatch 替換、不連 Ollama。
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EntityNotFound
from app.models.knowledge import TenderVector
from app.models.tender import Source, Tender
from app.schemas.search import SemanticHit
from app.services import embedding
from app.services.query import _latest_snapshot_subq, _row_to_item


def _base_select(distance_col):
    """組裝近鄰查詢骨架：Tender + source + 最新快照 + 距離欄。

    INNER JOIN tender_vectors（只回已嵌入者）；LEFT JOIN 最新快照（tier/days_left
    可能為 NULL，與 list/detail 行為一致）。
    """
    latest = _latest_snapshot_subq()
    return (
        select(
            Tender,
            Source.name.label("source"),
            latest.c.tier.label("tier"),
            latest.c.days_left.label("days_left"),
            distance_col.label("distance"),
        )
        .join(Source, Source.id == Tender.source_id)
        .join(TenderVector, TenderVector.tender_id == Tender.id)
        .join(latest, latest.c.tender_id == Tender.id, isouter=True)
    )


def _hit(row) -> SemanticHit:
    item = _row_to_item(row)
    distance = float(row.distance)
    score = max(0.0, min(1.0, 1.0 - distance))  # cosine：score = 1 - distance
    return SemanticHit(**item.model_dump(), distance=distance, score=score)


async def semantic_search(
    session: AsyncSession, q_text: str, *, limit: int = 20
) -> list[SemanticHit]:
    """自然語言 → 查詢向量 → 取最近的 ``limit`` 筆標案（依 cosine 距離遞增）。"""
    vec = await embedding.embed_query(q_text)
    dist = TenderVector.embedding.cosine_distance(vec)
    stmt = _base_select(dist).order_by(dist.asc()).limit(limit)
    rows = (await session.execute(stmt)).all()
    return [_hit(r) for r in rows]


async def similar_tenders(
    session: AsyncSession, tender_id: int, *, limit: int = 10
) -> list[SemanticHit]:
    """以某標案的向量找最相似的其他標案（排除自己）。

    - 標的不存在（Layer A）→ EntityNotFound（API 轉 404）。
    - 標的存在但尚未嵌入 → 回空清單（無向量可比，非錯誤）。
    """
    exists = await session.scalar(select(Tender.id).where(Tender.id == tender_id))
    if exists is None:
        raise EntityNotFound(f"tender {tender_id} not found")

    vec = await session.scalar(
        select(TenderVector.embedding).where(TenderVector.tender_id == tender_id)
    )
    if vec is None:
        return []

    dist = TenderVector.embedding.cosine_distance(vec)
    stmt = (
        _base_select(dist)
        .where(Tender.id != tender_id)
        .order_by(dist.asc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    return [_hit(r) for r in rows]

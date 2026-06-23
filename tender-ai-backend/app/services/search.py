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
from app.models.knowledge import DecisionVector, TenderVector
from app.models.tender import Source, Tender
from app.schemas.search import (
    DecisionRecommendation,
    SemanticHit,
    SimilarDecisionHit,
)
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


def _decision_select(distance_col):
    """近鄰查詢骨架（決策向量版）：Tender + source + 最新快照 + 距離 + 結論。

    INNER JOIN decision_vectors（只回已嵌入的評估）；LEFT JOIN 最新快照。
    一個標案可能有多筆評估（多人）→ 各為一列相似案，反映多份佐證。
    """
    latest = _latest_snapshot_subq()
    return (
        select(
            Tender,
            Source.name.label("source"),
            latest.c.tier.label("tier"),
            latest.c.days_left.label("days_left"),
            distance_col.label("distance"),
            DecisionVector.feasible.label("feasible"),
        )
        .join(Source, Source.id == Tender.source_id)
        .join(DecisionVector, DecisionVector.tender_id == Tender.id)
        .join(latest, latest.c.tender_id == Tender.id, isouter=True)
    )


def _decision_hit(row) -> SimilarDecisionHit:
    item = _row_to_item(row)
    distance = float(row.distance)
    score = max(0.0, min(1.0, 1.0 - distance))
    return SimilarDecisionHit(
        **item.model_dump(), distance=distance, score=score, feasible=row.feasible
    )


def _aggregate(tender_id: int, neighbors: list[SimilarDecisionHit]) -> DecisionRecommendation:
    """以相似度加權聚合鄰居結論 → 承接傾向 + 信心 + 白話總結。"""
    feas = [n for n in neighbors if n.feasible == "可行"]
    infeas = [n for n in neighbors if n.feasible == "不可行"]
    w_feas = sum(n.score for n in feas)
    w_infeas = sum(n.score for n in infeas)
    total = w_feas + w_infeas

    if not neighbors or total <= 0:
        return DecisionRecommendation(
            tender_id=tender_id, verdict="unknown", confidence=0.0,
            feasible_count=len(feas), infeasible_count=len(infeas),
            headline="尚無相似的已評估案例可參考。", neighbors=neighbors,
        )

    if w_feas >= w_infeas:
        verdict = "feasible_leaning"
        confidence = round((w_feas - w_infeas) / total, 4)
        headline = (
            f"最相似的 {len(neighbors)} 個已評估案例多偏可行"
            f"（{len(feas)} 可行／{len(infeas)} 不可行），傾向可承接。"
        )
    else:
        verdict = "infeasible_leaning"
        confidence = round((w_infeas - w_feas) / total, 4)
        headline = (
            f"最相似的 {len(neighbors)} 個已評估案例多偏不可行"
            f"（{len(feas)} 可行／{len(infeas)} 不可行），傾向略過。"
        )
    return DecisionRecommendation(
        tender_id=tender_id, verdict=verdict, confidence=confidence,
        feasible_count=len(feas), infeasible_count=len(infeas),
        headline=headline, neighbors=neighbors,
    )


async def recommend_from_decisions(
    session: AsyncSession, tender_id: int, *, limit: int = 5
) -> DecisionRecommendation:
    """為候選標案找最相似的已評估案例，聚合成可解釋的承接傾向（P5）。

    - 候選標案不存在（Layer A）→ EntityNotFound（API 轉 404）。
    - 以候選標案的公開特徵嵌成查詢向量，對 decision_vectors 做 cosine 近鄰。
    - 排除候選自身的評估；無相似案 → verdict=unknown、鄰居空清單（非錯誤）。
    """
    t = await session.get(Tender, tender_id)
    if t is None:
        raise EntityNotFound(f"tender {tender_id} not found")

    vec = await embedding.embed_query(
        embedding.tender_text(t.name, t.org, t.category)
    )
    dist = DecisionVector.embedding.cosine_distance(vec)
    stmt = (
        _decision_select(dist)
        .where(Tender.id != tender_id)
        .order_by(dist.asc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    neighbors = [_decision_hit(r) for r in rows]
    return _aggregate(tender_id, neighbors)

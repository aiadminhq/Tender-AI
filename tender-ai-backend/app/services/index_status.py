# -*- coding: utf-8 -*-
"""索引／向量覆蓋率狀態（Layer A/C 聚合，唯讀）。

回答「我的大腦索引到哪了」：彙整三張向量表（標案／知識庫／決策）的列數、去重主體數、
embedding 模型分佈，以及標案的向量覆蓋率與 category 缺口（學習天花板的可見化指標）。

純聚合查詢，不外洩任何個資或 rationale 全文；不寫入任何權重或向量。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import (
    DecisionVector,
    DocSummary,
    KnowledgeChunk,
    TenderVector,
)
from app.models.tender import Tender


@dataclass
class TableCoverage:
    """單張向量表的覆蓋概況。"""

    rows: int  # 向量列數
    distinct_subjects: int  # 去重主體數（標案向量＝標案；知識＝文件；決策＝標案）
    models: dict[str, int] = field(default_factory=dict)  # embedding model → 列數


@dataclass
class IndexStatus:
    """整體索引狀態。"""

    tenders_total: int  # 標案主檔總數（Layer A）
    tenders_vectorized: int  # 已嵌入向量的標案數
    tenders_category_missing: int  # category 為 NULL 的標案數（學習天花板指標）
    tender_coverage: float  # tenders_vectorized / tenders_total，[0,1]
    tender_vectors: TableCoverage
    knowledge_chunks: TableCoverage
    knowledge_docs: int  # 知識庫文件數（distinct doc_id）
    decision_vectors: TableCoverage
    doc_summaries: int  # 已產生摘要的標案數


async def _count(session: AsyncSession, model) -> int:
    return int(await session.scalar(select(func.count()).select_from(model)) or 0)


async def _distinct(session: AsyncSession, col) -> int:
    return int(await session.scalar(select(func.count(func.distinct(col)))) or 0)


async def _models(session: AsyncSession, model_col) -> dict[str, int]:
    rows = (await session.execute(
        select(model_col, func.count()).group_by(model_col)
    )).all()
    return {str(m): int(c) for m, c in rows}


async def index_status(session: AsyncSession) -> IndexStatus:
    """彙整三張向量表 + 標案覆蓋率 + category 缺口。"""
    tenders_total = int(await session.scalar(select(func.count(Tender.id))) or 0)
    tenders_vectorized = await _distinct(session, TenderVector.tender_id)
    tenders_category_missing = int(
        await session.scalar(
            select(func.count(Tender.id)).where(Tender.category.is_(None))
        )
        or 0
    )
    coverage = round(tenders_vectorized / tenders_total, 4) if tenders_total else 0.0

    return IndexStatus(
        tenders_total=tenders_total,
        tenders_vectorized=tenders_vectorized,
        tenders_category_missing=tenders_category_missing,
        tender_coverage=coverage,
        tender_vectors=TableCoverage(
            rows=await _count(session, TenderVector),
            distinct_subjects=tenders_vectorized,
            models=await _models(session, TenderVector.model),
        ),
        knowledge_chunks=TableCoverage(
            rows=await _count(session, KnowledgeChunk),
            distinct_subjects=await _distinct(session, KnowledgeChunk.doc_id),
            models=await _models(session, KnowledgeChunk.model),
        ),
        knowledge_docs=await _distinct(session, KnowledgeChunk.doc_id),
        decision_vectors=TableCoverage(
            rows=await _count(session, DecisionVector),
            distinct_subjects=await _distinct(session, DecisionVector.tender_id),
            models=await _models(session, DecisionVector.model),
        ),
        doc_summaries=await _count(session, DocSummary),
    )

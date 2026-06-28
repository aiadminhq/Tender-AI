# -*- coding: utf-8 -*-
"""索引／向量覆蓋率狀態 API schemas（Layer A/C 聚合，唯讀）。"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class TableCoverageOut(BaseModel):
    """單張向量表的覆蓋概況。"""

    model_config = ConfigDict(from_attributes=True)

    rows: int
    distinct_subjects: int
    models: dict[str, int]


class IndexStatusResponse(BaseModel):
    """整體索引狀態（向量覆蓋率 + category 缺口 + 三張向量表概況）。"""

    model_config = ConfigDict(from_attributes=True)

    tenders_total: int
    tenders_vectorized: int
    tenders_category_missing: int
    tender_coverage: float
    tender_vectors: TableCoverageOut
    knowledge_chunks: TableCoverageOut
    knowledge_docs: int
    decision_vectors: TableCoverageOut
    doc_summaries: int

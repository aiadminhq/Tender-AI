# -*- coding: utf-8 -*-
"""知識庫檢索／調閱 API schemas（Layer A 公開知識，唯讀）。"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class KnowledgeSearchHit(BaseModel):
    """一筆知識庫混合檢索命中（對齊 services.knowledge.KnowledgeHit）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    doc_id: str
    title: str
    heading: str | None
    content: str
    score: float  # RRF 融合後正規化分數（0..1）
    vec_score: float | None  # 語意 cosine 分數（1 - distance）
    kw_score: float | None  # 關鍵字 ts_rank 原始分數


class KnowledgeSearchResponse(BaseModel):
    items: list[KnowledgeSearchHit]
    count: int
    query: str


class KnowledgeDocItem(BaseModel):
    """知識庫文件清單列。"""

    model_config = ConfigDict(from_attributes=True)

    doc_id: str
    title: str
    chunks: int  # 該文件切塊數


class KnowledgeDocsResponse(BaseModel):
    items: list[KnowledgeDocItem]
    count: int


class KnowledgeChunkOut(BaseModel):
    """單一知識切塊（調閱用，不含 embedding/tokens 等內部欄位）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    doc_id: str
    title: str
    heading: str | None
    chunk_index: int
    content: str


class KnowledgeDocDetail(BaseModel):
    """單篇知識文件的全部切塊（依 chunk_index 遞增）。"""

    doc_id: str
    title: str
    count: int
    chunks: list[KnowledgeChunkOut]

# -*- coding: utf-8 -*-
"""語意檢索 API schemas（Layer C）。"""
from __future__ import annotations

from pydantic import BaseModel

from app.schemas.tender import TenderListItem


class SemanticHit(TenderListItem):
    """語意檢索命中：標準清單列 + 與查詢向量的距離與相似度分數。"""

    distance: float  # cosine distance（0 = 完全相同，越小越近）
    score: float  # 1 - distance，clamp 至 [0,1]，越大越相似


class SemanticSearchResponse(BaseModel):
    items: list[SemanticHit]
    count: int  # 本次回傳筆數（已受 limit 限制）
    query: str  # 原始查詢字串（回放給前端）

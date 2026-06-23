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


class SimilarDecisionHit(TenderListItem):
    """相似已評估案例（P5）：標準清單列 + 距離/分數 + 該案評估結論。

    僅帶結論標籤（可行/不可行），不外洩 rationale 全文或使用者身分（隱私鐵則）。
    """

    distance: float  # 與候選標案向量的 cosine distance（越小越近）
    score: float  # 1 - distance，clamp 至 [0,1]
    feasible: str  # 該相似案的評估結論：可行 | 不可行


class DecisionRecommendation(BaseModel):
    """決策推薦（P5）：聚合相似已評估案例，給候選標案一個可解釋的承接傾向。"""

    tender_id: int  # 候選標案
    verdict: str  # feasible_leaning | infeasible_leaning | unknown
    confidence: float  # |可行加權 − 不可行加權| / 總加權，[0,1]
    feasible_count: int  # 鄰居中「可行」案數
    infeasible_count: int  # 鄰居中「不可行」案數
    headline: str  # 白話總結
    neighbors: list[SimilarDecisionHit]  # 依距離遞增的相似案例

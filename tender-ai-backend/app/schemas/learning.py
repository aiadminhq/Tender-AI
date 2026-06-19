# -*- coding: utf-8 -*-
"""SL6 自我進化 schema（對外只回傳 Layer A 聚合統計與公開衍生詞彙）。

- 進化日誌（EvolutionLogOut）= 一次學習迭代的稽核摘要：樣本脈絡、詞彙增刪量、
  當批 top 重點詞／避免詞（系統推斷的承標判準），與行為信號聚合快照。
- 行為信號（BehaviorSignals）皆為計數與公開衍生詞彙（標案類別／城市／來源、
  事件型別、評估判準鍵），**不含人名／email 或個別評語原文**；user_id 嚴格隔離。
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class TermWeight(BaseModel):
    """單一判準詞彙（重點詞 / 避免詞）。"""

    term: str
    weight: float
    support: int


class DimensionCount(BaseModel):
    """某維度（類別 / 城市 / 來源）的 top 計數。"""

    value: str
    count: int


class CriteriaCount(BaseModel):
    """評估判準鍵的命中計數（鍵名為領域判準，非 PII）。"""

    key: str
    count: int


class BehaviorSignals(BaseModel):
    """使用者行為信號聚合快照（Layer A 聚合統計，user_id 隔離）。"""

    user_id: int | None = None
    events_total: int = 0
    event_type_counts: dict[str, int] = Field(default_factory=dict)
    top_categories: list[DimensionCount] = Field(default_factory=list)
    top_cities: list[DimensionCount] = Field(default_factory=list)
    top_sources: list[DimensionCount] = Field(default_factory=list)
    evaluation_counts: dict[str, int] = Field(default_factory=dict)
    top_criteria: list[CriteriaCount] = Field(default_factory=list)


class EvolutionLogOut(BaseModel):
    """一次進化迭代的稽核摘要。"""

    id: int
    batch: str
    trigger: str
    feasible_samples: int
    infeasible_samples: int
    keywords_added: int
    keywords_updated: int
    revision_rows: int
    top_positive: list[TermWeight] = Field(default_factory=list)
    top_negative: list[TermWeight] = Field(default_factory=list)
    signals: BehaviorSignals = Field(default_factory=BehaviorSignals)
    created_at: str | None = None


class EvolutionRunRequest(BaseModel):
    """觸發一輪自我進化（手動或排程）。"""

    # 來源標記：manual（前端按鈕）｜api｜auto（排程）
    trigger: str = Field(default="manual", max_length=16)
    # 詞彙列入 keyword_weights 的最少出現次數
    min_support: int = Field(default=2, ge=1, le=20)


class EvolutionStatusOut(BaseModel):
    """進化現況：最新日誌 + 歷史時間軸 + 當前生效權重（即時驅動排序）。"""

    total_runs: int = 0
    latest: EvolutionLogOut | None = None
    history: list[EvolutionLogOut] = Field(default_factory=list)
    active_positive: list[TermWeight] = Field(default_factory=list)
    active_negative: list[TermWeight] = Field(default_factory=list)

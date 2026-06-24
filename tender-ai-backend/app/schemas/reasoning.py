# -*- coding: utf-8 -*-
"""SL3 意圖與推理引擎的 Pydantic schemas。

對應願景：「懂得學習操作者為何點擊／選關鍵字，並推理使用者衡量『可能可中標』
的標準是基於什麼因素跟關係」。本層輸出皆為**可解釋**結構：
- ReasonCode：單一推理因素（類別／預算／地點／急迫／關鍵字／行為）的方向與證據。
- CriteriaProfileOut：從評估紀錄＋互動事件＋學習關鍵字推導的「操作者判準輪廓」。
- TenderReasoningOut：對單一標案的可中標推理（fit 分數＋逐條 reason code＋結論）。

隱私：reason code 的證據文字只引用 Layer A 公開欄位與聚合統計，對非合作範圍對象
不外洩個別評語原文或人名／email（Layer B 明細在白名單合作範圍內共享，但此端點只回聚合、不回逐筆明細）。
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# 推理方向：正向加分／負向扣分／中性提示（如急迫性）
Direction = Literal["positive", "negative", "neutral"]

# 結論分級：依 criteria_fit 推導
Verdict = Literal["strong", "consider", "weak"]


class ReasonCode(BaseModel):
    """單一推理因素。impact 為帶符號影響量（約 -1..1），驅動排序與 fit。"""

    factor: str  # category | budget | city | urgency | keyword | behavior | source
    label: str  # 顯示用因素名（繁中），如「標的類別」
    value: str | None = None  # 該標案在此因素上的取值，如「工程」
    direction: Direction
    impact: float  # 帶符號影響量（可解釋，非機率）
    evidence: str  # 一句話證據，如「你過去 8/8 件工程都判可行」


class CategorySignal(BaseModel):
    """某分類取值在歷史評估中的關聯統計（lift = p_feasible − 基準可行率）。"""

    value: str
    p_feasible: float  # Laplace 平滑後可行機率
    lift: float  # 相對基準的提升（正＝偏好、負＝迴避）
    support: int  # 該取值的評估樣本數
    feasible: int
    infeasible: int


class CriteriaProfileOut(BaseModel):
    """操作者判準輪廓：系統「學到」的承標標準（可被使用者檢視／修正）。"""

    n_evaluations: int  # 已標記評估數（監督訊號規模）
    n_events: int  # 已綁標案的互動事件數（行為訊號規模）
    base_rate: float  # 基準可行率（feasible / total）
    category_signals: list[CategorySignal] = Field(default_factory=list)
    city_signals: list[CategorySignal] = Field(default_factory=list)
    source_signals: list[CategorySignal] = Field(default_factory=list)
    budget_feasible_min: int | None = None  # 可行案預算下界（萬）
    budget_feasible_max: int | None = None  # 可行案預算上界（萬）
    budget_feasible_median: int | None = None
    top_keywords_positive: list[str] = Field(default_factory=list)
    top_keywords_negative: list[str] = Field(default_factory=list)
    engaged_categories: list[str] = Field(default_factory=list)  # 你常點開的類別
    engaged_cities: list[str] = Field(default_factory=list)
    summary: str  # 一段白話的「你的判準」摘要
    confidence: Literal["low", "medium", "high"]  # 依樣本量推導的可信度


class ManualKeywordIn(BaseModel):
    """推理卡手動關鍵字覆寫輸入（Phase 2）。

    ``action=add`` 把詞加入該清單；``action=remove`` 把詞移出（隱藏學習詞，
    或撤回先前的手動新增）。``kind=negative`` 即「人工迴避」合規路徑。
    """

    user_id: int | None = None  # Phase 1：未驗證；Phase 2 改由 session 推導
    term: str = Field(min_length=1, max_length=128)
    kind: Literal["positive", "negative", "engaged"]
    action: Literal["add", "remove"]


class TenderReasoningOut(BaseModel):
    """單一標案的可中標推理。"""

    tender_id: int
    criteria_fit: int  # 0–100，依判準輪廓推導（可解釋，非黑箱）
    verdict: Verdict
    headline: str  # 一句話結論
    reasons: list[ReasonCode] = Field(default_factory=list)  # 依 |impact| 由大到小
    profile: CriteriaProfileOut  # 推理所依據的判準輪廓快照

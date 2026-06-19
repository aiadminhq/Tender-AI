# -*- coding: utf-8 -*-
"""標案查詢 API 的 Pydantic schemas（對應前端 filter bar 的篩選/排序/分頁）。

語義對齊 prototype/index.html 的 passes()/sortFn()：
- tier/cat/city/src：多選（任一命中即留），空集合＝不過濾。
- deadline：保留「最新快照剩餘天數 ≤ deadline」。
- budget_min/max：以 budget_wan（萬元）區間過濾（None 預算在有下限時被排除）。
- focus：OR（任一關鍵字命中於 name+org+category 即留）。
- avoid：NOT（任一關鍵字命中即排除）。
- q：AND（以空白/逗號/頓號斷詞，每一詞皆須命中）。
- sort：feas|feasibility_score|days|budget|tier；feas／feasibility_score 同義，
  皆以「KeywordWeight 學習權重 + tier」綜合排序（SL2 閉合學習迴圈上線後生效）。
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# "feas" 為歷史預設別名；"feasibility_score" 為 SL2 後語義明確的同義鍵。
SortKey = Literal["feas", "feasibility_score", "days", "budget", "tier"]


class TenderQuery(BaseModel):
    """服務層消費的查詢條件（由 router 從 query string 組裝）。"""

    tier: list[str] = Field(default_factory=list)
    cat: list[str] = Field(default_factory=list)
    city: list[str] = Field(default_factory=list)
    src: list[str] = Field(default_factory=list)
    deadline: int | None = None
    budget_min: int | None = None
    budget_max: int | None = None
    focus: list[str] = Field(default_factory=list)
    avoid: list[str] = Field(default_factory=list)
    q: str | None = None
    sort: SortKey = "feas"
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=200)


class TenderListItem(BaseModel):
    """清單列：標案主檔 + 最新每日快照（tier / 剩餘天數）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    source: str
    case_pk: str
    name: str
    org: str | None
    category: str | None
    budget_wan: int | None
    deadline_roc: str | None
    deadline_iso: date | None
    tender_method: str | None
    city: str | None
    link: str | None
    tier: str | None  # 最新快照
    days_left: int | None  # 最新快照（快照值，非以「今天」即時推算）
    first_seen: date | None
    last_seen: date | None
    # SL2 可行度（0–100）：tier 基底 + KeywordWeight 學習權重；冷啟動（無權重）
    # 退化為純 tier 推導。None 代表此查詢未計算（向後相容）。
    feasibility_score: float | None = None


class TenderListResponse(BaseModel):
    items: list[TenderListItem]
    count: int  # 符合條件總數（未分頁）
    page: int
    page_size: int


class SnapshotItem(BaseModel):
    run_date: date
    tier: str | None
    days_left: int | None


class UserStateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    saved: bool
    status: str | None
    star: int | None


class TenderDetail(TenderListItem):
    """單案詳情：主檔 + 最新快照 + 歷史快照 + 該使用者狀態。"""

    snapshots: list[SnapshotItem] = Field(default_factory=list)
    user_state: UserStateOut | None = None

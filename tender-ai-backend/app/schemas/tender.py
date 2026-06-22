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


class AttachmentItem(BaseModel):
    """投標須知等附件索引（Layer A 公開來源；實檔離庫，這裡只回索引）。"""

    filename: str | None = None
    url: str | None = None
    # 是否已歸檔到本地（storage_uri 有值）；skipped／error 為 enrich 下載結果註記
    archived: bool = False
    skipped: bool | None = None
    error: str | None = None


class RevisionDetail(BaseModel):
    """單案最新詳情版本（tender_revisions 現值投影，皆 Layer A 公開欄）。

    僅在 enrich job 於「能連到 PCC 招標網」的環境跑過後才有值；未 enrich 的案
    （tenders.current_revision_id 為空）此物件為 None，前端據此優雅退化為空狀態。
    """

    revision_no: int
    fetched_at: datetime | None = None
    award_method: str | None = None
    deposit_required: bool | None = None
    deposit_amount_twd: int | None = None
    deposit_raw_text: str | None = None
    qualification_codes: list[str] = Field(default_factory=list)
    qualification_text: str | None = None
    category_main: str | None = None
    category_name: str | None = None
    category_raw: str | None = None
    performance_period: str | None = None
    performance_location: str | None = None
    subsidy_source: str | None = None
    extra_note: str | None = None
    attachments: list[AttachmentItem] = Field(default_factory=list)


class TenderDetail(TenderListItem):
    """單案詳情：主檔 + 最新快照 + 最新詳情版本 + 歷史快照 + 該使用者狀態。"""

    snapshots: list[SnapshotItem] = Field(default_factory=list)
    user_state: UserStateOut | None = None
    # 最新詳情版本（履約地點/資格/押標金/附件…）；未 enrich 時為 None。
    revision: RevisionDetail | None = None

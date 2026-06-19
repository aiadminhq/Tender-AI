# -*- coding: utf-8 -*-
"""SL5 主動推播 schema（Layer B；對非合作範圍對象只回傳 Layer A 安全欄位）。

- 推播理由（reason）取自 reasoning.explain_tender 的 headline；分數（score）為
  criteria_fit（0–100）。皆為可解釋的聚合結果，**不含人名／email 或個別評語原文**。
- 每筆推播卡同時帶該標案的 Layer A 顯示欄位（名稱／機關／類別／城市／預算／
  ROC 截止／剩餘天數／來源／連結），供前端通知面板直接呈現。
"""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class PushRunRequest(BaseModel):
    """觸發一次每日推播批次（手動或排程）。"""

    user_id: int | None = None
    # 單次最多推幾筆（高潛力上限）
    limit: int = Field(default=8, ge=1, le=50)
    # 顯示可行度（feasibility_score）門檻：≥ 才納入候選
    min_score: int = Field(default=60, ge=0, le=100)
    # 跨日去重視窗：近 N 天已推過的標案不重複推
    lookback_days: int = Field(default=7, ge=0, le=90)


class PushItemOut(BaseModel):
    """單筆推播卡（push_log + 該標案 Layer A 顯示欄位）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int  # push_log id
    tender_id: int | None
    run_date: date
    score: int | None
    tier: str | None
    reason: str | None
    channel: str
    status: str
    pushed_at: datetime
    read_at: datetime | None
    # ---- Layer A 標案顯示欄位（tender 被刪時為 None） ----
    name: str | None = None
    org: str | None = None
    category: str | None = None
    city: str | None = None
    budget_wan: int | None = None
    deadline_roc: str | None = None
    days_left: int | None = None
    source: str | None = None
    link: str | None = None


class PushRunResult(BaseModel):
    """一次批次結果：新建幾筆、因去重略過幾筆，與該批次的推播卡。"""

    run_date: date
    created: int
    skipped: int
    items: list[PushItemOut]


class PushDigestOut(BaseModel):
    """通知面板資料：最新一批推播卡 + 跨全部批次的未讀數。"""

    run_date: date | None = None
    unread: int = 0
    total: int = 0
    items: list[PushItemOut] = Field(default_factory=list)


class PushReadRequest(BaseModel):
    """標記已讀：push_id 給定 → 單筆；省略 → 該使用者全部未讀。"""

    user_id: int | None = None
    push_id: int | None = None


class PushReadResult(BaseModel):
    marked: int

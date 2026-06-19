# -*- coding: utf-8 -*-
"""Layer B 主動推播紀錄（白名單合作範圍內共享、對外不揭露；永不進任何公開 repo）。

SL5「重自動推播」：每日從學習到的承標判準（SL2 關鍵字權重 + SL3 推理）挑出
高潛力標案，逐案記成一筆推播。內容只引用 Layer A 公開欄位與聚合統計——理由文字
取自 reasoning.explain_tender 的 headline，**不含任何個別評語原文或人名／email**。

設計：
- user_id 嚴格隔離（每人各自的推播佇列）。
- (user_id, tender_id, run_date) 唯一：同日同案不重推（同日重跑 idempotent）。
- 跨日去重由服務層以「近 N 天已推清單」處理（避免天天重複推同一案）。
- tender 若日後被刪 → tender_id SET NULL，推播歷史（理由/分數）仍為 Layer A 安全文字。
- status：pending（待讀）｜read（已讀）。channel：in_app（站內）為主；未來如接外部
  頻道（telegram 等）token 一律走 .env，不入版控、不寫進此表內容。
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PushLog(Base):
    __tablename__ = "push_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # 標案刪除後保留推播歷史 → SET NULL（理由/分數仍為 Layer A 安全文字）
    tender_id: Mapped[int | None] = mapped_column(
        ForeignKey("tenders.id", ondelete="SET NULL"), index=True, nullable=True
    )
    # 推播批次日（去重與每日摘要的分組鍵）
    run_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    # 推播當下的可中標分（SL3 criteria_fit，0–100）
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 推播當下的分級快照（priority/high/mid/low）
    tier: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 為何推這案（reasoning.explain_tender headline；Layer A 安全文字）
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    channel: Mapped[str] = mapped_column(
        String(32), server_default="in_app", nullable=False
    )
    # pending（待讀）｜read（已讀）
    status: Mapped[str] = mapped_column(
        String(16), server_default="pending", nullable=False
    )
    pushed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "tender_id", "run_date", name="uq_push_user_tender_date"
        ),
    )

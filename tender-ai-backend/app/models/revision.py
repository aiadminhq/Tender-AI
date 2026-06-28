# -*- coding: utf-8 -*-
"""詳情 enrich 的 revision-first 持久層 models(Layer A 衍生,公開可重生)。

對齊修訂計畫 §2:
- ``tender_snapshots``:每次「不同內容」的原始抓取(稽核 + 去重帳本),
  ``UNIQUE(tender_id, content_hash)`` 保證同內容不重複入庫。
- ``tender_revisions``:**不可變**的正規化版本(永不 UPDATE);``id`` 預留為未來
  ``answer_citations.revision_id`` 的 FK 目標,故設為穩定主鍵、一版一列。
- ``crawl_runs``:每日/手動 enrich 執行統計(targeted/fetched/unchanged/new/failed)。
- ``crawl_failures``:抓取/解析失敗帳本,支援重試(retriable + next_retry_after + resolved_at)。

``tenders`` 的現值投影欄(``current_revision_id`` / ``detail_checked_at``)定義於
``app.models.tender``(與 tenders 同表),此處只建四張新表。

隱私:型別欄與 ``raw_fields`` 僅含**公開來源資訊**(Layer A),不放任何 Layer B 行為資料。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TenderSnapshot(Base):
    """單次「不同內容」的原始抓取;raw_html 本階段存 DB(storage_uri 預留離庫)。"""

    __tablename__ = "tender_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    tender_id: Mapped[int] = mapped_column(
        ForeignKey("tenders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)  # sha256 hex
    source_revision_key: Mapped[str | None] = mapped_column(String(16), nullable=True)
    raw_html: Mapped[str] = mapped_column(Text, nullable=False)
    storage_uri: Mapped[str | None] = mapped_column(Text, nullable=True)  # 未來離庫預留
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("tender_id", "content_hash", name="uq_snapshot_tender_hash"),
    )


class TenderRevision(Base):
    """不可變的正規化詳情版本(每案 revision_no 遞增;永不 UPDATE)。"""

    __tablename__ = "tender_revisions"

    id: Mapped[int] = mapped_column(primary_key=True)  # = 未來 answer_citations.revision_id 目標
    tender_id: Mapped[int] = mapped_column(
        ForeignKey("tenders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    snapshot_id: Mapped[int] = mapped_column(
        ForeignKey("tender_snapshots.id", ondelete="CASCADE"), nullable=False
    )
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)  # 每案遞增
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    source_revision_key: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # 正規化型別欄(計畫 §5;皆 nullable → 更正公告可如實清空,不從前一版 coalesce)
    award_method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    deposit_required: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    deposit_amount_twd: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    deposit_raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    qualification_codes: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    qualification_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 資格摘要結構化條目（由 qualification_text 推導的衍生投影；通用「屬性/標籤/內文/參數」結構，
    # 供前端表格呈現與後續向量化）。離線冪等回填可重算，不破壞 revision 不可變語義。
    qualification_items: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    category_main: Mapped[str | None] = mapped_column(String(16), nullable=True)
    category_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    category_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    performance_period: Mapped[str | None] = mapped_column(Text, nullable=True)
    performance_location: Mapped[str | None] = mapped_column(Text, nullable=True)
    subsidy_source: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_fields: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # 投標須知等附件清單(每筆 {filename, url, storage_uri, sha256, skipped, error});
    # 由 research enrich job 下載歸檔後回寫,實檔落 data/downloads/(離庫),此處存索引。
    attachments: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # 衍生標注標籤(供研究標注,**非過濾**);如 {"interior_match": bool, "interior_keywords": [...]}。
    annotations: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("tender_id", "revision_no", name="uq_revision_tender_no"),
        UniqueConstraint("tender_id", "content_hash", name="uq_revision_tender_hash"),
    )


class CrawlRun(Base):
    """每日/手動 enrich 一次執行的稽核與計數。"""

    __tablename__ = "crawl_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    trigger: Mapped[str] = mapped_column(String(16), nullable=False)  # daily | manual
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    targeted: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    fetched: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    unchanged: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    new_revisions: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    failed: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(16), default="running", server_default="'running'", nullable=False
    )
    notes: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class CrawlFailure(Base):
    """抓取/解析失敗帳本;retriable 目標 = retriable AND resolved_at IS NULL
    AND (next_retry_after IS NULL OR <= now)。"""

    __tablename__ = "crawl_failures"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 失敗帳本須跨 run 存活以供重試,故 run 刪除時設 NULL 而非連帶刪除
    crawl_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("crawl_runs.id", ondelete="SET NULL"), index=True, nullable=True
    )
    tender_id: Mapped[int] = mapped_column(
        ForeignKey("tenders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    stage: Mapped[str] = mapped_column(String(8), nullable=False)  # fetch | parse
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_class: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempt: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    retriable: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
    next_retry_after: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index(
            "ix_crawl_failures_retry",
            "resolved_at",
            "retriable",
            "next_retry_after",
        ),
    )

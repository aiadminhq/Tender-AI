"""Layer A 標案 Corpus models（公開可重生）。

- sources：資料源（PCC / TMU）。
- tenders：去重後的標案主檔，UNIQUE(source_id, case_pk)。
- daily_runs：每日每來源一筆的執行統計。
- daily_tender：某日某標案的當日快照（tier / 剩餘天數）。

私有的行為/評價/向量（Layer B / C）不在此檔，後續階段另建且不入公開 repo。
"""
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(16), unique=True)  # 'PCC' | 'TMU'
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    tenders: Mapped[list["Tender"]] = relationship(back_populates="source")


class Tender(Base):
    __tablename__ = "tenders"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("sources.id"), index=True, nullable=False
    )
    # 去重鍵：PCC 為 base64 解碼後的 pk；TMU 為其詳情頁 id。
    case_pk: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    org: Mapped[str | None] = mapped_column(Text, nullable=True)  # 採購機關
    category: Mapped[str | None] = mapped_column(
        String(8), nullable=True
    )  # 工程 / 財物 / 勞務（PCC 標的分類，可能缺）
    budget_wan: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 萬元
    deadline_roc: Mapped[str | None] = mapped_column(String(16), nullable=True)  # 民國 YYY/MM/DD
    deadline_iso: Mapped[date | None] = mapped_column(Date, index=True, nullable=True)
    tender_method: Mapped[str | None] = mapped_column(String(32), nullable=True)  # 招標方式
    city: Mapped[str | None] = mapped_column(String(16), index=True, nullable=True)
    link: Mapped[str | None] = mapped_column(Text, nullable=True)
    first_seen: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_seen: Mapped[date | None] = mapped_column(Date, index=True, nullable=True)

    # 詳情 enrich 現值投影(計畫 §2):指向最新 revision;循環 FK 故 use_alter 於建表後 ALTER。
    current_revision_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "tender_revisions.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_tenders_current_revision",
        ),
        nullable=True,
    )
    # 上次詳情檢查時間(TTL 用;NULL = 從未 enrich → enrich job 視為新目標)。
    detail_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True, nullable=True
    )
    # 日報註記與擴充元數據（daily_report_potency、is_urgent 等）
    annotations: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    source: Mapped["Source"] = relationship(back_populates="tenders")

    __table_args__ = (
        UniqueConstraint("source_id", "case_pk", name="uq_tender_source_case"),
    )


class DailyRun(Base):
    __tablename__ = "daily_runs"

    run_date: Mapped[date] = mapped_column(Date, primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("sources.id"), primary_key=True
    )
    total: Mapped[int] = mapped_column(Integer, default=0)
    high: Mapped[int] = mapped_column(Integer, default=0)
    mid: Mapped[int] = mapped_column(Integer, default=0)
    low: Mapped[int] = mapped_column(Integer, default=0)
    urgent: Mapped[int] = mapped_column(Integer, default=0)  # ≤7 天
    priority: Mapped[int] = mapped_column(Integer, default=0)  # ⭐ 期間最優先
    budget_sum_wan: Mapped[int] = mapped_column(BigInteger, default=0)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_file: Mapped[str | None] = mapped_column(String(128), nullable=True)


class DailyTender(Base):
    __tablename__ = "daily_tender"

    run_date: Mapped[date] = mapped_column(Date, primary_key=True)
    tender_id: Mapped[int] = mapped_column(
        ForeignKey("tenders.id"), primary_key=True
    )
    tier: Mapped[str | None] = mapped_column(String(8), nullable=True)  # high/mid/low
    days_left: Mapped[int | None] = mapped_column(Integer, nullable=True)

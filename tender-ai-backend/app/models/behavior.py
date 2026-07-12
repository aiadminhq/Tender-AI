# -*- coding: utf-8 -*-
"""Layer B 行為/回饋 models（白名單(@hqdesign.tw)合作範圍內共享、依登入帳號具名；對外不揭露、永不進任何公開 repo）。

對應 `規劃-後台資料庫與RAG學習迴圈.md` §1.2 的七張表，落為 Postgres：
- users：白名單帳號；現行 demo 尚未建登入，暫用預設使用者（見 services.behavior）。
- events：互動埋點（view/open_detail/click_link/dwell/apply_filter/search/sort…）。
- tender_user_state：每人每案的狀態（收藏/狀態/星等），複合主鍵。
- annotations：人工註記。
- evaluations：可行性評估（criteria 結構化 + 自由文字）。
- shares：分享紀錄。
- saved_searches：提示詞/篩選預設。

說明：
- 狀態/可行性等列舉值不落 DB enum（保留學習迴圈擴充彈性），值域於 API 層以
  Pydantic Literal 驗證；schema 一律由 Alembic 管。
- JSON 欄位用 Postgres JSONB；時間戳一律 timezone-aware，server_default now()。
- evaluations.embedding（vector）屬 Layer C（P3），維度跟 EMBED_MODEL 走，
  屆時另出 migration，此處先不建。
- 隱私硬規則：向量 metadata 不放人名／email；本層資料只進本地 DB。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    email: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # 白名單登入（@hqdesign.tw）：管理者開通後 whitelist_active 才為 true；
    # consent_shared/consent_at 記錄 Layer B 合作範圍共享同意（見 CLAUDE.md）。
    whitelist_active: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    consent_shared: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    consent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    password_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    # view | open_detail | click_link | dwell | apply_filter | search | sort
    type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    # 非標案層級事件（如 apply_filter/search/sort）tender_id 可空
    tender_id: Mapped[int | None] = mapped_column(
        ForeignKey("tenders.id", ondelete="SET NULL"), index=True, nullable=True
    )
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class TenderUserState(Base):
    __tablename__ = "tender_user_state"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    tender_id: Mapped[int] = mapped_column(
        ForeignKey("tenders.id", ondelete="CASCADE"), primary_key=True
    )
    saved: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    # 觀望 | 備標中 | 已投 | 得標 | 放棄（None＝尚無狀態）
    status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    star: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1–5
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "star IS NULL OR (star BETWEEN 1 AND 5)", name="ck_tus_star_range"
        ),
    )


class Annotation(Base):
    __tablename__ = "annotations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    tender_id: Mapped[int] = mapped_column(
        ForeignKey("tenders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    note: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Evaluation(Base):
    __tablename__ = "evaluations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    tender_id: Mapped[int] = mapped_column(
        ForeignKey("tenders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    feasible: Mapped[str | None] = mapped_column(String(8), nullable=True)  # 可行|不可行|待議
    # {budget_fit, deadline_fit, category_fit, agency_relation, scope_match, competition, margin}
    criteria: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # embedding vector(1024)：Layer C（P3），換 EMBED_MODEL 要出新 migration，此處先不建。


class Share(Base):
    __tablename__ = "shares"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    tender_id: Mapped[int] = mapped_column(
        ForeignKey("tenders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    channel: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SavedSearch(Base):
    __tablename__ = "saved_searches"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    query_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    filter_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    use_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

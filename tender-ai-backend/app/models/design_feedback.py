# -*- coding: utf-8 -*-
"""Design feedback models.

These rows collect UI/UX feedback from the dev annotation tool and the assistant
so local CLI agents can later aggregate and act on the same source of truth.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DesignFeedbackItem(Base):
    __tablename__ = "design_feedback_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    # Same convention as assistant threads: "default" before login, user id when authenticated.
    owner_user_id: Mapped[str] = mapped_column(
        String(64), default="default", server_default="default", index=True, nullable=False
    )
    source: Mapped[str] = mapped_column(
        String(32), default="annotation", server_default="annotation", index=True, nullable=False
    )
    target_cli: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    route: Mapped[str] = mapped_column(String(256), index=True, nullable=False)
    selector: Mapped[str] = mapped_column(Text, nullable=False)
    component_guess: Mapped[str | None] = mapped_column(String(128), nullable=True)
    text_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    rect: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    feedback_type: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(24), index=True, nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at_client: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )

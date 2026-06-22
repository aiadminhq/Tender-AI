# -*- coding: utf-8 -*-
"""Layer C 個人化偏好輪廓 model（雙軌學習的「個人化」軌之高層輪廓）。

``preference_profiles`` 存每位使用者較高層的個人化輪廓（重點／避免關鍵字、
偏好類別、預算區間），直接餵畫面上的「我的偏好輪廓」卡片。與 per-term 的
``UserKeywordWeight``（knowledge.py）平行：前者是聚合後的人話摘要、後者是
逐詞權重，皆由 ``app/jobs/learn_keywords.py`` 的 per-user 聚合算出（衍生表，
GET 端點只讀不算）。

**同意邊界**：個人化線只用本人 ``events``、只服務本人，**不需共享同意**即可
運作，不進團隊庫、不對任何他人揭露（見 CLAUDE.md Layer B 治理）。隱私鐵則：
本表僅存本人公開標案衍生詞彙與數值，無他人資料。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PreferenceProfile(Base):
    __tablename__ = "preference_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 1-1 綁定使用者；unique 確保每人至多一份輪廓
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    # 重點關鍵字（[str, ...]，依權重排序的本人 positive 詞）
    top_keywords: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # 避免關鍵字（[str, ...]，本人 negative 詞）
    avoid_keywords: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # 偏好類別（[str, ...]，本人可行樣本最常見的 category）
    preferred_categories: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # 預算區間（由本人可行樣本的 budget 推導；無樣本則 None）
    budget_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    budget_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

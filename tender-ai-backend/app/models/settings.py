# -*- coding: utf-8 -*-
"""設定頁 models：標案詳情「常態性規格表」的欄位顯示設定（團隊共用，單列 id=1）。

標案詳情頁把已擷取的規格欄位（類別／決標方式／押標金／履約地點／履約期限／
經費來源／資格／附件／其他說明）改成一張常態性的兩欄規格表，每一欄都可由
管理者在設定頁勾選隱藏（原始招標網欄位太多）。

此設定是**團隊共用**（非個人偏好、非前端 localStorage）：開發期單機單操作者 →
固定單列 id=1，service 端 get-or-create。``hidden_fields`` 存被隱藏的欄位鍵清單
（前端欄位註冊表的 key），其餘一律顯示。

Layer 邊界：本表只存「哪些欄位要隱藏」的 UI 偏好，不含任何 Layer A 標案內容或
Layer B 行為資料，故可入版控（schema/code），與 brain_config 同屬全域設定族。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DetailFieldVisibilityConfig(Base):
    """標案詳情規格表的欄位顯示設定（團隊共用，單列 id=1，get-or-create）。"""

    __tablename__ = "detail_field_visibility_config"

    # 固定單列：service 端 get-or-create id=1。
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    # 被隱藏的欄位鍵清單（前端欄位註冊表 key）；空陣列＝全部顯示。
    hidden_fields: Mapped[list] = mapped_column(
        JSONB, default=list, server_default="[]", nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

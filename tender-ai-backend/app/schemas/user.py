# -*- coding: utf-8 -*-
"""個人資料／白名單／同意／個人偏好輪廓的 Pydantic schemas（Phase 1）。

對應計畫 `plans/profile-and-learning-db/plan.mdx` 的四支端點：
  GET  /api/v1/me                     → MeOut
  PUT  /api/v1/me/consent             → ConsentIn / ConsentOut
  GET  /api/v1/me/preference-profile  → PreferenceProfileOut
  GET/POST /api/v1/admin/whitelist    → WhitelistIn / WhitelistOut

**信任邊界（Phase 1）**：身分（user_id）由前端 body／query 帶入，後端不驗證
來源——白名單／本機環境內可信，不可作為對外可信來源；Phase 2 改由伺服器端
session 推導 user_id 與 role。
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MeOut(BaseModel):
    """當前登入者的帳戶、白名單與同意狀態。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str | None
    role: str | None
    whitelist_active: bool
    consent_shared: bool
    consent_at: datetime | None


class ConsentIn(BaseModel):
    """本人設定／撤回共享同意（第 2 段）。"""

    # Phase 1：本人身分由 body 帶入（不可信）；Phase 2 改由 session 推導後忽略此值
    user_id: int | None = None
    consent_shared: bool


class ConsentOut(BaseModel):
    """同意更新後狀態。"""

    model_config = ConfigDict(from_attributes=True)

    consent_shared: bool
    consent_at: datetime | None


class WhitelistIn(BaseModel):
    """管理員開通／停用白名單帳號（第 1 段）。"""

    email: str
    whitelist_active: bool


class WhitelistOut(BaseModel):
    """單一帳號的白名單／同意狀態（管理列表用）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str | None
    role: str | None
    whitelist_active: bool
    consent_shared: bool
    consent_at: datetime | None


class PreferenceProfileOut(BaseModel):
    """AI 從本人行為學到的個人化偏好（衍生表，只讀不算）。

    尚未經學習任務產出時，所有欄位為 None／空（GET 不 404）。
    """

    model_config = ConfigDict(from_attributes=True)

    top_keywords: list | None = None
    avoid_keywords: list | None = None
    preferred_categories: list | None = None
    budget_min: int | None = None
    budget_max: int | None = None
    updated_at: datetime | None = None

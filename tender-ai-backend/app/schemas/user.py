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
    """當前登入者的帳戶、白名單與同意狀態。

    `password_is_default` 為 True 表示仍是預設密碼（admin），前端據此於設定頁
    提示「建議修改密碼」（不強制）。由伺服器端依儲存雜湊推導，故重整／自動登入
    後仍能正確顯示（非僅登入當下）。
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str | None
    role: str | None
    whitelist_active: bool
    consent_shared: bool
    consent_at: datetime | None
    password_is_default: bool = False


class LoginIn(BaseModel):
    """登入（Phase 2）：以信箱＋密碼驗證身分。"""

    email: str
    password: str


class LoginOut(BaseModel):
    """登入成功後回傳的帳戶資料（Phase 2：含 HMAC token）。

    `password_is_default` 為 True 表示仍是預設密碼（admin），前端據此於設定頁
    提示「建議修改密碼」（不強制）。
    `token` 為 Phase 2 stateless HMAC token，`expires_at` 為 UTC 到期時間。
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str | None
    role: str | None
    whitelist_active: bool
    consent_shared: bool
    consent_at: datetime | None
    password_is_default: bool = False
    token: str = ""
    expires_at: datetime | None = None


class PasswordChangeIn(BaseModel):
    """本人修改密碼（設定頁）：須帶舊密碼驗證後才換新。"""

    old_password: str
    new_password: str


class AdminPasswordIn(BaseModel):
    """管理員修改／重置某帳號密碼（不需舊密碼；user_id 由路徑帶入）。"""

    new_password: str


class ConsentIn(BaseModel):
    """本人設定／撤回共享同意（第 2 段）。"""

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

# -*- coding: utf-8 -*-
"""Layer B 行為寫入 API 的 Pydantic schemas。

對應 claude-code-handoff-backend.md 附錄 C 的行為端點：
  save / accept / rate / note / share、events、saved-searches。
列舉值在此以 Literal 驗證（DB 端不落 enum，保留學習迴圈擴充彈性）。
user_id 皆可省略；省略時由服務層落到「預設使用者」（單一團隊）。
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Feasible = Literal["可行", "不可行", "待議"]
TenderStatus = Literal["觀望", "備標中", "已投", "得標", "放棄"]
EventType = Literal[
    "view", "open_detail", "click_link", "dwell", "apply_filter", "search", "sort"
]


# --------------------------------------------------------------------------- #
# requests
# --------------------------------------------------------------------------- #
class SaveRequest(BaseModel):
    user_id: int | None = None
    saved: bool = True  # 預設收藏；傳 false 取消收藏


class AcceptRequest(BaseModel):
    user_id: int | None = None
    status: TenderStatus = "備標中"  # accept＝納入備標


class RateRequest(BaseModel):
    user_id: int | None = None
    star: int = Field(ge=1, le=5)


class NoteRequest(BaseModel):
    user_id: int | None = None
    note: str = Field(min_length=1)


class ShareRequest(BaseModel):
    user_id: int | None = None
    channel: str | None = None  # email / line / link …


class EventRequest(BaseModel):
    user_id: int | None = None
    type: EventType
    tender_id: int | None = None
    payload: dict | None = None


class SavedSearchCreate(BaseModel):
    user_id: int | None = None
    name: str = Field(min_length=1)
    query_text: str | None = None
    filter_json: dict | None = None


# --------------------------------------------------------------------------- #
# responses（from_attributes：可直接由 ORM 物件序列化）
# --------------------------------------------------------------------------- #
class StateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    tender_id: int
    saved: bool
    status: str | None
    star: int | None
    updated_at: datetime


class AnnotationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    tender_id: int
    note: str
    created_at: datetime


class ShareOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    tender_id: int
    channel: str | None
    ts: datetime


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    type: str
    tender_id: int | None
    payload: dict | None
    ts: datetime


class SavedSearchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    name: str
    query_text: str | None
    filter_json: dict | None
    use_count: int
    created_at: datetime

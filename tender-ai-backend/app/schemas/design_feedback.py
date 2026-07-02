# -*- coding: utf-8 -*-
"""Schemas for UI/UX design feedback aggregation."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

DesignFeedbackType = Literal["visual", "interaction", "copy", "layout", "other"]
DesignFeedbackSeverity = Literal["suggest", "important", "blocker"]
DesignFeedbackSource = Literal["annotation", "assistant", "import"]
DesignFeedbackCli = Literal[
    "claude",
    "codex",
    "hermes",
    "opencode",
    "antigravity",
    "gemini",
]


class DesignFeedbackRect(BaseModel):
    x: float
    y: float
    width: float
    height: float


class DesignFeedbackCreateItem(BaseModel):
    route: str = Field(min_length=1, max_length=256)
    selector: str = Field(min_length=1)
    component_guess: str | None = Field(default=None, max_length=128)
    text_snapshot: str | None = None
    rect: DesignFeedbackRect | None = None
    type: DesignFeedbackType
    severity: DesignFeedbackSeverity
    comment: str = Field(min_length=1)
    created_at: datetime | None = None
    metadata: dict | None = None


class DesignFeedbackCreateRequest(BaseModel):
    batch_id: str | None = Field(default=None, max_length=64)
    source: DesignFeedbackSource = "annotation"
    target_cli: DesignFeedbackCli | None = None
    items: list[DesignFeedbackCreateItem] = Field(min_length=1, max_length=200)


class DesignFeedbackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    batch_id: str
    owner_user_id: str
    source: str
    target_cli: str | None
    route: str
    selector: str
    component_guess: str | None
    text_snapshot: str | None
    rect: dict | None
    feedback_type: str
    severity: str
    comment: str
    metadata_json: dict | None
    created_at_client: datetime | None
    created_at: datetime


class DesignFeedbackCreateResponse(BaseModel):
    batch_id: str
    count: int
    items: list[DesignFeedbackOut]


class DesignFeedbackListResponse(BaseModel):
    items: list[DesignFeedbackOut]


class DesignFeedbackSummaryResponse(BaseModel):
    count: int
    markdown: str

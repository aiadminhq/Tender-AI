# -*- coding: utf-8 -*-
"""標案助手串流 API schemas。

把對話層做成可串流的 retrieval assistant：
- 以現有 tender SQL 與 semantic search 產出標案證據
- 以知識庫（knowledge_chunks）混合檢索產出方法／規則證據（SL4 起 active）
- 事件以 NDJSON 串流，前端可逐段累積文字與來源
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class AssistantChatPart(BaseModel):
    """支援 assistant-ui 的訊息片段格式；第一版只消耗 text。"""

    model_config = ConfigDict(extra="allow")

    type: str
    text: str | None = None


class AssistantChatMessage(BaseModel):
    """聊天訊息輸入。"""

    model_config = ConfigDict(extra="allow")

    role: Literal["system", "user", "assistant", "tool"]
    content: list[AssistantChatPart] = Field(default_factory=list)


class AssistantChatRequest(BaseModel):
    """/assistant/chat 的請求體。"""

    model_config = ConfigDict(extra="allow")

    messages: list[AssistantChatMessage]
    thread_id: str | None = None
    context: dict[str, Any] | None = None


class AssistantSourceOut(BaseModel):
    """助手回傳的證據來源。

    - 標案類（tender/semantic/similar）帶 ``tender_id``、``source``（PCC/TMU）、``url``。
    - 知識庫類（knowledge）無 tender_id，改帶 ``doc_id``／``heading`` 標示文件與區段；
      ``source`` 固定為「知識庫」，前端據此渲染不同樣式的來源卡。
    """

    kind: Literal["tender", "semantic", "similar", "knowledge"]
    tender_id: int | None = None
    title: str
    source: str
    url: str | None = None
    score: float | None = None
    excerpt: str | None = None
    # 知識庫來源專用（標案來源為 None）
    doc_id: str | None = None
    heading: str | None = None


class AssistantToolContractOut(BaseModel):
    """文件知識庫工具契約；SL4 起知識庫已落地，狀態為 active。"""

    name: Literal["document_knowledge_base"] = "document_knowledge_base"
    version: str = "v1"
    status: Literal["reserved", "active"] = "active"
    capabilities: list[str] = Field(
        default_factory=lambda: [
            "document_search",
            "document_citation_lookup",
            "document_snippet_extraction",
        ]
    )


class PreferenceSuggestionOut(BaseModel):
    """對話中偵測到的「長期條件」建議（confirm-to-remember）。

    僅是「建議」——前端據此顯示確認 chip，使用者按確認後才會寫入一筆具名
    Layer B Event（``type="state_preference"``）。後端在此「不」自動寫入、
    「不」碰評分權重（負向只由真實 lift 自然浮現，見 CLAUDE.md AI 大腦鐵則）。
    """

    kind: Literal["region"]
    op: Literal["only", "exclude"]
    value: str
    raw: str


class AssistantChatMetaOut(BaseModel):
    """串流的第一個 meta 事件。"""

    type: Literal["meta"] = "meta"
    scope: str
    # 本串對話 id（前端帶上來就沿用，缺值由後端產生並回傳）；前端據此 hydrate／寫回。
    thread_id: str
    prompt: str
    sources: list[AssistantSourceOut]
    tool_contract: AssistantToolContractOut
    # 偵測到對話中的長期條件時帶出（否則 None）；前端據此渲染確認 chip。
    preference_suggestion: PreferenceSuggestionOut | None = None


class AssistantChatDeltaOut(BaseModel):
    """串流文字增量事件。"""

    type: Literal["delta"] = "delta"
    text: str


class AssistantChatDoneOut(BaseModel):
    """串流結束事件。"""

    type: Literal["done"] = "done"


# ── 對話留存（Phase 4）讀取用 schemas ──────────────────────────────────────
# Layer B 紅線：登入未落地前 owner 一律 "default"、consent_state="pending-consent"、
# layer_b_opt_in=False；不具名、不共享、對外永不揭露（見 CLAUDE.md）。


class AssistantThreadMessageOut(BaseModel):
    """thread 內單則訊息（含助手來源卡）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str
    content: str
    sources: list[AssistantSourceOut] | None = None


class AssistantThreadOut(BaseModel):
    """thread 列表項（不含訊息明細）。"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    owner_user_id: str
    scope: str
    title: str | None = None
    consent_state: str
    layer_b_opt_in: bool


class AssistantThreadDetailOut(AssistantThreadOut):
    """thread 詳情：thread 欄位 + 依序訊息。"""

    messages: list[AssistantThreadMessageOut] = Field(default_factory=list)


class AssistantThreadListOut(BaseModel):
    """GET /assistant/threads 的回應。"""

    threads: list[AssistantThreadOut] = Field(default_factory=list)


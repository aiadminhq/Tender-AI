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


class AssistantChatMetaOut(BaseModel):
    """串流的第一個 meta 事件。"""

    type: Literal["meta"] = "meta"
    scope: str
    prompt: str
    sources: list[AssistantSourceOut]
    tool_contract: AssistantToolContractOut


class AssistantChatDeltaOut(BaseModel):
    """串流文字增量事件。"""

    type: Literal["delta"] = "delta"
    text: str


class AssistantChatDoneOut(BaseModel):
    """串流結束事件。"""

    type: Literal["done"] = "done"


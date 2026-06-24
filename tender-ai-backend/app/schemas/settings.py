# -*- coding: utf-8 -*-
"""設定頁 schemas：小助手「大腦」全域設定（單機單操作者）。

選擇 AI 助手視窗背後由哪個 provider 生成：
- ``ollama``（預設）：本機換模型。
- ``cli``：spawn 本機 headless CLI（claude/codex/hermes，已注入 tender-ai-brain MCP）自主 agentic。
- ``byok``：自帶金鑰直連雲端 LLM（v1：Anthropic）。

secret 紅線（見 CLAUDE.md）：BYOK 金鑰本體只進 ``.env``；此處只回傳／接收非密欄位，
``byok_key_set`` 為**唯讀**衍生布林（金鑰是否已設定），永不回傳金鑰本體。
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

BrainProvider = Literal["ollama", "cli", "byok"]
CliAgent = Literal["claude", "codex", "hermes"]
ByokProtocol = Literal["anthropic"]


class BrainConfigOut(BaseModel):
    """GET /settings/brain 的回應：目前大腦設定。"""

    model_config = ConfigDict(from_attributes=True)

    provider: BrainProvider
    ollama_model: str | None = None
    cli_agent: str | None = None
    byok_protocol: str | None = None
    byok_base_url: str | None = None
    byok_model: str | None = None
    # 唯讀：金鑰是否已在 .env 設定（永不回傳金鑰本體）。
    byok_key_set: bool = False
    updated_at: datetime | None = None


class BrainConfigUpdate(BaseModel):
    """PUT /settings/brain 的請求：部分更新非密欄位。

    只送要改的欄位即可（未送欄位不動）。金鑰本體不在此處設定（走 .env）。
    """

    provider: BrainProvider | None = None
    ollama_model: str | None = None
    cli_agent: CliAgent | None = None
    byok_protocol: ByokProtocol | None = None
    byok_base_url: str | None = None
    byok_model: str | None = None

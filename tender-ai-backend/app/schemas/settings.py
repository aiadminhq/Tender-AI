# -*- coding: utf-8 -*-
"""設定頁 schemas：小助手「大腦」全域設定（單機單操作者）。

選擇 AI 助手視窗背後由哪個 provider 生成：
- ``ollama``（預設）：本機換模型。
- ``cli``：spawn 本機 headless CLI（claude/codex/hermes，已注入 tender-ai-brain MCP）自主 agentic。
- ``byok``：自帶金鑰直連雲端 LLM（Anthropic / OpenRouter）。

secret 紅線（見 CLAUDE.md）：BYOK 金鑰本體只進 ``.env``；此處只回傳／接收非密欄位，
``byok_key_set`` 為**唯讀**衍生布林（金鑰是否已設定），永不回傳金鑰本體。
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

from app.services.brain_cli_registry import cli_agent_keys

BrainProvider = Literal["ollama", "cli", "byok"]
ByokProtocol = Literal["anthropic", "openrouter"]


class BrainConfigOut(BaseModel):
    """GET /settings/brain 的回應：目前大腦設定。"""

    model_config = ConfigDict(from_attributes=True)

    provider: BrainProvider
    ollama_model: str | None = None
    cli_agent: str | None = None
    cli_model: str | None = None
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
    cli_agent: str | None = None
    cli_model: str | None = None
    byok_protocol: ByokProtocol | None = None
    byok_base_url: str | None = None
    byok_model: str | None = None

    @field_validator("cli_agent")
    @classmethod
    def _validate_cli_agent(cls, v: str | None) -> str | None:
        # 註冊表驅動：值須 ∈ CLI registry keys；未知（如 "skynet"）→ 422。
        if v is not None and v not in cli_agent_keys():
            allowed = "、".join(cli_agent_keys())
            raise ValueError(f"未知的 CLI 代理：{v}（可選：{allowed}）")
        return v


# ── 大腦測試／代理清單（brain-picker 擴充）──────────────────────────────────────


class BrainAgentSpec(BaseModel):
    """GET /settings/brain/agents 單筆：一個 CLI 代理的可選資訊。"""

    key: str
    label_i18n: str
    models: list[str] = []
    default_model: str | None = None
    supports_model: bool = False
    needs_local_verify: bool = False


class BrainAgentsOut(BaseModel):
    """GET /settings/brain/agents 的回應：CLI 代理註冊表。"""

    agents: list[BrainAgentSpec] = []


class BrainTestRequest(BaseModel):
    """POST /settings/brain/test 的請求：以候選（未存）設定做煙測。

    不含任何祕密；BYOK 金鑰仍由 .env 取得（body 不帶）。
    """

    provider: BrainProvider
    ollama_model: str | None = None
    cli_agent: str | None = None
    cli_model: str | None = None
    byok_protocol: ByokProtocol | None = None
    byok_base_url: str | None = None
    byok_model: str | None = None

    @field_validator("cli_agent")
    @classmethod
    def _validate_cli_agent(cls, v: str | None) -> str | None:
        if v is not None and v not in cli_agent_keys():
            allowed = "、".join(cli_agent_keys())
            raise ValueError(f"未知的 CLI 代理：{v}（可選：{allowed}）")
        return v


class BrainTestResult(BaseModel):
    """POST /settings/brain/test 的回應：煙測結果（HTTP 恆 200，永不含祕密）。"""

    ok: bool
    provider: str
    model: str | None = None
    elapsed_ms: int = 0
    sample: str = ""
    error: str | None = None


# ── 標案詳情規格表：欄位顯示設定（團隊共用，單列 id=1）────────────────────────────


class DetailFieldVisibilityOut(BaseModel):
    """GET /settings/detail-fields 的回應：目前被隱藏的詳情欄位鍵清單。"""

    model_config = ConfigDict(from_attributes=True)

    # 被隱藏的欄位鍵（前端欄位註冊表 key）；空陣列＝全部顯示。
    hidden_fields: list[str] = []
    updated_at: datetime | None = None


class DetailFieldVisibilityUpdate(BaseModel):
    """PUT /settings/detail-fields 的請求：整批覆蓋被隱藏的欄位鍵清單。

    未送 ``hidden_fields`` 則不動；送出時整批覆蓋（service 端會去重正規化）。
    """

    hidden_fields: list[str] | None = None

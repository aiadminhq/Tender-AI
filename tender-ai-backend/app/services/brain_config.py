# -*- coding: utf-8 -*-
"""小助手「大腦」全域設定 service（單機單操作者 → 單列 id=1，get-or-create）。

封裝 ``assistant_brain_config`` 的讀／寫。設定決定 AI 助手視窗背後由哪個 provider
生成（ollama／cli／byok）。

secret 紅線（見 CLAUDE.md）：BYOK 金鑰本體只進 ``.env``；本層只讀寫 ``byok_key_set``
布林，**不碰金鑰本體**。``update`` 只更新傳入的非密欄位。
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assistant import AssistantBrainConfig

# 固定單列主鍵。
_ROW_ID = 1

# 允許更新的非密欄位（金鑰本體不在此列，走 .env）。
_MUTABLE_FIELDS = (
    "provider",
    "ollama_model",
    "cli_agent",
    "cli_model",
    "byok_protocol",
    "byok_base_url",
    "byok_model",
)


async def get_or_create(session: AsyncSession) -> AssistantBrainConfig:
    """取得單列設定；不存在則以預設（provider=cli, cli_agent=claude → Claude Code）建立。

    開發期單機單操作者，算力由本機 CLI 提供，故預設大腦＝Claude Code（CLI 自主代理，
    已注入 tender-ai-brain MCP）。需要時可在設定頁改為 ollama／byok。
    """
    config = await session.get(AssistantBrainConfig, _ROW_ID)
    if config is not None:
        return config

    config = AssistantBrainConfig(id=_ROW_ID, provider="cli", cli_agent="claude")
    session.add(config)
    await session.flush()
    return config


async def update(
    session: AsyncSession, changes: dict[str, object]
) -> AssistantBrainConfig:
    """更新非密欄位（None 值視為清空，仍套用）；金鑰本體一律忽略。"""
    config = await get_or_create(session)
    for field in _MUTABLE_FIELDS:
        if field in changes:
            setattr(config, field, changes[field])
    await session.flush()
    return config

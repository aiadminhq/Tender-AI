# -*- coding: utf-8 -*-
"""Claude API 聊天串流（Anthropic Messages API，SSE via httpx）。

介面與 llm.py（Ollama）相同：stream_chat() 為 async generator，逐塊 yield str。
provider 切換由 assistant.py 依 settings.assistant_provider 決定；此處不碰 Layer B。

鐵則：prompt 由 assistant.py 以公開證據（Layer A）組裝後傳入，不在此處接觸使用者行為資料。
"""
from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from app.core.config import settings

_ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_VERSION = "2023-06-01"


class ClaudeLlmError(RuntimeError):
    """Claude API 呼叫失敗或回傳格式異常。"""


async def stream_chat(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    timeout: float | None = None,
    max_tokens: int | None = None,
) -> AsyncIterator[str]:
    """串流 Claude Messages API：逐塊 yield 新增文字（增量，非累積）。

    messages 格式與 llm.py 相同（role/content dict 清單；system role 自動提取）。
    任何網路／逾時／非 2xx／格式問題一律 ClaudeLlmError，由 assistant.py 退回模板。
    """
    if not settings.anthropic_api_key:
        raise ClaudeLlmError("ANTHROPIC_API_KEY 未設定，無法呼叫 Claude API")

    # 將 Ollama 格式（含 system role）轉換為 Anthropic Messages API 格式
    system_content = ""
    anthropic_messages: list[dict[str, str]] = []
    for msg in messages:
        if msg["role"] == "system":
            system_content = msg.get("content", "")
        elif msg["role"] in ("user", "assistant"):
            anthropic_messages.append({"role": msg["role"], "content": msg["content"]})

    if not anthropic_messages:
        raise ClaudeLlmError("沒有可傳送的 user/assistant 訊息")

    body: dict = {
        "model": model or settings.claude_model,
        "max_tokens": max_tokens or settings.chat_num_predict,
        "stream": True,
        "messages": anthropic_messages,
    }
    if system_content:
        body["system"] = system_content

    headers = {
        "x-api-key": settings.anthropic_api_key,
        "anthropic-version": _ANTHROPIC_VERSION,
        "content-type": "application/json",
    }

    _timeout = timeout if timeout is not None else settings.chat_timeout

    try:
        async with httpx.AsyncClient(timeout=_timeout) as client:
            async with client.stream(
                "POST", _ANTHROPIC_MESSAGES_URL, json=body, headers=headers
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    raw = line[len("data:"):].strip()
                    if raw == "[DONE]":
                        break
                    try:
                        data = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    event_type = data.get("type", "")
                    if event_type == "content_block_delta":
                        delta = data.get("delta", {})
                        if delta.get("type") == "text_delta":
                            chunk = delta.get("text", "")
                            if chunk:
                                yield chunk
                    elif event_type == "message_stop":
                        break
                    elif event_type == "error":
                        err = data.get("error", {})
                        raise ClaudeLlmError(
                            f"Claude API 回報錯誤：{err.get('type')} {err.get('message')}"
                        )
    except httpx.HTTPStatusError as e:
        raise ClaudeLlmError(f"Claude API HTTP 錯誤 {e.response.status_code}") from e
    except httpx.HTTPError as e:
        raise ClaudeLlmError(f"Claude API 連線失敗：{e}") from e

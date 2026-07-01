# -*- coding: utf-8 -*-
"""OpenRouter 聊天串流（OpenAI 相容 /chat/completions，SSE via httpx）。

介面與 claude_llm.py / llm.py 相同：stream_chat() 為 async generator，逐塊 yield str。
provider 切換由 assistant.py 依 settings.assistant_provider == "openrouter" 決定；此處不碰 Layer B。
鐵則：prompt 由 assistant.py 以公開證據 (Layer A) 組裝後傳入，不在此處接觸使用者行為資料。
任何網路／逾時／非 2xx／格式問題一律 OpenRouterLlmError，由 assistant.py 的 except 退回模板 (HTTP 仍 200)。
"""
from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from app.core.config import settings


class OpenRouterLlmError(RuntimeError):
    """OpenRouter API 呼叫失敗或回傳格式異常。"""


async def stream_chat(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    timeout: float | None = None,
    max_tokens: int | None = None,
) -> AsyncIterator[str]:
    """串流 OpenRouter Chat Completions：逐塊 yield 新增文字（增量，非累積）。

    messages 格式與 llm.py 相同（OpenAI 相容：system / user / assistant 直接傳）。
    """
    if not settings.openrouter_api_key:
        raise OpenRouterLlmError("OPENROUTER_API_KEY 未設定，無法呼叫 OpenRouter API")

    # OpenAI 相容格式：system / user / assistant 直接送出（不需像 Anthropic 抽出 system）
    oai_messages: list[dict[str, str]] = []
    for msg in messages:
        role = msg.get("role")
        if role in ("system", "user", "assistant"):
            oai_messages.append({"role": role, "content": msg.get("content", "")})

    if not oai_messages:
        raise OpenRouterLlmError("沒有可傳送的訊息")

    body: dict = {
        "model": model or settings.openrouter_model,
        "max_tokens": max_tokens or settings.chat_num_predict,
        "stream": True,
        "messages": oai_messages,
    }

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
    }
    # 選填：OpenRouter 排行榜歸屬標頭
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_site_name:
        headers["X-Title"] = settings.openrouter_site_name

    _timeout = timeout if timeout is not None else settings.chat_timeout
    _url = settings.openrouter_base_url.rstrip("/") + "/chat/completions"

    try:
        async with httpx.AsyncClient(timeout=_timeout) as client:
            async with client.stream(
                "POST", _url, json=body, headers=headers
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
                    choices = data.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta", {})
                    chunk = delta.get("content", "")
                    if chunk:
                        yield chunk
    except httpx.HTTPStatusError as e:
        raise OpenRouterLlmError(
            f"OpenRouter API HTTP 錯誤 {e.response.status_code}"
        ) from e
    except httpx.HTTPError as e:
        raise OpenRouterLlmError(f"OpenRouter API 連線失敗：{e}") from e

# -*- coding: utf-8 -*-
"""LLM 生成服務：呼叫本機 Ollama ``POST /api/chat`` 取串流回應（SL1）。

- 串流端點 ``POST {ollama_url}/api/chat``，body ``{"model","messages","stream":true,
  "options":{...}}``；逐行 NDJSON，每行 ``{"message":{"content":...},"done":bool}``。
- 以 ``asyncio.Semaphore`` 限制本機同時生成數（本機 Ollama 不耐並發），避免拖垮機器。
- 任何網路／逾時／非 2xx 一律 ``LlmError``，由呼叫端決定退回模板（assistant.py）。
- CI／測試不連 Ollama：以 ``monkeypatch.setattr("app.services.llm.stream_chat", ...)``
  替換；故呼叫端請用模組屬性存取（``llm.stream_chat(...)``）而非 import 後綁定。
- 鐵則：不在此處落任何 Layer B 私有資料；prompt 由 assistant.py 以公開證據組裝。
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

import httpx

from app.core.config import settings


class LlmError(RuntimeError):
    """Ollama chat 後端呼叫失敗，或回傳格式異常。"""


# 模組層級 Semaphore：限制本機同時生成數。延遲建立以綁定到實際 event loop。
_semaphore: asyncio.Semaphore | None = None


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(max(1, settings.assistant_max_concurrency))
    return _semaphore


async def stream_chat(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    url: str | None = None,
    timeout: float | None = None,
    num_predict: int | None = None,
    temperature: float | None = None,
) -> AsyncIterator[str]:
    """串流 Ollama chat：逐塊 yield 新增文字（增量，非累積）。

    呼叫端負責累積成全文。任何網路／逾時／格式問題一律 ``LlmError``。
    Ollama 回報 ``done`` 後即收尾。
    """
    model = model or settings.chat_model
    base = (url or settings.ollama_url).rstrip("/")
    timeout = settings.chat_timeout if timeout is None else timeout
    num_predict = settings.chat_num_predict if num_predict is None else num_predict
    temperature = settings.chat_temperature if temperature is None else temperature

    body = {
        "model": model,
        "messages": messages,
        "stream": True,
        # qwen3.5 等 reasoning 模型預設把答案灌進 message.thinking、content 留空，
        # 在 num_predict 內思考就會吃光額度（done_reason=length、content=''）。
        # 關閉 thinking → 模型直接把答案寫進 content；不支援此參數的模型 Ollama 會略過。
        "think": False,
        "options": {"num_predict": num_predict, "temperature": temperature},
    }

    async with _get_semaphore():
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                    "POST", f"{base}/api/chat", json=body
                ) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if data.get("error"):
                            raise LlmError(f"Ollama chat 回報錯誤：{data['error']}")
                        chunk = (data.get("message") or {}).get("content") or ""
                        if chunk:
                            yield chunk
                        if data.get("done"):
                            break
        except httpx.HTTPError as e:  # 連線逾時／非 2xx／讀取中斷等
            raise LlmError(f"Ollama chat 呼叫失敗：{e}") from e

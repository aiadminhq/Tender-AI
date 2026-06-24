# -*- coding: utf-8 -*-
"""小助手「大腦」provider 路由器。

把「怎麼生成」從 ``assistant.py`` 抽出，依全域設定（``assistant_brain_config``）分派到：

- ``ollama``（預設）：包 ``llm.stream_chat``，逐塊 yield 增量文字。
- ``cli``：spawn 本機 headless CLI（claude/codex/hermes，已注入 tender-ai-brain MCP），
  讓它自主 agentic 呼叫 MCP 工具檢索＋推理；tool_use → progress、最終 result → 一筆 delta。
- ``byok``：自帶金鑰直連雲端 LLM（v1：Anthropic messages stream）。

delta 語意（與 assistant.py 既有一致）：本層 yield 的 ``BrainChunk(kind="delta")`` 為
**增量**，由 ``assistant.py`` 累積成全文再以 replace 語意送前端；``kind="progress"`` 為暫態
狀態，assistant.py 直接轉發、不累積、不留存。

Layer B / secret 紅線（見 CLAUDE.md / MCP_BRIDGE.md）：
- ollama／byok 路徑的 ``messages`` 由 assistant.py 以公開 A 層證據組裝，不含 Layer B 行為明細；
  byok 金鑰只取自 ``.env``（settings），不入庫/版控。
- cli 路徑的安全邊界落在 MCP tool-output 層（只回 A 層＋去識別化 C 層、個人狀態限操作帳號、
  不含姓名/email）；本層不另組裝個資。
任一 provider 失敗一律 raise ``BrainError``，由 assistant.py 退回模板（HTTP 仍 200）。
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, AsyncIterator, Literal

import httpx

from app.core.config import settings
from app.services import llm


class BrainError(RuntimeError):
    """大腦 provider 生成失敗；呼叫端應退回模板。"""


@dataclass
class BrainChunk:
    # delta=答案增量（assistant.py 累積）；progress=暫態狀態（直接轉發、不留存）。
    kind: Literal["delta", "progress"]
    text: str


# CLI provider 預設命令樣板（可在 settings 覆寫）。{prompt} 由呼叫端帶入。
_CLI_COMMANDS: dict[str, list[str]] = {
    "claude": ["claude", "-p", "{prompt}", "--output-format", "stream-json", "--verbose"],
}


async def stream(
    *,
    config: Any,
    messages: list[dict[str, str]],
    prompt: str,
    history: list[dict[str, str]] | None = None,
    focus_note: str = "",
) -> AsyncIterator[BrainChunk]:
    """依 config.provider 分派生成；統一 yield BrainChunk。"""
    provider = getattr(config, "provider", "ollama") or "ollama"

    if provider == "ollama":
        async for chunk in _stream_ollama(config, messages):
            yield chunk
    elif provider == "byok":
        async for chunk in _stream_byok(config, messages):
            yield chunk
    elif provider == "cli":
        async for chunk in _stream_cli(config, prompt=prompt, focus_note=focus_note):
            yield chunk
    else:
        raise BrainError(f"未知的大腦 provider：{provider}")


# ── ollama ──────────────────────────────────────────────────────────────────


async def _stream_ollama(
    config: Any, messages: list[dict[str, str]]
) -> AsyncIterator[BrainChunk]:
    model = getattr(config, "ollama_model", None) or None
    try:
        async for chunk in llm.stream_chat(messages, model=model):
            yield BrainChunk("delta", chunk)
    except llm.LlmError as e:
        raise BrainError(str(e)) from e


# ── byok（Anthropic messages stream）─────────────────────────────────────────


def _split_system(messages: list[dict[str, str]]) -> tuple[str, list[dict[str, str]]]:
    """把 system 訊息抽出（Anthropic 走頂層 ``system`` 欄位），其餘為對話訊息。"""
    system_parts = [m["content"] for m in messages if m.get("role") == "system"]
    convo = [
        {"role": m["role"], "content": m["content"]}
        for m in messages
        if m.get("role") in ("user", "assistant")
    ]
    if not convo:
        convo = [{"role": "user", "content": "請依候選標案清單給我重點。"}]
    return "\n\n".join(system_parts), convo


async def _stream_byok(
    config: Any, messages: list[dict[str, str]]
) -> AsyncIterator[BrainChunk]:
    protocol = getattr(config, "byok_protocol", None) or "anthropic"
    if protocol != "anthropic":
        raise BrainError(f"BYOK 暫不支援協定：{protocol}")

    api_key = settings.anthropic_api_key
    if not api_key:
        raise BrainError("BYOK 金鑰未設定（ANTHROPIC_API_KEY 為空）")

    base = (getattr(config, "byok_base_url", None) or "https://api.anthropic.com").rstrip("/")
    model = getattr(config, "byok_model", None) or "claude-opus-4-8"
    system, convo = _split_system(messages)

    body = {
        "model": model,
        "max_tokens": settings.chat_num_predict,
        "temperature": settings.chat_temperature,
        "stream": True,
        "messages": convo,
    }
    if system:
        body["system"] = system
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=settings.chat_timeout) as client:
            async with client.stream(
                "POST", f"{base}/v1/messages", json=body, headers=headers
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    data_raw = line[len("data:"):].strip()
                    if not data_raw or data_raw == "[DONE]":
                        continue
                    try:
                        data = json.loads(data_raw)
                    except json.JSONDecodeError:
                        continue
                    if data.get("type") == "content_block_delta":
                        text = (data.get("delta") or {}).get("text") or ""
                        if text:
                            yield BrainChunk("delta", text)
                    elif data.get("type") == "error":
                        msg = (data.get("error") or {}).get("message") or "unknown"
                        raise BrainError(f"BYOK 回報錯誤：{msg}")
    except httpx.HTTPError as e:
        raise BrainError(f"BYOK 呼叫失敗：{e}") from e


# ── cli（headless agentic）────────────────────────────────────────────────────


def _build_cli_prompt(prompt: str, focus_note: str) -> str:
    """組 CLI 單一 prompt：情境提示 + 使用者提問。CLI 自行跑 MCP 檢索。"""
    parts = []
    if focus_note:
        parts.append(f"[目前檢視情境]\n{focus_note}")
    parts.append(prompt or "請依資料庫與知識庫給我重點。")
    return "\n\n".join(parts)


def _cli_argv(agent: str, prompt: str) -> list[str]:
    template = _CLI_COMMANDS.get(agent)
    if template is None:
        raise BrainError(f"CLI 大腦暫不支援：{agent}")
    return [prompt if tok == "{prompt}" else tok for tok in template]


async def _stream_cli(
    config: Any, *, prompt: str, focus_note: str
) -> AsyncIterator[BrainChunk]:
    agent = getattr(config, "cli_agent", None) or "claude"
    full_prompt = _build_cli_prompt(prompt, focus_note)
    argv = _cli_argv(agent, full_prompt)

    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as e:
        raise BrainError(f"找不到 CLI 可執行檔：{agent}") from e
    except Exception as e:  # noqa: BLE001
        raise BrainError(f"啟動 CLI 失敗：{e}") from e

    answer_parts: list[str] = []
    saw_result = False
    assert proc.stdout is not None
    try:
        async for raw in proc.stdout:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            chunk = _parse_cli_line(line, answer_parts)
            if chunk is not None:
                if chunk.kind == "delta":
                    saw_result = True
                yield chunk
        await proc.wait()
    finally:
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass

    if proc.returncode not in (0, None):
        stderr = b""
        if proc.stderr is not None:
            try:
                stderr = await proc.stderr.read()
            except Exception:  # noqa: BLE001
                stderr = b""
        raise BrainError(
            f"CLI 非零退出（{proc.returncode}）：{stderr.decode('utf-8', 'replace')[:200]}"
        )

    # 沒有明確 result 事件但累積了 assistant 文字 → 補一筆完整 delta。
    if not saw_result:
        final = "".join(answer_parts).strip()
        if final:
            yield BrainChunk("delta", final)
        else:
            raise BrainError("CLI 未產出任何內容")


def _parse_cli_line(line: str, answer_parts: list[str]) -> BrainChunk | None:
    """解析一行 Claude Code stream-json。

    - ``type=assistant``：content blocks 內 text → 累積；tool_use → progress。
    - ``type=result``：取最終文字 → 一筆完整 delta。
    其餘（system/init 等）忽略。回傳要送出的 chunk 或 None。
    """
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        return None

    etype = data.get("type")
    if etype == "assistant":
        blocks = (data.get("message") or {}).get("content") or []
        progress_tool: str | None = None
        for block in blocks:
            btype = block.get("type")
            if btype == "text":
                answer_parts.append(block.get("text") or "")
            elif btype == "tool_use":
                progress_tool = block.get("name") or "tool"
        if progress_tool is not None:
            return BrainChunk("progress", f"查詢中：{progress_tool}")
        return None

    if etype == "result":
        result_text = data.get("result")
        if isinstance(result_text, str) and result_text.strip():
            return BrainChunk("delta", result_text.strip())
        final = "".join(answer_parts).strip()
        if final:
            return BrainChunk("delta", final)
        return None

    return None

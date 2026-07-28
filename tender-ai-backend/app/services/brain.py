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
import re
from dataclasses import dataclass
from typing import Any, AsyncIterator, Literal

import httpx

from app.core.config import settings
from app.services import llm
from app.services.brain_cli_registry import CLI_REGISTRY, get_spec


class BrainError(RuntimeError):
    """大腦 provider 生成失敗；呼叫端應退回模板。"""


@dataclass
class BrainChunk:
    # delta=答案增量（assistant.py 累積）；progress=暫態狀態（直接轉發、不留存）。
    kind: Literal["delta", "progress"]
    text: str


# CLI 代理的啟動樣板、parser 種類、模型旗標等集中於 ``brain_cli_registry``（單一事實來源）。
# 共通前提：tender-ai-brain MCP 已分別注入各 CLI 的設定檔（claude=.claude.json／
# codex=~/.codex/config.toml／hermes=~/.hermes/config.yaml，見 MCP_BRIDGE.md），本層只負責
# 「依註冊表以正確旗標啟動 + 依 parser 種類解析輸出」。


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


# ── byok（Anthropic-compatible messages stream）──────────────────────────────


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
    base, model, headers = _byok_connection(config)
    system, convo = _split_system(messages)

    body = {
        "model": model,
        "max_tokens": settings.chat_num_predict,
        "stream": True,
        "messages": convo,
    }
    if system:
        body["system"] = system

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


def _byok_connection(config: Any) -> tuple[str, str, dict[str, str]]:
    """依協定組出 endpoint、模型與 headers；金鑰只從環境設定取得。"""
    protocol = getattr(config, "byok_protocol", None) or "anthropic"
    if protocol == "anthropic":
        api_key = settings.anthropic_api_key
        env_name = "ANTHROPIC_API_KEY"
        default_base = "https://api.anthropic.com"
        default_model = "claude-sonnet-5"
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
    elif protocol == "openrouter":
        api_key = settings.openrouter_api_key
        env_name = "OPENROUTER_API_KEY"
        default_base = "https://openrouter.ai/api"
        default_model = "anthropic/claude-sonnet-5"
        headers = {
            "authorization": f"Bearer {api_key}",
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
    else:
        raise BrainError(f"BYOK 暫不支援協定：{protocol}")

    if not api_key:
        raise BrainError(f"BYOK 金鑰未設定（{env_name} 為空）")

    base = (getattr(config, "byok_base_url", None) or default_base).rstrip("/")
    model = getattr(config, "byok_model", None) or default_model
    return base, model, headers


# ── cli（headless agentic）────────────────────────────────────────────────────


def _build_cli_prompt(prompt: str, focus_note: str) -> str:
    """組 CLI 單一 prompt：情境提示 + 使用者提問。CLI 自行跑 MCP 檢索。"""
    parts = []
    if focus_note:
        parts.append(f"[目前檢視情境]\n{focus_note}")
    parts.append(prompt or "請依資料庫與知識庫給我重點。")
    return "\n\n".join(parts)


def _cli_argv(agent: str, prompt: str, model: str | None = None) -> list[str]:
    spec = get_spec(agent)
    if spec is None:
        raise BrainError(f"CLI 大腦暫不支援：{agent}")
    argv = [prompt if tok == "{prompt}" else tok for tok in spec.argv]
    # 僅當設了模型且該代理支援指定模型時，把 model flag append 到尾端（非破壞性）。
    if model and spec.model_flag:
        argv.extend([spec.model_flag, model])
    return argv


async def _stream_cli(
    config: Any, *, prompt: str, focus_note: str
) -> AsyncIterator[BrainChunk]:
    selected_agent = getattr(config, "cli_agent", None) or "claude"
    selected_model = getattr(config, "cli_model", None) or None
    full_prompt = _build_cli_prompt(prompt, focus_note)
    attempts = _cli_attempt_order(selected_agent)
    errors: list[str] = []

    for index, agent in enumerate(attempts):
        emitted_answer = False
        try:
            async for chunk in _stream_cli_once(
                agent=agent,
                model=selected_model if agent == selected_agent else None,
                full_prompt=full_prompt,
            ):
                if chunk.kind == "delta":
                    emitted_answer = True
                yield chunk
            return
        except BrainError as e:
            # 已輸出部分答案時不可改由另一代理重跑，避免前端收到重複或矛盾內容。
            if emitted_answer:
                raise
            errors.append(f"{agent}: {e}")
            if index + 1 < len(attempts):
                next_agent = attempts[index + 1]
                yield BrainChunk(
                    "progress",
                    f"{agent} 無法使用，改由 {next_agent} 接手",
                )

    raise BrainError(f"所有 CLI 代理皆失敗：{'；'.join(errors)}")


def _cli_attempt_order(selected_agent: str) -> list[str]:
    """首選代理優先，其後只加入本機已驗證的 fallback 代理。"""
    verified = [
        key
        for key, spec in CLI_REGISTRY.items()
        if not spec.needs_local_verify and key != selected_agent
    ]
    return [selected_agent, *verified]


async def _stream_cli_once(
    *, agent: str, model: str | None, full_prompt: str
) -> AsyncIterator[BrainChunk]:
    """執行單一 CLI；fallback 策略由 ``_stream_cli`` 統一處理。"""
    argv = _cli_argv(agent, full_prompt, model)

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
            chunk = _parse_cli_line(agent, line, answer_parts)
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


def _parse_cli_line(agent: str, line: str, answer_parts: list[str]) -> BrainChunk | None:
    """依註冊表的 parser 種類分派。各 CLI 輸出格式不同（見 brain_cli_registry）。

    回傳要送出的 chunk 或 None；解析不到結構的雜訊一律 None（不中斷串流）。
    codex 失敗事件會 raise BrainError（由 assistant.py 退模板）。
    parser 種類：claude（stream-json）／codex（JSONL）／hermes／text（純文字逐行 delta）。
    """
    spec = get_spec(agent)
    parser = spec.parser if spec is not None else "claude"
    if parser == "codex":
        return _parse_codex_line(line, answer_parts)
    if parser in ("hermes", "text"):
        # text 與 hermes 同為純文字逐行 delta（opencode/antigravity 走此路）。
        return _parse_hermes_line(line, answer_parts)
    return _parse_claude_line(line, answer_parts)


def _parse_claude_line(line: str, answer_parts: list[str]) -> BrainChunk | None:
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


# codex exec --json 事件（JSONL）。最終答案經由 item.completed / item.type=agent_message
# 傳來（為完整訊息，非 token 增量）；工具/指令類 item → progress；error / turn.failed → 失敗。
# 收尾統一靠 _stream_cli 的「無 result 但有累積文字」分支補一筆完整 delta，故本 parser 對
# agent_message 採「取代累積」（保留最後一則＝結論，蓋過前置 preamble），且回 None 不即時送。
_CODEX_PROGRESS_ITEMS = {
    "command_execution": "執行指令",
    "mcp_tool_call": "查詢資料庫",
    "web_search": "搜尋",
    "file_change": "整理資料",
}


def _parse_codex_line(line: str, answer_parts: list[str]) -> BrainChunk | None:
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        return None

    etype = data.get("type")

    if etype == "error":
        msg = data.get("message") or "codex 回報錯誤"
        raise BrainError(f"codex 失敗：{str(msg)[:200]}")
    if etype == "turn.failed":
        msg = (data.get("error") or {}).get("message") or "turn failed"
        raise BrainError(f"codex 失敗：{str(msg)[:200]}")

    if etype == "item.completed":
        item = data.get("item") or {}
        itype = item.get("type")
        if itype == "agent_message":
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                answer_parts.clear()  # 保留最後一則 agent_message 為最終答案
                answer_parts.append(text.strip())
            return None
        label = _CODEX_PROGRESS_ITEMS.get(itype)
        if label is not None:
            # MCP 工具呼叫盡量帶出工具名，讓「查詢中：search_tenders」更具體。
            tool = item.get("tool") or item.get("name") or item.get("server")
            if itype == "mcp_tool_call" and tool:
                return BrainChunk("progress", f"查詢中：{tool}")
            return BrainChunk("progress", f"{label}中…")
        return None

    return None


# hermes -z/--oneshot：無 JSON 事件格式，stdout 即純文字答案。逐行當 delta 增量串流
# （assistant.py 會累積成全文，前端 replace）；補上換行以保留 markdown 結構。
def _parse_hermes_line(line: str, answer_parts: list[str]) -> BrainChunk | None:
    text = _strip_ansi(line)
    if not text.strip():
        return None
    answer_parts.append(text + "\n")
    return BrainChunk("delta", text + "\n")


_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


def _strip_ansi(s: str) -> str:
    """去除終端 ANSI 跳脫序列（hermes 純文字輸出可能夾帶色碼/游標控制）。"""
    return _ANSI_RE.sub("", s)

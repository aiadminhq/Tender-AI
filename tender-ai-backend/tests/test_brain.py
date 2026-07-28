# -*- coding: utf-8 -*-
"""小助手「大腦」provider 路由器（app/services/brain.py）的離線單元測試。

只測純邏輯與分派：
- ``stream`` 依 ``config.provider`` 分派（ollama 以 monkeypatch 的 llm.stream_chat 驗證）。
- CLI 行解析（``_parse_cli_line`` 分派器）：claude stream-json／codex exec JSONL／hermes 純文字
  三家各自的累積、progress、失敗語意。
- ``_stream_cli`` codex 整段流程（fake subprocess）：progress 轉發 + 收尾單筆完整 delta。
- CLI argv 樣板與未支援 agent → BrainError；byok system 抽取。

不連 Ollama／不 spawn 真實 CLI／不連雲端：全部以合成輸入驗證。
"""
from __future__ import annotations

import json

import pytest

from app.services import brain
from app.services.brain import BrainChunk, BrainError


class _Cfg:
    """輕量假 config（模擬 AssistantBrainConfig 的屬性存取）。"""

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


async def _collect(aiter):
    return [c async for c in aiter]


# ── 分派 ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_stream_dispatch_ollama(monkeypatch):
    """provider=ollama → 包 llm.stream_chat，逐塊 yield delta（增量）。"""

    async def fake_stream_chat(messages, model=None):
        assert model == "qwen2.5"
        for piece in ["你", "好"]:
            yield piece

    monkeypatch.setattr(brain.llm, "stream_chat", fake_stream_chat)

    cfg = _Cfg(provider="ollama", ollama_model="qwen2.5")
    chunks = await _collect(
        brain.stream(config=cfg, messages=[{"role": "user", "content": "hi"}], prompt="hi")
    )
    assert chunks == [BrainChunk("delta", "你"), BrainChunk("delta", "好")]


@pytest.mark.asyncio
async def test_stream_dispatch_none_config_defaults_ollama(monkeypatch):
    """config=None → getattr 取不到 provider → 預設 ollama（即現行行為）。"""

    async def fake_stream_chat(messages, model=None):
        assert model is None  # None config 無 ollama_model
        yield "ok"

    monkeypatch.setattr(brain.llm, "stream_chat", fake_stream_chat)
    chunks = await _collect(brain.stream(config=None, messages=[], prompt="hi"))
    assert chunks == [BrainChunk("delta", "ok")]


@pytest.mark.asyncio
async def test_stream_dispatch_unknown_provider_raises():
    cfg = _Cfg(provider="bogus")
    with pytest.raises(BrainError):
        await _collect(brain.stream(config=cfg, messages=[], prompt="hi"))


@pytest.mark.asyncio
async def test_stream_ollama_wraps_llm_error(monkeypatch):
    async def boom(messages, model=None):
        raise brain.llm.LlmError("ollama 連不到")
        yield  # pragma: no cover

    monkeypatch.setattr(brain.llm, "stream_chat", boom)
    with pytest.raises(BrainError):
        await _collect(
            brain.stream(config=_Cfg(provider="ollama"), messages=[], prompt="x")
        )


# ── CLI 行解析 ────────────────────────────────────────────────────────────────


# claude（stream-json）——經 _parse_cli_line 分派器，agent="claude"。


def test_parse_cli_line_text_accumulates():
    acc: list[str] = []
    line = json.dumps(
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "找到"}]}}
    )
    assert brain._parse_cli_line("claude", line, acc) is None
    assert acc == ["找到"]


def test_parse_cli_line_tool_use_emits_progress():
    acc: list[str] = []
    line = json.dumps(
        {
            "type": "assistant",
            "message": {
                "content": [{"type": "tool_use", "name": "search_tenders"}]
            },
        }
    )
    chunk = brain._parse_cli_line("claude", line, acc)
    assert chunk == BrainChunk("progress", "查詢中：search_tenders")


def test_parse_cli_line_result_emits_delta():
    acc: list[str] = ["忽略"]
    line = json.dumps({"type": "result", "result": "最終答案"})
    chunk = brain._parse_cli_line("claude", line, acc)
    assert chunk == BrainChunk("delta", "最終答案")


def test_parse_cli_line_result_falls_back_to_accumulated():
    acc: list[str] = ["累積", "全文"]
    line = json.dumps({"type": "result", "result": ""})
    chunk = brain._parse_cli_line("claude", line, acc)
    assert chunk == BrainChunk("delta", "累積全文")


def test_parse_cli_line_ignores_system_and_bad_json():
    acc: list[str] = []
    assert brain._parse_cli_line("claude", json.dumps({"type": "system"}), acc) is None
    assert brain._parse_cli_line("claude", "{not json", acc) is None
    assert acc == []


# codex（exec --json，JSONL 事件）


def test_parse_codex_agent_message_replaces_accumulation():
    """agent_message 為完整訊息 → 取代累積（保留最後一則＝結論，蓋過 preamble）。"""
    acc: list[str] = []
    pre = json.dumps(
        {"type": "item.completed", "item": {"type": "agent_message", "text": "讓我查一下"}}
    )
    final = json.dumps(
        {"type": "item.completed", "item": {"type": "agent_message", "text": "最終結論"}}
    )
    assert brain._parse_cli_line("codex", pre, acc) is None
    assert acc == ["讓我查一下"]
    assert brain._parse_cli_line("codex", final, acc) is None
    assert acc == ["最終結論"]  # 取代而非追加


def test_parse_codex_mcp_tool_call_emits_progress_with_tool_name():
    acc: list[str] = []
    line = json.dumps(
        {
            "type": "item.completed",
            "item": {"type": "mcp_tool_call", "tool": "search_tenders"},
        }
    )
    assert brain._parse_cli_line("codex", line, acc) == BrainChunk(
        "progress", "查詢中：search_tenders"
    )


def test_parse_codex_command_execution_emits_progress():
    acc: list[str] = []
    line = json.dumps(
        {"type": "item.completed", "item": {"type": "command_execution", "command": "ls"}}
    )
    chunk = brain._parse_cli_line("codex", line, acc)
    assert chunk is not None and chunk.kind == "progress"


def test_parse_codex_error_and_turn_failed_raise():
    acc: list[str] = []
    with pytest.raises(BrainError):
        brain._parse_cli_line(
            "codex", json.dumps({"type": "error", "message": "usage limit"}), acc
        )
    with pytest.raises(BrainError):
        brain._parse_cli_line(
            "codex",
            json.dumps({"type": "turn.failed", "error": {"message": "boom"}}),
            acc,
        )


def test_parse_codex_ignores_lifecycle_and_bad_json():
    acc: list[str] = []
    assert brain._parse_cli_line("codex", json.dumps({"type": "thread.started"}), acc) is None
    assert brain._parse_cli_line("codex", json.dumps({"type": "turn.started"}), acc) is None
    assert brain._parse_cli_line("codex", "{not json", acc) is None
    assert acc == []


# hermes（-z/--oneshot，純文字）


def test_parse_hermes_line_streams_text_as_delta():
    acc: list[str] = []
    chunk = brain._parse_cli_line("hermes", "這是答案的一行", acc)
    assert chunk == BrainChunk("delta", "這是答案的一行\n")
    assert acc == ["這是答案的一行\n"]


def test_parse_hermes_blank_line_skipped():
    acc: list[str] = []
    assert brain._parse_cli_line("hermes", "   ", acc) is None
    assert acc == []


def test_parse_hermes_strips_ansi():
    acc: list[str] = []
    chunk = brain._parse_cli_line("hermes", "\x1b[32m綠字\x1b[0m", acc)
    assert chunk == BrainChunk("delta", "綠字\n")


# ── _stream_cli 整段流程（fake subprocess）─────────────────────────────────────


class _FakeStdout:
    """模擬 proc.stdout：async for 逐行 yield bytes。"""

    def __init__(self, lines: list[str]):
        self._lines = [(ln + "\n").encode("utf-8") for ln in lines]

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for b in self._lines:
            yield b


class _FakeStderr:
    async def read(self):
        return b""


class _FakeProc:
    def __init__(self, lines: list[str], returncode: int = 0):
        self.stdout = _FakeStdout(lines)
        self.stderr = _FakeStderr()
        self.returncode = returncode

    async def wait(self):
        return self.returncode

    def kill(self):  # pragma: no cover - returncode 已設，不會被呼叫
        pass


@pytest.mark.asyncio
async def test_stream_cli_codex_progress_then_single_final_delta(monkeypatch):
    """codex 整段：tool 事件 → progress；多則 agent_message → 收尾只送最後一則為完整 delta。"""
    lines = [
        json.dumps({"type": "thread.started", "thread_id": "t1"}),
        json.dumps({"type": "turn.started"}),
        json.dumps(
            {"type": "item.completed", "item": {"type": "agent_message", "text": "先看資料"}}
        ),
        json.dumps(
            {
                "type": "item.completed",
                "item": {"type": "mcp_tool_call", "tool": "search_tenders"},
            }
        ),
        json.dumps(
            {"type": "item.completed", "item": {"type": "agent_message", "text": "## 結論\n可行"}}
        ),
        json.dumps({"type": "turn.completed"}),
    ]

    async def fake_exec(*argv, stdout=None, stderr=None):
        assert argv[0] == "codex"
        return _FakeProc(lines, returncode=0)

    monkeypatch.setattr(brain.asyncio, "create_subprocess_exec", fake_exec)

    cfg = _Cfg(provider="cli", cli_agent="codex")
    chunks = await _collect(
        brain.stream(config=cfg, messages=[], prompt="可行嗎", focus_note="")
    )
    assert chunks == [
        BrainChunk("progress", "查詢中：search_tenders"),
        BrainChunk("delta", "## 結論\n可行"),  # 只有最後一則 agent_message
    ]


@pytest.mark.asyncio
async def test_stream_cli_codex_nonzero_exit_raises(monkeypatch):
    async def fake_exec(*argv, stdout=None, stderr=None):
        return _FakeProc([], returncode=1)

    monkeypatch.setattr(brain.asyncio, "create_subprocess_exec", fake_exec)
    with pytest.raises(BrainError):
        await _collect(
            brain.stream(
                config=_Cfg(provider="cli", cli_agent="codex"), messages=[], prompt="x"
            )
        )


@pytest.mark.asyncio
async def test_stream_cli_falls_back_to_next_verified_agent(monkeypatch):
    calls: list[tuple[str, ...]] = []
    codex_line = json.dumps(
        {
            "type": "item.completed",
            "item": {"type": "agent_message", "text": "Codex 接手完成"},
        }
    )

    async def fake_exec(*argv, stdout=None, stderr=None):
        calls.append(argv)
        if argv[0] == "claude":
            raise FileNotFoundError
        assert argv[0] == "codex"
        return _FakeProc([codex_line], returncode=0)

    monkeypatch.setattr(brain.asyncio, "create_subprocess_exec", fake_exec)
    chunks = await _collect(
        brain.stream(
            config=_Cfg(
                provider="cli",
                cli_agent="claude",
                cli_model="claude-sonnet-5",
            ),
            messages=[],
            prompt="x",
        )
    )

    assert [argv[0] for argv in calls] == ["claude", "codex"]
    assert "--model" in calls[0]
    assert "--model" not in calls[1]
    assert chunks == [
        BrainChunk("progress", "claude 無法使用，改由 codex 接手"),
        BrainChunk("delta", "Codex 接手完成"),
    ]


@pytest.mark.asyncio
async def test_stream_cli_fallback_excludes_unverified_agents(monkeypatch):
    calls: list[str] = []

    async def fake_exec(*argv, stdout=None, stderr=None):
        calls.append(argv[0])
        raise FileNotFoundError

    monkeypatch.setattr(brain.asyncio, "create_subprocess_exec", fake_exec)
    with pytest.raises(BrainError, match="所有 CLI 代理皆失敗"):
        await _collect(
            brain.stream(
                config=_Cfg(provider="cli", cli_agent="claude"),
                messages=[],
                prompt="x",
            )
        )

    assert calls == ["claude", "codex", "hermes"]


@pytest.mark.asyncio
async def test_stream_cli_does_not_fallback_after_partial_answer(monkeypatch):
    calls: list[str] = []

    async def fake_exec(*argv, stdout=None, stderr=None):
        calls.append(argv[0])
        return _FakeProc(["第一段回答"], returncode=1)

    monkeypatch.setattr(brain.asyncio, "create_subprocess_exec", fake_exec)
    with pytest.raises(BrainError, match="CLI 非零退出"):
        await _collect(
            brain.stream(
                config=_Cfg(provider="cli", cli_agent="hermes"),
                messages=[],
                prompt="x",
            )
        )

    assert calls == ["hermes"]


@pytest.mark.asyncio
async def test_stream_cli_hermes_streams_plaintext_deltas(monkeypatch):
    async def fake_exec(*argv, stdout=None, stderr=None):
        assert argv[0] == "hermes"
        return _FakeProc(["第一行", "第二行"], returncode=0)

    monkeypatch.setattr(brain.asyncio, "create_subprocess_exec", fake_exec)
    chunks = await _collect(
        brain.stream(
            config=_Cfg(provider="cli", cli_agent="hermes"), messages=[], prompt="x"
        )
    )
    assert chunks == [
        BrainChunk("delta", "第一行\n"),
        BrainChunk("delta", "第二行\n"),
    ]


# ── CLI argv / prompt ─────────────────────────────────────────────────────────


def test_cli_argv_substitutes_prompt():
    argv = brain._cli_argv("claude", "問題內容")
    assert "問題內容" in argv
    assert "{prompt}" not in argv
    assert argv[0] == "claude"


def test_cli_argv_codex_and_hermes_supported():
    codex = brain._cli_argv("codex", "問題")
    assert codex[:2] == ["codex", "exec"] and "問題" in codex and "--json" in codex
    hermes = brain._cli_argv("hermes", "問題")
    assert hermes[0] == "hermes" and "-z" in hermes and "問題" in hermes


def test_cli_argv_unsupported_agent_raises():
    with pytest.raises(BrainError):
        brain._cli_argv("gemini", "x")


def test_cli_argv_appends_model_flag_when_supported():
    # claude / codex 支援 --model：設了模型就 append 到尾端。
    claude = brain._cli_argv("claude", "問題", "claude-sonnet-4-6")
    assert claude[-2:] == ["--model", "claude-sonnet-4-6"]
    assert "問題" in claude
    codex = brain._cli_argv("codex", "問題", "gpt-5")
    assert codex[-2:] == ["--model", "gpt-5"]


def test_cli_argv_no_model_flag_when_unsupported():
    # hermes 無 model_flag：即使傳了 model 也不該 append（非破壞）。
    hermes = brain._cli_argv("hermes", "問題", "whatever")
    assert "--model" not in hermes
    assert "whatever" not in hermes
    assert hermes[0] == "hermes"


def test_cli_argv_omits_model_flag_when_model_none():
    # 沒設模型 → 沿用代理預設 argv，不 append flag。
    claude = brain._cli_argv("claude", "問題", None)
    assert "--model" not in claude


def test_parse_cli_line_text_agent_streams_plaintext():
    # opencode / antigravity 走 text parser：每行純文字當作 delta 累積。
    for agent in ("opencode", "antigravity"):
        acc: list[str] = []
        chunk = brain._parse_cli_line(agent, "你好", acc)
        assert chunk is not None and chunk.kind == "delta"
        # text parser 逐行串流純文字（含換行），內容須包含原文。
        assert "你好" in chunk.text


def test_build_cli_prompt_with_focus_note():
    out = brain._build_cli_prompt("有沒有台北的案子", "正在看：資訊系統建置")
    assert "正在看：資訊系統建置" in out
    assert "有沒有台北的案子" in out


# ── byok system 抽取 ──────────────────────────────────────────────────────────


def test_split_system_separates_system_from_convo():
    system, convo = brain._split_system(
        [
            {"role": "system", "content": "你是助手"},
            {"role": "user", "content": "嗨"},
            {"role": "assistant", "content": "哈囉"},
        ]
    )
    assert system == "你是助手"
    assert convo == [
        {"role": "user", "content": "嗨"},
        {"role": "assistant", "content": "哈囉"},
    ]


def test_split_system_empty_convo_gets_placeholder():
    system, convo = brain._split_system([{"role": "system", "content": "S"}])
    assert system == "S"
    assert len(convo) == 1 and convo[0]["role"] == "user"


def test_byok_connection_anthropic_uses_current_default(monkeypatch):
    monkeypatch.setattr(brain.settings, "anthropic_api_key", "sk-ant-test")
    base, model, headers = brain._byok_connection(
        _Cfg(byok_protocol="anthropic", byok_base_url=None, byok_model=None)
    )
    assert base == "https://api.anthropic.com"
    assert model == "claude-sonnet-5"
    assert headers["x-api-key"] == "sk-ant-test"
    assert "authorization" not in headers


def test_byok_connection_openrouter_uses_bearer_and_model_slug(monkeypatch):
    monkeypatch.setattr(brain.settings, "openrouter_api_key", "sk-or-test")
    base, model, headers = brain._byok_connection(
        _Cfg(byok_protocol="openrouter", byok_base_url=None, byok_model="openai/gpt-5.5")
    )
    assert base == "https://openrouter.ai/api"
    assert model == "openai/gpt-5.5"
    assert headers["authorization"] == "Bearer sk-or-test"
    assert "x-api-key" not in headers

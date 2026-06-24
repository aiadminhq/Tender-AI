# -*- coding: utf-8 -*-
"""小助手「大腦」provider 路由器（app/services/brain.py）的離線單元測試。

只測純邏輯與分派：
- ``stream`` 依 ``config.provider`` 分派（ollama 以 monkeypatch 的 llm.stream_chat 驗證）。
- CLI stream-json 行解析（``_parse_cli_line``）：text 累積、tool_use → progress、result → delta。
- CLI argv 樣板與未支援 agent → BrainError；byok system 抽取。

不連 Ollama／不 spawn CLI／不連雲端：全部以合成輸入驗證。
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


def test_parse_cli_line_text_accumulates():
    acc: list[str] = []
    line = json.dumps(
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "找到"}]}}
    )
    assert brain._parse_cli_line(line, acc) is None
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
    chunk = brain._parse_cli_line(line, acc)
    assert chunk == BrainChunk("progress", "查詢中：search_tenders")


def test_parse_cli_line_result_emits_delta():
    acc: list[str] = ["忽略"]
    line = json.dumps({"type": "result", "result": "最終答案"})
    chunk = brain._parse_cli_line(line, acc)
    assert chunk == BrainChunk("delta", "最終答案")


def test_parse_cli_line_result_falls_back_to_accumulated():
    acc: list[str] = ["累積", "全文"]
    line = json.dumps({"type": "result", "result": ""})
    chunk = brain._parse_cli_line(line, acc)
    assert chunk == BrainChunk("delta", "累積全文")


def test_parse_cli_line_ignores_system_and_bad_json():
    acc: list[str] = []
    assert brain._parse_cli_line(json.dumps({"type": "system"}), acc) is None
    assert brain._parse_cli_line("{not json", acc) is None
    assert acc == []


# ── CLI argv / prompt ─────────────────────────────────────────────────────────


def test_cli_argv_substitutes_prompt():
    argv = brain._cli_argv("claude", "問題內容")
    assert "問題內容" in argv
    assert "{prompt}" not in argv
    assert argv[0] == "claude"


def test_cli_argv_unsupported_agent_raises():
    with pytest.raises(BrainError):
        brain._cli_argv("hermes", "x")


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

# -*- coding: utf-8 -*-
"""設定頁 API：小助手「大腦」全域設定（單機單操作者 → 單列 id=1）。

對照 app/api/v1/settings.py 與 app/services/brain_config.py：
  GET  /api/v1/settings/brain   首次讀取 get-or-create 預設（provider=cli, cli_agent=claude → Claude Code）
  PUT  /api/v1/settings/brain   部分更新非密欄位（exclude_unset）

secret 紅線（見 CLAUDE.md）：BYOK 金鑰本體只進 .env，永不經 API 進出；
``byok_key_set`` 由 .env 是否設定金鑰即時推導，與 DB 無關。
"""
from __future__ import annotations

import pytest

from app.core.config import settings
from app.services import brain as brain_svc
from app.services import brain_config as brain_config_svc
from app.services.brain import BrainChunk, BrainError

BRAIN = "/api/v1/settings/brain"


# ── API：GET / PUT ────────────────────────────────────────────────────────────


async def test_get_brain_creates_default(client):
    """首次 GET → get-or-create 出預設單列：provider=cli、cli_agent=claude（Claude Code）。

    開發期算力由本機 CLI 提供，故預設大腦＝Claude Code（見 brain_config.get_or_create）。
    """
    r = await client.get(BRAIN)
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "cli"
    assert body["cli_agent"] == "claude"
    # 唯讀衍生布林必存在（值依 .env 而定，不在此斷言真假）。
    assert "byok_key_set" in body


async def test_put_brain_partial_update_cli(client):
    """PUT 只送 provider+cli_agent → 落地；未送欄位不動。"""
    r = await client.put(BRAIN, json={"provider": "cli", "cli_agent": "claude"})
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "cli"
    assert body["cli_agent"] == "claude"

    # 再 GET 應持久化（單列）。
    again = (await client.get(BRAIN)).json()
    assert again["provider"] == "cli"
    assert again["cli_agent"] == "claude"


async def test_put_brain_exclude_unset_preserves_other_fields(client):
    """先設 ollama_model，再單獨切 provider=byok → ollama_model 不被清掉。"""
    await client.put(BRAIN, json={"provider": "ollama", "ollama_model": "qwen2.5"})
    r = await client.put(BRAIN, json={"provider": "byok", "byok_model": "claude-opus-4-8"})
    body = r.json()
    assert body["provider"] == "byok"
    assert body["byok_model"] == "claude-opus-4-8"
    # 未在本次 PUT 送出 ollama_model → 維持先前值（exclude_unset 不覆蓋）。
    assert body["ollama_model"] == "qwen2.5"


async def test_put_brain_rejects_unknown_provider(client):
    """provider 超出 Literal 列舉 → 422（pydantic 驗證）。"""
    r = await client.put(BRAIN, json={"provider": "telepathy"})
    assert r.status_code == 422


async def test_put_brain_rejects_unknown_cli_agent(client):
    r = await client.put(BRAIN, json={"cli_agent": "skynet"})
    assert r.status_code == 422


async def test_byok_key_set_follows_env_not_payload(client, monkeypatch):
    """byok_key_set 由 .env 推導：API 從不接收/回傳金鑰本體。"""
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-test-xxx")
    body = (await client.get(BRAIN)).json()
    assert body["byok_key_set"] is True
    assert "anthropic_api_key" not in body
    assert "api_key" not in body

    monkeypatch.setattr(settings, "anthropic_api_key", "")
    body2 = (await client.get(BRAIN)).json()
    assert body2["byok_key_set"] is False


# ── service：get_or_create / update ───────────────────────────────────────────


async def test_service_get_or_create_idempotent(db_session):
    """重複呼叫 get-or-create 仍是同一列（id=1），不重建。"""
    a = await brain_config_svc.get_or_create(db_session)
    b = await brain_config_svc.get_or_create(db_session)
    assert a.id == b.id == 1


async def test_service_update_ignores_secret_field(db_session):
    """update 只動白名單非密欄位；混入金鑰本體欄位一律忽略，不寫進 model。"""
    cfg = await brain_config_svc.update(
        db_session,
        {
            "provider": "byok",
            "byok_model": "claude-opus-4-8",
            "anthropic_api_key": "sk-should-be-ignored",  # 非允許欄位
            "api_key": "sk-also-ignored",
        },
    )
    assert cfg.provider == "byok"
    assert cfg.byok_model == "claude-opus-4-8"
    assert not hasattr(cfg, "anthropic_api_key")
    assert not hasattr(cfg, "api_key")


async def test_service_update_none_clears_field(db_session):
    """傳入 None 視為清空該欄位（仍套用）。"""
    await brain_config_svc.update(db_session, {"provider": "ollama", "ollama_model": "qwen2.5"})
    cfg = await brain_config_svc.update(db_session, {"ollama_model": None})
    assert cfg.ollama_model is None


# ── cli_model 欄位 round-trip ─────────────────────────────────────────────────


async def test_put_brain_cli_model_round_trip(client):
    """PUT 帶 cli_model → 落地並 GET 取回（支援 per-agent 指定模型）。"""
    r = await client.put(
        BRAIN, json={"provider": "cli", "cli_agent": "claude", "cli_model": "claude-sonnet-4-6"}
    )
    assert r.status_code == 200
    assert r.json()["cli_model"] == "claude-sonnet-4-6"
    again = (await client.get(BRAIN)).json()
    assert again["cli_model"] == "claude-sonnet-4-6"


# ── GET /brain/agents：CLI 代理註冊表 ─────────────────────────────────────────


async def test_get_brain_agents_shape(client):
    """回傳註冊表：含 claude/codex/hermes；supports_model 依 model_flag 推導。"""
    r = await client.get(f"{BRAIN}/agents")
    assert r.status_code == 200
    agents = {a["key"]: a for a in r.json()["agents"]}
    assert {"claude", "codex", "hermes"} <= set(agents)
    # claude/codex 支援指定模型；hermes 不支援。
    assert agents["claude"]["supports_model"] is True
    assert agents["hermes"]["supports_model"] is False
    # 每筆都帶 i18n label key 與 models 清單。
    for spec in agents.values():
        assert spec["label_i18n"] and isinstance(spec["models"], list)


# ── POST /brain/test：候選設定煙測（HTTP 恆 200）───────────────────────────────


def _fake_stream_factory(chunks=None, exc=None):
    """造一個假 brain.stream：吐指定 chunks 或拋指定例外。"""

    async def _fake_stream(**_kwargs):
        if exc is not None:
            raise exc
        for c in chunks or []:
            yield c

    return _fake_stream


async def test_post_brain_test_ok(client, monkeypatch):
    """stream 正常吐 delta → ok=True、帶 sample，HTTP 200。"""
    monkeypatch.setattr(
        brain_svc, "stream", _fake_stream_factory(chunks=[BrainChunk("delta", "OK")])
    )
    r = await client.post(
        f"{BRAIN}/test", json={"provider": "cli", "cli_agent": "claude"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["sample"] == "OK"
    assert body["provider"] == "cli"


async def test_post_brain_test_failure_is_200(client, monkeypatch):
    """stream 拋 BrainError → ok=False、帶淨化錯誤字串，HTTP 仍 200、無祕密。"""
    monkeypatch.setattr(
        brain_svc, "stream", _fake_stream_factory(exc=BrainError("找不到 CLI 可執行檔：claude"))
    )
    r = await client.post(
        f"{BRAIN}/test", json={"provider": "cli", "cli_agent": "claude"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert body["error"]
    # 永不外洩金鑰本體欄位。
    assert "anthropic_api_key" not in body and "api_key" not in body

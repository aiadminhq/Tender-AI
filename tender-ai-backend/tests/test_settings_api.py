# -*- coding: utf-8 -*-
"""設定頁 API：小助手「大腦」全域設定（單機單操作者 → 單列 id=1）。

對照 app/api/v1/settings.py 與 app/services/brain_config.py：
  GET  /api/v1/settings/brain   首次讀取 get-or-create 預設（provider=ollama）
  PUT  /api/v1/settings/brain   部分更新非密欄位（exclude_unset）

secret 紅線（見 CLAUDE.md）：BYOK 金鑰本體只進 .env，永不經 API 進出；
``byok_key_set`` 由 .env 是否設定金鑰即時推導，與 DB 無關。
"""
from __future__ import annotations

import pytest

from app.core.config import settings
from app.services import brain_config as brain_config_svc

BRAIN = "/api/v1/settings/brain"


# ── API：GET / PUT ────────────────────────────────────────────────────────────


async def test_get_brain_creates_default(client):
    """首次 GET → get-or-create 出 provider=ollama 的單列預設。"""
    r = await client.get(BRAIN)
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "ollama"
    assert body["cli_agent"] is None
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

# -*- coding: utf-8 -*-
"""Phase 4 對話留存：串流落地 + GET /assistant/threads(/{id}) API 測試。

驗收：
- POST /chat 會把使用者提問與助手回答各 append 一則，meta 帶回 thread_id；
- 缺 thread_id 時後端自動產生並於 meta 回傳；
- GET 列表／詳情可取回，且預設 owner=default、consent_state=pending-consent、
  layer_b_opt_in=False（登入未落地的 Layer B 紅線）。
"""
from __future__ import annotations

import json

import pytest

CHAT = "/api/v1/assistant/chat"
THREADS = "/api/v1/assistant/threads"


def _events(text: str) -> list[dict]:
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def _meta(text: str) -> dict:
    return next(e for e in _events(text) if e.get("type") == "meta")


def _payload(prompt: str, **extra) -> dict:
    body = {"messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}]}
    body.update(extra)
    return body


@pytest.fixture
def fake_llm(monkeypatch):
    async def fake_stream(messages, **kw):
        yield "這是助手的回答。"

    monkeypatch.setattr("app.services.llm.stream_chat", fake_stream)


async def test_chat_persists_user_and_assistant_messages(client, seeded, fake_llm):
    resp = await client.post(CHAT, json=_payload("台北", thread_id="thread-abc"))
    assert resp.status_code == 200
    assert _meta(resp.text)["thread_id"] == "thread-abc"

    detail = await client.get(f"{THREADS}/thread-abc")
    assert detail.status_code == 200
    data = detail.json()
    assert [m["role"] for m in data["messages"]] == ["user", "assistant"]
    assert data["messages"][0]["content"] == "台北"
    assert data["messages"][1]["content"] == "這是助手的回答。"
    # 助手訊息留有來源卡（種子標案，公開 A 層欄位）。
    assert data["messages"][1]["sources"]
    assert data["messages"][0]["sources"] is None


async def test_chat_generates_thread_id_when_missing(client, seeded, fake_llm):
    resp = await client.post(CHAT, json=_payload("台北"))
    assert resp.status_code == 200
    thread_id = _meta(resp.text)["thread_id"]
    assert isinstance(thread_id, str) and thread_id

    detail = await client.get(f"{THREADS}/{thread_id}")
    assert detail.status_code == 200
    assert len(detail.json()["messages"]) == 2


async def test_thread_defaults_are_pending_consent(client, seeded, fake_llm):
    await client.post(CHAT, json=_payload("台北", thread_id="t-consent"))

    detail = await client.get(f"{THREADS}/t-consent")
    data = detail.json()
    assert data["owner_user_id"] == "default"
    assert data["consent_state"] == "pending-consent"
    assert data["layer_b_opt_in"] is False
    assert data["title"] == "台北"


async def test_list_threads_returns_recent_first(client, seeded, fake_llm):
    await client.post(CHAT, json=_payload("第一串", thread_id="t-1"))
    await client.post(CHAT, json=_payload("第二串", thread_id="t-2"))

    resp = await client.get(THREADS)
    assert resp.status_code == 200
    ids = [t["id"] for t in resp.json()["threads"]]
    assert ids[0] == "t-2"
    assert set(ids) == {"t-1", "t-2"}


async def test_get_missing_thread_returns_404(client, seeded):
    resp = await client.get(f"{THREADS}/does-not-exist")
    assert resp.status_code == 404

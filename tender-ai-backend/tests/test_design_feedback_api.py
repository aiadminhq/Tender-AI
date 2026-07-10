# -*- coding: utf-8 -*-
"""Design feedback API tests."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def test_design_feedback_create_and_summary(client):
    payload = {
        "source": "assistant",
        "target_cli": "codex",
        "items": [
            {
                "route": "/settings/brain",
                "selector": "#main-content",
                "component_guess": "BrainPicker",
                "text_snapshot": "引擎設定",
                "rect": {"x": 1, "y": 2, "width": 300, "height": 120},
                "type": "interaction",
                "severity": "important",
                "comment": "模型選單需要能帶入最新可用 CLI 模型。",
                "created_at": "2026-07-02T02:17:28.386Z",
                "metadata": {"thread_id": "thread-1"},
            }
        ],
    }

    res = await client.post("/api/v1/design-feedback", json=payload)

    assert res.status_code == 200
    data = res.json()
    assert data["count"] == 1
    assert data["items"][0]["owner_user_id"] == "default"
    assert data["items"][0]["target_cli"] == "codex"
    assert data["items"][0]["metadata_json"] == {"thread_id": "thread-1"}

    summary = await client.get("/api/v1/design-feedback/summary?target_cli=codex")

    assert summary.status_code == 200
    markdown = summary.json()["markdown"]
    assert "模型選單需要能帶入最新可用 CLI 模型" in markdown
    assert "目標 CLI：codex" in markdown
    assert "頁面：`/settings/brain`" in markdown


async def test_assistant_chat_can_capture_design_feedback(client):
    res = await client.post(
        "/api/v1/assistant/chat",
        json={
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "設計回饋：列表篩選區的可行性應改成 0 到 100 分。請給 codex",
                        }
                    ],
                }
            ],
            "context": {
                "scope": "assistant",
                "route": "/tenders",
                "selector": "#main-content",
                "component": "TenderFilters",
            },
        },
    )

    assert res.status_code == 200
    body = res.text
    assert "design_feedback_capture" in body
    assert "已記下這則設計回饋" in body

    summary = await client.get("/api/v1/design-feedback/summary?target_cli=codex")
    markdown = summary.json()["markdown"]
    assert "列表篩選區的可行性應改成 0 到 100 分" in markdown
    assert "TenderFilters" in markdown

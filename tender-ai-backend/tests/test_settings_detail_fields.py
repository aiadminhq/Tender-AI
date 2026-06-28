# -*- coding: utf-8 -*-
"""設定頁 API：標案詳情規格表欄位顯示設定（團隊共用 → 單列 id=1）。

對照 app/api/v1/settings.py 與 app/services/detail_field_visibility.py：
  GET  /api/v1/settings/detail-fields   首次讀取 get-or-create 預設（hidden_fields=[]）
  PUT  /api/v1/settings/detail-fields   整批覆蓋 hidden_fields（exclude_unset；去重正規化）

這是團隊共用設定（非個人偏好）：單列、跨人共享、可入版控。
"""
from __future__ import annotations

from app.services import detail_field_visibility as detail_fields_svc

DETAIL = "/api/v1/settings/detail-fields"


# ── API：GET / PUT ────────────────────────────────────────────────────────────


async def test_get_detail_fields_creates_default(client):
    """首次 GET → get-or-create 出預設單列：hidden_fields=[]（全部顯示）。"""
    r = await client.get(DETAIL)
    assert r.status_code == 200
    body = r.json()
    assert body["hidden_fields"] == []
    assert "updated_at" in body


async def test_put_detail_fields_persists(client):
    """PUT 隱藏 deposit/subsidySource → 落地；再 GET 應持久化（單列）。"""
    r = await client.put(DETAIL, json={"hidden_fields": ["deposit", "subsidySource"]})
    assert r.status_code == 200
    assert r.json()["hidden_fields"] == ["deposit", "subsidySource"]

    again = (await client.get(DETAIL)).json()
    assert again["hidden_fields"] == ["deposit", "subsidySource"]


async def test_put_detail_fields_dedupes_and_trims(client):
    """重複／空白／含空字串的輸入 → 去重、去空白、丟空字串，保留出現順序。"""
    r = await client.put(
        DETAIL,
        json={"hidden_fields": ["deposit", " deposit ", "", "attachments", "deposit"]},
    )
    assert r.status_code == 200
    assert r.json()["hidden_fields"] == ["deposit", "attachments"]


async def test_put_detail_fields_empty_clears(client):
    """送空清單 → 回到全部顯示（整批覆蓋語意）。"""
    await client.put(DETAIL, json={"hidden_fields": ["deposit"]})
    r = await client.put(DETAIL, json={"hidden_fields": []})
    assert r.status_code == 200
    assert r.json()["hidden_fields"] == []


async def test_put_detail_fields_exclude_unset_preserves(client):
    """未送 hidden_fields（空 body）→ 不動既有值（exclude_unset）。"""
    await client.put(DETAIL, json={"hidden_fields": ["extraNote"]})
    r = await client.put(DETAIL, json={})
    assert r.status_code == 200
    assert r.json()["hidden_fields"] == ["extraNote"]


async def test_put_detail_fields_rejects_non_list(client):
    """hidden_fields 型別錯誤（非陣列）→ 422（pydantic 驗證）。"""
    r = await client.put(DETAIL, json={"hidden_fields": "deposit"})
    assert r.status_code == 422


# ── service：get_or_create / update ───────────────────────────────────────────


async def test_service_get_or_create_idempotent(db_session):
    """重複呼叫 get-or-create 仍是同一列（id=1），不重建。"""
    a = await detail_fields_svc.get_or_create(db_session)
    b = await detail_fields_svc.get_or_create(db_session)
    assert a.id == b.id == 1


async def test_service_update_normalizes(db_session):
    """update 正規化：去重、去空白、丟空字串，保留順序。"""
    cfg = await detail_fields_svc.update(
        db_session,
        {"hidden_fields": [" qualification ", "qualification", "deposit", ""]},
    )
    assert cfg.hidden_fields == ["qualification", "deposit"]

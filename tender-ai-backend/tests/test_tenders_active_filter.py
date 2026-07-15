# -*- coding: utf-8 -*-
"""GET /api/v1/tenders 的「預設只回有效案」過濾測試（方案 C 資料層過濾）。

驗收：
- 預設（不帶 include_expired）：已截止案（deadline_iso < 今天）被排除。
- deadline_iso 為 NULL 的案永遠保留（未設截止日不視為過期）。
- include_expired=true：連同已截止案一併回傳。
- cursor 指紋納入 include_expired：切換此開關後沿用舊 cursor → 400（強制重置第一頁）。

基準日於 conftest 以 dependency_overrides 凍結為 2026-06-17，故種子四筆
（deadline 06-20/06-24/07-07/NULL）皆為有效案；本檔另植一筆 06-01 的已截止案。
"""
from __future__ import annotations

from datetime import date

from app.models.tender import Source, Tender
from tests.conftest import TestSessionLocal

BASE = "/api/v1/tenders"


def _ids(payload) -> list[int]:
    return [it["id"] for it in payload["items"]]


async def _seed_expired() -> int:
    """植入一筆已截止（deadline 2026-06-01 < 凍結今日 06-17）的案，回傳其 id。"""
    async with TestSessionLocal() as s:
        src = Source(name="PCC-EXP", base_url="https://web.pcc.gov.tw")
        s.add(src)
        await s.flush()
        t = Tender(
            source_id=src.id,
            case_pk="PCC-EXPIRED",
            name="已截止的測試標案",
            org="測試機關",
            category="工程",
            budget_wan=300,
            deadline_roc="115/06/01",
            deadline_iso=date(2026, 6, 1),
            tender_method="公開招標",
            city="台北市",
            link="https://example.test/expired",
            first_seen=date(2026, 5, 20),
            last_seen=date(2026, 6, 1),
        )
        s.add(t)
        await s.flush()
        tid = t.id
        await s.commit()
        return tid


# --------------------------------------------------------------------------- #
# 預設過濾掉已截止案；NULL 截止日保留
# --------------------------------------------------------------------------- #
async def test_default_excludes_expired(client, seeded):
    expired_id = await _seed_expired()
    body = (await client.get(BASE, params={"page_size": 200})).json()
    ids = _ids(body)
    # 種子四筆有效案全在，已截止案不在
    assert body["count"] == 4
    assert expired_id not in ids
    # NULL 截止日（tmu）仍在
    assert seeded["tmu"] in ids


async def test_include_expired_returns_all(client, seeded):
    expired_id = await _seed_expired()
    body = (await client.get(BASE, params={"page_size": 200, "include_expired": "true"})).json()
    ids = _ids(body)
    assert body["count"] == 5
    assert expired_id in ids
    assert seeded["tmu"] in ids


async def test_null_deadline_always_kept(client, seeded):
    # 不植過期案；僅確認預設下 NULL 截止日案存在
    body = (await client.get(BASE, params={"page_size": 200})).json()
    assert seeded["tmu"] in _ids(body)


# --------------------------------------------------------------------------- #
# cursor 指紋納入 include_expired：切換即失效 → 400
# --------------------------------------------------------------------------- #
async def test_cursor_invalid_on_include_expired_change_returns_400(client, seeded):
    await _seed_expired()
    # 預設（include_expired=false）取第一頁，拿 next_cursor
    p1 = (await client.get(BASE, params={"page_size": 2})).json()
    cur = p1["next_cursor"]
    assert cur
    # 同 sort 但把 include_expired 切成 true → filters 指紋不同 → 400
    r = await client.get(
        BASE, params={"page_size": 2, "cursor": cur, "include_expired": "true"}
    )
    assert r.status_code == 400

# -*- coding: utf-8 -*-
"""GET /api/v1/tenders 的 cursor（keyset）真分頁測試。

驗收：
- 首頁：不帶 cursor，回第一頁＋ next_cursor（尚有下一頁時非 null）。
- 下一頁銜接：以 next_cursor 取下一頁，與首頁無重疊、無遺漏，等於一次全撈。
- 走到底：最後一頁 next_cursor 為 null。
- cursor 失效：cursor 對應的 sort／filters 與當前請求不一致 → 400。
- page_size 邊界：0／>200 → 422。
- 各排序（feas/days/budget/tier）皆能 keyset 銜接正確。
"""
from __future__ import annotations

import base64
import json

from sqlalchemy import update

from app.models.tender import Tender
from tests.conftest import TestSessionLocal

BASE = "/api/v1/tenders"


def _ids(payload) -> list[int]:
    return [it["id"] for it in payload["items"]]


async def _set_feasibility_team(updates: dict[int, int]) -> None:
    async with TestSessionLocal() as s:
        for tid, score in updates.items():
            await s.execute(
                update(Tender).where(Tender.id == tid).values(feasibility_team=score)
            )
        await s.commit()


async def _drain(client, params: dict, page_size: int) -> list[int]:
    """用 cursor 逐頁撈到底，回傳串接後的 id 序列。"""
    collected: list[int] = []
    cursor = None
    guard = 0
    while True:
        guard += 1
        assert guard < 50, "分頁未收斂（疑似死迴圈）"
        p = dict(params)
        p["page_size"] = page_size
        if cursor is not None:
            p["cursor"] = cursor
        body = (await client.get(BASE, params=p)).json()
        collected.extend(_ids(body))
        cursor = body.get("next_cursor")
        if cursor is None:
            break
        # 防呆：非空頁才續抓
        assert body["items"], "next_cursor 非 null 但本頁為空"
    return collected


# --------------------------------------------------------------------------- #
# 首頁 + next_cursor
# --------------------------------------------------------------------------- #
async def test_first_page_has_next_cursor(client, seeded):
    body = (await client.get(BASE, params={"page_size": 2})).json()
    assert len(body["items"]) == 2
    assert body["count"] == 4
    # 尚有下一頁 → next_cursor 非 null
    assert body["next_cursor"]


async def test_last_page_next_cursor_null(client, seeded):
    # 一次撈完（page_size 覆蓋全部）→ next_cursor 應為 null
    body = (await client.get(BASE, params={"page_size": 200})).json()
    assert len(body["items"]) == 4
    assert body["next_cursor"] is None


# --------------------------------------------------------------------------- #
# 下一頁銜接（無重疊、無遺漏）＝ 一次全撈
# --------------------------------------------------------------------------- #
async def test_cursor_walk_matches_full_scan_feas(client, seeded):
    # 物化分數製造非平凡的 feas 排序，避免退化為單一 tier 排序。
    await _set_feasibility_team(
        {seeded["low"]: 90, seeded["high"]: 50, seeded["mid"]: 70}
    )
    full = _ids((await client.get(BASE, params={"page_size": 200})).json())
    walked = await _drain(client, {"sort": "feas"}, page_size=1)
    assert walked == full
    assert len(walked) == len(set(walked))  # 無重複


async def test_cursor_walk_matches_full_scan_days(client, seeded):
    full = _ids((await client.get(BASE, params={"sort": "days", "page_size": 200})).json())
    walked = await _drain(client, {"sort": "days"}, page_size=1)
    assert walked == full


async def test_cursor_walk_matches_full_scan_budget(client, seeded):
    full = _ids((await client.get(BASE, params={"sort": "budget", "page_size": 200})).json())
    walked = await _drain(client, {"sort": "budget"}, page_size=1)
    assert walked == full


async def test_cursor_walk_matches_full_scan_tier(client, seeded):
    full = _ids((await client.get(BASE, params={"sort": "tier", "page_size": 200})).json())
    walked = await _drain(client, {"sort": "tier"}, page_size=1)
    assert walked == full


async def test_cursor_page_size_2_two_pages(client, seeded):
    p1 = (await client.get(BASE, params={"page_size": 2})).json()
    assert _ids(p1) == [seeded["high"], seeded["mid"]]
    assert p1["next_cursor"]
    p2 = (await client.get(BASE, params={"page_size": 2, "cursor": p1["next_cursor"]})).json()
    assert _ids(p2) == [seeded["low"], seeded["tmu"]]
    assert p2["next_cursor"] is None


# --------------------------------------------------------------------------- #
# cursor 失效：sort／filters 不一致 → 400
# --------------------------------------------------------------------------- #
async def test_cursor_invalid_on_sort_change_returns_400(client, seeded):
    p1 = (await client.get(BASE, params={"sort": "days", "page_size": 2})).json()
    cur = p1["next_cursor"]
    assert cur
    # 帶著 days 的 cursor，卻改用 budget 排序 → 400
    r = await client.get(BASE, params={"sort": "budget", "page_size": 2, "cursor": cur})
    assert r.status_code == 400
    assert r.json()["detail"]


async def test_cursor_invalid_on_filter_change_returns_400(client, seeded):
    p1 = (await client.get(BASE, params={"page_size": 2})).json()
    cur = p1["next_cursor"]
    assert cur
    # 同 sort 但加了新的 tier 篩選 → filters 指紋不同 → 400
    r = await client.get(BASE, params={"page_size": 2, "cursor": cur, "tier": ["high"]})
    assert r.status_code == 400


async def test_cursor_malformed_returns_400(client, seeded):
    r = await client.get(BASE, params={"page_size": 2, "cursor": "not-a-valid-cursor"})
    assert r.status_code == 400


async def test_cursor_tampered_json_returns_400(client, seeded):
    bad = base64.urlsafe_b64encode(json.dumps({"foo": "bar"}).encode()).decode()
    r = await client.get(BASE, params={"page_size": 2, "cursor": bad})
    assert r.status_code == 400


# --------------------------------------------------------------------------- #
# page_size 邊界
# --------------------------------------------------------------------------- #
async def test_cursor_page_size_bounds_422(client, seeded):
    assert (await client.get(BASE, params={"page_size": 0})).status_code == 422
    assert (await client.get(BASE, params={"page_size": 999})).status_code == 422


# --------------------------------------------------------------------------- #
# 相容：舊的 page（offset）參數仍可用
# --------------------------------------------------------------------------- #
async def test_legacy_page_param_still_works(client, seeded):
    p1 = (await client.get(BASE, params={"page": 1, "page_size": 2})).json()
    p2 = (await client.get(BASE, params={"page": 2, "page_size": 2})).json()
    assert _ids(p1) == [seeded["high"], seeded["mid"]]
    assert _ids(p2) == [seeded["low"], seeded["tmu"]]
    assert p1["count"] == 4

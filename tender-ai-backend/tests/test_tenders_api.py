# -*- coding: utf-8 -*-
"""GET /api/v1/tenders 與 /{id} 的篩選／排序／分頁／詳情測試。

對照 P2 驗收：各篩選/排序/分頁正確，最新快照邏輯正確，查無回 404。
"""
from __future__ import annotations

from sqlalchemy import update

from app.models.knowledge import KeywordWeight
from app.models.tender import Tender
from tests.conftest import TestSessionLocal

BASE = "/api/v1/tenders"


def _ids(payload) -> list[int]:
    return [it["id"] for it in payload["items"]]


async def _add_keyword_weight(term: str, polarity: str, weight: float) -> None:
    """植入一條學習權重（供 feas 排序受權重影響的驗證）。"""
    async with TestSessionLocal() as s:
        s.add(KeywordWeight(term=term, polarity=polarity, weight=weight, support=2))
        await s.commit()


async def _set_feasibility_team(updates: dict[int, int]) -> None:
    """直接物化團隊線可行性分數（feas 排序的主鍵來源）。"""
    async with TestSessionLocal() as s:
        for tid, score in updates.items():
            await s.execute(
                update(Tender).where(Tender.id == tid).values(feasibility_team=score)
            )
        await s.commit()


# --------------------------------------------------------------------------- #
# 篩選
# --------------------------------------------------------------------------- #
async def test_no_filter_returns_all(client, seeded):
    r = await client.get(BASE)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 4
    assert set(_ids(body)) == set(seeded.values())


async def test_filter_tier_single(client, seeded):
    r = await client.get(BASE, params={"tier": ["high"]})
    body = r.json()
    assert body["count"] == 1
    assert _ids(body) == [seeded["high"]]


async def test_filter_tier_multi(client, seeded):
    r = await client.get(BASE, params={"tier": ["high", "mid"]})
    body = r.json()
    assert body["count"] == 2
    assert set(_ids(body)) == {seeded["high"], seeded["mid"]}


async def test_filter_city(client, seeded):
    r = await client.get(BASE, params={"city": ["新北市"]})
    body = r.json()
    assert _ids(body) == [seeded["mid"]]


async def test_filter_category(client, seeded):
    r = await client.get(BASE, params={"cat": ["工程"]})
    body = r.json()
    assert _ids(body) == [seeded["mid"]]


async def test_filter_source(client, seeded):
    r = await client.get(BASE, params={"src": ["TMU"]})
    body = r.json()
    assert _ids(body) == [seeded["tmu"]]


async def test_filter_deadline(client, seeded):
    # days_left <= 2 → 僅 low(1)；high(3)/mid(7) 不入，tmu(NULL) 被排除
    r = await client.get(BASE, params={"deadline": 2})
    body = r.json()
    assert _ids(body) == [seeded["low"]]


async def test_filter_budget_range(client, seeded):
    # 100..1000 → 僅 high(500)；mid(1200)/low(80)/tmu(NULL) 皆出局
    r = await client.get(BASE, params={"budget_min": 100, "budget_max": 1000})
    body = r.json()
    assert _ids(body) == [seeded["high"]]


async def test_filter_budget_min_only(client, seeded):
    r = await client.get(BASE, params={"budget_min": 100})
    body = r.json()
    assert set(_ids(body)) == {seeded["high"], seeded["mid"]}


async def test_query_single_token(client, seeded):
    # "台北" 僅命中 high（tmu 用「臺北」異體字，不命中）
    r = await client.get(BASE, params={"q": "台北"})
    body = r.json()
    assert _ids(body) == [seeded["high"]]


async def test_query_multi_token_and(client, seeded):
    # AND：兩詞皆須命中；high 同時含「台北」「系統」
    r = await client.get(BASE, params={"q": "台北 系統"})
    body = r.json()
    assert _ids(body) == [seeded["high"]]


async def test_query_multi_token_no_match(client, seeded):
    # high 含「系統」但不含「工程」→ 無結果
    r = await client.get(BASE, params={"q": "系統 工程"})
    body = r.json()
    assert body["count"] == 0
    assert body["items"] == []


async def test_focus_or(client, seeded):
    r = await client.get(BASE, params={"focus": ["工程", "勞務"]})
    body = r.json()
    assert set(_ids(body)) == {seeded["mid"], seeded["low"]}


async def test_avoid_not(client, seeded):
    r = await client.get(BASE, params={"avoid": ["勞務"]})
    body = r.json()
    assert set(_ids(body)) == {seeded["high"], seeded["mid"], seeded["tmu"]}


# --------------------------------------------------------------------------- #
# 排序（皆 null 殿後）
# --------------------------------------------------------------------------- #
async def test_sort_feas_default(client, seeded):
    # 預設 feas＝(feasibility_team desc, tier_rank, days)；種子皆未物化(NULL)
    # → 退化為 (tier_rank, days)：high < mid < low < tmu(null)
    r = await client.get(BASE)
    assert _ids(r.json()) == [
        seeded["high"],
        seeded["mid"],
        seeded["low"],
        seeded["tmu"],
    ]


async def test_sort_days(client, seeded):
    # days 升冪、null 殿後：low(1) < high(3) < mid(7) < tmu(null)
    r = await client.get(BASE, params={"sort": "days"})
    assert _ids(r.json()) == [
        seeded["low"],
        seeded["high"],
        seeded["mid"],
        seeded["tmu"],
    ]


async def test_sort_budget(client, seeded):
    # budget 降冪、null 殿後：mid(1200) > high(500) > low(80) > tmu(null)
    r = await client.get(BASE, params={"sort": "budget"})
    assert _ids(r.json()) == [
        seeded["mid"],
        seeded["high"],
        seeded["low"],
        seeded["tmu"],
    ]


async def test_sort_tier(client, seeded):
    # tier_rank：high(1) < mid(2) < low(3) < tmu(null→99)
    r = await client.get(BASE, params={"sort": "tier"})
    assert _ids(r.json()) == [
        seeded["high"],
        seeded["mid"],
        seeded["low"],
        seeded["tmu"],
    ]


async def test_sort_invalid_returns_422(client, seeded):
    r = await client.get(BASE, params={"sort": "bogus"})
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# SL2：feas 排序以物化團隊線可行性分數為主鍵、且回傳真實可行度分數
# --------------------------------------------------------------------------- #
async def test_feas_sort_orders_by_team_feasibility(client, seeded):
    """未物化時退化為 tier 排序（high 居首）；物化分數後，最高分案躍居首位。

    證明預設 feas 排序＝feasibility_team（物化團隊線分數）優先，而非單純 tier。
    分數本身如何隨學習權重變動，由 test_score_team_feasibility 的 job 層測試覆蓋。
    """
    # 冷啟動：feasibility_team 皆 NULL → 退化為純 tier 排序，high 居首。
    cold = (await client.get(BASE)).json()
    assert _ids(cold)[0] == seeded["high"]

    # 物化分數：low 給最高分、high 給較低分 → low 躍居首位、high 退居其後。
    await _set_feasibility_team({seeded["low"]: 90, seeded["high"]: 50})

    warm = (await client.get(BASE)).json()
    assert _ids(warm)[0] == seeded["low"]
    # high(50) 仍排在兩個未物化(NULL 殿後)的 mid／tmu 之前。
    assert _ids(warm)[1] == seeded["high"]


async def test_list_returns_feasibility_score(client, seeded):
    """每筆列表項回傳 0–100 的真實可行度分數；命中正權重者分數更高。"""
    await _add_keyword_weight("勞務", "positive", 5.0)
    body = (await client.get(BASE)).json()
    by_id = {it["id"]: it for it in body["items"]}

    # 欄位存在且落在合法區間。
    for it in body["items"]:
        assert it["feasibility_score"] is not None
        assert 1 <= it["feasibility_score"] <= 99

    # 命中正權重的 low，其顯示分數高於未命中的 high。
    assert by_id[seeded["low"]]["feasibility_score"] > by_id[seeded["high"]]["feasibility_score"]


# --------------------------------------------------------------------------- #
# 分頁
# --------------------------------------------------------------------------- #
async def test_pagination(client, seeded):
    p1 = (await client.get(BASE, params={"page": 1, "page_size": 2})).json()
    p2 = (await client.get(BASE, params={"page": 2, "page_size": 2})).json()
    assert p1["count"] == 4 and p2["count"] == 4
    assert _ids(p1) == [seeded["high"], seeded["mid"]]
    assert _ids(p2) == [seeded["low"], seeded["tmu"]]


async def test_page_size_bounds_422(client, seeded):
    assert (await client.get(BASE, params={"page_size": 0})).status_code == 422
    assert (await client.get(BASE, params={"page_size": 999})).status_code == 422
    assert (await client.get(BASE, params={"page": 0})).status_code == 422


# --------------------------------------------------------------------------- #
# 詳情 / 最新快照 / 404
# --------------------------------------------------------------------------- #
async def test_detail_latest_snapshot_and_history(client, seeded):
    r = await client.get(f"{BASE}/{seeded['high']}")
    assert r.status_code == 200
    body = r.json()
    # 最新快照覆寫主檔呈現值：應為 high/3（非舊快照 low/10）
    assert body["tier"] == "high"
    assert body["days_left"] == 3
    # 歷史快照兩筆、依 run_date 由新到舊
    assert [s["run_date"] for s in body["snapshots"]] == ["2026-06-17", "2026-06-15"]
    assert body["snapshots"][0]["tier"] == "high"
    assert body["snapshots"][1]["tier"] == "low"
    # 未帶 user_id → 無 user_state
    assert body["user_state"] is None


async def test_detail_tmu_null_snapshot(client, seeded):
    r = await client.get(f"{BASE}/{seeded['tmu']}")
    body = r.json()
    assert body["tier"] is None
    assert body["days_left"] is None
    assert body["snapshots"] == []


async def test_detail_not_found_404(client, seeded):
    r = await client.get(f"{BASE}/999999")
    assert r.status_code == 404
    assert r.json()["detail"]

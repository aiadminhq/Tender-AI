# -*- coding: utf-8 -*-
"""決策回顧 / 標案評分管理端點測試（P4 真資料端點）。

驗收對齊需求與紅線：
- 三種處置由 Layer B 行為訊號重建：
  skipped（速覽 pass 事件 ∪ 狀態＝放棄）／accepted（狀態∈{觀望,備標中,已投,得標}）／
  starred（saved 或 star 有值）。
- 優先序 skipped > accepted > starred：同一案有多訊號時取較強者。
- 淘汰理由 reason：優先速覽 pass 的 payload.reason，否則退取最近評估 rationale；
  by 為登入帳號名（具名貢獻者）。
- tier／deadline 由標案最新快照與 deadline_iso 水合（前端決策回顧顯示用）。
- 紅線（negative-keywords-human-only）：呼叫此唯讀端點**不得**寫入任何權重／狀態／事件。

離線、無網；合成種子資料（沿用 conftest 的 seeded 標案＋快照）。
"""
import pytest
from sqlalchemy import func, select

from app.models.behavior import Evaluation, Event, TenderUserState, User
from app.models.knowledge import KeywordWeight

BASE = "/api/v1"


@pytest.fixture
async def decisions_data(db_session, seeded):
    """在 conftest 的 seeded 標案上鋪本人行為，覆蓋三處置＋優先序＋理由 fallback。

    - high：速覽 pass（理由「預算過高」）＋同時有狀態/收藏 → 優先序應判 skipped。
    - mid ：狀態＝放棄（事件無理由）＋評估 rationale「利潤太低」→ skipped，理由取 rationale。
    - low ：承接（備標中）＋同時 saved/star → 優先序 accepted 勝 starred。
    - tmu ：僅收藏（saved），無快照 → starred、tier=None。
    """
    user = User(name="承辦小明", email="ming@hqdesign.tw")
    db_session.add(user)
    await db_session.flush()

    high, mid, low, tmu = seeded["high"], seeded["mid"], seeded["low"], seeded["tmu"]

    db_session.add(
        Event(
            user_id=user.id, type="view", tender_id=high,
            payload={"scope": "swipe", "action": "pass", "reason": "預算過高"},
        )
    )
    db_session.add(
        TenderUserState(user_id=user.id, tender_id=high, status="備標中", saved=True)
    )

    db_session.add(
        TenderUserState(user_id=user.id, tender_id=mid, status="放棄")
    )
    db_session.add(
        Evaluation(
            user_id=user.id, tender_id=mid, feasible="不可行", rationale="利潤太低"
        )
    )

    db_session.add(
        TenderUserState(
            user_id=user.id, tender_id=low, status="備標中", saved=True, star=4
        )
    )

    db_session.add(TenderUserState(user_id=user.id, tender_id=tmu, saved=True))

    await db_session.commit()
    return {"user": user.id, "high": high, "mid": mid, "low": low, "tmu": tmu}


async def test_dispositions_and_priority(client, decisions_data):
    """三處置正確分流，且優先序 skipped>accepted>starred。"""
    r = await client.get(
        f"{BASE}/me/tender-decisions", params={"user_id": decisions_data["user"]}
    )
    assert r.status_code == 200
    body = r.json()

    assert body["counts"] == {"accepted": 1, "starred": 1, "skipped": 2}

    disp = {d["tender_id"]: d["disposition"] for d in body["decisions"]}
    assert disp[decisions_data["high"]] == "skipped"  # 速覽 pass 勝過狀態/收藏
    assert disp[decisions_data["mid"]] == "skipped"  # 狀態＝放棄
    assert disp[decisions_data["low"]] == "accepted"  # 承接勝過 saved/star
    assert disp[decisions_data["tmu"]] == "starred"  # 僅收藏


async def test_skipped_reason_sources_and_by(client, decisions_data):
    """淘汰理由：pass payload.reason 優先；無則退取評估 rationale。by 為具名帳號。"""
    r = await client.get(
        f"{BASE}/me/tender-decisions", params={"user_id": decisions_data["user"]}
    )
    items = {d["tender_id"]: d for d in r.json()["decisions"]}

    high = items[decisions_data["high"]]
    assert high["reason"] == "預算過高"  # 速覽 pass 的 payload.reason
    assert high["by"] == "承辦小明"  # 具名貢獻者（登入帳號名）

    mid = items[decisions_data["mid"]]
    assert mid["reason"] == "利潤太低"  # 無事件理由 → 退取評估 rationale


async def test_tier_and_deadline_hydrated(client, decisions_data):
    """tier 取最新快照、deadline 取 ISO；無快照標案 tier 為 None。"""
    r = await client.get(
        f"{BASE}/me/tender-decisions", params={"user_id": decisions_data["user"]}
    )
    items = {d["tender_id"]: d for d in r.json()["decisions"]}

    high = items[decisions_data["high"]]
    assert high["tier"] == "high"  # 最新快照（舊 low、新 high → 取新）
    assert high["deadline_iso"] == "2026-06-20"

    tmu = items[decisions_data["tmu"]]
    assert tmu["tier"] is None  # 無快照


async def test_readonly_writes_nothing(client, decisions_data, db_session):
    """紅線：呼叫唯讀端點後，DB 不得新增任何權重／狀態／事件／評估。"""

    async def counts():
        neg = (
            await db_session.execute(
                select(func.count()).select_from(KeywordWeight)
                .where(KeywordWeight.polarity == "negative")
            )
        ).scalar_one()
        ev = (
            await db_session.execute(select(func.count()).select_from(Event))
        ).scalar_one()
        tus = (
            await db_session.execute(
                select(func.count()).select_from(TenderUserState)
            )
        ).scalar_one()
        eva = (
            await db_session.execute(select(func.count()).select_from(Evaluation))
        ).scalar_one()
        return (neg, ev, tus, eva)

    before = await counts()
    r = await client.get(
        f"{BASE}/me/tender-decisions", params={"user_id": decisions_data["user"]}
    )
    assert r.status_code == 200
    after = await counts()

    assert before == after
    assert before[0] == 0  # 全程零負權重（系統不得自動產生負分）


async def test_no_decisions_returns_empty(client, seeded):
    """無任何處置行為 → 回空清單、counts 皆 0（用內建 seeded，無行為）。"""
    r = await client.get(f"{BASE}/me/tender-decisions")
    assert r.status_code == 200
    body = r.json()
    assert body["counts"] == {"accepted": 0, "starred": 0, "skipped": 0}
    assert body["decisions"] == []

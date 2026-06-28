# -*- coding: utf-8 -*-
"""Layer B 行為 API 寫入測試（save/accept/rate/note/share、events、saved-searches）。

對照 P2 驗收：行為 API 寫入可查。
- save/accept/rate：透過 GET /tenders/{id}?user_id= 讀回 user_state 驗證持久化。
- note/share/event：以獨立 DB session 直查資料表驗證落地。
- 列舉/邊界值（star、event type、必填）由 Pydantic 擋下回 422。
- 未知標案回 404。
- Task 8：行為寫入端點改由 token 認定 user_id（無 token → 401）。
"""
from __future__ import annotations

from sqlalchemy import func, select

from app.models.behavior import Annotation, Evaluation, Event, Share

TENDERS = "/api/v1/tenders"
EVENTS = "/api/v1/events"
SAVED = "/api/v1/saved-searches"


# --------------------------------------------------------------------------- #
# save / accept / rate → 讀回 user_state
# --------------------------------------------------------------------------- #
async def test_save_then_readback(client, seeded, default_user, auth_headers):
    tid = seeded["high"]
    r = await client.post(
        f"{TENDERS}/{tid}/save",
        json={"saved": True},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 200
    st = r.json()
    assert st["saved"] is True and st["tender_id"] == tid
    uid = st["user_id"]  # token 使用者 id

    detail = await client.get(f"{TENDERS}/{tid}", params={"user_id": uid})
    assert detail.json()["user_state"]["saved"] is True


async def test_save_toggle_off(client, seeded, default_user, auth_headers):
    tid = seeded["high"]
    h = auth_headers(default_user)
    await client.post(f"{TENDERS}/{tid}/save", json={"saved": True}, headers=h)
    r = await client.post(f"{TENDERS}/{tid}/save", json={"saved": False}, headers=h)
    assert r.json()["saved"] is False


async def test_accept_sets_status(client, seeded, default_user, auth_headers):
    tid = seeded["mid"]
    r = await client.post(
        f"{TENDERS}/{tid}/accept",
        json={"status": "已投"},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 200
    assert r.json()["status"] == "已投"


async def test_accept_default_status(client, seeded, default_user, auth_headers):
    tid = seeded["mid"]
    r = await client.post(
        f"{TENDERS}/{tid}/accept",
        json={},
        headers=auth_headers(default_user),
    )
    assert r.json()["status"] == "備標中"


async def test_accept_invalid_status_422(client, seeded, default_user, auth_headers):
    tid = seeded["mid"]
    r = await client.post(
        f"{TENDERS}/{tid}/accept",
        json={"status": "亂填"},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 422


async def test_rate_then_readback(client, seeded, default_user, auth_headers):
    tid = seeded["low"]
    r = await client.post(
        f"{TENDERS}/{tid}/rate",
        json={"star": 5},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 200
    st = r.json()
    assert st["star"] == 5
    detail = await client.get(f"{TENDERS}/{tid}", params={"user_id": st["user_id"]})
    assert detail.json()["user_state"]["star"] == 5


async def test_rate_invalid_star_422(client, seeded, default_user, auth_headers):
    tid = seeded["low"]
    h = auth_headers(default_user)
    assert (await client.post(f"{TENDERS}/{tid}/rate", json={"star": 9}, headers=h)).status_code == 422
    assert (await client.post(f"{TENDERS}/{tid}/rate", json={"star": 0}, headers=h)).status_code == 422
    assert (await client.post(f"{TENDERS}/{tid}/rate", json={}, headers=h)).status_code == 422


# --------------------------------------------------------------------------- #
# note / share / event → 直查資料表
# --------------------------------------------------------------------------- #
async def test_note_persists(client, seeded, default_user, auth_headers, db_session):
    tid = seeded["high"]
    r = await client.post(
        f"{TENDERS}/{tid}/note",
        json={"note": "重要客戶，優先處理"},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["note"] == "重要客戶，優先處理" and body["id"] >= 1

    rows = (
        await db_session.execute(select(Annotation).where(Annotation.tender_id == tid))
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].note == "重要客戶，優先處理"


async def test_note_empty_422(client, seeded, default_user, auth_headers):
    tid = seeded["high"]
    r = await client.post(
        f"{TENDERS}/{tid}/note",
        json={"note": ""},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 422


async def test_share_persists(client, seeded, default_user, auth_headers, db_session):
    tid = seeded["high"]
    r = await client.post(
        f"{TENDERS}/{tid}/share",
        json={"channel": "line"},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 200
    assert r.json()["channel"] == "line"

    cnt = await db_session.scalar(
        select(func.count()).select_from(Share).where(Share.tender_id == tid)
    )
    assert cnt == 1


async def test_event_with_tender(client, seeded, default_user, auth_headers, db_session):
    tid = seeded["high"]
    r = await client.post(
        EVENTS,
        json={"type": "view", "tender_id": tid},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "view" and body["tender_id"] == tid

    cnt = await db_session.scalar(select(func.count()).select_from(Event))
    assert cnt == 1


async def test_event_without_tender(client, seeded, default_user, auth_headers):
    # apply_filter 等非標案層級事件，tender_id 可省略
    r = await client.post(
        EVENTS,
        json={"type": "apply_filter", "payload": {"tier": ["high"]}},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["tender_id"] is None
    assert body["payload"] == {"tier": ["high"]}


async def test_event_invalid_type_422(client, seeded, default_user, auth_headers):
    r = await client.post(
        EVENTS,
        json={"type": "bogus"},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# evaluate（標案判斷 ✓/✗/⭐ → Layer B + 即時學習）
# --------------------------------------------------------------------------- #
async def test_evaluate_persists_and_emits_judgment(client, seeded, default_user, auth_headers, db_session):
    tid = seeded["high"]
    r = await client.post(
        f"{TENDERS}/{tid}/evaluate",
        json={
            "feasible": "可行",
            "rationale": "預算與類別契合",
            "criteria": {"chips": ["預算契合"], "featured": True},
        },
        headers=auth_headers(default_user),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["evaluation"]["feasible"] == "可行"
    assert body["evaluation"]["criteria"]["featured"] is True
    assert body["evaluation"]["rationale"] == "預算與類別契合"

    # Evaluation 落地
    ev = (
        await db_session.execute(select(Evaluation).where(Evaluation.tender_id == tid))
    ).scalars().all()
    assert len(ev) == 1

    # 同步發 judgment 事件，payload 記極性/精選/有無原因
    jev = (
        await db_session.execute(select(Event).where(Event.type == "judgment"))
    ).scalars().all()
    assert len(jev) == 1
    assert jev[0].payload["feasible"] == "可行"
    assert jev[0].payload["featured"] is True
    assert jev[0].payload["has_rationale"] is True


async def test_evaluate_upsert_no_duplicate(client, seeded, default_user, auth_headers, db_session):
    tid = seeded["high"]
    h = auth_headers(default_user)
    await client.post(f"{TENDERS}/{tid}/evaluate", json={"feasible": "可行"}, headers=h)
    r = await client.post(f"{TENDERS}/{tid}/evaluate", json={"feasible": "不可行"}, headers=h)
    assert r.status_code == 200
    assert r.json()["evaluation"]["feasible"] == "不可行"

    ev = (
        await db_session.execute(select(Evaluation).where(Evaluation.tender_id == tid))
    ).scalars().all()
    assert len(ev) == 1  # 同人同案只留一筆（手動 upsert）
    assert ev[0].feasible == "不可行"


async def test_evaluate_invalid_feasible_422(client, seeded, default_user, auth_headers):
    tid = seeded["high"]
    r = await client.post(
        f"{TENDERS}/{tid}/evaluate",
        json={"feasible": "也許"},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 422


async def test_evaluate_unknown_tender_404(client, seeded, default_user, auth_headers):
    r = await client.post(
        f"{TENDERS}/999999/evaluate",
        json={"feasible": "可行"},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 404


async def test_evaluate_rationale_optional(client, seeded, default_user, auth_headers):
    tid = seeded["mid"]
    r = await client.post(
        f"{TENDERS}/{tid}/evaluate",
        json={"feasible": "可行"},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 200
    assert r.json()["evaluation"]["rationale"] is None


# --------------------------------------------------------------------------- #
# saved-searches
# --------------------------------------------------------------------------- #
async def test_saved_search_create_and_list(client, seeded, default_user, auth_headers):
    h = auth_headers(default_user)
    payload = {
        "name": "台北高優先",
        "query_text": "資訊系統",
        "filter_json": {"tier": ["high"], "city": ["台北市"]},
    }
    r = await client.post(SAVED, json=payload, headers=h)
    assert r.status_code == 200
    created = r.json()
    assert created["name"] == "台北高優先"
    assert created["use_count"] == 0
    assert created["filter_json"] == {"tier": ["high"], "city": ["台北市"]}

    # 帶 token 可列回（GET /saved-searches 也改為 token 認定 user）
    listed = (await client.get(SAVED, headers=h)).json()
    assert [s["name"] for s in listed] == ["台北高優先"]


async def test_saved_search_list_empty_when_no_records(client, seeded, default_user, auth_headers):
    # 尚無任何寫入 → 列表回空
    r = await client.get(SAVED, headers=auth_headers(default_user))
    assert r.status_code == 200
    assert r.json() == []


async def test_saved_search_missing_name_422(client, seeded, default_user, auth_headers):
    r = await client.post(
        SAVED,
        json={"query_text": "x"},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# 404：未知標案
# --------------------------------------------------------------------------- #
async def test_save_unknown_tender_404(client, seeded, default_user, auth_headers):
    r = await client.post(
        f"{TENDERS}/999999/save",
        json={"saved": True},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# Task 8：行為寫入端點需 token（無 token → 401；有 token → user_id 從 token 推導）
# --------------------------------------------------------------------------- #
async def test_event_requires_token(client, seeded):
    r = await client.post(EVENTS, json={"type": "view"})
    assert r.status_code == 401


async def test_event_attributes_to_token_user(client, seeded, default_user, auth_headers, db_session):
    r = await client.post(
        EVENTS,
        json={"type": "view"},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 200
    # 落庫的 user_id 應＝token 的 default_user.id（即使 body 沒帶 user_id）
    evt = (await db_session.execute(select(Event).where(Event.user_id == default_user.id))).scalars().first()
    assert evt is not None, "事件未落庫"
    assert evt.user_id == default_user.id

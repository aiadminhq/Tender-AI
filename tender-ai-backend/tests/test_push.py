# -*- coding: utf-8 -*-
"""SL5 主動推播測試（離線、無網；合成種子資料）。

驗收對齊願景第 4 點「重自動推播」：
- 依承標判準（SL2 可行度排序 + SL3 推理）挑高潛力標案 → run_push 只納入達門檻者。
- 同日重跑 idempotent（唯一鍵兜底，不重複塞）。
- 跨日去重：近 N 天已推過的標案不重複推。
- 未讀數 / 標記已讀。
- user_id 嚴格隔離：A 的推播不外洩給 B。
- Layer A 安全：推播理由不含人名／email（無 "@"）。
"""
from datetime import date, timedelta

import pytest

from app.models.behavior import User
from app.services import push as svc

PUSH_BASE = "/api/v1"


# --------------------------------------------------------------------------- #
# 服務層
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_run_push_selects_high_potential(seeded, db_session):
    """min_score=60（預設）：僅 high（顯示可行度 70）達標 → 只推 1 筆。"""
    result = await svc.run_push(db_session, min_score=60)
    await db_session.commit()
    assert result.created == 1
    assert len(result.items) == 1
    item = result.items[0]
    assert item.tender_id == seeded["high"]
    assert item.tier == "high"
    assert item.score is not None
    assert item.status == "pending"
    # 帶 Layer A 顯示欄位
    assert item.name and item.org and item.source == "PCC"


@pytest.mark.asyncio
async def test_run_push_idempotent_same_day(seeded, db_session):
    """同一 run_date 重跑：第二次 created=0，總數不變（唯一鍵 idempotent）。"""
    today = date(2026, 6, 18)
    first = await svc.run_push(db_session, min_score=30, limit=8, run_date=today)
    await db_session.commit()
    assert first.created == 4  # high/mid/low/tmu 全達 30 門檻

    second = await svc.run_push(db_session, min_score=30, limit=8, run_date=today)
    await db_session.commit()
    assert second.created == 0
    assert len(second.items) == 4  # digest 仍是同一批，不重複


@pytest.mark.asyncio
async def test_dedup_across_days(seeded, db_session):
    """跨日去重：d1 推 high+mid，d2（lookback 內）改推 low+tmu，不重複。"""
    d1 = date(2026, 6, 18)
    d2 = d1 + timedelta(days=1)

    r1 = await svc.run_push(db_session, min_score=30, limit=2, run_date=d1)
    await db_session.commit()
    ids1 = {it.tender_id for it in r1.items}
    assert ids1 == {seeded["high"], seeded["mid"]}

    r2 = await svc.run_push(
        db_session, min_score=30, limit=2, lookback_days=7, run_date=d2
    )
    await db_session.commit()
    ids2 = {it.tender_id for it in r2.items}
    assert ids2 == {seeded["low"], seeded["tmu"]}
    assert r2.skipped >= 2  # high/mid 因近期已推被略過


@pytest.mark.asyncio
async def test_unread_and_mark_read(seeded, db_session):
    """未讀數等於推播數；mark_read 後歸零且狀態為 read。"""
    result = await svc.run_push(db_session, min_score=30)
    await db_session.commit()
    created = result.created
    assert created == 4

    digest = await svc.get_digest(db_session)
    assert digest.unread == created
    assert all(it.status == "pending" for it in digest.items)

    marked = await svc.mark_read(db_session)
    await db_session.commit()
    assert marked == created

    digest2 = await svc.get_digest(db_session)
    assert digest2.unread == 0
    assert all(it.status == "read" for it in digest2.items)


@pytest.mark.asyncio
async def test_mark_read_single(seeded, db_session):
    """指定 push_id 只標記單筆。"""
    result = await svc.run_push(db_session, min_score=30)
    await db_session.commit()
    target = result.items[0].id

    marked = await svc.mark_read(db_session, push_id=target)
    await db_session.commit()
    assert marked == 1

    digest = await svc.get_digest(db_session)
    assert digest.unread == result.created - 1


@pytest.mark.asyncio
async def test_user_isolation(seeded, db_session):
    """A 的推播不外洩給 B：B 的 digest 為空。"""
    await svc.run_push(db_session, min_score=30)  # 預設 user
    await db_session.commit()

    other = User(name="other", email="other@hq.tw", role="scout")
    db_session.add(other)
    await db_session.flush()
    await db_session.commit()

    digest_other = await svc.get_digest(db_session, other.id)
    assert digest_other.unread == 0
    assert digest_other.items == []


@pytest.mark.asyncio
async def test_layer_a_safe_no_pii(seeded, db_session):
    """推播理由為 Layer A 安全內容：不含 email（"@"）。"""
    result = await svc.run_push(db_session, min_score=30)
    await db_session.commit()
    for it in result.items:
        assert it.reason is not None
        assert "@" not in it.reason


@pytest.mark.asyncio
async def test_digest_empty_for_unknown_default(db_session):
    """從未推過：digest 為空且不建立預設 user（唯讀無副作用）。"""
    digest = await svc.get_digest(db_session)
    assert digest.run_date is None
    assert digest.items == []
    # 唯讀路徑不應建立 default user
    from sqlalchemy import func, select

    cnt = (
        await db_session.execute(select(func.count()).select_from(User))
    ).scalar()
    assert cnt == 0


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_api_push_run_and_digest(seeded, client):
    resp = await client.post(
        f"{PUSH_BASE}/push/run", json={"min_score": 30, "limit": 8}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 4
    assert len(body["items"]) == 4

    d = await client.get(f"{PUSH_BASE}/push/digest")
    assert d.status_code == 200
    dbody = d.json()
    assert dbody["unread"] == 4
    assert dbody["total"] == 4


@pytest.mark.asyncio
async def test_api_push_read(seeded, client):
    await client.post(f"{PUSH_BASE}/push/run", json={"min_score": 30})
    resp = await client.post(f"{PUSH_BASE}/push/read", json={})
    assert resp.status_code == 200
    assert resp.json()["marked"] == 4

    d = await client.get(f"{PUSH_BASE}/push/digest")
    assert d.json()["unread"] == 0

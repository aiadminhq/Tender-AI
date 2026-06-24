# -*- coding: utf-8 -*-
"""app.jobs.backfill_qualification_items：把既有 revision 的資格摘要結構化回填。

背景
----
``qualification_items`` 為後加欄位（migration d8f1a3c6e904）。在它之前抓進的 revision，
``qualification_text`` 有值但 ``qualification_items`` 為 NULL。本 job 純讀既有
``qualification_text``、以 ``structure_text`` 結構化後寫回，**完全 offline**、**冪等**、
**只補 NULL 不覆蓋既有值**。

驗收重點：
- 補 NULL：text 有值且 items=NULL → 結構化後寫入（含 code / requirement 條目）。
- 不覆蓋：items 已有值者一律不動。
- 缺資料略過：text=NULL 不在母體；text 有值但結構化後 0 條目 → 略過、不寫。
- 冪等：重跑無新增更新。
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest_asyncio
from sqlalchemy import select

from app.models.revision import TenderRevision, TenderSnapshot
from app.models.tender import Source, Tender

_FETCHED = datetime(2026, 6, 20, 9, 0, tzinfo=timezone.utc)


async def _add_revision(session, tender_id: int, *, revision_no: int,
                        qualification_text: str | None,
                        qualification_items: list | None = None) -> int:
    h = f"{tender_id:02d}{revision_no:062d}"
    snap = TenderSnapshot(
        tender_id=tender_id, source_url="https://web.pcc.gov.tw/d",
        http_status=200, content_hash=h, raw_html="<html>d</html>", fetched_at=_FETCHED,
    )
    session.add(snap)
    await session.flush()
    rev = TenderRevision(
        tender_id=tender_id, snapshot_id=snap.id, revision_no=revision_no,
        content_hash=h, qualification_text=qualification_text,
        qualification_items=qualification_items, fetched_at=_FETCHED,
    )
    session.add(rev)
    await session.flush()
    return rev.id


@pytest_asyncio.fixture
async def revs(db_session):
    """植入三種情境，回傳 label → revision_id。"""
    src = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    db_session.add(src)
    await db_session.flush()

    from datetime import date
    t = Tender(source_id=src.id, case_pk="Q1", name="案-Q1", org="某機關",
               link="https://x/Q1", first_seen=date(2026, 6, 20), last_seen=date(2026, 6, 20))
    db_session.add(t)
    await db_session.flush()

    fillable = await _add_revision(
        db_session, t.id, revision_no=1,
        qualification_text="一、廠商登記\nE101011綜合營造業丙等",
    )
    has_value = await _add_revision(
        db_session, t.id, revision_no=2,
        qualification_text="二、納稅證明",
        qualification_items=[{"kind": "note", "label": None, "content": "既有", "params": {}}],
    )
    no_text = await _add_revision(
        db_session, t.id, revision_no=3, qualification_text=None,
    )
    await db_session.commit()
    return {"fill": fillable, "has": has_value, "notext": no_text}


async def _items(session, rid: int):
    return await session.scalar(
        select(TenderRevision.qualification_items).where(TenderRevision.id == rid)
    )


async def test_backfill_fills_and_respects_boundaries(revs, db_session, session_factory):
    from app.jobs.backfill_qualification_items import run_backfill_qualification_items

    stats = await run_backfill_qualification_items(session_factory=session_factory)

    fill_items = await _items(db_session, revs["fill"])
    assert isinstance(fill_items, list) and fill_items
    assert any(it["kind"] == "code" and it["label"] == "E101011" for it in fill_items)
    assert any(it["kind"] == "requirement" and it["label"] == "一" for it in fill_items)

    # 既有值不動
    has_items = await _items(db_session, revs["has"])
    assert has_items == [{"kind": "note", "label": None, "content": "既有", "params": {}}]

    # text=NULL 不在母體
    assert await _items(db_session, revs["notext"]) is None
    assert stats["updated"] == 1


async def test_backfill_idempotent(revs, db_session, session_factory):
    from app.jobs.backfill_qualification_items import run_backfill_qualification_items

    await run_backfill_qualification_items(session_factory=session_factory)
    stats2 = await run_backfill_qualification_items(session_factory=session_factory)
    assert stats2["updated"] == 0

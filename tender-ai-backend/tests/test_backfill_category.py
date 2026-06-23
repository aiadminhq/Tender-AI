# -*- coding: utf-8 -*-
"""app.jobs.backfill_category：把已抓進 revision 的標的分類投影回 Tender.category。

背景
----
`enrich_details` 刻意「不回填 Tender 主檔」（詳情只落成不可變 revision），導致由它補抓
的舊案 ``tenders.category`` 仍為 NULL——這正是 P4 學習的天花板（79% NULL）。本 job 純讀
既有 revision、把 ``category_main`` 正規化後投影回 ``Tender.category``，**完全 offline**、
**冪等**、**只補 NULL 不覆蓋既有值**。新案路徑（research_enrich）已於抓取時回填，不受影響。

驗收重點：
- 補 NULL：category=NULL 且其 revision 有 category_main → 正規化後寫入（「工程類」→「工程」）。
- 不覆蓋：category 已有值者一律不動。
- 缺資料略過：revision 無 category_main → 維持 NULL、不計入。
- 取現值版本優先：以 current_revision_id 指向的版本為憑，無則退回最新有分類的版本。
- 冪等：重跑無新增更新。
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest_asyncio
from sqlalchemy import select

from app.models.revision import TenderRevision, TenderSnapshot
from app.models.tender import Source, Tender

_FETCHED = datetime(2026, 6, 20, 9, 0, tzinfo=timezone.utc)


async def _add_revision(session, tender_id: int, *, revision_no: int,
                        category_main: str | None, set_current: bool = False) -> int:
    """為標案掛一筆 snapshot + revision；可選擇把它設為 current_revision。"""
    h = f"{tender_id:02d}{revision_no:062d}"  # 64 字、(tender,hash) 唯一
    snap = TenderSnapshot(
        tender_id=tender_id, source_url="https://web.pcc.gov.tw/d",
        http_status=200, content_hash=h, raw_html="<html>d</html>", fetched_at=_FETCHED,
    )
    session.add(snap)
    await session.flush()
    rev = TenderRevision(
        tender_id=tender_id, snapshot_id=snap.id, revision_no=revision_no,
        content_hash=h, category_main=category_main, fetched_at=_FETCHED,
    )
    session.add(rev)
    await session.flush()
    if set_current:
        t = await session.get(Tender, tender_id)
        t.current_revision_id = rev.id
    await session.flush()
    return rev.id


@pytest_asyncio.fixture
async def tenders(db_session):
    """植入四種情境，回傳 label → tender_id。"""
    src = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    db_session.add(src)
    await db_session.flush()

    def _t(pk, category=None):
        return Tender(source_id=src.id, case_pk=pk, name=f"案-{pk}", org="某機關",
                      category=category, link=f"https://x/{pk}",
                      first_seen=date(2026, 6, 20), last_seen=date(2026, 6, 20))

    fillable = _t("FILL")            # NULL + 有分類 revision → 應補
    has_value = _t("HAS", "勞務")     # 已有值 → 不可覆蓋
    no_cat = _t("NOCAT")             # NULL + revision 無分類 → 略過
    prefer = _t("PREFER")            # NULL + 舊版工程／現值財物 → 取現值
    db_session.add_all([fillable, has_value, no_cat, prefer])
    await db_session.flush()

    await _add_revision(db_session, fillable.id, revision_no=1, category_main="工程類")
    await _add_revision(db_session, has_value.id, revision_no=1, category_main="工程類")
    await _add_revision(db_session, no_cat.id, revision_no=1, category_main=None)
    await _add_revision(db_session, prefer.id, revision_no=1, category_main="工程類")
    await _add_revision(db_session, prefer.id, revision_no=2, category_main="財物類",
                        set_current=True)
    await db_session.commit()
    return {"fill": fillable.id, "has": has_value.id,
            "nocat": no_cat.id, "prefer": prefer.id}


async def _cat(session, tid: int) -> str | None:
    return await session.scalar(select(Tender.category).where(Tender.id == tid))


async def test_backfill_fills_normalizes_and_respects_boundaries(tenders, db_session, session_factory):
    from app.jobs.backfill_category import run_backfill_category

    stats = await run_backfill_category(session_factory=session_factory)

    assert await _cat(db_session, tenders["fill"]) == "工程"   # 補上 + 去「類」
    assert await _cat(db_session, tenders["has"]) == "勞務"     # 既有值不動
    assert await _cat(db_session, tenders["nocat"]) is None     # 無分類略過
    assert await _cat(db_session, tenders["prefer"]) == "財物"  # 取 current_revision
    assert stats["updated"] == 2  # fill + prefer


async def test_backfill_idempotent(tenders, db_session, session_factory):
    from app.jobs.backfill_category import run_backfill_category

    await run_backfill_category(session_factory=session_factory)
    stats2 = await run_backfill_category(session_factory=session_factory)
    assert stats2["updated"] == 0  # 第二次無新增更新

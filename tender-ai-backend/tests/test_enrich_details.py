# -*- coding: utf-8 -*-
"""enrich job(revision-first 詳情 enrich)的離線整合測試。

全程不連網/不連 Ollama:以 monkeypatch 替換 ``PCCAdapter.fetch_detail`` 回 fixture,
資料寫測試庫(``TestSessionLocal``)。對齊修訂計畫 §6 測試矩陣 9–17。

鐵則:enrich job 是唯一會 live 連 PCC 的元件 → 本檔絕不真正連網,一律 fixture+monkeypatch。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import func, select, update

from app.adapters import get_adapter
from app.adapters.base import FetchResult
from app.jobs.enrich_details import run_enrich
from app.models.revision import CrawlFailure, CrawlRun, TenderRevision, TenderSnapshot
from app.models.tender import Tender

from tests.conftest import TestSessionLocal

FIX = Path(__file__).parent / "fixtures"

# 固定且 tz-aware 的「現在」(detail_checked_at 為 timezone=True,比較須一致)
NOW = datetime(2026, 6, 18, 9, 0, tzinfo=timezone.utc)


def _load(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


def _fetch_result(
    case_pk: str,
    raw: str,
    *,
    status: int = 200,
    content_type: str | None = "text/html; charset=utf-8",
    key: str | None = None,
) -> FetchResult:
    """以 fixture 內容組出一個 FetchResult(取代 adapter 的 live 抓取)。"""
    return FetchResult(
        source_name="PCC",
        source_url=f"https://web.pcc.gov.tw/detail?pkPmsMain={case_pk}",
        status_code=status,
        content_type=content_type,
        raw_content=raw,
        fetched_at=NOW,
        source_revision_key=key,
    )


def _patch_pcc(monkeypatch, fn) -> None:
    """把 PCCAdapter.fetch_detail 換成測試用假抓取(simulate live)。"""
    monkeypatch.setattr(get_adapter("PCC"), "fetch_detail", fn)


# --------------------------------------------------------------------------- #
# 共用查詢 helper(走測試讀 session)
# --------------------------------------------------------------------------- #
async def _snapshots(session, tender_id: int) -> list[TenderSnapshot]:
    res = await session.execute(
        select(TenderSnapshot).where(TenderSnapshot.tender_id == tender_id)
    )
    return list(res.scalars())


async def _revisions(session, tender_id: int) -> list[TenderRevision]:
    res = await session.execute(
        select(TenderRevision)
        .where(TenderRevision.tender_id == tender_id)
        .order_by(TenderRevision.revision_no)
    )
    return list(res.scalars())


async def _failures(session, tender_id: int) -> list[CrawlFailure]:
    res = await session.execute(
        select(CrawlFailure).where(CrawlFailure.tender_id == tender_id)
    )
    return list(res.scalars())


# --------------------------------------------------------------------------- #
# 9) 首跑 → snapshot + revision_no=1 + current_revision_id + detail_checked_at
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_first_run_creates_snapshot_and_revision(seeded, db_session, monkeypatch):
    full = _load("pcc_detail_full.html")
    _patch_pcc(monkeypatch, lambda case_pk: _fetch_result(case_pk, full, key="01"))

    stats = await run_enrich(session_factory=TestSessionLocal, now=NOW, rate_limit_s=0)

    # 三筆 PCC 標的皆為目標(TMU 不支援 → 不選)
    assert stats["targeted"] == 3
    assert stats["fetched"] == 3
    assert stats["new_revisions"] == 3
    assert stats["unchanged"] == 0
    assert stats["failed"] == 0

    hid = seeded["high"]
    snaps = await _snapshots(db_session, hid)
    revs = await _revisions(db_session, hid)
    assert len(snaps) == 1
    assert len(revs) == 1
    rev = revs[0]
    assert rev.revision_no == 1
    assert rev.snapshot_id == snaps[0].id
    assert rev.deposit_amount_twd == 150000
    assert rev.deposit_required is True
    assert rev.qualification_codes == ["E101011", "E102011"]
    assert rev.category_code == "5179"
    assert rev.source_revision_key == "01"

    t = await db_session.get(Tender, hid)
    assert t.current_revision_id == rev.id
    assert t.detail_checked_at is not None

    # crawl_run 收檔且計數正確
    run = await db_session.get(CrawlRun, stats["run_id"])
    assert run.status == "completed"
    assert run.finished_at is not None
    assert run.targeted == 3 and run.new_revisions == 3


# --------------------------------------------------------------------------- #
# 10) 同 hash 重跑 → 冪等:無新列、detail_checked_at 更新、unchanged++
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_same_hash_rerun_is_idempotent(seeded, db_session, monkeypatch):
    full = _load("pcc_detail_full.html")
    _patch_pcc(monkeypatch, lambda case_pk: _fetch_result(case_pk, full, key="01"))

    await run_enrich(session_factory=TestSessionLocal, now=NOW, rate_limit_s=0)
    # 第二次以 only_missing=False 強制重選同一批
    later = NOW + timedelta(hours=1)
    stats2 = await run_enrich(
        session_factory=TestSessionLocal,
        now=later,
        only_missing=False,
        rate_limit_s=0,
    )

    assert stats2["unchanged"] == 3
    assert stats2["new_revisions"] == 0

    hid = seeded["high"]
    assert len(await _snapshots(db_session, hid)) == 1
    assert len(await _revisions(db_session, hid)) == 1
    t = await db_session.get(Tender, hid)
    assert t.detail_checked_at == later  # detail_checked_at 已 bump


# --------------------------------------------------------------------------- #
# 11) hash 變更 → 新 revision_no=2、current_revision_id 前進、舊版不可變
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_hash_change_creates_new_revision(seeded, db_session, monkeypatch):
    full = _load("pcc_detail_full.html")
    corrected = _load("pcc_detail_corrected.html")
    holder = {"raw": full, "key": "01"}
    _patch_pcc(
        monkeypatch,
        lambda case_pk: _fetch_result(case_pk, holder["raw"], key=holder["key"]),
    )

    await run_enrich(session_factory=TestSessionLocal, now=NOW, rate_limit_s=0)
    hid = seeded["high"]
    rev1 = (await _revisions(db_session, hid))[0]
    rev1_id = rev1.id
    rev1_amount = rev1.deposit_amount_twd

    # 換內容 → 第二次(only_missing=False 強制重選)
    holder["raw"] = corrected
    holder["key"] = "02"
    later = NOW + timedelta(hours=1)
    await run_enrich(
        session_factory=TestSessionLocal,
        now=later,
        only_missing=False,
        rate_limit_s=0,
    )

    db_session.expire_all()
    revs = await _revisions(db_session, hid)
    assert len(revs) == 2
    assert [r.revision_no for r in revs] == [1, 2]
    assert len(await _snapshots(db_session, hid)) == 2

    rev2 = revs[1]
    t = await db_session.get(Tender, hid)
    assert t.current_revision_id == rev2.id  # 現值投影前進到新版
    assert rev2.id != rev1_id

    # 舊版不可變:rev1 的型別欄仍為原值
    assert revs[0].deposit_amount_twd == rev1_amount == 150000
    assert revs[0].source_revision_key == "01"


# --------------------------------------------------------------------------- #
# 12) 更正公告清空某欄 → 新 revision 如實反映清空(非 coalesce)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_corrected_announcement_clears_field_faithfully(
    seeded, db_session, monkeypatch
):
    full = _load("pcc_detail_full.html")
    corrected = _load("pcc_detail_corrected.html")
    holder = {"raw": full, "key": "01"}
    _patch_pcc(
        monkeypatch,
        lambda case_pk: _fetch_result(case_pk, holder["raw"], key=holder["key"]),
    )

    await run_enrich(session_factory=TestSessionLocal, now=NOW, rate_limit_s=0)
    holder["raw"] = corrected
    holder["key"] = "02"
    await run_enrich(
        session_factory=TestSessionLocal,
        now=NOW + timedelta(hours=1),
        only_missing=False,
        rate_limit_s=0,
    )

    hid = seeded["high"]
    revs = await _revisions(db_session, hid)
    assert revs[0].deposit_amount_twd == 150000  # 原版有押標金額
    # 更正版被清空 → 不從前一版 coalesce 補回
    assert revs[1].deposit_amount_twd is None
    assert revs[1].deposit_required is False


# --------------------------------------------------------------------------- #
# 13) 目標選擇:new ∪ stale(active&TTL)∪ retriable;截止案不重抓;--all 覆寫
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_target_selection_new_stale_expired_and_all(
    seeded, db_session, monkeypatch
):
    from datetime import date

    full = _load("pcc_detail_full.html")
    seen: list[str] = []

    def fake(case_pk):
        seen.append(case_pk)
        return _fetch_result(case_pk, full, key="01")

    _patch_pcc(monkeypatch, fake)

    # 先全跑一次,讓三筆 PCC 都有 revision
    await run_enrich(session_factory=TestSessionLocal, now=NOW, rate_limit_s=0)

    high, mid, low = seeded["high"], seeded["mid"], seeded["low"]
    # high:近期已檢查(active)→ 非 stale、非 new → 不選
    await db_session.execute(
        update(Tender).where(Tender.id == high).values(detail_checked_at=NOW)
    )
    # mid:48h 前檢查(active、TTL=24h)→ stale → 選
    await db_session.execute(
        update(Tender).where(Tender.id == mid).values(
            detail_checked_at=NOW - timedelta(hours=48)
        )
    )
    # low:截止日已過 + 近期已檢查 → 非 active → 不選
    await db_session.execute(
        update(Tender).where(Tender.id == low).values(
            deadline_iso=date(2026, 6, 1), detail_checked_at=NOW
        )
    )
    await db_session.commit()

    seen.clear()
    stats = await run_enrich(
        session_factory=TestSessionLocal,
        now=NOW,
        only_missing=True,
        ttl_hours=24,
        rate_limit_s=0,
    )
    assert stats["targeted"] == 1
    assert set(seen) == {"PCC-M"}  # 只有 stale 的 mid

    # --all:三筆 PCC 全選(TMU 仍不選)
    seen.clear()
    stats_all = await run_enrich(
        session_factory=TestSessionLocal,
        now=NOW,
        only_missing=False,
        rate_limit_s=0,
    )
    assert stats_all["targeted"] == 3
    assert set(seen) == {"PCC-H", "PCC-M", "PCC-L"}


# --------------------------------------------------------------------------- #
# 14) 抓取失敗(transport raise)→ 寫 crawl_failure(fetch)、整批續跑
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_fetch_failure_records_and_continues(seeded, db_session, monkeypatch):
    full = _load("pcc_detail_full.html")

    def fake(case_pk):
        if case_pk == "PCC-M":
            raise RuntimeError("connection reset")
        return _fetch_result(case_pk, full, key="01")

    _patch_pcc(monkeypatch, fake)

    stats = await run_enrich(session_factory=TestSessionLocal, now=NOW, rate_limit_s=0)

    assert stats["failed"] == 1
    assert stats["new_revisions"] == 2  # high、low 仍處理(整批不中斷)

    mid = seeded["mid"]
    fails = await _failures(db_session, mid)
    assert len(fails) == 1
    assert fails[0].stage == "fetch"
    assert fails[0].retriable is True
    assert len(await _revisions(db_session, mid)) == 0

    # 其餘標的成功
    assert len(await _revisions(db_session, seeded["high"])) == 1
    assert len(await _revisions(db_session, seeded["low"])) == 1


@pytest.mark.asyncio
async def test_fetch_non_200_records_fetch_failure(seeded, db_session, monkeypatch):
    full = _load("pcc_detail_full.html")

    def fake(case_pk):
        if case_pk == "PCC-M":
            return _fetch_result(case_pk, "", status=503)
        return _fetch_result(case_pk, full, key="01")

    _patch_pcc(monkeypatch, fake)
    stats = await run_enrich(session_factory=TestSessionLocal, now=NOW, rate_limit_s=0)

    assert stats["failed"] == 1
    fails = await _failures(db_session, seeded["mid"])
    assert len(fails) == 1 and fails[0].stage == "fetch"
    assert fails[0].http_status == 503


@pytest.mark.asyncio
async def test_fetch_wrong_content_type_records_fetch_failure(
    seeded, db_session, monkeypatch
):
    full = _load("pcc_detail_full.html")

    def fake(case_pk):
        if case_pk == "PCC-M":
            return _fetch_result(case_pk, "{}", content_type="application/json")
        return _fetch_result(case_pk, full, key="01")

    _patch_pcc(monkeypatch, fake)
    stats = await run_enrich(session_factory=TestSessionLocal, now=NOW, rate_limit_s=0)

    assert stats["failed"] == 1
    fails = await _failures(db_session, seeded["mid"])
    assert len(fails) == 1 and fails[0].stage == "fetch"
    # content-type 錯通常非暫時性 → 不可重試
    assert fails[0].retriable is False


# --------------------------------------------------------------------------- #
# 15) retriable failure 下次被選中;成功後 resolved_at 設定
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_retriable_failure_reselected_and_resolved(
    seeded, db_session, monkeypatch
):
    full = _load("pcc_detail_full.html")
    holder = {"fail": True}

    def fake(case_pk):
        if case_pk == "PCC-H" and holder["fail"]:
            raise RuntimeError("temporary network error")
        return _fetch_result(case_pk, full, key="01")

    _patch_pcc(monkeypatch, fake)

    # 第一次:high 抓取失敗(retriable)、無 revision
    await run_enrich(session_factory=TestSessionLocal, now=NOW, rate_limit_s=0)
    high = seeded["high"]
    fails = await _failures(db_session, high)
    assert len(fails) == 1 and fails[0].resolved_at is None
    assert len(await _revisions(db_session, high)) == 0

    # 第二次(較晚、退避已過):high 經 retriable 被重選且成功
    holder["fail"] = False
    later = NOW + timedelta(hours=23)
    await run_enrich(
        session_factory=TestSessionLocal,
        now=later,
        only_missing=True,
        ttl_hours=24,
        rate_limit_s=0,
    )

    db_session.expire_all()
    fails2 = await _failures(db_session, high)
    assert all(f.resolved_at is not None for f in fails2)  # 成功後解除
    assert len(await _revisions(db_session, high)) == 1


# --------------------------------------------------------------------------- #
# 16) transaction 完整性:snapshot 後 parse 失敗 → rollback + crawl_failure(parse)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_parse_failure_rolls_back_and_records(seeded, db_session, monkeypatch):
    full = _load("pcc_detail_full.html")
    invalid = _load("pcc_detail_invalid.html")  # 通過 fetch 但 parse 回 None

    def fake(case_pk):
        if case_pk == "PCC-H":
            return _fetch_result(case_pk, invalid, key=None)
        return _fetch_result(case_pk, full, key="01")

    _patch_pcc(monkeypatch, fake)
    stats = await run_enrich(session_factory=TestSessionLocal, now=NOW, rate_limit_s=0)

    high = seeded["high"]
    # 半套 rollback:無 snapshot、無 revision、現值未動
    assert len(await _snapshots(db_session, high)) == 0
    assert len(await _revisions(db_session, high)) == 0
    t = await db_session.get(Tender, high)
    assert t.current_revision_id is None

    fails = await _failures(db_session, high)
    assert len(fails) == 1 and fails[0].stage == "parse"
    assert stats["failed"] == 1
    assert stats["new_revisions"] == 2  # 其餘成功


# --------------------------------------------------------------------------- #
# 17) TMU 標的略過(supports_detail_enrich=False),不記 failure
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_tmu_is_skipped_without_failure(seeded, db_session, monkeypatch):
    full = _load("pcc_detail_full.html")
    seen: list[str] = []

    def fake(case_pk):
        seen.append(case_pk)
        return _fetch_result(case_pk, full, key="01")

    _patch_pcc(monkeypatch, fake)
    await run_enrich(
        session_factory=TestSessionLocal,
        now=NOW,
        only_missing=False,
        rate_limit_s=0,
    )

    assert "TMU-1" not in seen  # TMU 從未被抓取
    tmu = seeded["tmu"]
    assert len(await _snapshots(db_session, tmu)) == 0
    assert len(await _revisions(db_session, tmu)) == 0
    assert len(await _failures(db_session, tmu)) == 0

# -*- coding: utf-8 -*-
"""研究資料蒐集 enrich job(進階查詢全抓 + 詳情深抓 + 投標須知歸檔)的離線整合測試。

全程不連網/不下載:monkeypatch ``PCCAdapter.fetch_list_case_pks`` / ``fetch_detail``
回 fixture,並注入假 ``archiver`` + ``session_factory`` + 固定 ``now``。對齊計畫
「Dev(離線)第 4 點」驗收:命中數 > 0、attachments 有抓到、``storage_uri`` 有值、
標注標籤正確、case_pk 去重 + first_seen/last_seen。

鐵則:research enrich 是唯一會 live 連 PCC 的研究元件 → 本檔絕不真正連網/下載。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select

from app.adapters import get_adapter
from app.adapters.base import FetchResult
from app.jobs.research_enrich import run_research_enrich
from app.models.revision import CrawlFailure, CrawlRun, TenderRevision, TenderSnapshot
from app.models.tender import Source, Tender

from tests.conftest import TestSessionLocal

FIX = Path(__file__).parent / "fixtures"

# 固定且 tz-aware 的「現在」(detail_checked_at / first_seen 比較須一致)
NOW = datetime(2026, 6, 18, 9, 0, tzinfo=timezone.utc)

# 兩筆 fixture 的語意:full=廁所改善工程(室內命中 + 1 附件)、
# with_bid_doc=氣候變遷(不命中 + 1 附件)
PK_INTERIOR = "71248861"   # → pcc_detail_full.html
PK_PLAIN = "71252818"      # → pcc_detail_with_bid_doc.html


def _load(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


def _fetch_result(case_pk: str, raw: str, *, status: int = 200,
                  content_type: str | None = "text/html; charset=utf-8") -> FetchResult:
    return FetchResult(
        source_name="PCC",
        source_url=f"https://web.pcc.gov.tw/detail?pkPmsMain={case_pk}",
        status_code=status,
        content_type=content_type,
        raw_content=raw,
        fetched_at=NOW,
        source_revision_key="01",
    )


def _fake_archiver_factory(calls: list | None = None):
    """假 archiver:每個附件回一筆含 storage_uri 的索引(不連網/不落地實檔)。"""
    def fake(source_name, case_pk, attachments, *, base_dir=None):
        if calls is not None:
            calls.append((source_name, case_pk, base_dir))
        return [
            {
                "url": a["url"],
                "filename": a["filename"],
                "storage_uri": f"{source_name}/{case_pk}/{a['filename']}.pdf",
                "sha256": "deadbeef",
                "skipped": False,
                "error": None,
            }
            for a in attachments
        ]
    return fake


def _patch_two_cities(monkeypatch, *, detail_fn) -> None:
    """台北回 [interior, plain],新北回 [plain](測 case_pk 去重、首見縣市為準)。"""
    adapter = get_adapter("PCC")
    taipei = adapter.EXEC_LOCATIONS["台北市"]

    def fake_list(exec_location, start, end):
        if exec_location == taipei:
            return [PK_INTERIOR, PK_PLAIN]
        return [PK_PLAIN]  # 新北:重複的 plain → 應被去重

    monkeypatch.setattr(adapter, "fetch_list_case_pks", fake_list)
    monkeypatch.setattr(adapter, "fetch_detail", detail_fn)


async def _tenders(session) -> list[Tender]:
    res = await session.execute(select(Tender).order_by(Tender.id))
    return list(res.scalars())


async def _revisions(session, tender_id: int) -> list[TenderRevision]:
    res = await session.execute(
        select(TenderRevision)
        .where(TenderRevision.tender_id == tender_id)
        .order_by(TenderRevision.revision_no)
    )
    return list(res.scalars())


# --------------------------------------------------------------------------- #
# 1) 全抓 → 建案 → 詳情 → 歸檔 → 標注:完整快樂路徑
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_full_flow_discover_enrich_archive_annotate(db_session, monkeypatch, tmp_path):
    full = _load("pcc_detail_full.html")
    plain = _load("pcc_detail_with_bid_doc.html")
    arc_calls: list = []

    def detail(case_pk):
        return _fetch_result(case_pk, full if case_pk == PK_INTERIOR else plain)

    _patch_two_cities(monkeypatch, detail_fn=detail)

    stats = await run_research_enrich(
        session_factory=TestSessionLocal,
        now=NOW,
        rate_limit_s=0,
        archive_base_dir=tmp_path,
        archiver=_fake_archiver_factory(arc_calls),
    )

    # 去重:plain 在台北/新北各出現一次 → 僅 2 筆唯一案
    assert stats["discovered"] == 2
    assert stats["fetched"] == 2
    assert stats["new_revisions"] == 2
    assert stats["unchanged"] == 0
    assert stats["failed"] == 0
    assert stats["attachments_archived"] == 2  # 兩案各 1 附件
    assert stats["interior_hits"] == 1          # 僅廁所改善工程命中

    # archiver 確被呼叫(帶 base_dir),且兩案皆呼叫
    assert len(arc_calls) == 2
    assert all(c[2] == tmp_path for c in arc_calls)

    # Source 自動建立
    src = (await db_session.execute(select(Source).where(Source.name == "PCC"))).scalar_one()
    assert src.base_url == "https://web.pcc.gov.tw"

    tenders = await _tenders(db_session)
    assert len(tenders) == 2
    by_pk = {t.case_pk: t for t in tenders}
    assert set(by_pk) == {PK_INTERIOR, PK_PLAIN}

    # plain 首見縣市為台北(去重以首見為準)
    assert by_pk[PK_PLAIN].city == "台北市"
    # first_seen/last_seen = 當日
    for t in tenders:
        assert t.first_seen == NOW.date()
        assert t.last_seen == NOW.date()
        assert t.detail_checked_at == NOW
        assert t.current_revision_id is not None

    # 真實欄位回填(暫定名被覆蓋)
    interior = by_pk[PK_INTERIOR]
    assert interior.name == "115年廁所改善工程"
    assert interior.org == "臺北市立臺北特殊教育學校"
    assert interior.budget_wan == 312          # 3,129,067 元 → 萬元
    assert interior.deadline_roc == "115/07/01"  # 去掉時間段
    assert str(interior.deadline_iso) == "2026-07-01"
    assert interior.category == "工程"
    assert "(待補)" not in interior.name

    # revision:attachments(歸檔索引)+ annotations(標注標籤)
    revs = await _revisions(db_session, interior.id)
    assert len(revs) == 1
    rev = revs[0]
    assert rev.revision_no == 1
    assert rev.attachments and len(rev.attachments) == 1
    assert rev.attachments[0]["storage_uri"].startswith(f"PCC/{PK_INTERIOR}/")
    assert rev.annotations["interior_match"] is True
    assert "廁所" in rev.annotations["interior_keywords"]

    # plain 案標注不命中
    plain_rev = (await _revisions(db_session, by_pk[PK_PLAIN].id))[0]
    assert plain_rev.annotations["interior_match"] is False
    assert plain_rev.attachments and len(plain_rev.attachments) == 1

    # snapshot.storage_uri = 附件歸檔目錄(離庫指標)
    snap = (
        await db_session.execute(
            select(TenderSnapshot).where(TenderSnapshot.tender_id == interior.id)
        )
    ).scalar_one()
    assert snap.storage_uri == f"PCC/{PK_INTERIOR}"

    # crawl_run 收檔 + notes
    run = await db_session.get(CrawlRun, stats["run_id"])
    assert run.status == "completed"
    assert run.finished_at == NOW
    assert run.targeted == 2 and run.new_revisions == 2
    assert run.notes["job"] == "research_enrich"
    assert run.notes["interior_hits"] == 1
    assert run.notes["attachments_archived"] == 2


# --------------------------------------------------------------------------- #
# 2) 同 hash 重跑 → 冪等:無新 revision、unchanged++、last_seen 仍更新
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_rerun_same_content_is_idempotent(db_session, monkeypatch, tmp_path):
    full = _load("pcc_detail_full.html")
    plain = _load("pcc_detail_with_bid_doc.html")

    def detail(case_pk):
        return _fetch_result(case_pk, full if case_pk == PK_INTERIOR else plain)

    _patch_two_cities(monkeypatch, detail_fn=detail)
    common = dict(
        session_factory=TestSessionLocal, rate_limit_s=0,
        archive_base_dir=tmp_path, archiver=_fake_archiver_factory(),
    )

    await run_research_enrich(now=NOW, **common)
    later = NOW + timedelta(hours=2)
    stats2 = await run_research_enrich(now=later, **common)

    assert stats2["discovered"] == 2
    assert stats2["unchanged"] == 2
    assert stats2["new_revisions"] == 0

    tenders = await _tenders(db_session)
    assert len(tenders) == 2  # 未重複建案
    for t in tenders:
        assert len(await _revisions(db_session, t.id)) == 1  # 無新版
        assert t.detail_checked_at == later                  # 已 bump
        assert t.last_seen == later.date()


# --------------------------------------------------------------------------- #
# 3) 抓取失敗(transport raise)→ 記 crawl_failure(fetch)、整批續跑
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_fetch_failure_records_and_continues(db_session, monkeypatch, tmp_path):
    full = _load("pcc_detail_full.html")
    plain = _load("pcc_detail_with_bid_doc.html")

    def detail(case_pk):
        if case_pk == PK_PLAIN:
            raise RuntimeError("connection reset")
        return _fetch_result(case_pk, full)

    _patch_two_cities(monkeypatch, detail_fn=detail)

    stats = await run_research_enrich(
        session_factory=TestSessionLocal, now=NOW, rate_limit_s=0,
        archive_base_dir=tmp_path, archiver=_fake_archiver_factory(),
    )

    assert stats["failed"] == 1
    assert stats["new_revisions"] == 1  # interior 仍成功(整批不中斷)

    by_pk = {t.case_pk: t for t in await _tenders(db_session)}
    # 失敗案仍建了 Tender(discovery 階段)但無 revision
    assert len(await _revisions(db_session, by_pk[PK_PLAIN].id)) == 0
    fails = (
        await db_session.execute(
            select(CrawlFailure).where(CrawlFailure.tender_id == by_pk[PK_PLAIN].id)
        )
    ).scalars().all()
    assert len(fails) == 1
    assert fails[0].stage == "fetch"
    assert fails[0].retriable is True
    # 成功案有 revision
    assert len(await _revisions(db_session, by_pk[PK_INTERIOR].id)) == 1


# --------------------------------------------------------------------------- #
# 4) 解析失敗(無效頁)→ 半套 rollback + crawl_failure(parse),不留 snapshot
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_parse_failure_rolls_back_and_records(db_session, monkeypatch, tmp_path):
    full = _load("pcc_detail_full.html")
    invalid = _load("pcc_detail_invalid.html")  # 通過 fetch 但 parse 回 None

    def detail(case_pk):
        return _fetch_result(case_pk, invalid if case_pk == PK_PLAIN else full)

    _patch_two_cities(monkeypatch, detail_fn=detail)

    stats = await run_research_enrich(
        session_factory=TestSessionLocal, now=NOW, rate_limit_s=0,
        archive_base_dir=tmp_path, archiver=_fake_archiver_factory(),
    )

    assert stats["failed"] == 1
    assert stats["new_revisions"] == 1

    by_pk = {t.case_pk: t for t in await _tenders(db_session)}
    bad = by_pk[PK_PLAIN]
    # 無 snapshot、無 revision、現值未動
    assert len(await _revisions(db_session, bad.id)) == 0
    snaps = (
        await db_session.execute(
            select(TenderSnapshot).where(TenderSnapshot.tender_id == bad.id)
        )
    ).scalars().all()
    assert snaps == []
    assert bad.current_revision_id is None

    fails = (
        await db_session.execute(
            select(CrawlFailure).where(CrawlFailure.tender_id == bad.id)
        )
    ).scalars().all()
    assert len(fails) == 1 and fails[0].stage == "parse"


# --------------------------------------------------------------------------- #
# 5) 撞 PCC 反大量查詢驗證碼 → 記 crawl_failure(captcha, 可重試)+ 優雅中止整批
#    (常駐攔截:繼續連發無用且不禮貌易招 IP 封鎖;剩餘標的 deferred,下輪退避再抓)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_captcha_aborts_batch_and_records_retriable(db_session, monkeypatch, tmp_path):
    captcha = _load("pcc_detail_captcha.html")
    full = _load("pcc_detail_full.html")

    def detail(case_pk):
        # 首個處理的標的(PK_INTERIOR)即撞驗證碼 → 應在 idx=0 優雅中止
        return _fetch_result(case_pk, captcha if case_pk == PK_INTERIOR else full)

    _patch_two_cities(monkeypatch, detail_fn=detail)

    stats = await run_research_enrich(
        session_factory=TestSessionLocal, now=NOW, rate_limit_s=0,
        archive_base_dir=tmp_path, archiver=_fake_archiver_factory(),
    )

    # 去重後 2 筆;首筆撞驗證碼 → captcha 計數、整批中止、剩餘 deferred
    assert stats["discovered"] == 2
    assert stats["captcha"] == 1
    assert stats["failed"] == 1
    assert stats["aborted_on_captcha"] is True
    assert stats["deferred"] == 1
    # 中止 → 第二筆未處理,無新版
    assert stats["new_revisions"] == 0
    assert stats["fetched"] == 0

    by_pk = {t.case_pk: t for t in await _tenders(db_session)}
    # 撞驗證碼的案:無 snapshot/revision,記 captcha 失敗且可重試
    blocked = by_pk[PK_INTERIOR]
    assert len(await _revisions(db_session, blocked.id)) == 0
    snaps = (
        await db_session.execute(
            select(TenderSnapshot).where(TenderSnapshot.tender_id == blocked.id)
        )
    ).scalars().all()
    assert snaps == []
    fails = (
        await db_session.execute(
            select(CrawlFailure).where(CrawlFailure.tender_id == blocked.id)
        )
    ).scalars().all()
    assert len(fails) == 1
    assert fails[0].stage == "captcha"
    assert fails[0].retriable is True

    # 第二筆(deferred)在 discovery 階段已建 Tender,但因中止而未處理 → 無失敗、無版
    deferred = by_pk[PK_PLAIN]
    assert len(await _revisions(db_session, deferred.id)) == 0
    assert (
        await db_session.execute(
            select(CrawlFailure).where(CrawlFailure.tender_id == deferred.id)
        )
    ).scalars().all() == []

    # crawl_run notes 留下可稽核的中止記錄
    run = await db_session.get(CrawlRun, stats["run_id"])
    assert run.notes["captcha"] == 1
    assert run.notes["deferred"] == 1
    assert run.notes["aborted_on_captcha"] is True

# -*- coding: utf-8 -*-
"""詳情 enrich job:把 PCC 招標公告詳情頁抓回並落成不可變 revision(Layer A 衍生)。

revision-first 持久層(對齊修訂計畫 §1/§2):
- 每次「不同內容」的抓取 → 一筆 ``tender_snapshots``(原始稽核 + 去重帳本)。
- 內容新/變更 → 一筆**不可變** ``tender_revisions``(型別欄如實反映來源,**不 coalesce**)。
- ``tenders.current_revision_id`` / ``detail_checked_at`` 為現值投影 + TTL 指標。
- 每次執行記 ``crawl_runs``;抓取/解析失敗記 ``crawl_failures``(支援退避重試)。

**鐵則:本 job 是唯一會 live 連 PCC 的後端元件 → 絕不在 CI/pytest 跑。**
測試一律 monkeypatch ``adapter.fetch_detail`` 回 fixture,注入 ``session_factory`` 與
``now``,不連網、不連 Ollama。

執行(本機手動 / 每日排程):
    uv run python -m app.jobs.enrich_details                 # new ∪ stale(TTL) ∪ retriable
    uv run python -m app.jobs.enrich_details --all           # 所有支援來源標的,不設門檻
    uv run python -m app.jobs.enrich_details --source PCC --limit 50 --ttl-hours 24
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path, PurePosixPath

from sqlalchemy import and_, func, or_, select, update

from app.adapters import get_adapter, iter_adapters
from app.db.session import AsyncSessionLocal
from app.models.revision import CrawlFailure, CrawlRun, TenderRevision, TenderSnapshot
from app.models.tender import Source, Tender
from app.services.archiver import archive_attachments
from app.services.detail_parser import is_captcha_page, parse_pcc_detail

# 抓取失敗的退避基數(每次嘗試線性遞增);content-type/4xx/parse 類視為不可重試。
_RETRY_BACKOFF = timedelta(hours=1)

# 衍生標注標籤的室內/裝修語彙種子(**僅供標注,不過濾**);research_enrich 由此 re-import 共用。
INTERIOR_KEYWORDS: tuple[str, ...] = (
    "裝修", "整修", "修繕", "改善", "裝潢", "汰換", "室內", "教室",
    "廁所", "衛生設備", "空間", "防水", "隔間", "地板", "天花板",
    "油漆", "粉刷", "外牆", "翻新", "更新工程",
)


def derive_annotations(*texts: str | None) -> dict:
    """由標案名稱/分類/說明等文字衍生標注標籤(布林 + 命中詞);**非過濾**。"""
    blob = " ".join(t for t in texts if t)
    hits = [kw for kw in INTERIOR_KEYWORDS if kw in blob]
    return {"interior_match": bool(hits), "interior_keywords": hits}


def _archive_dir(archived: list[dict]) -> str | None:
    """由附件歸檔結果取共同目錄相對路徑(寫入 snapshot.storage_uri 當離庫指標)。"""
    for rec in archived:
        uri = rec.get("storage_uri")
        if uri:
            return str(PurePosixPath(uri).parent)
    return None


def _supported_sources(source: str | None) -> set[str]:
    """支援詳情 enrich 的來源名稱集合(可由 ``source`` 收斂為單一來源)。"""
    names = {a.source_name for a in iter_adapters() if a.supports_detail_enrich}
    if source:
        names &= {source}
    return names


async def _select_targets(
    session,
    *,
    only_missing: bool,
    source: str | None,
    ttl_hours: int,
    now: datetime,
    limit: int | None,
    since: date | None = None,
) -> list[tuple[int, str, str]]:
    """挑出待 enrich 標的,回傳 ``[(tender_id, case_pk, source_name), ...]``(id 序)。

    only_missing(預設):候選 = new ∪ stale(active 且超過 TTL)∪ retriable,
    且僅限支援詳情 enrich 的來源。``--all`` 則取所有支援來源標的,不設門檻。
    以純 row 回傳(非 ORM 實體),避免跨 transaction 邊界的 lazy-load。
    """
    supported = _supported_sources(source)
    if not supported:
        return []

    stmt = (
        select(Tender.id, Tender.case_pk, Source.name)
        .join(Source, Source.id == Tender.source_id)
        .where(Source.name.in_(supported))
        .order_by(Tender.id)
    )

    if only_missing:
        today = now.date()
        cutoff = now - timedelta(hours=ttl_hours)
        active = or_(Tender.deadline_iso.is_(None), Tender.deadline_iso >= today)

        # new:從未 enrich 過(無 revision 且未檢查過)
        is_new = and_(
            Tender.current_revision_id.is_(None),
            Tender.detail_checked_at.is_(None),
        )
        # stale:已有 revision、案件仍有效、且距上次檢查超過 TTL
        is_stale = and_(
            Tender.current_revision_id.is_not(None),
            active,
            Tender.detail_checked_at < cutoff,
        )
        # retriable:有未解決且已到期的失敗帳本
        due_failures = (
            select(CrawlFailure.tender_id)
            .where(
                CrawlFailure.retriable.is_(True),
                CrawlFailure.resolved_at.is_(None),
                or_(
                    CrawlFailure.next_retry_after.is_(None),
                    CrawlFailure.next_retry_after <= now,
                ),
            )
            .scalar_subquery()
        )
        is_retriable = Tender.id.in_(due_failures)

        stmt = stmt.where(or_(is_new, is_stale, is_retriable))

    # 可選日期窗:只收 first_seen >= since 的標的(catch-up / 只補近期報表用)。
    if since is not None:
        stmt = stmt.where(Tender.first_seen >= since)

    if limit is not None:
        stmt = stmt.limit(limit)

    return [(r[0], r[1], r[2]) for r in (await session.execute(stmt)).all()]


async def _record_failure(
    session,
    *,
    run_id: int,
    tender_id: int,
    stage: str,
    http_status: int | None,
    exc: Exception | None,
    retriable: bool,
    now: datetime,
) -> None:
    """寫一筆失敗帳本並 bump detail_checked_at;退避時間依嘗試次數線性遞增。"""
    prior = (
        await session.execute(
            select(func.count())
            .select_from(CrawlFailure)
            .where(CrawlFailure.tender_id == tender_id)
        )
    ).scalar() or 0
    attempt = prior + 1
    next_retry = now + _RETRY_BACKOFF * attempt if retriable else None

    session.add(
        CrawlFailure(
            crawl_run_id=run_id,
            tender_id=tender_id,
            stage=stage,
            http_status=http_status,
            error_class=type(exc).__name__ if exc else None,
            error_detail=(str(exc)[:1000] if exc else None),
            attempt=attempt,
            retriable=retriable,
            next_retry_after=next_retry,
        )
    )
    # 失敗仍視為「已檢查」(避免下一輪因 new 立即重抓;重試走 retriable 退避)
    await session.execute(
        update(Tender).where(Tender.id == tender_id).values(detail_checked_at=now)
    )
    await session.commit()


async def _resolve_failures(session, tender_id: int, now: datetime) -> None:
    """成功後解除該標的所有未解決失敗(設 resolved_at)。"""
    await session.execute(
        update(CrawlFailure)
        .where(CrawlFailure.tender_id == tender_id, CrawlFailure.resolved_at.is_(None))
        .values(resolved_at=now)
    )


async def _process_one(
    session,
    *,
    run_id: int,
    tender_id: int,
    case_pk: str,
    source_name: str,
    now: datetime,
    archive_base_dir: Path | None,
    archiver,
) -> tuple[str, int, bool]:
    """處理單一標的(各自獨立 transaction);回傳 ``(結果碼, 歸檔數, 命中室內標注)``。

    結果碼:``new`` / ``unchanged`` / ``captcha`` / ``fetch_fail`` / ``parse_fail``。
    整批不中斷:一般失敗記帳後續跑;``captcha`` 由呼叫端優雅中止整批(避免被封 IP)。
    """
    adapter = get_adapter(source_name)

    # 1) 抓取(唯一會 live 連 PCC 之處;transport 例外 → fetch 失敗,可重試)
    try:
        fr = adapter.fetch_detail(case_pk)
    except Exception as exc:  # noqa: BLE001 — 整批不中斷,記帳後續跑
        await session.rollback()
        await _record_failure(
            session, run_id=run_id, tender_id=tender_id, stage="fetch",
            http_status=None, exc=exc, retriable=True, now=now,
        )
        return "fetch_fail", 0, False

    # 2) 抓取驗證:非 200 / content-type 非 text/html → fetch 失敗
    if fr.status_code != 200:
        # 5xx 視為暫時性可重試;4xx 視為不可重試
        await _record_failure(
            session, run_id=run_id, tender_id=tender_id, stage="fetch",
            http_status=fr.status_code, exc=None,
            retriable=fr.status_code >= 500, now=now,
        )
        return "fetch_fail", 0, False
    if "text/html" not in (fr.content_type or ""):
        await _record_failure(
            session, run_id=run_id, tender_id=tender_id, stage="fetch",
            http_status=fr.status_code, exc=None, retriable=False, now=now,
        )
        return "fetch_fail", 0, False

    raw = fr.raw_content
    content_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()

    # 3) 去重:同一案同 content_hash 已入庫 → 內容未變(冪等)
    exists = (
        await session.execute(
            select(TenderSnapshot.id).where(
                TenderSnapshot.tender_id == tender_id,
                TenderSnapshot.content_hash == content_hash,
            )
        )
    ).scalar()
    if exists is not None:
        await session.execute(
            update(Tender).where(Tender.id == tender_id).values(detail_checked_at=now)
        )
        await _resolve_failures(session, tender_id, now)
        await session.commit()
        return "unchanged", 0, False

    # 4) CAPTCHA 攔截:200+HTML 但屬反大量查詢圖形驗證碼 → 不破解/不繞過,
    #    歸為「可重試的暫時阻擋」(stage=captcha),由呼叫端優雅中止整批。
    if is_captcha_page(raw):
        await _record_failure(
            session, run_id=run_id, tender_id=tender_id, stage="captcha",
            http_status=fr.status_code, exc=None, retriable=True, now=now,
        )
        return "captcha", 0, False

    # 5) 內容新/變更 → 先解析(失敗則不入 snapshot,等同 rollback;記 parse 失敗)
    parsed = parse_pcc_detail(raw)
    if parsed is None:
        await _record_failure(
            session, run_id=run_id, tender_id=tender_id, stage="parse",
            http_status=fr.status_code, exc=None, retriable=False, now=now,
        )
        return "parse_fail", 0, False

    # 6) 附件歸檔(實檔離庫,DB 僅存索引)+ 衍生室內/裝修標注(供研究標注,非過濾)
    archived = (
        archiver(source_name, case_pk, parsed.attachments, base_dir=archive_base_dir)
        if parsed.attachments
        else []
    )
    archived_ok = sum(1 for r in archived if r.get("storage_uri"))
    name = parsed.raw_fields.get("標案名稱") if parsed.raw_fields else None
    annotations = derive_annotations(
        name, parsed.category_name, parsed.category_raw, parsed.extra_note
    )

    # 7) 單一 transaction:snapshot → revision(不可變)→ 現值投影 → 解除失敗
    revision_key = parsed.source_revision_key or fr.source_revision_key
    snapshot = TenderSnapshot(
        tender_id=tender_id,
        source_url=fr.source_url,
        http_status=fr.status_code,
        content_type=fr.content_type,
        content_hash=content_hash,
        source_revision_key=fr.source_revision_key,
        raw_html=raw,
        storage_uri=_archive_dir(archived),
        fetched_at=fr.fetched_at,
    )
    session.add(snapshot)
    await session.flush()  # 取得 snapshot.id 供 revision 溯源

    next_no = (
        (
            await session.execute(
                select(func.coalesce(func.max(TenderRevision.revision_no), 0)).where(
                    TenderRevision.tender_id == tender_id
                )
            )
        ).scalar()
        + 1
    )
    revision = TenderRevision(
        tender_id=tender_id,
        snapshot_id=snapshot.id,
        revision_no=next_no,
        content_hash=content_hash,
        source_revision_key=revision_key,
        award_method=parsed.award_method,
        deposit_required=parsed.deposit_required,
        deposit_amount_twd=parsed.deposit_amount_twd,
        deposit_raw_text=parsed.deposit_raw_text,
        qualification_codes=parsed.qualification_codes,
        qualification_text=parsed.qualification_text,
        qualification_items=parsed.qualification_items or None,
        category_main=parsed.category_main,
        category_code=parsed.category_code,
        category_name=parsed.category_name,
        category_raw=parsed.category_raw,
        performance_period=parsed.performance_period,
        performance_location=parsed.performance_location,
        subsidy_source=parsed.subsidy_source,
        extra_note=parsed.extra_note,
        raw_fields=parsed.raw_fields,
        attachments=archived or None,
        annotations=annotations,
        fetched_at=fr.fetched_at,
    )
    session.add(revision)
    await session.flush()  # 取得 revision.id 供現值投影

    # 僅更新現值投影 + TTL 標記;**不回填 Tender 主檔欄位**(那是 research enrich 的事)
    await session.execute(
        update(Tender)
        .where(Tender.id == tender_id)
        .values(current_revision_id=revision.id, detail_checked_at=now)
    )
    await _resolve_failures(session, tender_id, now)
    await session.commit()
    return "new", archived_ok, bool(annotations["interior_match"])


async def run_enrich(
    *,
    only_missing: bool = True,
    limit: int | None = None,
    source: str | None = None,
    ttl_hours: int = 24,
    trigger: str = "manual",
    rate_limit_s: float = 1.0,
    since: date | None = None,
    now: datetime | None = None,
    session_factory=None,
    archive_base_dir: Path | None = None,
    archiver=archive_attachments,
) -> dict:
    """執行一次詳情 enrich;回傳統計 dict(含 crawl_run id 與各計數)。

    參數
    ----
    only_missing : 預設 True → 候選 = new ∪ stale ∪ retriable;False(--all)取所有支援來源標的。
    limit / source / ttl_hours : 目標選擇的上限 / 來源收斂 / stale TTL(小時)。
    trigger : 'manual'(預設)或 'daily',寫入 crawl_run。
    rate_limit_s : 每筆抓取間隔秒數(sequential + rate-limit;測試傳 0)。
    now / session_factory : 測試注入點(固定時鐘 / 測試庫 session)。
    archive_base_dir / archiver : 附件歸檔落地根目錄 / 歸檔函式(測試注入假 archiver)。
    """
    now = now or datetime.now(timezone.utc)
    factory = session_factory or AsyncSessionLocal
    stats = {
        "run_id": None,
        "trigger": trigger,
        "targeted": 0,
        "fetched": 0,
        "unchanged": 0,
        "new_revisions": 0,
        "failed": 0,
        "captcha": 0,
        "deferred": 0,
        "attachments_archived": 0,
        "interior_hits": 0,
        "aborted_on_captcha": False,
    }

    async with factory() as session:
        # crawl_run 開檔(running),先 commit 取得穩定 run_id
        run = CrawlRun(trigger=trigger, status="running")
        session.add(run)
        await session.flush()
        run_id = run.id
        await session.commit()
        stats["run_id"] = run_id

        targets = await _select_targets(
            session,
            only_missing=only_missing,
            source=source,
            ttl_hours=ttl_hours,
            now=now,
            limit=limit,
            since=since,
        )
        stats["targeted"] = len(targets)

        for idx, (tid, case_pk, src) in enumerate(targets):
            if idx and rate_limit_s:
                await asyncio.sleep(rate_limit_s)
            try:
                outcome, archived_ok, interior = await _process_one(
                    session,
                    run_id=run_id,
                    tender_id=tid,
                    case_pk=case_pk,
                    source_name=src,
                    now=now,
                    archive_base_dir=archive_base_dir,
                    archiver=archiver,
                )
            except Exception as exc:  # noqa: BLE001 — 殘餘未預期錯誤亦不中斷整批
                await session.rollback()
                await _record_failure(
                    session, run_id=run_id, tender_id=tid, stage="fetch",
                    http_status=None, exc=exc, retriable=True, now=now,
                )
                outcome, archived_ok, interior = "fetch_fail", 0, False

            if outcome == "new":
                stats["fetched"] += 1
                stats["new_revisions"] += 1
                stats["attachments_archived"] += archived_ok
                stats["interior_hits"] += int(interior)
            elif outcome == "unchanged":
                stats["fetched"] += 1
                stats["unchanged"] += 1
            elif outcome == "captcha":
                stats["failed"] += 1
                stats["captcha"] += 1
            else:  # fetch_fail / parse_fail
                stats["failed"] += 1
            print(
                f"  [{idx + 1}/{stats['targeted']}] {src}/{case_pk} → {outcome}",
                file=sys.stderr,
            )

            # 撞驗證碼:不破解/不繞過,優雅中止整批,剩餘標的標為 deferred(下輪退避重試)
            if outcome == "captcha":
                stats["aborted_on_captcha"] = True
                stats["deferred"] = stats["targeted"] - (idx + 1)
                print(
                    f"  ⚠ 撞 CAPTCHA,中止整批;剩餘 {stats['deferred']} 筆 deferred",
                    file=sys.stderr,
                )
                break

        # crawl_run 收檔
        run = await session.get(CrawlRun, run_id)
        run.targeted = stats["targeted"]
        run.fetched = stats["fetched"]
        run.unchanged = stats["unchanged"]
        run.new_revisions = stats["new_revisions"]
        run.failed = stats["failed"]
        run.finished_at = now
        run.status = "completed"
        run.notes = {
            "captcha": stats["captcha"],
            "deferred": stats["deferred"],
            "attachments_archived": stats["attachments_archived"],
            "interior_hits": stats["interior_hits"],
            "aborted_on_captcha": stats["aborted_on_captcha"],
        }
        await session.commit()

    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description="PCC 詳情 enrich(revision-first;勿在 CI 跑)")
    ap.add_argument(
        "--all", action="store_true",
        help="所有支援來源標的全跑(預設只 new ∪ stale ∪ retriable)",
    )
    ap.add_argument("--limit", type=int, default=None, help="目標上限")
    ap.add_argument("--source", default=None, help="收斂單一來源(如 PCC)")
    ap.add_argument("--ttl-hours", type=int, default=24, help="stale TTL 小時(預設 24)")
    ap.add_argument(
        "--trigger", default="manual", choices=["manual", "daily"],
        help="執行觸發來源(寫入 crawl_run)",
    )
    ap.add_argument(
        "--rate-limit", type=float, default=1.0, help="每筆抓取間隔秒數(預設 1.0)",
    )
    ap.add_argument(
        "--since", default=None,
        help="只 enrich first_seen >= 此日期(YYYY-MM-DD;catch-up / 只補近期報表用)",
    )
    args = ap.parse_args()

    since = date.fromisoformat(args.since) if args.since else None
    stats = asyncio.run(
        run_enrich(
            only_missing=not args.all,
            limit=args.limit,
            source=args.source,
            ttl_hours=args.ttl_hours,
            trigger=args.trigger,
            rate_limit_s=args.rate_limit,
            since=since,
        )
    )
    print(
        f"enrich 完成(run #{stats['run_id']}）｜目標 {stats['targeted']}"
        f"｜新版 {stats['new_revisions']}｜未變 {stats['unchanged']}"
        f"｜附件 {stats['attachments_archived']}｜室內命中 {stats['interior_hits']}"
        f"｜失敗 {stats['failed']}（含 CAPTCHA {stats['captcha']}）"
    )
    if stats["aborted_on_captcha"]:
        print(f"⚠ 撞 CAPTCHA 已中止;{stats['deferred']} 筆 deferred 留待下輪退避重試")


if __name__ == "__main__":
    main()

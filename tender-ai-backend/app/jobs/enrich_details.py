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
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, func, or_, select, update

from app.adapters import get_adapter, iter_adapters
from app.db.session import AsyncSessionLocal
from app.models.revision import CrawlFailure, CrawlRun, TenderRevision, TenderSnapshot
from app.models.tender import Source, Tender
from app.services.detail_parser import parse_pcc_detail

# 抓取失敗的退避基數(每次嘗試線性遞增);content-type/4xx/parse 類視為不可重試。
_RETRY_BACKOFF = timedelta(hours=1)


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
) -> str:
    """處理單一標的(各自獨立 transaction);回傳結果碼供統計。

    結果碼:``new`` / ``unchanged`` / ``fetch_fail`` / ``parse_fail``。
    整批不中斷:任何失敗都記帳並 continue(由呼叫端 catch 殘餘例外)。
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
        return "fetch_fail"

    # 2) 抓取驗證:非 200 / content-type 非 text/html → fetch 失敗
    if fr.status_code != 200:
        # 5xx 視為暫時性可重試;4xx 視為不可重試
        await _record_failure(
            session, run_id=run_id, tender_id=tender_id, stage="fetch",
            http_status=fr.status_code, exc=None,
            retriable=fr.status_code >= 500, now=now,
        )
        return "fetch_fail"
    if "text/html" not in (fr.content_type or ""):
        await _record_failure(
            session, run_id=run_id, tender_id=tender_id, stage="fetch",
            http_status=fr.status_code, exc=None, retriable=False, now=now,
        )
        return "fetch_fail"

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
        return "unchanged"

    # 4) 內容新/變更 → 先解析(失敗則不入 snapshot,等同 rollback;記 parse 失敗)
    parsed = parse_pcc_detail(raw)
    if parsed is None:
        await _record_failure(
            session, run_id=run_id, tender_id=tender_id, stage="parse",
            http_status=fr.status_code, exc=None, retriable=False, now=now,
        )
        return "parse_fail"

    # 5) 單一 transaction:snapshot → revision(不可變)→ 現值投影 → 解除失敗
    revision_key = parsed.source_revision_key or fr.source_revision_key
    snapshot = TenderSnapshot(
        tender_id=tender_id,
        source_url=fr.source_url,
        http_status=fr.status_code,
        content_type=fr.content_type,
        content_hash=content_hash,
        source_revision_key=fr.source_revision_key,
        raw_html=raw,
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
        category_main=parsed.category_main,
        category_code=parsed.category_code,
        category_name=parsed.category_name,
        category_raw=parsed.category_raw,
        performance_period=parsed.performance_period,
        performance_location=parsed.performance_location,
        subsidy_source=parsed.subsidy_source,
        extra_note=parsed.extra_note,
        raw_fields=parsed.raw_fields,
        fetched_at=fr.fetched_at,
    )
    session.add(revision)
    await session.flush()  # 取得 revision.id 供現值投影

    await session.execute(
        update(Tender)
        .where(Tender.id == tender_id)
        .values(current_revision_id=revision.id, detail_checked_at=now)
    )
    await _resolve_failures(session, tender_id, now)
    await session.commit()
    return "new"


async def run_enrich(
    *,
    only_missing: bool = True,
    limit: int | None = None,
    source: str | None = None,
    ttl_hours: int = 24,
    trigger: str = "manual",
    rate_limit_s: float = 1.0,
    now: datetime | None = None,
    session_factory=None,
) -> dict:
    """執行一次詳情 enrich;回傳統計 dict(含 crawl_run id 與各計數)。

    參數
    ----
    only_missing : 預設 True → 候選 = new ∪ stale ∪ retriable;False(--all)取所有支援來源標的。
    limit / source / ttl_hours : 目標選擇的上限 / 來源收斂 / stale TTL(小時)。
    trigger : 'manual'(預設)或 'daily',寫入 crawl_run。
    rate_limit_s : 每筆抓取間隔秒數(sequential + rate-limit;測試傳 0)。
    now / session_factory : 測試注入點(固定時鐘 / 測試庫 session)。
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
        )
        stats["targeted"] = len(targets)

        for idx, (tid, case_pk, src) in enumerate(targets):
            if idx and rate_limit_s:
                await asyncio.sleep(rate_limit_s)
            try:
                outcome = await _process_one(
                    session,
                    run_id=run_id,
                    tender_id=tid,
                    case_pk=case_pk,
                    source_name=src,
                    now=now,
                )
            except Exception as exc:  # noqa: BLE001 — 殘餘未預期錯誤亦不中斷整批
                await session.rollback()
                await _record_failure(
                    session, run_id=run_id, tender_id=tid, stage="fetch",
                    http_status=None, exc=exc, retriable=True, now=now,
                )
                outcome = "fetch_fail"

            if outcome == "new":
                stats["fetched"] += 1
                stats["new_revisions"] += 1
            elif outcome == "unchanged":
                stats["fetched"] += 1
                stats["unchanged"] += 1
            else:  # fetch_fail / parse_fail
                stats["failed"] += 1
            print(
                f"  [{idx + 1}/{stats['targeted']}] {src}/{case_pk} → {outcome}",
                file=sys.stderr,
            )

        # crawl_run 收檔
        run = await session.get(CrawlRun, run_id)
        run.targeted = stats["targeted"]
        run.fetched = stats["fetched"]
        run.unchanged = stats["unchanged"]
        run.new_revisions = stats["new_revisions"]
        run.failed = stats["failed"]
        run.finished_at = now
        run.status = "completed"
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
    args = ap.parse_args()

    stats = asyncio.run(
        run_enrich(
            only_missing=not args.all,
            limit=args.limit,
            source=args.source,
            ttl_hours=args.ttl_hours,
            trigger=args.trigger,
            rate_limit_s=args.rate_limit,
        )
    )
    print(
        f"enrich 完成(run #{stats['run_id']}）｜目標 {stats['targeted']}"
        f"｜新版 {stats['new_revisions']}｜未變 {stats['unchanged']}"
        f"｜失敗 {stats['failed']}"
    )


if __name__ == "__main__":
    main()

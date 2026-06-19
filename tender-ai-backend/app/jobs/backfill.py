# -*- coding: utf-8 -*-
"""歷史回填：解析既有 HTML 報表 → 寫入 Layer A（tenders / daily_runs / daily_tender）。

特性：
- 完全 offline，只讀既有報表檔，不連任何外部站台（CI/sandbox 安全）。
- 冪等（idempotent）：以 UNIQUE(source_id, case_pk) 去重 upsert；可重複執行而結果穩定
  （first_seen 取最早、last_seen 取最晚）。
- 不重寫既有爬蟲核心，僅「讀回其歷史產出」。

執行：
    uv run python -m app.jobs.backfill [reports_dir]
    （reports_dir 預設 ../tender-reports/reports，相對於後端目錄）
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from datetime import date
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.adapters import source_seeds
from app.db.session import AsyncSessionLocal
from app.models.tender import DailyRun, DailyTender, Source, Tender
from app.services.report_parser import ParsedTender, aggregate, parse_report

_NAME_RE = re.compile(r"tender-(\d{4})(\d{2})(\d{2})\.html$")


def date_from_filename(name: str) -> date | None:
    m = _NAME_RE.search(name)
    if not m:
        return None
    return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))


def _dedupe(tenders: list[ParsedTender]) -> list[ParsedTender]:
    """報表內以 case_pk 去重（保留首見），並濾掉缺 name/pk 的列。"""
    seen: dict[str, ParsedTender] = {}
    for t in tenders:
        if t.name and t.case_pk:
            seen.setdefault(t.case_pk, t)
    return list(seen.values())


async def ensure_sources(session) -> dict[str, int]:
    existing = {s.name: s for s in (await session.execute(select(Source))).scalars()}
    for name, url in source_seeds().items():
        if name not in existing:
            session.add(Source(name=name, base_url=url))
    await session.flush()
    return {s.name: s.id for s in (await session.execute(select(Source))).scalars()}


async def _upsert_tenders(session, source_id: int, rows: list[ParsedTender], run_date: date) -> None:
    values = [
        dict(
            source_id=source_id, case_pk=t.case_pk, name=t.name, org=t.org,
            category=t.category, budget_wan=t.budget_wan, deadline_roc=t.deadline_roc,
            deadline_iso=t.deadline_iso, tender_method=t.tender_method, city=t.city,
            link=t.link, first_seen=run_date, last_seen=run_date,
        )
        for t in rows
    ]
    stmt = pg_insert(Tender).values(values)
    # 衝突即更新：可變欄位以「最新非空」覆寫，first/last_seen 取極值（順序無關、冪等）。
    stmt = stmt.on_conflict_do_update(
        constraint="uq_tender_source_case",
        set_={
            "name": stmt.excluded.name,
            "org": func.coalesce(stmt.excluded.org, Tender.org),
            "category": func.coalesce(stmt.excluded.category, Tender.category),
            "budget_wan": func.coalesce(stmt.excluded.budget_wan, Tender.budget_wan),
            "deadline_roc": func.coalesce(stmt.excluded.deadline_roc, Tender.deadline_roc),
            "deadline_iso": func.coalesce(stmt.excluded.deadline_iso, Tender.deadline_iso),
            "tender_method": func.coalesce(stmt.excluded.tender_method, Tender.tender_method),
            "city": func.coalesce(stmt.excluded.city, Tender.city),
            "link": func.coalesce(stmt.excluded.link, Tender.link),
            "first_seen": func.least(Tender.first_seen, stmt.excluded.first_seen),
            "last_seen": func.greatest(Tender.last_seen, stmt.excluded.last_seen),
        },
    )
    await session.execute(stmt)


async def _ids_by_pk(session, source_id: int, case_pks: list[str]) -> dict[str, int]:
    res = await session.execute(
        select(Tender.id, Tender.case_pk).where(
            Tender.source_id == source_id, Tender.case_pk.in_(case_pks)
        )
    )
    return {pk: tid for tid, pk in res.all()}


async def _upsert_daily_tender(session, run_date: date, dt_rows: list[dict]) -> None:
    if not dt_rows:
        return
    stmt = pg_insert(DailyTender).values(dt_rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["run_date", "tender_id"],
        set_={"tier": stmt.excluded.tier, "days_left": stmt.excluded.days_left},
    )
    await session.execute(stmt)


async def _upsert_daily_run(session, run_date: date, source_id: int, rows: list[ParsedTender], report_file: str) -> None:
    agg = aggregate(rows)
    summary = f"{agg['total']} 筆（高 {agg['high']}／中 {agg['mid']}／低 {agg['low']}；7天內 {agg['urgent']}）"
    stmt = pg_insert(DailyRun).values(
        run_date=run_date, source_id=source_id, summary=summary,
        report_file=report_file, **agg,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["run_date", "source_id"],
        set_={
            "total": stmt.excluded.total, "high": stmt.excluded.high,
            "mid": stmt.excluded.mid, "low": stmt.excluded.low,
            "urgent": stmt.excluded.urgent, "priority": stmt.excluded.priority,
            "budget_sum_wan": stmt.excluded.budget_sum_wan,
            "summary": stmt.excluded.summary, "report_file": stmt.excluded.report_file,
        },
    )
    await session.execute(stmt)


async def run_backfill(reports_dir: Path) -> dict:
    files = sorted(reports_dir.glob("tender-*.html"))
    if not files:
        raise SystemExit(f"找不到報表：{reports_dir}/tender-*.html")

    stats = {"reports": 0, "skipped": [], "daily_tender_rows": 0,
             "by_source": {"PCC": 0, "TMU": 0}}

    async with AsyncSessionLocal() as session:
        src = await ensure_sources(session)
        await session.commit()

        for f in files:
            run_date = date_from_filename(f.name)
            if run_date is None:
                stats["skipped"].append(f.name)
                continue
            report = parse_report(f.read_text(encoding="utf-8"))

            for sname, source_rows in (("PCC", report.pcc), ("TMU", report.tmu)):
                rows = _dedupe(source_rows)
                if not rows:
                    continue
                source_id = src[sname]
                await _upsert_tenders(session, source_id, rows, run_date)
                await session.flush()
                id_by_pk = await _ids_by_pk(session, source_id, [t.case_pk for t in rows])
                dt_rows = [
                    dict(run_date=run_date, tender_id=id_by_pk[t.case_pk],
                         tier=t.tier, days_left=t.days_left)
                    for t in rows if t.case_pk in id_by_pk
                ]
                await _upsert_daily_tender(session, run_date, dt_rows)
                await _upsert_daily_run(session, run_date, source_id, rows, f.name)
                stats["daily_tender_rows"] += len(dt_rows)
                stats["by_source"][sname] += len(rows)

            await session.commit()
            stats["reports"] += 1

        # 收尾統計（去重後的母體大小）
        distinct = dict(
            (await session.execute(
                select(Source.name, func.count(Tender.id))
                .join(Tender, Tender.source_id == Source.id)
                .group_by(Source.name)
            )).all()
        )
        stats["distinct_tenders"] = distinct
        stats["distinct_total"] = sum(distinct.values())

    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description="回填歷史報表至 Layer A")
    ap.add_argument(
        "reports_dir", nargs="?", default="../tender-reports/reports",
        help="報表目錄（含 tender-YYYYMMDD.html），預設 ../tender-reports/reports",
    )
    ap.add_argument("--json", dest="json_out", default="backfill_report.json",
                    help="輸出統計 JSON 路徑（預設 backfill_report.json，已 gitignore）")
    args = ap.parse_args()

    reports_dir = Path(args.reports_dir).resolve()
    stats = asyncio.run(run_backfill(reports_dir))

    Path(args.json_out).write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("回填完成：", json.dumps(stats, ensure_ascii=False), file=sys.stderr)
    print(
        f"  報表 {stats['reports']} 份｜每日快照列 {stats['daily_tender_rows']}"
        f"｜去重後標案 {stats['distinct_total']}（{stats['distinct_tenders']}）"
    )


if __name__ == "__main__":
    main()

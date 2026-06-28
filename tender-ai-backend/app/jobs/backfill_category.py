# -*- coding: utf-8 -*-
"""把已抓進 revision 的標的分類投影回 ``tenders.category``（補 P4 學習的 NULL 天花板）。

為何需要本 job
--------------
`enrich_details` 對既有 Tender 列做 TTL 補抓時，**刻意不回填 Tender 主檔**——詳情僅落成
不可變 revision（見 `enrich_details._process_one` 的「不回填 Tender 主檔欄位」）。因此由它
補抓過的舊案，``tenders.category`` 仍為 NULL，即使其 revision 早已存有 ``category_main``。
這正是 P4 學習的天花板（大量 category NULL）。本 job 純讀既有 revision、把 ``category_main``
正規化後投影回 ``tenders.category``。

特性
----
- **完全 offline**：只讀既有 DB 的 revision，不連任何外部站台（CI/sandbox 安全）。
- **冪等**：只補 ``category IS NULL`` 的列，**永不覆蓋既有值**；重跑結果穩定。
- **取現值版本優先**：以 ``current_revision_id`` 指向版本的 ``category_main`` 為憑；該版本
  無分類時，退回該案「最新（revision_no 最大）且有分類」的版本。
- 不重寫已測 scraper / 解析器，僅投影其既有產出。

執行：
    uv run python -m app.jobs.backfill_category [--limit N] [--source PCC]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys

from sqlalchemy import desc, func, select, update

from app.db.session import AsyncSessionLocal
from app.models.revision import TenderRevision
from app.models.tender import Source, Tender


def normalize_category(category_main: str | None) -> str | None:
    """詳情的標的分類主名 → Tender.category 正規化值（去「類」、上限 8 字）。

    與 ``research_enrich`` 回填時的轉換一致，作為單一事實來源（「工程類」→「工程」）。
    """
    return (category_main or "").replace("類", "")[:8] or None


async def _pick_category_main(session, tender: Tender) -> str | None:
    """選出該案用來回填的 ``category_main``：現值版本優先，否則退回最新有分類的版本。"""
    if tender.current_revision_id is not None:
        cur = await session.scalar(
            select(TenderRevision.category_main).where(
                TenderRevision.id == tender.current_revision_id
            )
        )
        if cur:
            return cur
    # 退回：該案最新（revision_no 最大）且 category_main 非空的版本
    return await session.scalar(
        select(TenderRevision.category_main)
        .where(
            TenderRevision.tender_id == tender.id,
            TenderRevision.category_main.is_not(None),
        )
        .order_by(desc(TenderRevision.revision_no))
        .limit(1)
    )


async def run_backfill_category(
    *,
    limit: int | None = None,
    source: str | None = None,
    session_factory=None,
) -> dict:
    """把既有 revision 的標的分類投影回 ``tenders.category``（僅補 NULL）。

    參數
    ----
    limit : 處理列數上限（None＝全部）。
    source : 來源名稱收斂（如 "PCC"）；None＝不限。
    session_factory : 測試注入點（測試庫 session）。

    回傳統計 dict：``candidates``（category NULL 的母體）、``updated``（實際回填數）、
    ``no_category``（有候選但 revision 無分類而略過）。
    """
    factory = session_factory or AsyncSessionLocal
    stats = {"candidates": 0, "updated": 0, "no_category": 0}

    async with factory() as session:
        stmt = select(Tender).where(Tender.category.is_(None))
        if source is not None:
            stmt = stmt.join(Source, Source.id == Tender.source_id).where(
                Source.name == source
            )
        stmt = stmt.order_by(Tender.id)
        if limit is not None:
            stmt = stmt.limit(limit)

        tenders = (await session.execute(stmt)).scalars().all()
        stats["candidates"] = len(tenders)

        for t in tenders:
            category = normalize_category(await _pick_category_main(session, t))
            if category is None:
                stats["no_category"] += 1
                continue
            await session.execute(
                update(Tender).where(Tender.id == t.id).values(category=category)
            )
            stats["updated"] += 1

        await session.commit()

        # 收尾：回填後仍為 NULL 的母體大小（供觀察學習天花板收斂）
        stats["still_null"] = await session.scalar(
            select(func.count()).select_from(Tender).where(Tender.category.is_(None))
        )

    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description="把既有 revision 的標的分類回填至 tenders.category")
    ap.add_argument("--limit", type=int, default=None, help="處理列數上限（預設全部）")
    ap.add_argument("--source", default=None, help="來源收斂（如 PCC），預設不限")
    ap.add_argument("--json", dest="json_out", default="backfill_category_report.json",
                    help="輸出統計 JSON 路徑（已 gitignore）")
    args = ap.parse_args()

    stats = asyncio.run(run_backfill_category(limit=args.limit, source=args.source))

    from pathlib import Path
    Path(args.json_out).write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"分類回填完成：候選 {stats['candidates']}｜回填 {stats['updated']}"
        f"｜無分類略過 {stats['no_category']}｜仍 NULL {stats.get('still_null')}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()

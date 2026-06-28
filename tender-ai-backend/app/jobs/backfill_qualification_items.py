# -*- coding: utf-8 -*-
"""把既有 revision 的 ``qualification_text`` 結構化回填至 ``qualification_items``。

為何需要本 job
--------------
``qualification_items`` 是後加欄位（見 migration d8f1a3c6e904）。在它之前抓進的
revision，``qualification_text`` 有值但 ``qualification_items`` 為 NULL。本 job 純讀既有
``qualification_text``、以 ``detail_parser.structure_text`` 切成通用「屬性/標籤/內文/參數」
條目後寫回，供前端表格呈現與後續向量化。

關於 revision 不可變
--------------------
``TenderRevision`` 原則上不可變（更正走新版本）。但 ``qualification_items`` 是**可由原始
``qualification_text`` 重算的衍生投影**（同 ``backfill_category`` 把既有產出投影回主檔的精神），
回填不改變任何來源事實，故就地補 NULL 是可接受的。

特性
----
- **完全 offline**：只讀既有 DB 的 revision，不連任何外部站台（CI/sandbox 安全）。
- **冪等**：只補 ``qualification_items IS NULL`` 且 ``qualification_text IS NOT NULL`` 的列，
  **永不覆蓋既有值**；``structure_text`` 為純函式，重跑結果穩定。
- 不重寫已測 scraper / 解析器，僅投影其既有產出。

執行：
    uv run python -m app.jobs.backfill_qualification_items [--limit N]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys

from sqlalchemy import select, update

from app.db.session import AsyncSessionLocal
from app.models.revision import TenderRevision
from app.services.detail_parser import structure_text


async def run_backfill_qualification_items(
    *,
    limit: int | None = None,
    session_factory=None,
) -> dict:
    """把既有 revision 的 ``qualification_text`` 結構化投影回 ``qualification_items``（僅補 NULL）。

    參數
    ----
    limit : 處理列數上限（None＝全部）。
    session_factory : 測試注入點（測試庫 session）。

    回傳統計 dict：``candidates``（text 有值、items 尚未填的母體）、``updated``（實際回填數）、
    ``empty``（有 text 但結構化後 0 條目而略過）、``still_null``（回填後仍未填者）。

    註：SQL 僅以 ``qualification_text IS NOT NULL`` 收斂；「items 是否已填」改在 Python 判斷，
    避免 JSONB 欄位存 Python None 時落成 JSONB ``'null'``（非 SQL NULL）導致 ``IS NULL`` 漏判。
    """
    factory = session_factory or AsyncSessionLocal
    stats = {"candidates": 0, "updated": 0, "empty": 0}

    def _needs_fill(rev: TenderRevision) -> bool:
        # 已是非空 list＝已填；None 或 JSONB 'null'（→ None）或空 list 皆視為待填。
        return not (isinstance(rev.qualification_items, list) and rev.qualification_items)

    async with factory() as session:
        stmt = (
            select(TenderRevision)
            .where(TenderRevision.qualification_text.is_not(None))
            .order_by(TenderRevision.id)
        )
        if limit is not None:
            stmt = stmt.limit(limit)

        revisions = [r for r in (await session.execute(stmt)).scalars().all() if _needs_fill(r)]
        stats["candidates"] = len(revisions)

        for rev in revisions:
            items = [it.to_dict() for it in structure_text(rev.qualification_text)]
            if not items:
                stats["empty"] += 1
                continue
            await session.execute(
                update(TenderRevision)
                .where(TenderRevision.id == rev.id)
                .values(qualification_items=items)
            )
            stats["updated"] += 1

        await session.commit()

        # 收尾：回填後仍未填（text 有值但 items 仍空）的母體大小
        remaining = (
            await session.execute(
                select(TenderRevision).where(TenderRevision.qualification_text.is_not(None))
            )
        ).scalars().all()
        stats["still_null"] = sum(1 for r in remaining if _needs_fill(r))

    return stats


def main() -> None:
    ap = argparse.ArgumentParser(
        description="把既有 revision 的資格摘要結構化回填至 qualification_items"
    )
    ap.add_argument("--limit", type=int, default=None, help="處理列數上限（預設全部）")
    ap.add_argument(
        "--json",
        dest="json_out",
        default="backfill_qualification_items_report.json",
        help="輸出統計 JSON 路徑（已 gitignore）",
    )
    args = ap.parse_args()

    stats = asyncio.run(run_backfill_qualification_items(limit=args.limit))

    from pathlib import Path

    Path(args.json_out).write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"資格結構化回填完成：候選 {stats['candidates']}｜回填 {stats['updated']}"
        f"｜空略過 {stats['empty']}｜仍 NULL {stats.get('still_null')}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()

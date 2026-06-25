# -*- coding: utf-8 -*-
"""把團隊線可行性分數物化回 ``tenders.feasibility_team``（潛力分級的分帶來源）。

為何需要本 job
--------------
潛力分級（高/中/低）不再憑報表 tier，而是由「團隊線可行性分數」分帶而來。該分數
等同 ``reasoning.explain_tender`` 的 ``criteria_fit``，但走**團隊線 profile**
（``user_id=None``）、**無個人手動迴避詞**（貫徹「負分人工專屬」團隊紅線）。
逐筆即時算太貴且難在 SQL 內分帶，故由本 job 離線物化進 ``tenders.feasibility_team``，
查詢端只讀該欄分帶（見 ``app/services/query.py``）。

特性
----
- **完全 offline**：只讀既有 DB（profile/關鍵字權重/標案欄位），不連任何外部站台、
  不呼叫 Ollama（CI/sandbox 安全）。
- **冪等＋最小寫入**：分數由既有資料決定性算出；只在「算出值與現存值不同」時才 UPDATE，
  重跑結果穩定、無謂寫入為零。
- **與單筆推理同源**：profile / positive_kws / learned_negatives 的取法與
  ``explain_tender`` 一致，確保物化值＝該案以團隊線解讀的 criteria_fit。
- **不產生負分關鍵字**：本 job 只讀權重算分數、寫一個整數欄，與「負分人工專屬」無涉。

執行：
    uv run python -m app.jobs.score_team_feasibility [--limit N] [--source PCC]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys

from sqlalchemy import func, select, update

from app.db.session import AsyncSessionLocal
from app.models.knowledge import KeywordWeight
from app.models.tender import Source, Tender
from app.services.reasoning import build_criteria_profile, compute_team_fit


async def _load_team_inputs(session):
    """一次載入物化所需的團隊線輸入：profile、正向學習詞、即時派生的團隊負權。

    取法刻意對齊 ``explain_tender``（user_id=None）以保證物化值＝團隊線 criteria_fit：
    - ``profile``：團隊線承標判準（base_rate / 類別 / 城市 / 預算 / 關鍵字偏好）。
    - ``positive_kws``：所有非負極性權重（正向可由資料自動學）。
    - ``learned_negatives``：即時判斷學習派生、**帶標記**（notes 非空）的團隊負權；
      遺留的「自動」負向（notes 為 NULL）仍被忽略，維持紅線與向後相容。
    """
    profile = await build_criteria_profile(session, user_id=None)
    positive_kws = list(
        (
            await session.execute(
                select(KeywordWeight).where(KeywordWeight.polarity != "negative")
            )
        ).scalars()
    )
    learned_negatives = list(
        (
            await session.execute(
                select(KeywordWeight).where(
                    KeywordWeight.polarity == "negative",
                    KeywordWeight.notes.is_not(None),
                )
            )
        ).scalars()
    )
    return profile, positive_kws, learned_negatives


async def run_score_team_feasibility(
    *,
    limit: int | None = None,
    source: str | None = None,
    session_factory=None,
) -> dict:
    """物化團隊線可行性分數至 ``tenders.feasibility_team``。

    參數
    ----
    limit : 處理列數上限（None＝全部）。
    source : 來源名稱收斂（如 "PCC"）；None＝不限。
    session_factory : 測試注入點（測試庫 session）。

    回傳統計 dict：``candidates``（母體）、``updated``（分數有變而寫入）、
    ``unchanged``（算出值與現存值相同而略過）、``scored``（成功算出分數的列）。
    """
    factory = session_factory or AsyncSessionLocal
    stats = {"candidates": 0, "updated": 0, "unchanged": 0, "scored": 0}

    async with factory() as session:
        profile, positive_kws, learned_negatives = await _load_team_inputs(session)

        stmt = select(Tender)
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
            score = compute_team_fit(t, profile, positive_kws, learned_negatives)
            stats["scored"] += 1
            if t.feasibility_team == score:
                stats["unchanged"] += 1
                continue
            await session.execute(
                update(Tender)
                .where(Tender.id == t.id)
                .values(feasibility_team=score)
            )
            stats["updated"] += 1

        await session.commit()

        # 收尾：物化後仍為 NULL 的母體（供觀察分帶覆蓋率；NULL 由查詢端回退報表分級）
        stats["still_null"] = await session.scalar(
            select(func.count())
            .select_from(Tender)
            .where(Tender.feasibility_team.is_(None))
        )

    return stats


def main() -> None:
    ap = argparse.ArgumentParser(
        description="物化團隊線可行性分數至 tenders.feasibility_team"
    )
    ap.add_argument("--limit", type=int, default=None, help="處理列數上限（預設全部）")
    ap.add_argument("--source", default=None, help="來源收斂（如 PCC），預設不限")
    ap.add_argument(
        "--json",
        dest="json_out",
        default="score_team_feasibility_report.json",
        help="輸出統計 JSON 路徑（已 gitignore）",
    )
    args = ap.parse_args()

    stats = asyncio.run(
        run_score_team_feasibility(limit=args.limit, source=args.source)
    )

    from pathlib import Path

    Path(args.json_out).write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"可行性物化完成：母體 {stats['candidates']}｜寫入 {stats['updated']}"
        f"｜未變 {stats['unchanged']}｜仍 NULL {stats.get('still_null')}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()

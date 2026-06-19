# -*- coding: utf-8 -*-
"""嵌入回填：為 Layer A 標案產生語意向量 → 寫入 Layer C（tender_vectors）。

- 來源僅標案公開欄位（name + org + category），不含人名／email（隱私鐵則）。
- 預設只補「缺向量」或「向量模型過期（換 EMBED_MODEL）」者；--all 強制全部重嵌。
- 冪等：以 tender_id 為主鍵 upsert；可重複執行而結果穩定。
- 需本機 Ollama 在線且已 pull EMBED_MODEL；CI／測試不跑此 job（改 mock embedding）。

執行：
    uv run python -m app.jobs.embed_tenders            # 只補缺漏／模型過期
    uv run python -m app.jobs.embed_tenders --all      # 全部重嵌
    uv run python -m app.jobs.embed_tenders --batch 128
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.knowledge import TenderVector
from app.models.tender import Tender
from app.services.embedding import embed_texts, tender_text


async def _targets(session, model: str, only_missing: bool) -> list[Tender]:
    """挑出待嵌入標案；only_missing 時排除『已有當前模型向量』者。"""
    stmt = select(Tender).order_by(Tender.id)
    if only_missing:
        done = select(TenderVector.tender_id).where(TenderVector.model == model)
        stmt = stmt.where(Tender.id.not_in(done))
    return list((await session.execute(stmt)).scalars())


async def _upsert_vectors(session, rows: list[dict]) -> None:
    if not rows:
        return
    stmt = pg_insert(TenderVector).values(rows)
    # 衝突即覆寫（重嵌）：向量／模型／原文更新，updated_at 重新蓋時間。
    stmt = stmt.on_conflict_do_update(
        index_elements=["tender_id"],
        set_={
            "embedding": stmt.excluded.embedding,
            "model": stmt.excluded.model,
            "content": stmt.excluded.content,
            "updated_at": func.now(),
        },
    )
    await session.execute(stmt)


async def run_embed(*, only_missing: bool = True, batch_size: int = 64) -> dict:
    model = settings.embed_model
    stats = {"model": model, "candidates": 0, "embedded": 0, "batches": 0}

    async with AsyncSessionLocal() as session:
        targets = await _targets(session, model, only_missing)
        stats["candidates"] = len(targets)

        for i in range(0, len(targets), batch_size):
            chunk = targets[i : i + batch_size]
            contents = [tender_text(t.name, t.org, t.category) for t in chunk]
            vectors = await embed_texts(contents, model=model)
            rows = [
                dict(tender_id=t.id, embedding=v, model=model, content=c)
                for t, v, c in zip(chunk, vectors, contents)
            ]
            await _upsert_vectors(session, rows)
            await session.commit()
            stats["embedded"] += len(rows)
            stats["batches"] += 1
            print(
                f"  批次 {stats['batches']}：+{len(rows)}"
                f"（累計 {stats['embedded']}/{stats['candidates']}）",
                file=sys.stderr,
            )

    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description="為標案產生語意向量（Layer C）")
    ap.add_argument(
        "--all", action="store_true",
        help="強制重嵌全部標案（預設只補缺漏／模型過期）",
    )
    ap.add_argument("--batch", type=int, default=64, help="批次大小（預設 64）")
    args = ap.parse_args()

    stats = asyncio.run(run_embed(only_missing=not args.all, batch_size=args.batch))
    print(
        f"嵌入完成：模型 {stats['model']}｜候選 {stats['candidates']}"
        f"｜已嵌 {stats['embedded']}（{stats['batches']} 批）"
    )


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""嵌入回填（P5）：把評估（rationale + criteria）嵌入決策向量 → Layer C（decision_vectors）。

- 同意門檻（合作範圍）：僅 ``whitelist_active && consent_shared`` 的使用者，其評估才入庫，
  與 learn_keywords 的具名共享門檻一致（白名單(@hqdesign.tw)內共享、對外永不揭露）。
- 結論門檻：僅 feasible ∈ {可行, 不可行}（待議/None 不嵌入，無監督訊號）。
- 來源僅標案公開欄位 + 判準 + 理由，向量 metadata 不含人名／email（隱私鐵則）。
- 預設只補「缺向量」或「模型過期」者；--all 強制全部重嵌。
- 冪等：以 evaluation_id 為主鍵 upsert；可重複執行而結果穩定。
- 需本機 Ollama 在線且已 pull EMBED_MODEL；CI／測試不跑此 job（改 mock embedding）。

執行：
    uv run python -m app.jobs.embed_decisions            # 只補缺漏／模型過期
    uv run python -m app.jobs.embed_decisions --all      # 全部重嵌
    uv run python -m app.jobs.embed_decisions --batch 128
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.behavior import Evaluation, User
from app.models.knowledge import DecisionVector
from app.models.tender import Tender
from app.services.embedding import decision_text, embed_texts

# 入庫的結論值域（待議/None 無監督訊號，不嵌入）
_FEASIBLE_VALUES = ("可行", "不可行")


async def _targets(session, model: str, only_missing: bool):
    """挑出待嵌入評估：合作範圍內 + 結論明確；only_missing 排除『已有當前模型向量』者。

    回傳 (Evaluation, Tender) 配對清單（join 標案取公開特徵）。
    """
    stmt = (
        select(Evaluation, Tender)
        .join(User, User.id == Evaluation.user_id)
        .join(Tender, Tender.id == Evaluation.tender_id)
        .where(User.whitelist_active.is_(True), User.consent_shared.is_(True))
        .where(Evaluation.feasible.in_(_FEASIBLE_VALUES))
        .order_by(Evaluation.id)
    )
    if only_missing:
        done = select(DecisionVector.evaluation_id).where(DecisionVector.model == model)
        stmt = stmt.where(Evaluation.id.not_in(done))
    return list((await session.execute(stmt)).all())


async def _upsert_vectors(session, rows: list[dict]) -> None:
    if not rows:
        return
    stmt = pg_insert(DecisionVector).values(rows)
    # 衝突即覆寫（重嵌）：向量／模型／原文／結論更新，updated_at 重新蓋時間。
    stmt = stmt.on_conflict_do_update(
        index_elements=["evaluation_id"],
        set_={
            "embedding": stmt.excluded.embedding,
            "model": stmt.excluded.model,
            "content": stmt.excluded.content,
            "feasible": stmt.excluded.feasible,
            "tender_id": stmt.excluded.tender_id,
            "updated_at": func.now(),
        },
    )
    await session.execute(stmt)


async def run_embed_decisions(
    *, only_missing: bool = True, batch_size: int = 64, session_factory=None
) -> dict:
    model = settings.embed_model
    stats = {"model": model, "candidates": 0, "embedded": 0, "batches": 0}

    factory = session_factory or AsyncSessionLocal
    async with factory() as session:
        targets = await _targets(session, model, only_missing)
        stats["candidates"] = len(targets)

        for i in range(0, len(targets), batch_size):
            chunk = targets[i : i + batch_size]
            contents = [
                decision_text(t.name, t.org, t.category,
                              criteria=ev.criteria, rationale=ev.rationale)
                for ev, t in chunk
            ]
            vectors = await embed_texts(contents, model=model)
            rows = [
                dict(evaluation_id=ev.id, tender_id=ev.tender_id, embedding=v,
                     model=model, content=c, feasible=ev.feasible)
                for (ev, _t), v, c in zip(chunk, vectors, contents)
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
    ap = argparse.ArgumentParser(description="把評估嵌入決策向量（Layer C, P5）")
    ap.add_argument(
        "--all", action="store_true",
        help="強制重嵌全部評估（預設只補缺漏／模型過期）",
    )
    ap.add_argument("--batch", type=int, default=64, help="批次大小（預設 64）")
    args = ap.parse_args()

    stats = asyncio.run(
        run_embed_decisions(only_missing=not args.all, batch_size=args.batch)
    )
    print(
        f"嵌入完成：模型 {stats['model']}｜候選 {stats['candidates']}"
        f"｜已嵌 {stats['embedded']}（{stats['batches']} 批）"
    )


if __name__ == "__main__":
    main()

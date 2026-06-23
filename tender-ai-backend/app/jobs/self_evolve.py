# -*- coding: utf-8 -*-
"""自演化觸發閘：樣本累積到門檻（預設 50）且較上批有新增，才重跑一次 learn_keywords。

為何需要本 job
--------------
P4 以 24 筆評估起步，樣本太少、學出來的權重不穩。前端評估 UI 會持續累積資料，但我們
**不該每來一筆評估就重學**（吵雜、浪費、抖動），也不該在「沒有新資料」時空轉。本閘把
「何時值得再自演化一次」的判準集中於一處：

- **門檻（threshold_met）**：團隊線可用樣本數 ≥ ``min_samples``（預設 50）。團隊線採
  consent-aware 計數，與 `learn_keywords` 完全一致——只納入 ``whitelist_active &&
  consent_shared`` 的使用者、且結論 ∈ {可行, 不可行}。
- **有新增（has_new_data）**：當前樣本數 > 上一次學習批次（`KeywordWeightRevision`
  審計軌跡）所記錄的樣本數。沒有新評估就不重學。
- 兩者皆成立才 ``should_evolve``；``force=True`` 可無條件觸發（例如手動或排程強制）。

特性
----
- **完全 offline**：只讀評估資料 + 既有審計批次，不連 Ollama／不需網路（CI 安全）。
- **冪等**：無新資料時第二次呼叫不會重學。
- 真正觸發時就委派既有的 `learn_keywords`（不重寫學習邏輯，單一事實來源）。

執行：
    uv run python -m app.jobs.self_evolve [--min-samples 50] [--force]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.jobs.learn_keywords import learn_keywords
from app.models.behavior import Evaluation, User
from app.models.knowledge import KeywordWeightRevision

#: 觸發一次自演化所需的最小團隊線樣本數（P4：24 筆太少，累積到 50+ 再學）。
DEFAULT_MIN_SAMPLES = 50


async def _count_team_samples(session) -> int:
    """團隊線可用樣本數：consent-aware，與 learn_keywords 的納入準則一致。"""
    rows = (
        await session.execute(
            select(Evaluation.id)
            .join(User, User.id == Evaluation.user_id)
            .where(
                User.whitelist_active.is_(True),
                User.consent_shared.is_(True),
                Evaluation.feasible.in_(["可行", "不可行"]),
            )
        )
    ).all()
    return len(rows)


async def _last_batch_samples(session) -> int | None:
    """上一次學習批次所記錄的樣本數（feasible+infeasible）；從無批次時回傳 None。"""
    row = (
        await session.execute(
            select(
                KeywordWeightRevision.feasible_samples,
                KeywordWeightRevision.infeasible_samples,
            )
            .order_by(KeywordWeightRevision.batch.desc(), KeywordWeightRevision.id.desc())
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    return (row[0] or 0) + (row[1] or 0)


async def evaluate_gate(session, *, min_samples: int = DEFAULT_MIN_SAMPLES) -> dict:
    """純判斷（不觸發學習）：回傳閘的決策脈絡。"""
    current = await _count_team_samples(session)
    last = await _last_batch_samples(session)
    threshold_met = current >= min_samples
    # 無前批時 last=None：只要有任何樣本即視為有新資料
    has_new_data = current > (last if last is not None else -1)
    return {
        "current_samples": current,
        "last_batch_samples": last,
        "threshold": min_samples,
        "threshold_met": threshold_met,
        "has_new_data": has_new_data,
        "should_evolve": threshold_met and has_new_data,
    }


async def run_self_evolution(
    *,
    min_samples: int = DEFAULT_MIN_SAMPLES,
    force: bool = False,
    session_factory=None,
    min_support: int = 2,
    include_category_features: bool = True,
) -> dict:
    """檢查閘；達標（或 force）才委派 `learn_keywords` 重學一次。

    回傳 ``{"gate": {...}, "did_evolve": bool, "learn": {...} | None}``。
    ``gate.should_evolve`` 只反映「門檻＋有新增」；``force`` 體現在 ``did_evolve``。
    """
    factory = session_factory or AsyncSessionLocal

    async with factory() as session:
        gate = await evaluate_gate(session, min_samples=min_samples)

    did_evolve = bool(force or gate["should_evolve"])
    learn = None
    if did_evolve:
        learn = await learn_keywords(
            session_factory=factory,
            min_support=min_support,
            include_category_features=include_category_features,
        )

    return {"gate": gate, "did_evolve": did_evolve, "learn": learn}


def main() -> None:
    ap = argparse.ArgumentParser(description="自演化觸發閘：達門檻＋有新增才重學關鍵字權重")
    ap.add_argument("--min-samples", type=int, default=DEFAULT_MIN_SAMPLES,
                    help=f"觸發門檻（預設 {DEFAULT_MIN_SAMPLES}）")
    ap.add_argument("--force", action="store_true", help="無條件觸發一次自演化")
    ap.add_argument("--json", dest="json_out", default="self_evolve_report.json",
                    help="輸出統計 JSON 路徑（已 gitignore）")
    args = ap.parse_args()

    out = asyncio.run(run_self_evolution(min_samples=args.min_samples, force=args.force))

    from pathlib import Path
    Path(args.json_out).write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    g = out["gate"]
    print(
        f"自演化閘：樣本 {g['current_samples']}/{g['threshold']}"
        f"｜上批 {g['last_batch_samples']}｜有新增 {g['has_new_data']}"
        f"｜觸發 {out['did_evolve']}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()

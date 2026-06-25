# -*- coding: utf-8 -*-
"""以「信心校準」從 consent-aware 團隊樣本學出潛力分帶切點 ``c_high`` / ``c_low``。

為何需要本 job（Stage 2）
------------------------
潛力分級（高/中/低）由團隊線可行性分數 ``Tender.feasibility_team`` 分帶而來。Stage 1
先用「種子切點」（``query.SEED_C_HIGH`` / ``SEED_C_LOW`` = 62 / 42，源自 reasoning
的 verdict 門檻）。本 job 讓切點**會隨資料重新組構**：使用者每多判斷一案，門檻就更貼近
「實際的可行/不可行」分佈——這正回應「越多人用 AI、越知道分數怎麼打」。

信心校準的數學
--------------
對每筆 consent-aware 評估，取該案的團隊線分數 ``s``（與物化的 feasibility_team 同源，
``compute_team_fit``）與其結論標籤（可行/不可行）。掃整數切點 ``c``：

- ``c_high`` ＝ 能讓「分數 ≥ c 的標案中，實際可行比例 ≥ target_high」成立的**最低** c
  （最低 → 高帶盡量寬，但仍守住信心）。
- ``c_low``  ＝ 能讓「分數 < c 的標案中，實際不可行比例 ≥ target_low」成立的**最高** c
  （最高 → 低帶盡量寬，但仍守住信心）。

每個切點都要求群體 ≥ ``min_support`` 才採信。預設 ``target_high=0.80`` 對應使用者原話
「可行性超過 80 ＝高潛力」，但重新詮釋為「高帶內**有 80% 信心**確實可行」。

護欄（資料不足或不自洽就回退種子）
--------------------------------
- 兩個類別（可行/不可行）的樣本數都需 ≥ ``min_support``，否則 ``fallback=True``。
- 搜尋範圍即為夾擠，且**刻意不重疊**：``c_high ∈ [55, 90]``、``c_low ∈ [25, 50]``。
  不重疊保證可分資料能學出**有序**切點（最低 c_high=55 > 最高 c_low=50，最小中帶
  ``[50, 55)``）——避免兩切點都擠向重疊區而交叉、害得幾乎恆回退。
- 任一切點找不到（某帶始終達不到目標信心）→ ``fallback=True``、沿用種子。
- ``c_low ≥ c_high``（帶序顛倒）為防禦性護欄：在當前不重疊夾擠下不會發生，但若日後調寬
  範圍致重疊仍能擋下壞門檻 → ``fallback=True``。
- ``fallback=True`` 時切點＝``SEED_C_HIGH`` / ``SEED_C_LOW``，查詢端因此維持 Stage 1 行為。

特性
----
- **完全 offline**：只讀既有 DB（評估／使用者／標案／關鍵字權重），不連任何站台、不呼叫
  Ollama（CI/sandbox 安全）。
- **append-only 稽核軌跡**：每跑一次 append 一列 ``TierThresholdRevision``（同
  ``KeywordWeightRevision`` 慣例）；查詢端讀最新一列。決定性：同資料每次算出同切點。
- **不產生負分關鍵字**：本 job 只算分數切點、寫一張版本表，與「負分人工專屬」紅線無涉
  （見 ``TierThresholdRevision`` docstring）。
- **consent-aware 團隊線**：樣本納入準則與 ``learn_keywords`` / ``self_evolve`` 完全一致
  ——僅 ``whitelist_active && consent_shared``、結論 ∈ {可行, 不可行}。

執行：
    uv run python -m app.jobs.learn_tier_thresholds [--target-high 0.8] [--target-low 0.7] [--min-support 5]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.jobs.score_team_feasibility import _load_team_inputs
from app.models.behavior import Evaluation, User
from app.models.knowledge import TierThresholdRevision
from app.models.tender import Tender
from app.services.query import SEED_C_HIGH, SEED_C_LOW
from app.services.reasoning import compute_team_fit

#: 校準目標：高帶內「實際可行」信心、低帶內「實際不可行」信心。
DEFAULT_TARGET_HIGH = 0.80
DEFAULT_TARGET_LOW = 0.70
#: 每個切點成立所需的最小樣本數（兩個類別亦各需達標才採信）。
DEFAULT_MIN_SUPPORT = 5

#: 切點夾擠範圍（搜尋範圍即夾擠，避免極端門檻）。刻意**不重疊**：
#: 最低 c_high(55) > 最高 c_low(50)，保證可分資料能學出有序切點、最小中帶 [50, 55)。
C_HIGH_MIN, C_HIGH_MAX = 55, 90
C_LOW_MIN, C_LOW_MAX = 25, 50


def calibrate_thresholds(
    samples: list[tuple[int, bool]],
    *,
    target_high: float = DEFAULT_TARGET_HIGH,
    target_low: float = DEFAULT_TARGET_LOW,
    min_support: int = DEFAULT_MIN_SUPPORT,
) -> dict:
    """純函式：由 ``(score, is_feasible)`` 樣本算出校準切點與決策脈絡。

    ``samples``：每筆為 ``(分數 0–100, 是否可行)``。回傳 dict（見檔頭數學說明）：
    ``c_high`` / ``c_low`` / ``support_high`` / ``support_low`` /
    ``feasible_samples`` / ``infeasible_samples`` / ``fallback``。
    無法可靠校準時 ``fallback=True`` 且切點＝種子（``SEED_C_HIGH`` / ``SEED_C_LOW``）。
    """
    feasible_n = sum(1 for _s, f in samples if f)
    infeasible_n = sum(1 for _s, f in samples if not f)

    # 預設：回退種子切點（沿用 Stage 1 行為）。
    out = {
        "c_high": SEED_C_HIGH,
        "c_low": SEED_C_LOW,
        "support_high": 0,
        "support_low": 0,
        "feasible_samples": feasible_n,
        "infeasible_samples": infeasible_n,
        "fallback": True,
    }

    # 兩個類別都要有足夠樣本，校準才有意義。
    if feasible_n < min_support or infeasible_n < min_support:
        return out

    # c_high：升冪掃 → 第一個達標者即「最低切點」（高帶最寬而仍守信心）。
    c_high = None
    support_high = 0
    for c in range(C_HIGH_MIN, C_HIGH_MAX + 1):
        group = [f for s, f in samples if s >= c]
        if len(group) < min_support:
            continue
        precision = sum(1 for f in group if f) / len(group)
        if precision >= target_high:
            c_high = c
            support_high = len(group)
            break

    # c_low：降冪掃 → 第一個達標者即「最高切點」（低帶最寬而仍守信心）。
    c_low = None
    support_low = 0
    for c in range(C_LOW_MAX, C_LOW_MIN - 1, -1):
        group = [f for s, f in samples if s < c]
        if len(group) < min_support:
            continue
        precision = sum(1 for f in group if not f) / len(group)
        if precision >= target_low:
            c_low = c
            support_low = len(group)
            break

    # 任一切點缺失、或帶序顛倒（c_low ≥ c_high）→ 回退種子，避免半學成的壞門檻。
    if c_high is None or c_low is None or c_low >= c_high:
        return out

    out.update(
        {
            "c_high": c_high,
            "c_low": c_low,
            "support_high": support_high,
            "support_low": support_low,
            "fallback": False,
        }
    )
    return out


async def _load_labeled_samples(session) -> list[tuple[int, bool]]:
    """載入 consent-aware 已標註樣本 ``(團隊線分數, 是否可行)``。

    納入準則刻意對齊 ``learn_keywords`` / ``self_evolve``：僅 ``whitelist_active &&
    consent_shared`` 的使用者、結論 ∈ {可行, 不可行}；每筆評估算一個樣本（與閘的計數一致，
    同一案被多位同事各判一次即多個樣本）。分數用 ``compute_team_fit`` 即時算，與物化進
    ``feasibility_team`` 的口徑同源。
    """
    profile, positive_kws, learned_negatives = await _load_team_inputs(session)

    rows = (
        await session.execute(
            select(Evaluation, Tender)
            .join(Tender, Tender.id == Evaluation.tender_id)
            .join(User, User.id == Evaluation.user_id)
            .where(
                User.whitelist_active.is_(True),
                User.consent_shared.is_(True),
                Evaluation.feasible.in_(["可行", "不可行"]),
            )
        )
    ).all()

    samples: list[tuple[int, bool]] = []
    for eval_obj, tender_obj in rows:
        score = compute_team_fit(tender_obj, profile, positive_kws, learned_negatives)
        samples.append((score, eval_obj.feasible == "可行"))
    return samples


async def run_learn_tier_thresholds(
    *,
    target_high: float = DEFAULT_TARGET_HIGH,
    target_low: float = DEFAULT_TARGET_LOW,
    min_support: int = DEFAULT_MIN_SUPPORT,
    session_factory=None,
) -> dict:
    """學一次潛力分帶切點並 append 一列 ``TierThresholdRevision``。

    參數
    ----
    target_high / target_low : 高帶可行信心 / 低帶不可行信心目標。
    min_support : 每個切點（與每個類別）採信所需的最小樣本數。
    session_factory : 測試注入點（測試庫 session）。

    回傳校準結果 dict（含 ``batch`` / ``target_*`` / ``min_support`` / ``total_samples``）。
    """
    factory = session_factory or AsyncSessionLocal

    async with factory() as session:
        samples = await _load_labeled_samples(session)
        result = calibrate_thresholds(
            samples,
            target_high=target_high,
            target_low=target_low,
            min_support=min_support,
        )

        now = datetime.now(timezone.utc)
        batch = now.isoformat()
        session.add(
            TierThresholdRevision(
                batch=batch,
                c_high=result["c_high"],
                c_low=result["c_low"],
                target_high=target_high,
                target_low=target_low,
                min_support=min_support,
                support_high=result["support_high"],
                support_low=result["support_low"],
                feasible_samples=result["feasible_samples"],
                infeasible_samples=result["infeasible_samples"],
                fallback=result["fallback"],
            )
        )
        await session.commit()

    return {
        **result,
        "batch": batch,
        "target_high": target_high,
        "target_low": target_low,
        "min_support": min_support,
        "total_samples": len(samples),
    }


def main() -> None:
    ap = argparse.ArgumentParser(
        description="以信心校準學出潛力分帶切點 c_high / c_low（append 一列版本）"
    )
    ap.add_argument("--target-high", type=float, default=DEFAULT_TARGET_HIGH,
                    help=f"高帶可行信心目標（預設 {DEFAULT_TARGET_HIGH}）")
    ap.add_argument("--target-low", type=float, default=DEFAULT_TARGET_LOW,
                    help=f"低帶不可行信心目標（預設 {DEFAULT_TARGET_LOW}）")
    ap.add_argument("--min-support", type=int, default=DEFAULT_MIN_SUPPORT,
                    help=f"每切點/類別最小樣本數（預設 {DEFAULT_MIN_SUPPORT}）")
    ap.add_argument("--json", dest="json_out", default="learn_tier_thresholds_report.json",
                    help="輸出統計 JSON 路徑（已 gitignore）")
    args = ap.parse_args()

    out = asyncio.run(
        run_learn_tier_thresholds(
            target_high=args.target_high,
            target_low=args.target_low,
            min_support=args.min_support,
        )
    )

    from pathlib import Path

    Path(args.json_out).write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"門檻校準完成：c_high={out['c_high']}｜c_low={out['c_low']}"
        f"｜回退={out['fallback']}｜可行 {out['feasible_samples']}"
        f"／不可行 {out['infeasible_samples']}（共 {out['total_samples']} 樣本）",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()

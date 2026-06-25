# -*- coding: utf-8 -*-
"""信心校準 job ``learn_tier_thresholds`` 的純函式 + 整合測試（Stage 2）。

潛力分帶切點 ``c_high`` / ``c_low`` 不再固定為種子（62/42），而是由 consent-aware
團隊樣本以信心校準學出，並 append 一列 ``TierThresholdRevision`` 供查詢端讀最新一列。

驗收重點：
- **純函式數學**（``calibrate_thresholds``）：可分資料學出有序切點；任一類別樣本不足、
  某帶始終達不到目標信心、或空樣本 → 回退種子（``fallback=True``）。
- **不重疊夾擠**：c_high ∈ [55,90]、c_low ∈ [25,50]，保證可分資料學出有序切點且
  中帶不為空（最小 [50,55)）；中帶有雜訊時 c_high 會被資料往上推。
- **載入 + 計數**：``_load_labeled_samples`` 僅納 consent-aware 樣本、標籤計數正確。
- **持久化 + 查詢端**：跑一次 append 一列版本，且 ``_latest_tier_thresholds`` 讀到的
  切點＝job 回傳值（查詢端自動改讀最新門檻，毋須改查詢碼）。
- **串接**：``run_self_evolution(force=True)`` 依序跑完權重→物化→校準，三者皆有產物。
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select

from app.jobs.learn_tier_thresholds import (
    calibrate_thresholds,
    run_learn_tier_thresholds,
)
from app.models.behavior import Evaluation, User
from app.models.knowledge import TierThresholdRevision
from app.models.tender import Source, Tender
from app.services.query import SEED_C_HIGH, SEED_C_LOW, _latest_tier_thresholds
from tests.conftest import TestSessionLocal


# --------------------------------------------------------------------------- #
# 純函式：信心校準數學（不碰 DB）
# --------------------------------------------------------------------------- #
def test_clear_separation_learns_ordered_cutoffs():
    """乾淨可分（高分可行、低分不可行）→ 學出有序切點、非回退。"""
    samples = [(s, True) for s in (75, 80, 85, 90, 95)] + [
        (s, False) for s in (20, 25, 30, 35, 40)
    ]
    out = calibrate_thresholds(samples, min_support=3)

    assert out["fallback"] is False
    # 高帶最寬而仍守信心 → c_high 落在搜尋下界 55；低帶同理落上界 50。
    assert out["c_high"] == 55
    assert out["c_low"] == 50
    assert out["c_low"] < out["c_high"]  # 帶序正確
    assert out["support_high"] == 5
    assert out["support_low"] == 5
    assert out["feasible_samples"] == 5
    assert out["infeasible_samples"] == 5


def test_noisy_mid_pushes_c_high_up():
    """中段混入不可行 → 為守住高帶 80% 信心，c_high 被資料往上推離下界。"""
    samples = [(s, True) for s in (70, 75, 80, 85, 90)] + [
        (s, False) for s in (20, 30, 40, 55, 60)
    ]
    out = calibrate_thresholds(samples, min_support=3)

    assert out["fallback"] is False
    # c=55 群含 55/60 兩個不可行 → 5/7≈0.71 未達 0.8；c=56 起達標。
    assert out["c_high"] == 56
    assert out["c_high"] > 55  # 純資料驅動，非釘在下界
    assert out["c_low"] == 50
    assert out["c_low"] < out["c_high"]


def test_insufficient_class_support_falls_back_to_seed():
    """某一類別樣本數 < min_support → 不校準，回退種子切點。"""
    samples = [(s, True) for s in (80, 85, 90)] + [(30, False)]  # 不可行只有 1 筆
    out = calibrate_thresholds(samples, min_support=3)

    assert out["fallback"] is True
    assert out["c_high"] == SEED_C_HIGH  # 62
    assert out["c_low"] == SEED_C_LOW  # 42
    assert out["feasible_samples"] == 3
    assert out["infeasible_samples"] == 1
    assert out["support_high"] == 0
    assert out["support_low"] == 0


def test_unreliable_high_band_falls_back():
    """高分區其實多為不可行（標籤與分數反向）→ 高帶切點找不到 → 回退種子。"""
    samples = [(s, True) for s in (30, 35, 40)] + [
        (s, False) for s in (80, 85, 90)
    ]
    out = calibrate_thresholds(samples, min_support=3)

    assert out["fallback"] is True
    assert (out["c_high"], out["c_low"]) == (SEED_C_HIGH, SEED_C_LOW)


def test_empty_samples_falls_back():
    """無樣本 → 回退種子、計數為 0。"""
    out = calibrate_thresholds([], min_support=5)

    assert out["fallback"] is True
    assert (out["c_high"], out["c_low"]) == (SEED_C_HIGH, SEED_C_LOW)
    assert out["feasible_samples"] == 0
    assert out["infeasible_samples"] == 0


# 備註：``c_low >= c_high``（帶序顛倒）為防禦性護欄。在當前**不重疊**夾擠
# （c_high≥55 > c_low≤50）下結構上不會發生，故無對應觸發測試；若日後調寬範圍致重疊，
# 該護欄仍會擋下並回退（見 job docstring）。


# --------------------------------------------------------------------------- #
# 整合：載入樣本 / 持久化 / 查詢端讀最新門檻
# --------------------------------------------------------------------------- #
async def _seed_evals(
    session,
    n_feasible: int,
    n_infeasible: int,
    *,
    tag: str,
    consent: bool = True,
    whitelist: bool = True,
) -> None:
    """植入一組團隊線評估：工程(可行) / 財物(不可行)，同意與白名單可調。

    每組用 tag 區隔 Source 名／case_pk／使用者 email，避免多次呼叫時鍵衝突。
    """
    src = Source(name=f"PCC-{tag}", base_url="https://web.pcc.gov.tw")
    session.add(src)
    await session.flush()
    user = User(
        name=f"user-{tag}",
        email=f"{tag}@hqdesign.tw",
        whitelist_active=whitelist,
        consent_shared=consent,
    )
    session.add(user)
    await session.flush()

    def _t(pk: str, category: str, name: str) -> Tender:
        return Tender(
            source_id=src.id,
            case_pk=pk,
            name=name,
            org="某機關",
            category=category,
            link=f"https://x/{pk}",
            first_seen=date(2026, 6, 23),
            last_seen=date(2026, 6, 23),
        )

    for i in range(n_feasible):
        t = _t(f"{tag}-F{i}", "工程", f"道路工程改善案 {i}")
        session.add(t)
        await session.flush()
        session.add(
            Evaluation(user_id=user.id, tender_id=t.id, feasible="可行", rationale="r")
        )
    for i in range(n_infeasible):
        t = _t(f"{tag}-I{i}", "財物", f"財物採購案 {i}")
        session.add(t)
        await session.flush()
        session.add(
            Evaluation(user_id=user.id, tender_id=t.id, feasible="不可行", rationale="r")
        )
    await session.commit()


async def _latest_revision(session) -> TierThresholdRevision | None:
    return (
        await session.execute(
            select(TierThresholdRevision).order_by(TierThresholdRevision.id.desc()).limit(1)
        )
    ).scalar_one_or_none()


async def test_run_with_no_samples_writes_fallback_revision(seeded, session_factory):
    """無任何評估（seeded 僅 4 標案、零評估）→ 回退種子，且 append 一列版本。"""
    out = await run_learn_tier_thresholds(session_factory=session_factory)

    assert out["total_samples"] == 0
    assert out["fallback"] is True
    assert (out["c_high"], out["c_low"]) == (SEED_C_HIGH, SEED_C_LOW)

    async with TestSessionLocal() as s:
        rev = await _latest_revision(s)
        assert rev is not None
        assert rev.batch == out["batch"]
        assert rev.c_high == SEED_C_HIGH
        assert rev.c_low == SEED_C_LOW
        assert rev.fallback is True
        assert rev.feasible_samples == 0
        assert rev.infeasible_samples == 0
        # 查詢端讀到的最新門檻＝種子。
        assert await _latest_tier_thresholds(s) == (SEED_C_HIGH, SEED_C_LOW)


async def test_consent_filter_and_label_counts(db_session, session_factory):
    """僅納 consent-aware 樣本；可行/不可行計數正確，且查詢端讀到 job 寫入的切點。"""
    await _seed_evals(db_session, 5, 5, tag="ok", consent=True)
    await _seed_evals(db_session, 3, 2, tag="nocon", consent=False)  # 未同意 → 排除
    await _seed_evals(db_session, 4, 1, tag="nowl", whitelist=False)  # 非白名單 → 排除

    out = await run_learn_tier_thresholds(session_factory=session_factory)

    # 只有 tag="ok" 的 10 筆入樣本；標籤計數對齊。
    assert out["total_samples"] == 10
    assert out["feasible_samples"] == 5
    assert out["infeasible_samples"] == 5

    async with TestSessionLocal() as s:
        rev = await _latest_revision(s)
        assert rev is not None
        assert rev.batch == out["batch"]
        assert rev.feasible_samples == 5
        assert rev.infeasible_samples == 5
        # 不論是否回退，查詢端讀到的最新門檻＝job 本次回傳的切點（持久化正確）。
        assert await _latest_tier_thresholds(s) == (out["c_high"], out["c_low"])


async def test_append_only_each_run_adds_revision(seeded, session_factory):
    """append-only：每跑一次新增一列版本（不就地覆蓋）。"""
    await run_learn_tier_thresholds(session_factory=session_factory)
    await run_learn_tier_thresholds(session_factory=session_factory)

    async with TestSessionLocal() as s:
        rows = (await s.execute(select(TierThresholdRevision))).scalars().all()
        assert len(rows) == 2


# --------------------------------------------------------------------------- #
# 串接：自演化觸發後依序跑完權重 → 物化 → 校準
# --------------------------------------------------------------------------- #
async def test_self_evolution_chains_tier_thresholds(db_session, session_factory):
    """force 觸發後，learn / score / tier_thresholds 三段皆有產物，且寫入門檻版本。"""
    from app.jobs.self_evolve import run_self_evolution

    await _seed_evals(db_session, 30, 25, tag="big")

    out = await run_self_evolution(force=True, session_factory=session_factory)

    assert out["did_evolve"] is True
    assert out["learn"] is not None  # 權重已重學
    assert out["score"] is not None  # 分數已重新物化
    assert out["tier_thresholds"] is not None  # 門檻已校準
    assert out["tier_thresholds"]["total_samples"] == 55

    async with TestSessionLocal() as s:
        rev = await _latest_revision(s)
        assert rev is not None
        assert rev.batch == out["tier_thresholds"]["batch"]

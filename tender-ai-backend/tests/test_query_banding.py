# -*- coding: utf-8 -*-
"""潛力分級「由團隊線可行性分數分帶」的查詢端測試（Stage 1）。

潛力分級不再直接沿用報表快照 tier，而是把物化的 ``tenders.feasibility_team`` 依切點
分帶（見 ``app/services/query.py`` 的 ``_derived_tier_expr`` / ``_band_tier_expr``）。
本檔以 ``GET /api/v1/tenders/{id}`` 回傳的 ``tier`` 驗證分帶語義：

- 未物化（NULL）→ 回退報表快照 tier；
- 物化分數凌駕報表 tier（高分升級、低分降級）；
- 種子切點 62/42 的邊界值精確分帶；
- 報表 ``priority`` 為強訊號，凌駕分數分帶；
- 學出的 ``TierThresholdRevision`` 覆寫種子切點，且取「最新一列」。
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import update

from app.models.knowledge import TierThresholdRevision
from app.models.tender import DailyTender, Tender
from tests.conftest import TestSessionLocal

BASE = "/api/v1/tenders"


async def _set_feasibility_team(updates: dict[int, int]) -> None:
    """直接物化團隊線可行性分數（繞過 job，專注驗證查詢端分帶）。"""
    async with TestSessionLocal() as s:
        for tid, score in updates.items():
            await s.execute(
                update(Tender).where(Tender.id == tid).values(feasibility_team=score)
            )
        await s.commit()


async def _add_snapshot(tid: int, run_date: date, tier: str, days_left: int) -> None:
    """補一筆每日快照（用於驗證 priority 報表訊號）。"""
    async with TestSessionLocal() as s:
        s.add(
            DailyTender(run_date=run_date, tender_id=tid, tier=tier, days_left=days_left)
        )
        await s.commit()


async def _add_tier_threshold(c_high: int, c_low: int, batch: str) -> None:
    """append 一筆門檻版本（信心校準學習產物的稽核軌跡）。"""
    async with TestSessionLocal() as s:
        s.add(
            TierThresholdRevision(
                batch=batch,
                c_high=c_high,
                c_low=c_low,
                target_high=0.80,
                target_low=0.70,
            )
        )
        await s.commit()


async def _tier_of(client, tid: int) -> str | None:
    return (await client.get(f"{BASE}/{tid}")).json()["tier"]


async def test_null_feasibility_falls_back_to_report_tier(client, seeded):
    """全未物化（feasibility_team 皆 NULL）→ 潛力分級回退報表快照 tier。"""
    assert await _tier_of(client, seeded["high"]) == "high"
    assert await _tier_of(client, seeded["mid"]) == "mid"
    assert await _tier_of(client, seeded["low"]) == "low"
    # tmu 無快照 → 報表 tier 亦為 NULL
    assert await _tier_of(client, seeded["tmu"]) is None


async def test_score_band_overrides_report_tier(client, seeded):
    """物化分數凌駕報表分級：report=high 的案給低分→降級 low；report=low 的案給高分→升級 high。"""
    await _set_feasibility_team({seeded["high"]: 30, seeded["low"]: 80})
    assert await _tier_of(client, seeded["high"]) == "low"   # 30 < 42 → low
    assert await _tier_of(client, seeded["low"]) == "high"   # 80 >= 62 → high


async def test_seed_band_boundaries(client, seeded):
    """種子切點 c_high=62 / c_low=42 的邊界值：62→high、42→mid、41→low。"""
    await _set_feasibility_team(
        {seeded["high"]: 62, seeded["mid"]: 42, seeded["low"]: 41}
    )
    assert await _tier_of(client, seeded["high"]) == "high"
    assert await _tier_of(client, seeded["mid"]) == "mid"
    assert await _tier_of(client, seeded["low"]) == "low"


async def test_priority_report_tier_overrides_score_band(client, seeded):
    """報表 priority 為強訊號：即使分數落 low 帶，最終分級仍維持 priority。"""
    await _set_feasibility_team({seeded["low"]: 10})  # 分數本應 → low
    # 補一筆「最新」priority 快照（run_date 較種子的 2026-06-17 新）
    await _add_snapshot(seeded["low"], date(2026, 6, 18), "priority", 1)
    assert await _tier_of(client, seeded["low"]) == "priority"


async def test_learned_thresholds_override_seed_cutoffs(client, seeded):
    """分數 55：種子(62/42)→mid；學出新切點(50/30)後→high，證明查詢端讀最新門檻。"""
    await _set_feasibility_team({seeded["mid"]: 55})
    assert await _tier_of(client, seeded["mid"]) == "mid"

    await _add_tier_threshold(c_high=50, c_low=30, batch="2026-06-25T00:00:00")
    assert await _tier_of(client, seeded["mid"]) == "high"


async def test_latest_threshold_revision_wins(client, seeded):
    """多筆門檻版本（append-only）→ 查詢端取「最新一列（id 最大）」。"""
    await _set_feasibility_team({seeded["mid"]: 55})
    await _add_tier_threshold(c_high=90, c_low=80, batch="2026-06-24T00:00:00")  # 舊：55→low
    await _add_tier_threshold(c_high=50, c_low=30, batch="2026-06-25T00:00:00")  # 新：55→high
    assert await _tier_of(client, seeded["mid"]) == "high"

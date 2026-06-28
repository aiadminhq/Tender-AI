# -*- coding: utf-8 -*-
"""app.jobs.self_evolve：自演化觸發閘——樣本累積到門檻（預設 50）且較上批有新增才重學。

背景
----
P4 以 24 筆評估起步，樣本太少。前端評估 UI 會持續累積；本閘決定「何時自動觸發一次
自演化（重跑 learn_keywords）」，避免每筆評估都重學、也避免無新資料時空轉：
- **門檻**：團隊線（consent-aware：whitelist_active && consent_shared、結論 ∈ {可行,不可行}）
  可用樣本數 ≥ min_samples。
- **有新增**：當前樣本數 > 上一批學習所記錄的樣本數（KeywordWeightRevision）。
- 兩者皆成立才 evolve；`force=True` 可無條件觸發。

不連 Ollama / 不需網路：純讀評估資料 + 既有審計批次，於測試庫驗證。
"""
from __future__ import annotations

from datetime import date

import pytest_asyncio

from app.models.behavior import Evaluation, User
from app.models.tender import Source, Tender


async def _seed_samples(session, n_feasible: int, n_infeasible: int, *,
                        whitelist=True, consent=True) -> None:
    """植入 n 筆團隊線評估（同意可調）；半數工程(可行)、半數財物(不可行)便於有詞可學。"""
    src = await session.scalar(
        __import__("sqlalchemy").select(Source).where(Source.name == "PCC")
    ) if False else None
    src = Source(name=f"PCC", base_url="https://web.pcc.gov.tw")
    session.add(src)
    await session.flush()
    user = User(name="alex", email="alex@hqdesign.tw",
                whitelist_active=whitelist, consent_shared=consent)
    session.add(user)
    await session.flush()

    def _t(pk, category, name):
        return Tender(source_id=src.id, case_pk=pk, name=name, org="某機關",
                      category=category, link=f"https://x/{pk}",
                      first_seen=date(2026, 6, 23), last_seen=date(2026, 6, 23))

    for i in range(n_feasible):
        t = _t(f"F{i}", "工程", f"道路工程改善案 {i}")
        session.add(t)
        await session.flush()
        session.add(Evaluation(user_id=user.id, tender_id=t.id, feasible="可行", rationale="r"))
    for i in range(n_infeasible):
        t = _t(f"I{i}", "財物", f"財物採購案 {i}")
        session.add(t)
        await session.flush()
        session.add(Evaluation(user_id=user.id, tender_id=t.id, feasible="不可行", rationale="r"))
    await session.commit()


@pytest_asyncio.fixture
async def session_factory_fix(session_factory):
    return session_factory


async def test_below_threshold_does_not_evolve(db_session, session_factory):
    from app.jobs.self_evolve import run_self_evolution

    await _seed_samples(db_session, 6, 4)  # 共 10 < 50
    out = await run_self_evolution(min_samples=50, session_factory=session_factory)
    assert out["gate"]["current_samples"] == 10
    assert out["gate"]["threshold_met"] is False
    assert out["gate"]["should_evolve"] is False
    assert out["did_evolve"] is False
    assert out["learn"] is None


async def test_reaching_threshold_triggers_evolution(db_session, session_factory):
    from app.jobs.self_evolve import run_self_evolution

    await _seed_samples(db_session, 30, 25)  # 共 55 ≥ 50
    out = await run_self_evolution(min_samples=50, session_factory=session_factory)
    assert out["gate"]["current_samples"] == 55
    assert out["gate"]["threshold_met"] is True
    assert out["gate"]["should_evolve"] is True
    assert out["did_evolve"] is True
    assert out["learn"] is not None
    assert out["learn"]["feasible_samples"] == 30
    assert out["learn"]["infeasible_samples"] == 25


async def test_no_new_data_skips_second_run(db_session, session_factory):
    from app.jobs.self_evolve import run_self_evolution

    await _seed_samples(db_session, 30, 25)  # 55
    first = await run_self_evolution(min_samples=50, session_factory=session_factory)
    assert first["did_evolve"] is True
    # 無新增評估 → 第二次不應重學
    second = await run_self_evolution(min_samples=50, session_factory=session_factory)
    assert second["gate"]["has_new_data"] is False
    assert second["gate"]["should_evolve"] is False
    assert second["did_evolve"] is False


async def test_force_overrides_gate(db_session, session_factory):
    from app.jobs.self_evolve import run_self_evolution

    await _seed_samples(db_session, 6, 4)  # 10 < 50
    out = await run_self_evolution(min_samples=50, force=True, session_factory=session_factory)
    assert out["gate"]["threshold_met"] is False
    assert out["did_evolve"] is True  # force 無條件觸發
    assert out["learn"] is not None


async def test_consent_filter_applies_to_gate(db_session, session_factory):
    """未同意者的評估不計入門檻（與 learn_keywords 團隊線一致）。"""
    from app.jobs.self_evolve import run_self_evolution

    await _seed_samples(db_session, 30, 25, consent=False)  # 全未同意
    out = await run_self_evolution(min_samples=50, session_factory=session_factory)
    assert out["gate"]["current_samples"] == 0
    assert out["did_evolve"] is False

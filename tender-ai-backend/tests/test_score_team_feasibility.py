# -*- coding: utf-8 -*-
"""物化 job ``score_team_feasibility`` 的整合測試。

驗收重點（Stage 1）：
- **與單筆推理同源**：物化的 ``tenders.feasibility_team`` 恆等於
  ``reasoning.explain_tender(user_id=None)`` 的 ``criteria_fit``（團隊線）。
- **統計正確**：candidates／scored／updated／unchanged／still_null。
- **冪等**：同資料重跑只讀不寫（updated=0、unchanged=母體）。
- **反映正向學習**：對「勞務」加正權重後，低 tier 案的物化分數上升、且仍與
  criteria_fit 同步。
- **收斂母體**：``source`` / ``limit`` 旋鈕正確縮小處理範圍。
"""
from __future__ import annotations

from app.jobs.score_team_feasibility import run_score_team_feasibility
from app.models.knowledge import KeywordWeight
from app.models.tender import Tender
from app.services.reasoning import explain_tender
from tests.conftest import TestSessionLocal


async def _add_keyword_weight(term: str, polarity: str, weight: float) -> None:
    """植入一條學習權重（供物化反映正向關鍵字的驗證）。"""
    async with TestSessionLocal() as s:
        s.add(KeywordWeight(term=term, polarity=polarity, weight=weight, support=2))
        await s.commit()


async def test_materialize_equals_team_line_criteria_fit(seeded, session_factory):
    """物化分數＝該案以團隊線解讀的 criteria_fit（與 explain_tender 對齊）。"""
    stats = await run_score_team_feasibility(session_factory=session_factory)

    # 母體 4 案、皆成功算分；種子皆 NULL → 全部寫入、無「未變」、無殘留 NULL。
    assert stats["candidates"] == 4
    assert stats["scored"] == 4
    assert stats["updated"] == 4
    assert stats["unchanged"] == 0
    assert stats["still_null"] == 0

    async with TestSessionLocal() as s:
        for tid in seeded.values():
            t = await s.get(Tender, tid)
            expected = (await explain_tender(s, tid, user_id=None)).criteria_fit
            assert t.feasibility_team == expected


async def test_idempotent_rerun_writes_nothing(seeded, session_factory):
    """同資料重跑：分數決定性不變 → 全部「未變」、零寫入。"""
    await run_score_team_feasibility(session_factory=session_factory)
    again = await run_score_team_feasibility(session_factory=session_factory)

    assert again["candidates"] == 4
    assert again["scored"] == 4
    assert again["updated"] == 0
    assert again["unchanged"] == 4
    assert again["still_null"] == 0


async def test_positive_keyword_raises_materialized_score(seeded, session_factory):
    """對「勞務」加正權重後，桃園清潔勞務委外（low）的物化分數上升、且仍同步 criteria_fit。"""
    await run_score_team_feasibility(session_factory=session_factory)
    async with TestSessionLocal() as s:
        baseline = (await s.get(Tender, seeded["low"])).feasibility_team

    # 正向學習詞命中 low 的 name／category（haystack）。
    await _add_keyword_weight("勞務", "positive", 5.0)
    stats = await run_score_team_feasibility(session_factory=session_factory)

    # 至少 low 因關鍵字改分而被寫入。
    assert stats["updated"] >= 1
    async with TestSessionLocal() as s:
        t = await s.get(Tender, seeded["low"])
        expected = (await explain_tender(s, seeded["low"], user_id=None)).criteria_fit
        assert t.feasibility_team > baseline
        assert t.feasibility_team == expected


async def test_source_filter_narrows_candidates(seeded, session_factory):
    """``source`` 收斂母體：只物化該來源，其餘維持 NULL（由查詢端回退報表分級）。"""
    stats = await run_score_team_feasibility(source="TMU", session_factory=session_factory)

    assert stats["candidates"] == 1  # 僅 tmu
    assert stats["scored"] == 1
    assert stats["updated"] == 1
    assert stats["still_null"] == 3  # high/mid/low 未處理


async def test_limit_narrows_candidates(seeded, session_factory):
    """``limit`` 收斂母體：依 id 取前 N 筆物化，其餘維持 NULL。"""
    stats = await run_score_team_feasibility(limit=2, session_factory=session_factory)

    assert stats["candidates"] == 2
    assert stats["scored"] == 2
    assert stats["updated"] == 2
    assert stats["still_null"] == 2

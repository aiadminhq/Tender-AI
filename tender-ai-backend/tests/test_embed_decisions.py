# -*- coding: utf-8 -*-
"""app.jobs.embed_decisions：把評估嵌入決策向量（Layer C）。

不連 Ollama：monkeypatch embed_texts 回傳定長假向量。驗收重點：
- 同意門檻：僅 whitelist_active && consent_shared 的使用者，其評估才入庫。
- 結論門檻：僅 feasible ∈ {可行, 不可行}（待議/None 不嵌入）。
- 冪等：only_missing 時重跑不重複嵌入；--all 全部重嵌。
"""
from __future__ import annotations

from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from app.models.behavior import Evaluation, User
from app.models.knowledge import EMBED_DIM, DecisionVector
from app.models.tender import Source, Tender


@pytest.fixture(autouse=True)
def mock_embed_texts(monkeypatch):
    """embed_texts → 每筆回固定 e0 假向量；job 以模組屬性呼叫故 patch 模組屬性。"""

    async def fake_embed_texts(texts, **kw):
        return [[1.0] + [0.0] * (EMBED_DIM - 1) for _ in texts]

    monkeypatch.setattr("app.jobs.embed_decisions.embed_texts", fake_embed_texts)


@pytest_asyncio.fixture
async def evals(db_session):
    """植入：合作範圍內(可行/不可行/待議) + 範圍外(可行) 的評估，回傳便於斷言的 id。"""
    src = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    db_session.add(src)
    await db_session.flush()

    def _t(pk):
        return Tender(source_id=src.id, case_pk=pk, name=f"案-{pk}", org="某機關",
                      category="工程", link=f"https://x/{pk}",
                      first_seen=date(2026, 6, 23), last_seen=date(2026, 6, 23))

    t1, t2, t3, t4 = _t("A"), _t("B"), _t("C"), _t("D")
    db_session.add_all([t1, t2, t3, t4])

    member = User(name="alex", email="alex@hqdesign.tw",
                  whitelist_active=True, consent_shared=True)
    outsider = User(name="bob", email="bob@other.com",
                    whitelist_active=False, consent_shared=False)
    db_session.add_all([member, outsider])
    await db_session.flush()

    db_session.add_all([
        Evaluation(user_id=member.id, tender_id=t1.id, feasible="可行", rationale="r1"),
        Evaluation(user_id=member.id, tender_id=t2.id, feasible="不可行", rationale="r2"),
        Evaluation(user_id=member.id, tender_id=t3.id, feasible="待議", rationale="r3"),
        Evaluation(user_id=outsider.id, tender_id=t4.id, feasible="可行", rationale="r4"),
    ])
    await db_session.commit()
    return {"t1": t1.id, "t2": t2.id, "t3": t3.id, "t4": t4.id}


async def _count(session) -> int:
    return await session.scalar(select(func.count()).select_from(DecisionVector))


async def test_embed_decisions_gates_consent_and_verdict(evals, db_session, session_factory):
    from app.jobs.embed_decisions import run_embed_decisions

    stats = await run_embed_decisions(only_missing=True, session_factory=session_factory)
    # 僅合作範圍內 + (可行/不可行) 兩筆入庫；待議與範圍外被擋
    assert stats["embedded"] == 2
    rows = (await db_session.execute(select(DecisionVector))).scalars().all()
    tids = {r.tender_id for r in rows}
    assert tids == {evals["t1"], evals["t2"]}
    assert {r.feasible for r in rows} == {"可行", "不可行"}


async def test_embed_decisions_idempotent(evals, db_session, session_factory):
    from app.jobs.embed_decisions import run_embed_decisions

    await run_embed_decisions(only_missing=True, session_factory=session_factory)
    n1 = await _count(db_session)
    stats2 = await run_embed_decisions(only_missing=True, session_factory=session_factory)
    assert stats2["embedded"] == 0  # 第二次無新增
    assert await _count(db_session) == n1

# -*- coding: utf-8 -*-
"""即時判斷學習測試（realtime_learn / learn_keywords allow_auto_negative）。

涵蓋 2026-06-24 紅線覆寫後的「負向即時寫團隊負權」路徑：
- 正向仍自動學成 positive。
- 負向候選即時轉成團隊負權重，並帶 NEG_LEARN_NOTE 標記（免遭 notes-IS-NULL 清除）。
- consent-aware：未同意者不納入團隊聚合。
- append-only：每次重算寫新的 KeywordWeightRevision 批次。
- reasoning 即時吃到學習負權（負向立即影響演算法）。

對照：批次預設 allow_auto_negative=False 時，負向仍只列候選（紅線維持），由
test_learn_keywords.py 守住。
"""
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.jobs.learn_keywords import NEG_LEARN_NOTE
from app.models.behavior import Evaluation, User
from app.models.knowledge import KeywordWeight, KeywordWeightRevision
from app.models.tender import Source, Tender
from app.services import realtime_learn
from app.services.reasoning import explain_tender
from tests.conftest import TestSessionLocal


@pytest.fixture
async def judgment_data(db_session):
    """種子：可行（工程）vs 不可行（勞務），同意共享的使用者。"""
    source = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    db_session.add(source)
    await db_session.flush()

    user = User(
        name="david",
        email="david@hqdesign.tw",
        role="scout",
        whitelist_active=True,
        consent_shared=True,
    )
    db_session.add(user)
    await db_session.flush()

    feasibles = [
        Tender(source_id=source.id, case_pk="F1", name="公路工程維修專案",
               org="公路局", category="工程", budget_wan=500,
               deadline_roc="115/07/01", deadline_iso="2026-07-01"),
        Tender(source_id=source.id, case_pk="F2", name="橋梁工程檢測",
               org="交通部", category="工程", budget_wan=800,
               deadline_roc="115/07/15", deadline_iso="2026-07-15"),
    ]
    infeasibles = [
        Tender(source_id=source.id, case_pk="I1", name="會議勞務承包",
               org="文化部", category="勞務", budget_wan=50,
               deadline_roc="115/06/15", deadline_iso="2026-06-15"),
        Tender(source_id=source.id, case_pk="I2", name="影片剪輯勞務",
               org="教育部", category="勞務", budget_wan=30,
               deadline_roc="115/06/20", deadline_iso="2026-06-20"),
    ]
    for t in feasibles + infeasibles:
        db_session.add(t)
    await db_session.flush()

    now = datetime.now(timezone.utc)
    for t in feasibles:
        db_session.add(Evaluation(user_id=user.id, tender_id=t.id, feasible="可行",
                                  criteria={"budget_fit": True}, rationale="工程契合",
                                  created_at=now))
    for t in infeasibles:
        db_session.add(Evaluation(user_id=user.id, tender_id=t.id, feasible="不可行",
                                  criteria={"budget_fit": False}, rationale="勞務不做",
                                  created_at=now))
    await db_session.commit()
    return {"user": user, "feasible": feasibles, "infeasible": infeasibles}


@pytest.mark.asyncio
async def test_realtime_writes_negative_weights_with_marker(judgment_data, db_session):
    """即時學習：負向候選即時寫成團隊負權，帶 NEG_LEARN_NOTE，不遭清除。"""
    summary = await realtime_learn.learn_after_evaluation(
        session_factory=TestSessionLocal
    )
    assert summary["feasible_samples"] == 2
    assert summary["infeasible_samples"] == 2

    kws = {
        kw.term: kw
        for kw in (await db_session.execute(select(KeywordWeight))).scalars()
    }
    # 正向仍自動學成 positive。
    assert "工程" in kws and kws["工程"].polarity == "positive"
    # 負向「勞務」此路徑即時寫成負權，帶標記、weight 存正幅度。
    assert "勞務" in kws
    assert kws["勞務"].polarity == "negative"
    assert kws["勞務"].notes == NEG_LEARN_NOTE
    assert kws["勞務"].weight > 0  # 存正幅度，消費端施加負號


@pytest.mark.asyncio
async def test_realtime_negative_survives_repurge(judgment_data, db_session):
    """重跑不會把帶標記的負權清掉（notes 非空免遭 notes-IS-NULL 清除）。"""
    await realtime_learn.learn_after_evaluation(session_factory=TestSessionLocal)
    db_session.expire_all()
    await realtime_learn.learn_after_evaluation(session_factory=TestSessionLocal)

    kws = {
        kw.term: kw
        for kw in (await db_session.execute(select(KeywordWeight))).scalars()
    }
    assert "勞務" in kws and kws["勞務"].polarity == "negative"


@pytest.mark.asyncio
async def test_realtime_negative_affects_reasoning(judgment_data, db_session):
    """負向即時影響演算法：含「勞務」的標案，學習負權拉低其關鍵字分數。"""
    await realtime_learn.learn_after_evaluation(session_factory=TestSessionLocal)
    db_session.expire_all()

    # 新標案：名稱含「勞務」、無正向詞、category 留空避免分類主導。
    source = (await db_session.execute(select(Source).limit(1))).scalar()
    t_new = Tender(source_id=source.id, case_pk="NEW-LABOUR", name="勞務派遣案",
                   org="某部", category=None, budget_wan=200,
                   deadline_roc="115/08/01", deadline_iso="2026-08-01")
    db_session.add(t_new)
    await db_session.commit()

    out = await explain_tender(db_session, t_new.id)
    kw_reasons = [r for r in out.reasons if r.factor == "keyword"]
    assert kw_reasons, "應有 keyword reason code"
    assert kw_reasons[0].impact < 0  # 負向學習詞拉低分數
    assert "勞務" in kw_reasons[0].value


@pytest.mark.asyncio
async def test_realtime_consent_aware(judgment_data, db_session):
    """未同意者的負向判斷不得污染團隊負權。"""
    source = (await db_session.execute(select(Source).limit(1))).scalar()
    erin = User(name="erin", email="erin@hqdesign.tw", role="member",
                whitelist_active=True, consent_shared=False)
    db_session.add(erin)
    await db_session.flush()
    t_erin = Tender(source_id=source.id, case_pk="ERIN", name="保全駐衛獨特詞",
                    org="某局", category="勞務", budget_wan=100,
                    deadline_roc="115/08/10", deadline_iso="2026-08-10")
    db_session.add(t_erin)
    await db_session.flush()
    db_session.add(Evaluation(user_id=erin.id, tender_id=t_erin.id, feasible="不可行",
                              criteria={}, rationale="erin 個人判斷",
                              created_at=datetime.now(timezone.utc)))
    await db_session.commit()

    summary = await realtime_learn.learn_after_evaluation(
        session_factory=TestSessionLocal
    )
    assert summary["consenting_users"] == 1  # 只算 david
    team_terms = {
        kw.term
        for kw in (await db_session.execute(select(KeywordWeight))).scalars()
    }
    assert "駐衛" not in team_terms and "保全" not in team_terms


@pytest.mark.asyncio
async def test_realtime_append_only_revisions(judgment_data, db_session):
    """append-only：每次即時學習新增一個 revision 批次，不覆蓋歷史。"""
    s1 = await realtime_learn.learn_after_evaluation(session_factory=TestSessionLocal)
    db_session.expire_all()
    s2 = await realtime_learn.learn_after_evaluation(session_factory=TestSessionLocal)

    batches = set(
        (
            await db_session.execute(
                select(KeywordWeightRevision.batch).distinct()
            )
        ).scalars()
    )
    assert {s1["revision_batch"], s2["revision_batch"]} <= batches
    assert len(batches) >= 2

    # revision 也應快照到負向列（負向 append-only 可回溯）。
    neg_revs = list(
        (
            await db_session.execute(
                select(KeywordWeightRevision).where(
                    KeywordWeightRevision.polarity == "negative"
                )
            )
        ).scalars()
    )
    assert any(r.term == "勞務" for r in neg_revs)

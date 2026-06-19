# -*- coding: utf-8 -*-
"""P4 學習工作測試（keywords learn job）。

離線、無網；種子資料由 fixtures 注入。
"""
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.jobs.learn_keywords import learn_keywords
from app.models.behavior import Evaluation, User
from app.models.knowledge import KeywordWeight, KeywordWeightRevision
from app.models.tender import Source, Tender
from tests.conftest import TestSessionLocal


@pytest.fixture
async def learning_data(db_session):
    """種子資料：可行 vs 不可行 的標案，詞彙區隔明確。"""
    # 創建資料源
    source = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    db_session.add(source)
    await db_session.flush()

    # 創建使用者
    user = User(name="david", email="david@hq.tw", role="scout")
    db_session.add(user)
    await db_session.flush()

    # 可行標案：含「工程」、「高預算」
    t_feasible_1 = Tender(
        source_id=source.id,
        case_pk="PCC-F1",
        name="公路工程維修專案",
        org="公路局",
        category="工程",
        budget_wan=500,
        deadline_roc="115/07/01",
        deadline_iso="2026-07-01",
    )
    t_feasible_2 = Tender(
        source_id=source.id,
        case_pk="PCC-F2",
        name="橋梁工程檢測",
        org="交通部",
        category="工程",
        budget_wan=800,
        deadline_roc="115/07/15",
        deadline_iso="2026-07-15",
    )

    # 不可行標案：含「勞務」、「低預算」
    t_infeasible_1 = Tender(
        source_id=source.id,
        case_pk="PCC-I1",
        name="會議勞務承包",
        org="文化部",
        category="勞務",
        budget_wan=50,
        deadline_roc="115/06/15",
        deadline_iso="2026-06-15",
    )
    t_infeasible_2 = Tender(
        source_id=source.id,
        case_pk="PCC-I2",
        name="影片剪輯勞務",
        org="教育部",
        category="勞務",
        budget_wan=30,
        deadline_roc="115/06/20",
        deadline_iso="2026-06-20",
    )

    for t in [t_feasible_1, t_feasible_2, t_infeasible_1, t_infeasible_2]:
        db_session.add(t)

    await db_session.flush()

    # 建立評估（可行 / 不可行）
    now = datetime.now(timezone.utc)
    evals = [
        Evaluation(
            user_id=user.id,
            tender_id=t_feasible_1.id,
            feasible="可行",
            criteria={"budget_fit": True},
            rationale="預算充足，適合工程團隊",
            created_at=now,
        ),
        Evaluation(
            user_id=user.id,
            tender_id=t_feasible_2.id,
            feasible="可行",
            criteria={"budget_fit": True},
            rationale="大型工程，技術契合",
            created_at=now,
        ),
        Evaluation(
            user_id=user.id,
            tender_id=t_infeasible_1.id,
            feasible="不可行",
            criteria={"budget_fit": False},
            rationale="勞務性質不符，預算太低",
            created_at=now,
        ),
        Evaluation(
            user_id=user.id,
            tender_id=t_infeasible_2.id,
            feasible="不可行",
            criteria={"budget_fit": False},
            rationale="勞務項目，我們不做",
            created_at=now,
        ),
    ]

    for e in evals:
        db_session.add(e)

    await db_session.commit()
    return {
        "user": user,
        "feasible": [t_feasible_1, t_feasible_2],
        "infeasible": [t_infeasible_1, t_infeasible_2],
    }


@pytest.mark.asyncio
async def test_learn_keywords_extracts_polarity(learning_data, db_session):
    """測試：positive 詞應出現在可行標案，negative 詞在不可行標案。"""
    stats = await learn_keywords(session_factory=TestSessionLocal, min_support=1)

    # 驗證樣本數
    assert stats["feasible_samples"] == 2
    assert stats["infeasible_samples"] == 2

    # 驗證關鍵字產出（期望「工程」為 positive，「勞務」為 negative）
    kw_results = (
        await db_session.execute(select(KeywordWeight))
    ).scalars()
    kws = list(kw_results)

    # 應有多個關鍵字被提取
    assert len(kws) > 0

    # 檢查「工程」和「勞務」的極性
    by_term = {kw.term: kw for kw in kws}
    if "工程" in by_term:
        assert by_term["工程"].polarity == "positive"
    if "勞務" in by_term:
        assert by_term["勞務"].polarity == "negative"


@pytest.mark.asyncio
async def test_learn_keywords_update_idempotent(learning_data, db_session):
    """測試：重複運行應更新而非重複插入。"""
    # 首次
    stats1 = await learn_keywords(session_factory=TestSessionLocal, min_support=1)
    count1 = (
        await db_session.execute(select(__import__("sqlalchemy").func.count(KeywordWeight.term)))
    ).scalar()

    # 第二次
    db_session.expire_all()  # 清快取
    stats2 = await learn_keywords(session_factory=TestSessionLocal, min_support=1)
    count2 = (
        await db_session.execute(select(__import__("sqlalchemy").func.count(KeywordWeight.term)))
    ).scalar()

    # 筆數不增加（idempotent）
    assert count1 == count2
    assert stats2["keywords_updated"] > 0


@pytest.mark.asyncio
async def test_learn_keywords_respects_min_support(learning_data, db_session):
    """測試：min_support 門檻過濾低頻詞。"""
    # min_support = 10（超過樣本數），應無詞彙被收錄
    stats = await learn_keywords(session_factory=TestSessionLocal, min_support=10)
    assert stats["keywords_added"] == 0

    # min_support = 1，應有詞彙被收錄
    db_session.expire_all()
    stats = await learn_keywords(session_factory=TestSessionLocal, min_support=1)
    assert stats["keywords_added"] > 0


@pytest.mark.asyncio
async def test_learn_keywords_writes_versioned_snapshot(learning_data, db_session):
    """SL2：每次學習都把當批權重快照寫入 keyword_weight_revisions（可回溯審計）。"""
    stats = await learn_keywords(session_factory=TestSessionLocal, min_support=1)

    batch = stats["revision_batch"]
    assert batch  # ISO8601 時間戳
    assert stats["revision_rows"] > 0

    revs = list(
        (
            await db_session.execute(
                select(KeywordWeightRevision).where(
                    KeywordWeightRevision.batch == batch
                )
            )
        ).scalars()
    )
    # 快照列數 == 該批列入的關鍵字數，且樣本脈絡冗餘存於每列。
    assert len(revs) == stats["revision_rows"]
    assert all(r.feasible_samples == 2 and r.infeasible_samples == 2 for r in revs)

    # 快照內容須與當前 keyword_weights 一致（同 term 的極性／權重相符）。
    kws = {
        kw.term: kw
        for kw in (await db_session.execute(select(KeywordWeight))).scalars()
    }
    for r in revs:
        assert r.term in kws
        assert r.polarity == kws[r.term].polarity
        assert r.weight == pytest.approx(kws[r.term].weight)


@pytest.mark.asyncio
async def test_learn_keywords_snapshots_accumulate_across_runs(
    learning_data, db_session
):
    """SL2：重跑學習會新增一個 batch（append-only），不覆蓋既有快照。"""
    s1 = await learn_keywords(session_factory=TestSessionLocal, min_support=1)
    db_session.expire_all()
    s2 = await learn_keywords(session_factory=TestSessionLocal, min_support=1)

    batches = set(
        (
            await db_session.execute(
                select(KeywordWeightRevision.batch).distinct()
            )
        ).scalars()
    )
    # 兩次迭代 → 至少兩個不同 batch（時間戳不同），歷史保留。
    assert {s1["revision_batch"], s2["revision_batch"]} <= batches
    assert len(batches) >= 2


@pytest.mark.asyncio
async def test_learn_keywords_respects_category_priority(learning_data, db_session):
    """SL2：分類特徵優先於詞彙 TF 評分（Tier 1 > Tier 3）。

    即使名稱中出現「勞務」詞，但 category=工程 時，分類應優先決定極性為 positive。
    """
    # 植入测试数据：category=工程 但名稱含「勞務」詞
    from app.models.tender import Source, Tender
    from app.models.behavior import Evaluation, User

    source = await db_session.execute(select(Source).limit(1))
    source = source.scalar()

    user = await db_session.execute(select(User).limit(1))
    user = user.scalar()

    # 新建標案：分類=工程，名稱=「勞務外包」
    t_conflict = Tender(
        source_id=source.id,
        case_pk="PCC-CONFLICT",
        name="勞務外包工程施工",
        org="工務局",
        category="工程",  # Tier 1：絕對 positive
        budget_wan=300,
        deadline_roc="115/07/20",
        deadline_iso="2026-07-20",
    )
    db_session.add(t_conflict)
    await db_session.flush()

    # 評估為可行
    eval = Evaluation(
        user_id=user.id,
        tender_id=t_conflict.id,
        feasible="可行",
        criteria={"category_fit": True},
        rationale="工程分類無庸置疑",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(eval)
    await db_session.commit()

    # 重新學習
    stats = await learn_keywords(session_factory=TestSessionLocal, min_support=1)

    # 驗證：「工程」應為 positive，且被列為分類特徵（category_features_added > 0）
    kws = {
        kw.term: kw
        for kw in (await db_session.execute(select(KeywordWeight))).scalars()
    }
    assert "工程" in kws
    assert kws["工程"].polarity == "positive"
    assert stats.get("category_features_added", 0) > 0

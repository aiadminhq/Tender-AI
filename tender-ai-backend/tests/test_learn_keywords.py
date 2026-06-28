# -*- coding: utf-8 -*-
"""P4 學習工作測試（keywords learn job）。

離線、無網；種子資料由 fixtures 注入。
"""
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.jobs.learn_keywords import learn_keywords
from app.models.behavior import Evaluation, User
from app.models.knowledge import (
    KeywordWeight,
    KeywordWeightRevision,
    UserKeywordWeight,
)
from app.models.preference import PreferenceProfile, UserManualKeyword
from app.models.tender import Source, Tender
from tests.conftest import TestSessionLocal


@pytest.fixture
async def learning_data(db_session):
    """種子資料：可行 vs 不可行 的標案，詞彙區隔明確。"""
    # 創建資料源
    source = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    db_session.add(source)
    await db_session.flush()

    # 創建使用者（白名單已開通＋已同意共享 → 行為納入團隊聚合）
    user = User(
        name="david",
        email="david@hq.tw",
        role="scout",
        whitelist_active=True,
        consent_shared=True,
    )
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
async def test_learn_keywords_positive_only_negatives_are_candidates(
    learning_data, db_session
):
    """紅線：可行詞自動學成 positive；偏負向詞只列「候選建議」，絕不自動寫負權重。

    「工程」偏可行 → positive 權重；「勞務」偏不可行 → 不得寫入任何 KeywordWeight，
    只能出現在 stats['negative_candidates']（附理由，供人工審核）。
    """
    stats = await learn_keywords(session_factory=TestSessionLocal, min_support=1)

    # 驗證樣本數
    assert stats["feasible_samples"] == 2
    assert stats["infeasible_samples"] == 2

    kws = list((await db_session.execute(select(KeywordWeight))).scalars())
    assert len(kws) > 0

    # 紅線①：keyword_weights 內絕不存在任何「自動產生」的負向列。
    assert all(kw.polarity != "negative" for kw in kws)

    by_term = {kw.term: kw for kw in kws}
    if "工程" in by_term:
        assert by_term["工程"].polarity == "positive"
    # 紅線②：「勞務」偏不可行，不得被寫成（任何極性的）權重。
    assert "勞務" not in by_term

    # 紅線③：「勞務」應改列為「候選建議」，且附審核理由。
    cand_terms = {c["term"] for c in stats["negative_candidates"]}
    assert "勞務" in cand_terms
    labour = next(c for c in stats["negative_candidates"] if c["term"] == "勞務")
    assert labour["infeasible_count"] > labour["feasible_count"]
    assert labour["reason"]  # 附人工審核理由


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


# --------------------------------------------------------------------------- #
# 個人線（user_keyword_weights / preference_profiles）
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_learn_keywords_writes_personal_line(learning_data, db_session):
    """v8：學習任務確實產出 user_keyword_weights / preference_profiles。"""
    user = learning_data["user"]
    stats = await learn_keywords(session_factory=TestSessionLocal, min_support=1)

    assert stats["personal_users_processed"] == 1
    assert stats["user_keyword_weights_written"] > 0
    assert stats["preference_profiles_written"] == 1

    # 個人權重：本人專屬，只自動學「正向」；負分人工專屬，學習不得自動產生負向。
    ukws = {
        u.term: u
        for u in (
            await db_session.execute(
                select(UserKeywordWeight).where(
                    UserKeywordWeight.user_id == user.id
                )
            )
        ).scalars()
    }
    assert ukws  # 非空
    assert ukws["工程"].polarity == "positive"
    # 紅線：個人線也絕不自動產生負向；「勞務」偏不可行也不得被寫成權重。
    assert all(u.polarity != "negative" for u in ukws.values())
    assert "勞務" not in ukws

    # 高層輪廓：偏好類別含 工程；預算區間取本人可行案（500、800）。
    # 避免詞只取本人「手動」迴避詞；本案未手動設定，故 avoid_keywords 應為空。
    profile = (
        await db_session.execute(
            select(PreferenceProfile).where(
                PreferenceProfile.user_id == user.id
            )
        )
    ).scalar_one()
    assert "工程" in profile.preferred_categories
    assert "工程" in profile.top_keywords
    assert profile.avoid_keywords == []
    assert profile.budget_min == 500
    assert profile.budget_max == 800


@pytest.mark.asyncio
async def test_avoid_keywords_come_from_manual_only(learning_data, db_session):
    """紅線：preference_profiles.avoid_keywords 只能來自本人「手動」迴避詞。

    手動把「勞務」標為迴避（UserManualKeyword kind=negative）後，它應出現在
    avoid_keywords；但 user_keyword_weights 仍不得出現任何自動負向列。
    """
    user = learning_data["user"]
    db_session.add(
        UserManualKeyword(
            user_id=user.id, term="勞務", kind="negative", excluded=False
        )
    )
    await db_session.commit()

    await learn_keywords(session_factory=TestSessionLocal, min_support=1)

    profile = (
        await db_session.execute(
            select(PreferenceProfile).where(PreferenceProfile.user_id == user.id)
        )
    ).scalar_one()
    # 手動迴避詞進 avoid_keywords。
    assert "勞務" in profile.avoid_keywords

    # 但個人權重表仍不得有任何自動負向列（手動迴避不寫進 user_keyword_weights）。
    ukws = list(
        (
            await db_session.execute(
                select(UserKeywordWeight).where(
                    UserKeywordWeight.user_id == user.id
                )
            )
        ).scalars()
    )
    assert all(u.polarity != "negative" for u in ukws)


@pytest.mark.asyncio
async def test_team_join_is_consent_aware(learning_data, db_session):
    """v5：未同意者的行為不納入團隊 keyword_weights，但個人線仍更新。

    新增第二位使用者 erin（白名單但未同意），其評估只走個人線；團隊樣本數不應
    把 erin 的標案算進去。
    """
    source = (await db_session.execute(select(Source).limit(1))).scalar()

    # 未同意者：whitelist_active=True、consent_shared=False
    erin = User(
        name="erin",
        email="erin@hqdesign.tw",
        role="member",
        whitelist_active=True,
        consent_shared=False,
    )
    db_session.add(erin)
    await db_session.flush()

    # erin 的可行標案：含獨特詞「資訊」，不應進團隊聚合
    t_erin = Tender(
        source_id=source.id,
        case_pk="PCC-ERIN",
        name="資訊系統維護資訊資訊",
        org="資訊局",
        category="勞務",
        budget_wan=400,
        deadline_roc="115/08/01",
        deadline_iso="2026-08-01",
    )
    db_session.add(t_erin)
    await db_session.flush()
    db_session.add(
        Evaluation(
            user_id=erin.id,
            tender_id=t_erin.id,
            feasible="可行",
            criteria={"budget_fit": True},
            rationale="erin 個人判斷可行",
            created_at=datetime.now(timezone.utc),
        )
    )
    await db_session.commit()

    stats = await learn_keywords(session_factory=TestSessionLocal, min_support=1)

    # 團隊線：只算 david（已同意）的 2 可行 + 2 不可行；erin 不計入
    assert stats["consenting_users"] == 1
    assert stats["feasible_samples"] == 2
    assert stats["infeasible_samples"] == 2

    # erin 的獨特詞「資訊」不得進團隊 keyword_weights
    team_terms = {
        kw.term
        for kw in (await db_session.execute(select(KeywordWeight))).scalars()
    }
    assert "資訊" not in team_terms

    # 但 erin 的個人線仍更新（兩位使用者都處理）
    assert stats["personal_users_processed"] == 2
    erin_ukws = (
        await db_session.execute(
            select(UserKeywordWeight).where(UserKeywordWeight.user_id == erin.id)
        )
    ).scalars().all()
    assert any(u.term == "資訊" for u in erin_ukws)

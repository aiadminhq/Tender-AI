# -*- coding: utf-8 -*-
"""SL6 自我進化測試（離線、無網；合成種子資料）。

驗收對齊願景第 6 點「最後這樣就可以自我進化」：
- run_evolution：跑一輪學習 → 讀 top 判準詞 → 聚合行為信號 → append 一列稽核日誌。
- 版本推進：重跑會累積 evolution_logs 與 keyword_weight_revisions（append-only）。
- get_evolution_status：最新日誌 + 歷史時間軸 + 當前生效權重。
- aggregate_behavior_signals：Layer A 聚合（計數＋公開衍生詞彙），user_id 嚴格隔離。
- Layer A 安全：所有對外欄位不含人名／email（無 "@"）、不回放個別評語原文。
- API：POST /evolution/run 回傳稽核日誌；GET /evolution/status 回傳現況。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.models.behavior import Evaluation, Event, User
from app.models.knowledge import EvolutionLog, KeywordWeightRevision
from app.models.tender import Source, Tender
from app.services import evolution as evo
from app.services.behavior import DEFAULT_USER_NAME
from tests.conftest import TestSessionLocal

EVO_BASE = "/api/v1"


# --------------------------------------------------------------------------- #
# 種子：可行 vs 不可行（詞彙區隔明確）＋ 預設使用者行為事件 ＋ 第二使用者（隔離）
# --------------------------------------------------------------------------- #
@pytest.fixture
async def evo_seed(db_session):
    """植入進化迴圈所需的合成資料：

    - 預設使用者 ``default``（含 email，用以驗證聚合輸出不外洩 email）。
    - 可行標案 2 筆（含「工程」、台北市、PCC）＋ 不可行 2 筆（含「勞務」、桃園市、PCC）。
    - 評估 2 可行 / 2 不可行（criteria 僅可行為 truthy domain_fit）。
    - 預設使用者事件：view×2 / open_detail×1（皆落在可行標案）＋ apply_filter / search（無標案）。
    - 第二使用者 ``rival``：只 1 筆事件，用以驗證 user_id 隔離。
    """
    source = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    db_session.add(source)
    await db_session.flush()

    # 預設使用者（services.behavior 以 name == DEFAULT_USER_NAME 解析）；給 email 以驗無外洩。
    default_user = User(
        name=DEFAULT_USER_NAME,
        email="scout@hq.tw",
        role="member",
        whitelist_active=True,
        consent_shared=True,
    )
    rival = User(name="rival", email="rival@hq.tw", role="scout")
    db_session.add_all([default_user, rival])
    await db_session.flush()

    t_f1 = Tender(
        source_id=source.id, case_pk="PCC-F1", name="公路工程維修專案",
        org="公路局", category="工程", city="台北市", budget_wan=500,
        deadline_roc="115/07/01", deadline_iso="2026-07-01",
    )
    t_f2 = Tender(
        source_id=source.id, case_pk="PCC-F2", name="橋梁工程檢測案",
        org="交通部", category="工程", city="台北市", budget_wan=800,
        deadline_roc="115/07/15", deadline_iso="2026-07-15",
    )
    t_i1 = Tender(
        source_id=source.id, case_pk="PCC-I1", name="會議勞務承包",
        org="文化部", category="勞務", city="桃園市", budget_wan=50,
        deadline_roc="115/06/15", deadline_iso="2026-06-15",
    )
    t_i2 = Tender(
        source_id=source.id, case_pk="PCC-I2", name="影片剪輯勞務",
        org="教育部", category="勞務", city="桃園市", budget_wan=30,
        deadline_roc="115/06/20", deadline_iso="2026-06-20",
    )
    db_session.add_all([t_f1, t_f2, t_i1, t_i2])
    await db_session.flush()

    now = datetime.now(timezone.utc)
    db_session.add_all([
        Evaluation(user_id=default_user.id, tender_id=t_f1.id, feasible="可行",
                   criteria={"domain_fit": True}, rationale="工程契合", created_at=now),
        Evaluation(user_id=default_user.id, tender_id=t_f2.id, feasible="可行",
                   criteria={"domain_fit": True}, rationale="技術契合", created_at=now),
        Evaluation(user_id=default_user.id, tender_id=t_i1.id, feasible="不可行",
                   criteria={"domain_fit": False}, rationale="勞務不符", created_at=now),
        Evaluation(user_id=default_user.id, tender_id=t_i2.id, feasible="不可行",
                   criteria={"domain_fit": False}, rationale="不做勞務", created_at=now),
    ])

    # 預設使用者事件：3 筆落在「工程／台北市／PCC」的可行標案，2 筆無標案層級事件。
    db_session.add_all([
        Event(user_id=default_user.id, type="view", tender_id=t_f1.id),
        Event(user_id=default_user.id, type="view", tender_id=t_f2.id),
        Event(user_id=default_user.id, type="open_detail", tender_id=t_f1.id),
        Event(user_id=default_user.id, type="apply_filter", tender_id=None,
              payload={"category": "工程"}),
        Event(user_id=default_user.id, type="search", tender_id=None,
              payload={"q": "工程"}),
        # 第二使用者：僅 1 筆，驗隔離
        Event(user_id=rival.id, type="view", tender_id=t_i1.id),
    ])
    await db_session.commit()

    return {
        "default_user_id": default_user.id,
        "rival_id": rival.id,
        "feasible": [t_f1.id, t_f2.id],
        "infeasible": [t_i1.id, t_i2.id],
    }


def _assert_no_pii(payload) -> None:
    """Layer A 硬規則：序列化後整包不得出現 email（"@"），亦不得出現使用者名稱。"""
    blob = json.dumps(payload, ensure_ascii=False, default=str)
    assert "@" not in blob, f"PII（email）外洩於：{blob}"
    assert DEFAULT_USER_NAME not in blob and "rival" not in blob


# --------------------------------------------------------------------------- #
# 行為信號聚合
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_aggregate_behavior_signals(evo_seed, db_session):
    """聚合預設使用者信號：計數正確、皆為 Layer A 公開維度、無 PII。"""
    uid = evo_seed["default_user_id"]
    sig = await evo.aggregate_behavior_signals(db_session, uid)

    assert sig["user_id"] == uid
    assert sig["events_total"] == 5
    assert sig["event_type_counts"] == {
        "view": 2, "open_detail": 1, "apply_filter": 1, "search": 1
    }
    # 3 筆有標案的事件全落在「工程／台北市／PCC」
    assert sig["top_categories"] == [{"value": "工程", "count": 3}]
    assert sig["top_cities"] == [{"value": "台北市", "count": 3}]
    assert sig["top_sources"] == [{"value": "PCC", "count": 3}]
    # 評估：2 可行 / 2 不可行；criteria 僅可行為 truthy → domain_fit 命中 2
    assert sig["evaluation_counts"] == {"可行": 2, "不可行": 2}
    assert sig["top_criteria"] == [{"key": "domain_fit", "count": 2}]

    _assert_no_pii(sig)


@pytest.mark.asyncio
async def test_aggregate_user_isolation(evo_seed, db_session):
    """user_id 嚴格隔離：第二使用者只看得到自己的 1 筆事件、無評估。"""
    sig_a = await evo.aggregate_behavior_signals(db_session, evo_seed["default_user_id"])
    sig_b = await evo.aggregate_behavior_signals(db_session, evo_seed["rival_id"])

    assert sig_a["events_total"] == 5
    assert sig_b["events_total"] == 1
    assert sig_b["event_type_counts"] == {"view": 1}
    assert sig_b["evaluation_counts"] == {}  # B 無評估
    assert sig_b["top_criteria"] == []
    # B 看的是不可行標案（勞務／桃園市）
    assert sig_b["top_categories"] == [{"value": "勞務", "count": 1}]


@pytest.mark.asyncio
async def test_aggregate_empty_when_no_user(db_session):
    """user_id 為 None（查無使用者）回空骨架，且不建立任何使用者（唯讀無副作用）。"""
    sig = await evo.aggregate_behavior_signals(db_session, None)
    assert sig["events_total"] == 0
    assert sig["event_type_counts"] == {}
    assert sig["top_categories"] == []

    cnt = (await db_session.execute(select(func.count()).select_from(User))).scalar()
    assert cnt == 0


# --------------------------------------------------------------------------- #
# run_evolution（編排：學習 → top 判準詞 → 信號 → 稽核日誌）
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_run_evolution_writes_log(evo_seed, db_session):
    """跑一輪：產出稽核日誌，含樣本脈絡、top 重點詞／避免詞與行為信號。"""
    log = await evo.run_evolution(
        session_factory=TestSessionLocal, trigger="test", min_support=1
    )

    assert log["id"] >= 1
    assert log["trigger"] == "test"
    assert log["feasible_samples"] == 2
    assert log["infeasible_samples"] == 2
    assert log["revision_rows"] > 0
    assert log["batch"]  # ISO8601 批號（連回 keyword_weight_revisions）
    assert log["created_at"]

    # top 判準詞為系統推斷的承標判準（公開衍生詞彙）
    pos_terms = {w["term"] for w in log["top_positive"]}
    neg_terms = {w["term"] for w in log["top_negative"]}
    assert "工程" in pos_terms
    assert "勞務" in neg_terms

    # 行為信號為預設使用者的 Layer A 聚合
    assert log["signals"]["events_total"] == 5
    assert log["signals"]["top_categories"] == [{"value": "工程", "count": 3}]

    # 稽核軌跡確實落庫，且 batch 對得上 keyword_weight_revisions
    db_session.expire_all()
    rows = (
        await db_session.execute(
            select(EvolutionLog).where(EvolutionLog.batch == log["batch"])
        )
    ).scalars().all()
    assert len(rows) == 1
    rev_cnt = (
        await db_session.execute(
            select(func.count())
            .select_from(KeywordWeightRevision)
            .where(KeywordWeightRevision.batch == log["batch"])
        )
    ).scalar()
    assert rev_cnt == log["revision_rows"]

    _assert_no_pii(log)


@pytest.mark.asyncio
async def test_run_evolution_appends_versions(evo_seed, db_session):
    """版本推進：重跑為 append-only — evolution_logs 與 revisions 各累積一個新 batch。"""
    log1 = await evo.run_evolution(
        session_factory=TestSessionLocal, trigger="t1", min_support=1
    )
    log2 = await evo.run_evolution(
        session_factory=TestSessionLocal, trigger="t2", min_support=1
    )

    assert log2["id"] > log1["id"]
    assert log1["batch"] != log2["batch"]  # 時間戳批號不同

    db_session.expire_all()
    total_logs = (
        await db_session.execute(select(func.count()).select_from(EvolutionLog))
    ).scalar()
    assert total_logs == 2

    batches = set(
        (
            await db_session.execute(
                select(KeywordWeightRevision.batch).distinct()
            )
        ).scalars()
    )
    assert {log1["batch"], log2["batch"]} <= batches


# --------------------------------------------------------------------------- #
# get_evolution_status
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_get_evolution_status(evo_seed, db_session):
    """現況：total_runs / latest / history / 當前生效權重；最新在前。"""
    await evo.run_evolution(session_factory=TestSessionLocal, trigger="a", min_support=1)
    log2 = await evo.run_evolution(
        session_factory=TestSessionLocal, trigger="b", min_support=1
    )

    db_session.expire_all()
    status = await evo.get_evolution_status(db_session, history_limit=10)

    assert status["total_runs"] == 2
    assert status["latest"]["id"] == log2["id"]
    assert status["latest"]["trigger"] == "b"
    assert len(status["history"]) == 2
    # 歷史時間軸最新在前
    assert status["history"][0]["id"] >= status["history"][1]["id"]
    # 當前生效權重（即時驅動排序）
    assert any(w["term"] == "工程" for w in status["active_positive"])
    assert any(w["term"] == "勞務" for w in status["active_negative"])

    _assert_no_pii(status)


@pytest.mark.asyncio
async def test_get_evolution_status_empty(db_session):
    """從未跑過：total_runs=0、latest 為 None、history 空。"""
    status = await evo.get_evolution_status(db_session)
    assert status["total_runs"] == 0
    assert status["latest"] is None
    assert status["history"] == []


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_api_run_and_status(evo_seed, client):
    """POST /evolution/run 回傳稽核日誌；GET /evolution/status 反映該次執行。"""
    resp = await client.post(
        f"{EVO_BASE}/evolution/run", json={"trigger": "api", "min_support": 1}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["trigger"] == "api"
    assert body["feasible_samples"] == 2
    assert body["infeasible_samples"] == 2
    assert {w["term"] for w in body["top_positive"]} & {"工程"}
    assert body["signals"]["events_total"] == 5
    _assert_no_pii(body)

    s = await client.get(f"{EVO_BASE}/evolution/status")
    assert s.status_code == 200
    sbody = s.json()
    assert sbody["total_runs"] == 1
    assert sbody["latest"]["trigger"] == "api"
    assert any(w["term"] == "工程" for w in sbody["active_positive"])
    _assert_no_pii(sbody)


@pytest.mark.asyncio
async def test_api_status_empty(client):
    """無資料時 status 仍正常回傳空骨架。"""
    s = await client.get(f"{EVO_BASE}/evolution/status")
    assert s.status_code == 200
    body = s.json()
    assert body["total_runs"] == 0
    assert body["latest"] is None
    assert body["history"] == []

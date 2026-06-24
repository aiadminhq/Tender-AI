# -*- coding: utf-8 -*-
"""SL3 意圖與推理引擎測試。

離線、無網；種子資料由 fixtures 注入（合成資料，真實行為/評價永不進版控）。
驗收對齊願景：
- 「推理使用者衡量可中標的標準」→ build_criteria_profile 的 lift 方向正確
  （工程 → 正、勞務/財物 → 負），且 base_rate / 預算區間 / 信心分級正確。
- 「為何（不）值得投標」→ explain_tender 對工程案給 strong、勞務案給 weak，
  並逐條帶出可解釋 reason code。
- 「懂得學習操作者為何點擊」→ events（open_detail/dwell）推導 engaged 類別。
- 冷啟動（無評估）不崩、退為 base_rate 0.5 + confidence low。
"""
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select  # noqa: F401  保留與其他測試一致的匯入風格

from app.core.errors import EntityNotFound
from app.models.behavior import Evaluation, Event, User
from app.models.knowledge import KeywordWeight
from app.models.preference import UserManualKeyword
from app.models.tender import DailyTender, Source, Tender
from app.services import reasoning as svc
from tests.conftest import TestSessionLocal

REASON_BASE = "/api/v1"


@pytest.fixture
async def reasoning_data(db_session):
    """種子：工程（可行）vs 勞務/財物（不可行），詞彙＋類別＋預算區隔明確。

    回傳 label → tender_id 與 user。
    """
    source = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    db_session.add(source)
    await db_session.flush()

    user = User(name="aaron", email="aaron@hq.tw", role="scout")
    db_session.add(user)
    await db_session.flush()

    # 3 件可行：工程（台北/新北），預算 150–900；2 件不可行：勞務/財物，預算 20/40。
    t_eng_a = Tender(
        source_id=source.id, case_pk="E1", name="校舍工程改善統包",
        org="台北市政府教育局", category="工程", budget_wan=300,
        deadline_roc="115/07/01", deadline_iso=date(2026, 7, 1), city="台北市",
        link="https://x.test/e1",
    )
    t_eng_b = Tender(
        source_id=source.id, case_pk="E2", name="排水溝營繕工程",
        org="新北市水利局", category="工程", budget_wan=900,
        deadline_roc="115/07/10", deadline_iso=date(2026, 7, 10), city="新北市",
        link="https://x.test/e2",
    )
    t_eng_c = Tender(
        source_id=source.id, case_pk="E3", name="人行道鋪面工程",
        org="台北市工務局", category="工程", budget_wan=150,
        deadline_roc="115/07/05", deadline_iso=date(2026, 7, 5), city="台北市",
        link="https://x.test/e3",
    )
    t_lab = Tender(
        source_id=source.id, case_pk="L1", name="會議影音勞務委外服務",
        org="文化部", category="勞務", budget_wan=20,
        deadline_roc="115/06/20", deadline_iso=date(2026, 6, 20), city="新北市",
        link="https://x.test/l1",
    )
    t_goods = Tender(
        source_id=source.id, case_pk="G1", name="辦公設備財物採購",
        org="教育部", category="財物", budget_wan=40,
        deadline_roc="115/06/22", deadline_iso=date(2026, 6, 22), city="新北市",
        link="https://x.test/g1",
    )
    db_session.add_all([t_eng_a, t_eng_b, t_eng_c, t_lab, t_goods])
    await db_session.flush()

    # 一筆近截止快照（工程 a，days_left=3）→ 觸發 urgency 中性提示。
    db_session.add_all([
        DailyTender(run_date=date(2026, 6, 18), tender_id=t_eng_a.id, tier="high", days_left=3),
        DailyTender(run_date=date(2026, 6, 18), tender_id=t_eng_b.id, tier="mid", days_left=20),
    ])

    now = datetime.now(timezone.utc)
    db_session.add_all([
        Evaluation(user_id=user.id, tender_id=t_eng_a.id, feasible="可行", created_at=now),
        Evaluation(user_id=user.id, tender_id=t_eng_b.id, feasible="可行", created_at=now),
        Evaluation(user_id=user.id, tender_id=t_eng_c.id, feasible="可行", created_at=now),
        Evaluation(user_id=user.id, tender_id=t_lab.id, feasible="不可行", created_at=now),
        Evaluation(user_id=user.id, tender_id=t_goods.id, feasible="不可行", created_at=now),
    ])

    # SL2 學習關鍵字（正：工程）。另存一筆 legacy 自動負權重（勞務）作為紅線探針：
    # 系統負權重一律不得進入判準輪廓或 per-tender 計分（負分人工專屬，見 CLAUDE.md P4/P5）。
    db_session.add_all([
        KeywordWeight(term="工程", polarity="positive", weight=0.8),
        KeywordWeight(term="勞務", polarity="negative", weight=0.7),
    ])

    # 行為事件：操作者多次點開「工程」案（engaged 偏好）。
    db_session.add_all([
        Event(user_id=user.id, tender_id=t_eng_a.id, type="open_detail"),
        Event(user_id=user.id, tender_id=t_eng_b.id, type="dwell"),
        Event(user_id=user.id, tender_id=t_eng_c.id, type="open_detail"),
        Event(user_id=user.id, tender_id=t_lab.id, type="view"),  # view 不算 engaged
    ])

    await db_session.commit()
    return {
        "user": user.id,
        "eng_a": t_eng_a.id,
        "eng_b": t_eng_b.id,
        "eng_c": t_eng_c.id,
        "lab": t_lab.id,
        "goods": t_goods.id,
    }


# --------------------------------------------------------------------------- #
# build_criteria_profile
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_profile_lift_direction(reasoning_data, db_session):
    """工程 lift 應為正、勞務/財物為負；base_rate = 3/5 = 0.6。"""
    p = await svc.build_criteria_profile(db_session)
    assert p.n_evaluations == 5
    assert p.base_rate == pytest.approx(0.6)

    eng = p.category["工程"]
    assert eng.feasible == 3 and eng.infeasible == 0
    assert eng.lift > 0  # 偏好
    lab = p.category["勞務"]
    assert lab.lift < 0  # 迴避
    goods = p.category["財物"]
    assert goods.lift < 0


@pytest.mark.asyncio
async def test_profile_budget_and_keywords(reasoning_data, db_session):
    """可行案預算區間取自可行標案；正向學習詞進輪廓，系統負權重一律不帶出。

    紅線：``kw_negative`` 只收本人「手動」迴避詞；無人工覆寫時即為空，
    legacy 自動負權重（勞務）不得外洩到輪廓（見 CLAUDE.md P4/P5）。
    """
    p = await svc.build_criteria_profile(db_session)
    assert p.budget_min == 150
    assert p.budget_max == 900
    assert "工程" in p.kw_positive
    assert "勞務" not in p.kw_positive  # 負權重不得混進正向
    assert p.kw_negative == []  # 無人工迴避詞 → 空（負分人工專屬）


@pytest.mark.asyncio
async def test_profile_engaged_categories_from_events(reasoning_data, db_session):
    """engaged 類別由 open_detail/dwell 推導；view 不計入。"""
    p = await svc.build_criteria_profile(db_session)
    assert "工程" in p.engaged_categories
    # 勞務只有 view 事件，不應被視為 engaged
    assert "勞務" not in p.engaged_categories


@pytest.mark.asyncio
async def test_profile_cold_start(db_session):
    """無任何評估：不崩、base_rate=0.5、confidence=low。"""
    p = await svc.build_criteria_profile(db_session)
    assert p.n_evaluations == 0
    assert p.base_rate == pytest.approx(0.5)
    out = svc.profile_to_out(p)
    assert out.confidence == "low"
    assert out.summary  # 仍給得出白話摘要


# --------------------------------------------------------------------------- #
# explain_tender
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_explain_engineering_is_strong(reasoning_data, db_session):
    """工程案 → strong，且含正向類別 reason 與急迫中性提示。"""
    out = await svc.explain_tender(db_session, reasoning_data["eng_a"])
    assert out.verdict == "strong"
    assert out.criteria_fit >= 62
    factors = {r.factor: r for r in out.reasons}
    assert factors["category"].direction == "positive"
    # eng_a 有 days_left=3 的快照 → urgency 中性提示
    assert "urgency" in factors
    assert factors["urgency"].direction == "neutral"


@pytest.mark.asyncio
async def test_explain_labour_is_weak(reasoning_data, db_session):
    """勞務案 → weak，類別為負向；無人工迴避詞時不靠關鍵字負分（紅線）。

    負向方向應由「類別 lift」（資料驅動）帶出，而非系統自動負權重關鍵字；
    未給人工迴避詞時，計分不得出現任何負向 keyword 因子。
    """
    out = await svc.explain_tender(db_session, reasoning_data["lab"])
    assert out.verdict == "weak"
    assert out.criteria_fit < 42
    factors = {r.factor: r for r in out.reasons}
    assert factors["category"].direction == "negative"
    # 紅線：legacy 自動負權重（勞務）不得在計分產生負向關鍵字因子
    assert "keyword" not in factors or factors["keyword"].direction != "negative"


@pytest.mark.asyncio
async def test_manual_negative_applies_in_scoring(reasoning_data, db_session):
    """負分人工專屬紅線：唯有本人「手動」迴避詞才在 per-tender 計分產生負向關鍵字因子。

    勞務案不命中任何正向學習詞——未給人工迴避詞時無 keyword 因子（即便 DB 內存有
    legacy 自動負權重「勞務」也不得計分）；本人手動把「勞務」列為迴避詞後，計分才
    出現 direction=negative 的 keyword 因子，且證據點明是「你設定的迴避關鍵字」。
    """
    uid = reasoning_data["user"]
    lab = reasoning_data["lab"]

    # before：未給人工迴避詞 → 無 keyword 因子（系統負權重不得自動計分）
    before = await svc.explain_tender(db_session, lab, user_id=uid)
    assert "keyword" not in {r.factor for r in before.reasons}

    # 本人手動指定迴避詞「勞務」（唯一合規負分來源）
    db_session.add(
        UserManualKeyword(user_id=uid, term="勞務", kind="negative", excluded=False)
    )
    await db_session.commit()

    # after：計分出現負向 keyword 因子，且證據點明來自本人設定的迴避詞
    after = await svc.explain_tender(db_session, lab, user_id=uid)
    factors = {r.factor: r for r in after.reasons}
    assert "keyword" in factors
    assert factors["keyword"].direction == "negative"
    assert factors["keyword"].impact < 0
    assert "迴避關鍵字" in factors["keyword"].evidence


@pytest.mark.asyncio
async def test_explain_reasons_sorted_by_impact(reasoning_data, db_session):
    """加權 reason 應依 |impact| 由大到小排序（中性提示殿後）。"""
    out = await svc.explain_tender(db_session, reasoning_data["lab"])
    weighted = [abs(r.impact) for r in out.reasons if r.direction != "neutral"]
    assert weighted == sorted(weighted, reverse=True)


@pytest.mark.asyncio
async def test_explain_missing_tender_raises(reasoning_data, db_session):
    with pytest.raises(EntityNotFound):
        await svc.explain_tender(db_session, 999999)


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_api_profile_endpoint(reasoning_data, client):
    resp = await client.get(f"{REASON_BASE}/reasoning/profile")
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_evaluations"] == 5
    cats = {c["value"]: c for c in body["category_signals"]}
    assert cats["工程"]["lift"] > 0


@pytest.mark.asyncio
async def test_api_tender_reasoning_endpoint(reasoning_data, client):
    tid = reasoning_data["eng_a"]
    resp = await client.get(f"{REASON_BASE}/tenders/{tid}/reasoning")
    assert resp.status_code == 200
    body = resp.json()
    assert body["tender_id"] == tid
    assert body["verdict"] == "strong"
    assert body["reasons"]


@pytest.mark.asyncio
async def test_api_tender_reasoning_404(reasoning_data, client):
    resp = await client.get(f"{REASON_BASE}/tenders/999999/reasoning")
    assert resp.status_code == 404


# --------------------------------------------------------------------------- #
# §3.2 分類直接映射先驗（無評估歷史時的領域先驗）
# §3.3 預算絕對軟閾值（無個人承接區間時的概略判斷）
# 對齊 P4_LEARNING_ANALYSIS.md §3.2/3.3 與 §5.1 測試構想。
# --------------------------------------------------------------------------- #
@pytest.fixture
async def prior_source(db_session):
    """僅建立資料源；用於建構「無評估歷史」的冷啟動標案。"""
    source = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    db_session.add(source)
    await db_session.flush()
    return source


async def _make_tender(db_session, source, *, case_pk, category, budget, org="某機關"):
    t = Tender(
        source_id=source.id, case_pk=case_pk, name=f"{org}{category or ''}案",
        org=org, category=category, budget_wan=budget, link=f"https://x.test/{case_pk}",
    )
    db_session.add(t)
    await db_session.flush()
    await db_session.commit()
    return t.id


@pytest.mark.asyncio
async def test_category_prior_engineering_cold_start(db_session, prior_source):
    """冷啟動（零評估）：工程類仍以分類先驗給正向、fit 高於基準。"""
    tid = await _make_tender(
        db_session, prior_source, case_pk="P1", category="工程", budget=200
    )
    out = await svc.explain_tender(db_session, tid)
    factors = {r.factor: r for r in out.reasons}
    assert "category" in factors
    assert factors["category"].direction == "positive"
    assert out.criteria_fit > 50


@pytest.mark.asyncio
async def test_category_prior_goods_cold_start(db_session, prior_source):
    """冷啟動：財物類方向尚未認證 → 中性（不扣分），不得以先驗壓低 fit。

    財物/勞務 樣本少（7/5）且 0% 可行率尚未認證，依指示先視為 0.0；
    待累積足量評估後再由 lift（資料優先分支）自然帶出方向。
    """
    tid = await _make_tender(
        db_session, prior_source, case_pk="P2", category="財物", budget=200
    )
    out = await svc.explain_tender(db_session, tid)
    factors = {r.factor: r for r in out.reasons}
    assert "category" in factors
    assert factors["category"].direction == "neutral"
    assert factors["category"].impact == 0.0


@pytest.mark.asyncio
async def test_budget_soft_threshold_high(db_session, prior_source):
    """無個人預算歷史：預算 ≥300 萬 → 預算軟正向（§3.3）。"""
    tid = await _make_tender(
        db_session, prior_source, case_pk="B1", category=None, budget=400
    )
    out = await svc.explain_tender(db_session, tid)
    factors = {r.factor: r for r in out.reasons}
    assert "budget" in factors
    assert factors["budget"].direction == "positive"


@pytest.mark.asyncio
async def test_budget_soft_threshold_low(db_session, prior_source):
    """無個人預算歷史：預算 <100 萬 → 預算軟負向（§3.3）。"""
    tid = await _make_tender(
        db_session, prior_source, case_pk="B2", category=None, budget=50
    )
    out = await svc.explain_tender(db_session, tid)
    factors = {r.factor: r for r in out.reasons}
    assert "budget" in factors
    assert factors["budget"].direction == "negative"


@pytest.mark.asyncio
async def test_budget_soft_threshold_neutral_zone(db_session, prior_source):
    """100–300 萬：中性區，不產生 budget reason；299 萬亦視為中性（§5.1）。"""
    tid = await _make_tender(
        db_session, prior_source, case_pk="B3", category=None, budget=299
    )
    out = await svc.explain_tender(db_session, tid)
    assert "budget" not in {r.factor for r in out.reasons}

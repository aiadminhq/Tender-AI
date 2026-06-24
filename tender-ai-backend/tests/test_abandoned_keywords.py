# -*- coding: utf-8 -*-
"""規則頁「建議迴避字根」端點測試（P3 規則字根連動）。

驗收對齊需求與紅線：
- 由本人**實際淘汰**的標案（速覽 pass 事件 ∪ 狀態＝放棄）標題聚合字根／詞候選。
- 文件頻次：``count`` ＝出現在幾件你淘汰的標案；附最多 3 筆示例標題。
- 排除：本人正向詞（不建議迴避喜歡的）＋已手動迴避詞（不重複建議）。
- 非淘汰標案的詞不得汙染候選。
- 紅線（negative-keywords-human-only）：呼叫此唯讀端點**不得**寫入任何負權重；
  真正歸負分只發生在本人按「加入迴避」走 POST /me/keywords（kind=negative）。

離線、無網；合成種子資料。
"""
from datetime import date

import pytest
from sqlalchemy import func, select

from app.models.behavior import Event, TenderUserState, User
from app.models.knowledge import KeywordWeight
from app.models.preference import UserManualKeyword
from app.models.tender import Source, Tender

BASE = "/api/v1"


@pytest.fixture
async def abandoned_data(db_session):
    """種子：兩件被淘汰的清潔勞務案（共享「勞務」「清潔」）＋一件未淘汰的工程案。

    - t_lab1 經速覽 pass 事件淘汰；t_lab2 經狀態＝放棄淘汰。
    - t_eng 未被淘汰（控制組），其專屬詞（工程/道路）不得進候選。
    - 正向詞「清潔」應被排除；已手動迴避詞「委外」應被排除。
    """
    user = User(name="tester", email="tester@hqdesign.tw")
    db_session.add(user)
    source = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    db_session.add(source)
    await db_session.flush()

    t_lab1 = Tender(
        source_id=source.id, case_pk="AB-L1", name="桃園市清潔勞務委外",
        org="桃園市環保局", category="勞務", budget_wan=80,
        deadline_iso=date(2026, 7, 7), city="桃園市", link="https://x.test/l1",
    )
    t_lab2 = Tender(
        source_id=source.id, case_pk="AB-L2", name="新北市清潔勞務承攬",
        org="新北市環保局", category="勞務", budget_wan=90,
        deadline_iso=date(2026, 7, 8), city="新北市", link="https://x.test/l2",
    )
    t_eng = Tender(
        source_id=source.id, case_pk="AB-E", name="台北市道路工程改善",
        org="台北市政府", category="工程", budget_wan=300,
        deadline_iso=date(2026, 7, 1), city="台北市", link="https://x.test/e",
    )
    db_session.add_all([t_lab1, t_lab2, t_eng])
    await db_session.flush()

    # 淘汰訊號一：速覽 ✗/pass 事件（t_lab1）
    db_session.add(
        Event(
            user_id=user.id, type="view", tender_id=t_lab1.id,
            payload={"scope": "swipe", "action": "pass", "reason": "預算過低"},
        )
    )
    # 淘汰訊號二：狀態＝放棄（t_lab2）
    db_session.add(
        TenderUserState(user_id=user.id, tender_id=t_lab2.id, status="放棄")
    )
    # 正向詞（系統可自動學）：清潔 → 應被排除於候選之外
    db_session.add(
        KeywordWeight(term="清潔", polarity="positive", weight=0.7, support=5)
    )
    # 已手動迴避詞：委外 → 已處理過，不再重複建議
    db_session.add(
        UserManualKeyword(
            user_id=user.id, term="委外", kind="negative", excluded=False
        )
    )
    await db_session.commit()
    return {"user": user.id, "lab1": t_lab1.id, "lab2": t_lab2.id, "eng": t_eng.id}


async def test_aggregates_roots_from_abandoned_titles(client, abandoned_data):
    """「勞務」出現在兩件被淘汰的標案 → count==2，附示例標題。"""
    r = await client.get(
        f"{BASE}/me/abandoned-keyword-candidates",
        params={"user_id": abandoned_data["user"], "min_count": 2},
    )
    assert r.status_code == 200
    body = r.json()

    assert body["abandoned_count"] == 2  # 兩件淘汰案皆納入（事件 ∪ 放棄）
    terms = {c["term"]: c for c in body["candidates"]}
    assert "勞務" in terms
    assert terms["勞務"]["count"] == 2
    assert terms["勞務"]["sample_titles"]  # 附示例標題
    assert terms["勞務"]["kind"] in ("word", "root")


async def test_excludes_positive_and_already_avoided(client, abandoned_data):
    """正向詞（清潔）與已手動迴避詞（委外）皆不出現在候選。"""
    r = await client.get(
        f"{BASE}/me/abandoned-keyword-candidates",
        params={"user_id": abandoned_data["user"], "min_count": 1},
    )
    body = r.json()
    terms = {c["term"] for c in body["candidates"]}
    assert "清潔" not in terms  # 正向：不建議迴避喜歡的
    assert "委外" not in terms  # 已迴避：不重複建議


async def test_non_abandoned_tender_not_polluting(client, abandoned_data):
    """未被淘汰的工程案專屬詞（工程/道路）不得進候選。"""
    r = await client.get(
        f"{BASE}/me/abandoned-keyword-candidates",
        params={"user_id": abandoned_data["user"], "min_count": 1},
    )
    body = r.json()
    terms = {c["term"] for c in body["candidates"]}
    assert "工程" not in terms
    assert "道路" not in terms


async def test_min_count_filters_singletons(client, abandoned_data):
    """min_count=2 時，只出現一次的字根（如「承攬」「委外」）被濾除。"""
    r = await client.get(
        f"{BASE}/me/abandoned-keyword-candidates",
        params={"user_id": abandoned_data["user"], "min_count": 2},
    )
    body = r.json()
    for c in body["candidates"]:
        assert c["count"] >= 2
    terms = {c["term"] for c in body["candidates"]}
    assert "承攬" not in terms  # 僅 t_lab2 出現


async def test_readonly_writes_no_negative_weight(client, abandoned_data, db_session):
    """紅線：呼叫唯讀端點後，DB 不得新增任何負權重或自動迴避詞。"""
    neg_kw_before = (
        await db_session.execute(
            select(func.count()).select_from(KeywordWeight)
            .where(KeywordWeight.polarity == "negative")
        )
    ).scalar_one()
    # 種子已含 1 筆「委外」手動迴避；呼叫端點後此數不得增加（系統不得自動產生負分）
    manual_neg_before = (
        await db_session.execute(
            select(func.count()).select_from(UserManualKeyword)
            .where(UserManualKeyword.kind == "negative")
        )
    ).scalar_one()

    r = await client.get(
        f"{BASE}/me/abandoned-keyword-candidates",
        params={"user_id": abandoned_data["user"], "min_count": 1},
    )
    assert r.status_code == 200

    neg_kw_after = (
        await db_session.execute(
            select(func.count()).select_from(KeywordWeight)
            .where(KeywordWeight.polarity == "negative")
        )
    ).scalar_one()
    manual_neg_after = (
        await db_session.execute(
            select(func.count()).select_from(UserManualKeyword)
            .where(UserManualKeyword.kind == "negative")
        )
    ).scalar_one()
    assert neg_kw_after == neg_kw_before == 0
    assert manual_neg_after == manual_neg_before == 1


async def test_no_abandoned_returns_empty(client, seeded):
    """無任何淘汰行為 → 回空候選、abandoned_count=0（用內建 seeded，無 pass/放棄）。"""
    r = await client.get(f"{BASE}/me/abandoned-keyword-candidates")
    assert r.status_code == 200
    body = r.json()
    assert body["abandoned_count"] == 0
    assert body["candidates"] == []

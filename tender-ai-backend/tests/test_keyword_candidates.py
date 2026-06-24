# -*- coding: utf-8 -*-
"""速覽配對（swipe）判斷原因表單的關鍵字候選端點測試。

驗收對齊本人需求（C）與紅線：
- 字（CJK 單字）／詞（jieba 斷詞）皆回傳、可供前端選取。
- ✓/⭐ 用的 ``positive_hits`` = 本人學習正向詞 ∩ 本標案文字。
- ✗ 用的 ``recommended_negative`` = 系統建議（附 lift／reason），**僅止於建議**：
  呼叫此唯讀端點**不得**寫入任何負權重（負分人工專屬紅線，
  見記憶 negative-keywords-human-only；commit 7f56ff0 已回歸人工專屬）。
- 查無標案 → 404。

離線、無網；合成種子資料。
"""
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import func, select

from app.models.knowledge import EvolutionLog, KeywordWeight
from app.models.tender import Source, Tender

BASE = "/api/v1"


@pytest.fixture
async def candidate_data(db_session):
    """種子：工程案（含學習正向詞「工程」）＋勞務案（命中系統負向建議「勞務」）。"""
    source = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    db_session.add(source)
    await db_session.flush()

    t_eng = Tender(
        source_id=source.id, case_pk="KC-E", name="校舍工程改善統包",
        org="台北市政府教育局", category="工程", budget_wan=300,
        deadline_roc="115/07/01", deadline_iso=date(2026, 7, 1), city="台北市",
        link="https://x.test/e",
    )
    t_lab = Tender(
        source_id=source.id, case_pk="KC-L", name="桃園市清潔勞務委外",
        org="桃園市環保局", category="勞務", budget_wan=80,
        deadline_roc="115/07/07", deadline_iso=date(2026, 7, 7), city="桃園市",
        link="https://x.test/l",
    )
    db_session.add_all([t_eng, t_lab])
    await db_session.flush()

    # 學習正向詞（系統可自動學）：工程 → ✓/⭐ 預選來源
    db_session.add(
        KeywordWeight(term="工程", polarity="positive", weight=0.8, support=8)
    )
    # 系統建議的「疑似迴避」候選（附理由，供人審）：勞務 → ✗ 預選但需人確認
    db_session.add(
        EvolutionLog(
            batch="2026-06-24T00:00:00",
            trigger="manual",
            negative_candidates=[
                {
                    "term": "勞務",
                    "feasible_count": 0,
                    "infeasible_count": 3,
                    "lift": 0.6,
                    "support": 3,
                    "reason": "在「不可行」樣本出現 3 次、「可行」0 次（偏負向）；需人工確認",
                }
            ],
            created_at=datetime(2026, 6, 24, tzinfo=timezone.utc),
        )
    )
    await db_session.commit()
    return {"eng": t_eng.id, "lab": t_lab.id}


async def test_words_and_chars_returned(client, candidate_data):
    """詞（jieba）與字（CJK 單字）皆回傳，且字為相異單一中文字。"""
    r = await client.get(f"{BASE}/tenders/{candidate_data['eng']}/keyword-candidates")
    assert r.status_code == 200
    body = r.json()

    word_terms = [w["term"] for w in body["words"]]
    assert "工程" in word_terms  # jieba 斷出的詞
    assert all(len(w["term"]) >= 2 for w in body["words"])  # 詞長 ≥2

    char_terms = [c["term"] for c in body["chars"]]
    assert "工" in char_terms and "程" in char_terms  # 拆出的單字
    assert all(len(c["term"]) == 1 for c in body["chars"])  # 字為單一字元
    assert len(char_terms) == len(set(char_terms))  # 相異、不重複


async def test_positive_hits_from_learned_keywords(client, candidate_data):
    """✓/⭐ 預選：本人學習正向詞 ∩ 本標案文字。"""
    r = await client.get(f"{BASE}/tenders/{candidate_data['eng']}/keyword-candidates")
    body = r.json()
    assert "工程" in body["positive_hits"]


async def test_recommended_negative_is_suggestion_only(client, candidate_data, db_session):
    """✗ 的負向候選僅為『系統建議』（附 lift／reason），且唯讀端點不寫任何負權重（紅線）。"""
    # 呼叫前：DB 無任何負權重
    before = (
        await db_session.execute(
            select(func.count())
            .select_from(KeywordWeight)
            .where(KeywordWeight.polarity == "negative")
        )
    ).scalar_one()
    assert before == 0

    r = await client.get(f"{BASE}/tenders/{candidate_data['lab']}/keyword-candidates")
    assert r.status_code == 200
    body = r.json()

    rec = body["recommended_negative"]
    assert any(c["term"] == "勞務" for c in rec)  # 命中系統建議
    cand = next(c for c in rec if c["term"] == "勞務")
    assert cand["reason"]  # 附理由
    assert cand["lift"] > 0  # 附 lift

    # 紅線：呼叫唯讀端點後，DB 仍無任何負權重（系統不得自動寫入負分）
    after = (
        await db_session.execute(
            select(func.count())
            .select_from(KeywordWeight)
            .where(KeywordWeight.polarity == "negative")
        )
    ).scalar_one()
    assert after == 0


async def test_engineering_tender_has_no_negative_recommendation(client, candidate_data):
    """工程案文字不含『勞務』→ 不應出現該負向建議（候選需與本標案文字交集）。"""
    r = await client.get(f"{BASE}/tenders/{candidate_data['eng']}/keyword-candidates")
    body = r.json()
    assert all(c["term"] != "勞務" for c in body["recommended_negative"])


async def test_unknown_tender_404(client, candidate_data):
    r = await client.get(f"{BASE}/tenders/999999/keyword-candidates")
    assert r.status_code == 404

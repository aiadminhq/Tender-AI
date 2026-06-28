# -*- coding: utf-8 -*-
"""推理卡「手動關鍵字覆寫」測試（Phase 2）。

對齊需求：在「為什麼·推理」卡的偏好／迴避／常點開區塊，讓使用者手動
新增（add）或移除（remove）關鍵字，並持久化、讀取時合併回判準輪廓。

涵蓋三層：
- 純函式 ``apply_overrides``：learned − 排除 ＋ 手動新增，順序穩定、不重複。
- service ``upsert_manual_keyword`` / ``list_overrides``：以 (user, term, kind)
  複合鍵 upsert，excluded 可切換、round-trip 正確。
- 端點 ``POST /api/v1/me/keywords``：add → 出現於對應清單；remove 既有學習詞 → 消失。

治理：手動「迴避」(kind=negative, action=add) 即「負分由人手動給」的合規路徑
（見記憶 negative-keywords-human-only）；個人化覆寫只用本人資料、不需共享同意。
"""
import pytest

from app.models.behavior import User
from app.models.knowledge import KeywordWeight
from app.models.preference import UserManualKeyword
from app.services import manual_keywords as mk

ME_BASE = "/api/v1"


# --------------------------------------------------------------------------- #
# 1) 純函式合併
# --------------------------------------------------------------------------- #
def _ov(term: str, kind: str, excluded: bool) -> UserManualKeyword:
    return UserManualKeyword(user_id=1, term=term, kind=kind, excluded=excluded)


def test_apply_overrides_add_and_exclude_preserve_order():
    positive = ["工程", "營繕工程", "統包"]
    negative = ["勞務"]
    engaged = ["工程"]
    overrides = [
        _ov("監造", "positive", excluded=False),   # 手動新增
        _ov("統包", "positive", excluded=True),     # 隱藏一個學習詞
        _ov("財物", "negative", excluded=False),    # 手動迴避（合規人工負分）
        _ov("捷運", "engaged", excluded=False),
    ]
    pos, neg, eng = mk.apply_overrides(positive, negative, engaged, overrides)

    # 學習詞保序、排除「統包」、尾端接上手動新增「監造」
    assert pos == ["工程", "營繕工程", "監造"]
    # 手動迴避併入
    assert neg == ["勞務", "財物"]
    assert eng == ["工程", "捷運"]


def test_apply_overrides_no_duplicate_when_added_term_already_learned():
    pos, _, _ = mk.apply_overrides(
        ["工程"], [], [], [_ov("工程", "positive", excluded=False)]
    )
    assert pos == ["工程"]


# --------------------------------------------------------------------------- #
# 2) service round-trip
# --------------------------------------------------------------------------- #
@pytest.fixture
async def user(db_session) -> User:
    u = User(name="alex", email="alex@hqdesign.tw", role="member")
    db_session.add(u)
    await db_session.flush()
    return u


async def test_upsert_then_list_roundtrip(db_session, user):
    await mk.upsert_manual_keyword(db_session, user.id, "監造", "positive", False)
    await mk.upsert_manual_keyword(db_session, user.id, "工程", "positive", True)
    await db_session.flush()

    rows = await mk.list_overrides(db_session, user.id)
    by_term = {r.term: r for r in rows}
    assert by_term["監造"].excluded is False
    assert by_term["工程"].excluded is True
    assert by_term["監造"].kind == "positive"


async def test_upsert_toggles_excluded_in_place(db_session, user):
    await mk.upsert_manual_keyword(db_session, user.id, "監造", "positive", False)
    await db_session.flush()
    await mk.upsert_manual_keyword(db_session, user.id, "監造", "positive", True)
    await db_session.flush()

    rows = await mk.list_overrides(db_session, user.id)
    assert len(rows) == 1
    assert rows[0].excluded is True


# --------------------------------------------------------------------------- #
# 3) 端點整合
# --------------------------------------------------------------------------- #
@pytest.fixture
async def learned(db_session):
    """團隊線學習關鍵字（build_criteria_profile 讀全表）＋一位使用者。"""
    u = User(name="alex", email="alex@hqdesign.tw", role="member", whitelist_active=True)
    db_session.add_all([
        u,
        KeywordWeight(term="工程", polarity="positive", weight=0.8),
        KeywordWeight(term="勞務", polarity="negative", weight=0.5),
    ])
    await db_session.commit()
    return u


async def test_post_add_positive_keyword_appears(client, learned, auth_headers):
    resp = await client.post(
        f"{ME_BASE}/me/keywords",
        json={"term": "監造", "kind": "positive", "action": "add"},
        headers=auth_headers(learned.id),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "監造" in body["top_keywords_positive"]
    assert "工程" in body["top_keywords_positive"]  # 學習詞仍在


async def test_post_remove_learned_keyword_disappears(client, learned, auth_headers):
    resp = await client.post(
        f"{ME_BASE}/me/keywords",
        json={"term": "工程", "kind": "positive", "action": "remove"},
        headers=auth_headers(learned.id),
    )
    assert resp.status_code == 200, resp.text
    assert "工程" not in resp.json()["top_keywords_positive"]


async def test_post_add_avoid_keyword_is_human_negative_path(client, learned, auth_headers):
    """手動迴避＝合規的人工負分路徑：term 進 top_keywords_negative。"""
    resp = await client.post(
        f"{ME_BASE}/me/keywords",
        json={"term": "拆除", "kind": "negative", "action": "add"},
        headers=auth_headers(learned.id),
    )
    assert resp.status_code == 200, resp.text
    assert "拆除" in resp.json()["top_keywords_negative"]

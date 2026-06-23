# -*- coding: utf-8 -*-
"""GET /api/v1/search/recommend/{tender_id}：以決策向量做相似案例推薦（P5）。

不連 Ollama：monkeypatch embedding.embed_query；向量為人工植入的 1024 維稀疏向量，
使 cosine 距離可預期、排序與聚合結論可斷言。

驗收重點（P5 §5）：
- 依與候選標案向量的 cosine 距離遞增回鄰居，且排除候選自身的決策。
- 依「可行/不可行」鄰居的相似度加權聚合出傾向（verdict）與信心（confidence）。
- 候選無相似決策 → verdict=unknown、鄰居空清單（非錯誤）。
- 候選標案不存在 → 404。
- 隱私：回傳僅標案公開欄位 + 結論標籤，永不含 rationale 全文或使用者身分。
"""
from __future__ import annotations

import pytest
import pytest_asyncio

from app.models.behavior import Evaluation, User
from app.models.knowledge import EMBED_DIM, DecisionVector

RECOMMEND = "/api/v1/search/recommend"


def _vec(dims: dict[int, float]) -> list[float]:
    """組 1024 維向量：只有 dims 指定的索引非零，其餘為 0。"""
    v = [0.0] * EMBED_DIM
    for i, x in dims.items():
        v[i] = x
    return v


def _ids(items) -> list[int]:
    return [it["id"] for it in items]


async def _add_decision(
    session, *, user_id: int, tender_id: int, feasible: str, vec: list[float]
) -> None:
    """植入一筆 evaluation + 對應 decision_vector（直接植入，繞過嵌入 job）。"""
    ev = Evaluation(
        user_id=user_id, tender_id=tender_id, feasible=feasible,
        criteria={"budget_fit": True}, rationale=f"理由-{tender_id}",
    )
    session.add(ev)
    await session.flush()
    session.add(
        DecisionVector(
            evaluation_id=ev.id, tender_id=tender_id, model="bge-m3",
            embedding=vec, content=f"content-{tender_id}", feasible=feasible,
        )
    )


@pytest_asyncio.fixture
async def seeded_decisions(seeded, db_session):
    """在 seed_basic 之上植入決策向量。

    候選查詢向量固定為 e0（見 mock_embed_e0）。幾何安排：
      mid (候選自身) 可行  e0           → dist 0，必須被排除
      high           可行  0.8e0+0.6e1  → cos .8 / dist .2（最近鄰居）
      tmu            可行  0.6e0+0.8e1  → cos .6 / dist .4
      low            不可行 0.1e0+0.99e2→ cos≈.1 / dist≈.9（最遠）
    → 可行加權（≈.8+.6）遠大於不可行（≈.1）：傾向「可承接」、2 可行 vs 1 不可行。
    """
    u = User(name="alex", email="alex@hqdesign.tw", whitelist_active=True, consent_shared=True)
    db_session.add(u)
    await db_session.flush()

    await _add_decision(db_session, user_id=u.id, tender_id=seeded["mid"],
                        feasible="可行", vec=_vec({0: 1.0}))
    await _add_decision(db_session, user_id=u.id, tender_id=seeded["high"],
                        feasible="可行", vec=_vec({0: 0.8, 1: 0.6}))
    await _add_decision(db_session, user_id=u.id, tender_id=seeded["tmu"],
                        feasible="可行", vec=_vec({0: 0.6, 1: 0.8}))
    await _add_decision(db_session, user_id=u.id, tender_id=seeded["low"],
                        feasible="不可行", vec=_vec({0: 0.1, 2: 0.99}))
    await db_session.commit()
    return seeded


@pytest.fixture
def mock_embed_e0(monkeypatch):
    """把候選標案的查詢嵌入固定為 e0，與 seeded_decisions 幾何對齊。"""

    async def fake_embed_query(text, **kw):
        return _vec({0: 1.0})

    monkeypatch.setattr("app.services.embedding.embed_query", fake_embed_query)


# --------------------------------------------------------------------------- #
async def test_recommend_orders_and_excludes_self(client, seeded_decisions, mock_embed_e0):
    r = await client.get(f"{RECOMMEND}/{seeded_decisions['mid']}")
    assert r.status_code == 200
    body = r.json()
    # 候選自身（mid）被排除；其餘依距離遞增：high, tmu, low
    nb = body["neighbors"]
    assert _ids(nb) == [seeded_decisions["high"], seeded_decisions["tmu"], seeded_decisions["low"]]
    assert seeded_decisions["mid"] not in _ids(nb)
    # 距離遞增、分數遞減
    dists = [it["distance"] for it in nb]
    assert dists == sorted(dists)
    assert nb[0]["score"] == pytest.approx(0.8, abs=1e-3)


async def test_recommend_verdict_feasible_leaning(client, seeded_decisions, mock_embed_e0):
    body = (await client.get(f"{RECOMMEND}/{seeded_decisions['mid']}")).json()
    assert body["verdict"] == "feasible_leaning"
    assert body["feasible_count"] == 2
    assert body["infeasible_count"] == 1
    assert 0.0 < body["confidence"] <= 1.0
    assert body["headline"]  # 有白話總結
    # 隱私：鄰居只帶結論標籤，不外洩 rationale 全文
    assert all("rationale" not in it for it in body["neighbors"])
    assert body["neighbors"][0]["feasible"] == "可行"


async def test_recommend_no_decisions_returns_unknown(client, seeded, mock_embed_e0):
    # seeded 但未植入任何決策向量 → 無相似案可參考
    body = (await client.get(f"{RECOMMEND}/{seeded['mid']}")).json()
    assert body["verdict"] == "unknown"
    assert body["neighbors"] == []
    assert body["feasible_count"] == 0 and body["infeasible_count"] == 0


async def test_recommend_unknown_tender_404(client, seeded_decisions, mock_embed_e0):
    assert (await client.get(f"{RECOMMEND}/999999")).status_code == 404


async def test_recommend_respects_limit(client, seeded_decisions, mock_embed_e0):
    body = (await client.get(f"{RECOMMEND}/{seeded_decisions['mid']}", params={"limit": 1})).json()
    assert _ids(body["neighbors"]) == [seeded_decisions["high"]]


async def test_recommend_limit_range(client, seeded_decisions, mock_embed_e0):
    assert (await client.get(f"{RECOMMEND}/{seeded_decisions['mid']}", params={"limit": 0})).status_code == 422
    assert (await client.get(f"{RECOMMEND}/{seeded_decisions['mid']}", params={"limit": 999})).status_code == 422

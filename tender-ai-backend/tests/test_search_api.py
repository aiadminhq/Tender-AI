# -*- coding: utf-8 -*-
"""GET /api/v1/search/semantic 與 /search/similar/{id} 的語意檢索測試。

不連 Ollama：以 monkeypatch 替換 embedding.embed_query；向量為人工植入的
1024 維稀疏向量，使 cosine 距離可預期、排序可斷言。
對照 P3 驗收：語意排序正確、INNER JOIN 只回已嵌入者、相似案排除自身、
標的無向量回空、查無標的回 404、參數驗證 422。
"""
from __future__ import annotations

import pytest
import pytest_asyncio

from app.models.knowledge import EMBED_DIM, TenderVector

SEMANTIC = "/api/v1/search/semantic"
SIMILAR = "/api/v1/search/similar"


def _vec(dims: dict[int, float]) -> list[float]:
    """組 1024 維向量：只有 dims 指定的索引非零，其餘為 0。"""
    v = [0.0] * EMBED_DIM
    for i, x in dims.items():
        v[i] = x
    return v


def _ids(payload_items) -> list[int]:
    return [it["id"] for it in payload_items]


@pytest_asyncio.fixture
async def seeded_vec(seeded, db_session):
    """在 seed_basic 之上植入向量：high/mid/low 有向量、tmu 無。

    幾何安排（對齊查詢向量 e0 = 維度0）：
      high = e0            → 與 e0 距離 0（最近）
      mid  = 0.6·e0+0.8·e1 → cos 0.6、距離 0.4
      low  = 0.1·e0+0.99·e2→ cos≈0.1、距離≈0.9（最遠）
      tmu  = 無向量        → 被 INNER JOIN 濾除 / 相似案回空
    """
    db_session.add_all(
        [
            TenderVector(
                tender_id=seeded["high"], embedding=_vec({0: 1.0}),
                model="bge-m3", content="high",
            ),
            TenderVector(
                tender_id=seeded["mid"], embedding=_vec({0: 0.6, 1: 0.8}),
                model="bge-m3", content="mid",
            ),
            TenderVector(
                tender_id=seeded["low"], embedding=_vec({0: 0.1, 2: 0.99}),
                model="bge-m3", content="low",
            ),
        ]
    )
    await db_session.commit()
    return seeded


@pytest.fixture
def mock_embed_e0(monkeypatch):
    """把查詢嵌入固定為 e0（維度0 單位向量），與 seeded_vec 的幾何對齊。"""

    async def fake_embed_query(text, **kw):
        return _vec({0: 1.0})

    # 服務以模組屬性存取 embedding.embed_query，故 patch 模組屬性即可生效。
    monkeypatch.setattr("app.services.embedding.embed_query", fake_embed_query)


# --------------------------------------------------------------------------- #
# 語意搜尋
# --------------------------------------------------------------------------- #
async def test_semantic_orders_by_distance(client, seeded_vec, mock_embed_e0):
    r = await client.get(SEMANTIC, params={"q": "資訊系統"})
    assert r.status_code == 200
    body = r.json()
    # tmu 無向量 → 不在結果；其餘依距離遞增：high, mid, low
    assert body["count"] == 3
    assert _ids(body["items"]) == [seeded_vec["high"], seeded_vec["mid"], seeded_vec["low"]]
    assert body["query"] == "資訊系統"


async def test_semantic_scores_monotonic(client, seeded_vec, mock_embed_e0):
    body = (await client.get(SEMANTIC, params={"q": "x"})).json()
    items = body["items"]
    # score = 1 - cosine distance，越前面越大；最近者 ≈ 1.0
    assert items[0]["score"] == pytest.approx(1.0, abs=1e-3)
    scores = [it["score"] for it in items]
    assert scores == sorted(scores, reverse=True)
    # 命中欄位含標準清單欄位（沿用 TenderListItem）
    assert items[0]["name"] and items[0]["source"] == "PCC"


async def test_semantic_respects_limit(client, seeded_vec, mock_embed_e0):
    body = (await client.get(SEMANTIC, params={"q": "x", "limit": 1})).json()
    assert body["count"] == 1
    assert _ids(body["items"]) == [seeded_vec["high"]]


async def test_semantic_requires_q(client, seeded_vec):
    assert (await client.get(SEMANTIC)).status_code == 422
    assert (await client.get(SEMANTIC, params={"q": ""})).status_code == 422


async def test_semantic_limit_range(client, seeded_vec, mock_embed_e0):
    assert (await client.get(SEMANTIC, params={"q": "x", "limit": 0})).status_code == 422
    assert (await client.get(SEMANTIC, params={"q": "x", "limit": 999})).status_code == 422


async def test_semantic_degraded_when_embedding_unavailable(
    client, seeded_vec, monkeypatch
):
    """embedding 後端（Ollama）不可用 → 可辨識的離線降級 503（P2-6 保留標記）。

    不是不透明 500、也不假裝正常回空結果：回 503 + code=semantic_degraded，
    讓前端顯示「語意搜尋離線降級」而非通用錯誤（見 roadmap P2-6）。
    """
    from app.services.embedding import EmbeddingError

    async def boom(text, **kw):
        raise EmbeddingError("Ollama 呼叫失敗：connection refused")

    monkeypatch.setattr("app.services.embedding.embed_query", boom)
    r = await client.get(SEMANTIC, params={"q": "資訊系統"})
    assert r.status_code == 503
    assert r.json()["code"] == "semantic_degraded"


# --------------------------------------------------------------------------- #
# 相似標案
# --------------------------------------------------------------------------- #
async def test_similar_excludes_self_and_orders(client, seeded_vec):
    r = await client.get(f"{SIMILAR}/{seeded_vec['high']}")
    assert r.status_code == 200
    items = r.json()
    # 排除自身；其餘依與 high(e0) 的距離遞增：mid 再 low
    assert _ids(items) == [seeded_vec["mid"], seeded_vec["low"]]
    assert seeded_vec["high"] not in _ids(items)


async def test_similar_no_vector_returns_empty(client, seeded_vec):
    # tmu 存在但未嵌入 → 無向量可比，回空清單（非錯誤）
    r = await client.get(f"{SIMILAR}/{seeded_vec['tmu']}")
    assert r.status_code == 200
    assert r.json() == []


async def test_similar_unknown_tender_404(client, seeded_vec):
    r = await client.get(f"{SIMILAR}/999999")
    assert r.status_code == 404


async def test_similar_respects_limit(client, seeded_vec):
    items = (await client.get(f"{SIMILAR}/{seeded_vec['high']}", params={"limit": 1})).json()
    assert _ids(items) == [seeded_vec["mid"]]

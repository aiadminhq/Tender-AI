# -*- coding: utf-8 -*-
"""GET /api/v1/knowledge/* 的知識庫檢索／調閱測試。

不連 Ollama：以 monkeypatch 替換 embedding.embed_query；向量為人工植入的稀疏向量，
使 cosine 距離可預期。對照：
  - /knowledge/search 把 services.knowledge.search_knowledge 對外開成 REST（RRF 融合生效）。
  - /knowledge/docs 依 doc_id 聚合列文件；/knowledge/docs/{id} 依 chunk_index 逐段調閱。
  - 參數驗證（缺 q→422、limit 越界→422）、查無文件→404。
"""
from __future__ import annotations

import pytest
import pytest_asyncio

from app.models.knowledge import EMBED_DIM, KnowledgeChunk

SEARCH = "/api/v1/knowledge/search"
DOCS = "/api/v1/knowledge/docs"


def _vec(dims: dict[int, float]) -> list[float]:
    v = [0.0] * EMBED_DIM
    for i, x in dims.items():
        v[i] = x
    return v


@pytest.fixture
def mock_embed_e0(monkeypatch):
    async def fake_embed_query(text, **kw):
        return _vec({0: 1.0})

    monkeypatch.setattr("app.services.embedding.embed_query", fake_embed_query)


@pytest_asyncio.fixture
async def seeded_knowledge(db_session):
    """植入 2 份文件、共 3 切塊（對齊查詢向量 e0；C 同時命中關鍵字 'pcc'）。"""
    a = KnowledgeChunk(
        doc_id="01-分級與類別", title="分級與類別優先序", heading="潛力分級",
        chunk_index=0, content="高潛力標案截止在 14 天內，最優先處理。",
        tokens="高潛力 截止 最優先 分級", embedding=_vec({0: 1.0}), model="bge-m3",
    )
    b = KnowledgeChunk(
        doc_id="01-分級與類別", title="分級與類別優先序", heading="類別優先序",
        chunk_index=1, content="標的類別優先序為工程大於財物大於勞務。",
        tokens="類別 工程 財物 勞務 優先序", embedding=_vec({0: 0.6, 1: 0.8}), model="bge-m3",
    )
    c = KnowledgeChunk(
        doc_id="04-資料來源", title="標案資料來源", heading="主來源",
        chunk_index=0, content="主要資料來源為政府電子採購網（PCC）每日蒐集。",
        tokens="pcc 政府電子採購網 資料來源 蒐集", embedding=_vec({0: 0.1, 2: 0.99}),
        model="bge-m3",
    )
    db_session.add_all([a, b, c])
    await db_session.commit()
    return {"a": a.id, "b": b.id, "c": c.id}


# --------------------------------------------------------------------------- #
# 檢索
# --------------------------------------------------------------------------- #
async def test_search_fuses_two_paths(client, seeded_knowledge, mock_embed_e0):
    r = await client.get(SEARCH, params={"q": "pcc"})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 3 and body["query"] == "pcc"
    # C（向量 rank3 + 關鍵字 rank1）經 RRF 融合應排第一
    first = body["items"][0]
    assert first["doc_id"] == "04-資料來源" and first["heading"] == "主來源"
    assert first["vec_score"] is not None and first["kw_score"] is not None


async def test_search_respects_limit(client, seeded_knowledge, mock_embed_e0):
    body = (await client.get(SEARCH, params={"q": "x", "limit": 2})).json()
    assert body["count"] == 2


async def test_search_requires_q(client, seeded_knowledge):
    assert (await client.get(SEARCH)).status_code == 422
    assert (await client.get(SEARCH, params={"q": ""})).status_code == 422


async def test_search_limit_range(client, seeded_knowledge, mock_embed_e0):
    assert (await client.get(SEARCH, params={"q": "x", "limit": 0})).status_code == 422
    assert (await client.get(SEARCH, params={"q": "x", "limit": 99})).status_code == 422


# --------------------------------------------------------------------------- #
# 調閱（瀏覽）
# --------------------------------------------------------------------------- #
async def test_list_docs(client, seeded_knowledge):
    body = (await client.get(DOCS)).json()
    assert body["count"] == 2
    # 依 doc_id 排序：01-… 在前，且切塊數正確
    assert [d["doc_id"] for d in body["items"]] == ["01-分級與類別", "04-資料來源"]
    by_id = {d["doc_id"]: d for d in body["items"]}
    assert by_id["01-分級與類別"]["chunks"] == 2
    assert by_id["04-資料來源"]["chunks"] == 1


async def test_get_doc_chunks_ordered(client, seeded_knowledge):
    r = await client.get(f"{DOCS}/01-分級與類別")
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "分級與類別優先序" and body["count"] == 2
    # 依 chunk_index 遞增
    assert [c["chunk_index"] for c in body["chunks"]] == [0, 1]
    assert body["chunks"][0]["heading"] == "潛力分級"


async def test_get_doc_unknown_404(client, seeded_knowledge):
    assert (await client.get(f"{DOCS}/不存在的文件")).status_code == 404

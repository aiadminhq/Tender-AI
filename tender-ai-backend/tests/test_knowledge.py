# -*- coding: utf-8 -*-
"""SL4 知識庫檢索與小助手接入測試。

不連 Ollama：以 monkeypatch 替換 ``embedding.embed_query``；向量為人工植入的 1024 維
稀疏向量，使 cosine 距離可預期；關鍵字路以英數 token（避免中文斷詞歧義）確定命中。

對照 SL4 驗收：
  - ``search_knowledge`` 兩路（向量 + 關鍵字）皆生效，RRF 融合會把「雙路命中」的切塊
    推上「僅向量第 1 名」之前（融合確實有作用，而非單純向量排序）。
  - 空查詢回空；KnowledgeHit 欄位（doc_id/title/heading/vec_score/kw_score）正確。
  - 小助手 /assistant/chat：meta.scope 含 knowledge_base、tool_contract 為 active、
    sources 內出現 kind="knowledge"（tender_id 為 None、帶 doc_id/heading），且知識片段
    被嵌入 grounding system prompt。
"""
from __future__ import annotations

import json

import pytest
import pytest_asyncio

from app.models.knowledge import EMBED_DIM, KnowledgeChunk
from app.services import knowledge as knowledge_svc

CHAT = "/api/v1/assistant/chat"

# 小助手接入測試走 /chat 的 Ollama 生成路徑；產品預設大腦已改 cli/Claude Code，固定回 ollama。
pytestmark = pytest.mark.usefixtures("ollama_brain")


def _vec(dims: dict[int, float]) -> list[float]:
    """組 1024 維向量：只有 dims 指定的索引非零，其餘為 0。"""
    v = [0.0] * EMBED_DIM
    for i, x in dims.items():
        v[i] = x
    return v


def _payload(prompt: str) -> dict:
    return {"messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}]}


def _events(text: str) -> list[dict]:
    return [json.loads(line) for line in text.splitlines() if line.strip()]


@pytest.fixture
def mock_embed_e0(monkeypatch):
    """查詢嵌入固定為 e0（維度0 單位向量），與 seeded_knowledge 的幾何對齊。"""

    async def fake_embed_query(text, **kw):
        return _vec({0: 1.0})

    monkeypatch.setattr("app.services.embedding.embed_query", fake_embed_query)


@pytest_asyncio.fixture
async def seeded_knowledge(db_session):
    """植入 3 個知識切塊（對齊查詢向量 e0）：

      A 規則／分級：embedding e0          → 向量距離 0（最近）；tokens 不含 'pcc'
      B 規則／類別：embedding 0.6e0+0.8e1 → cos 0.6、距離 0.4；tokens 不含 'pcc'
      C 來源／資料：embedding 0.1e0+0.99e2→ cos≈0.1、距離≈0.9（向量最遠）；tokens 含 'pcc'

    查詢 token 'pcc' 只命中 C：C 同時拿到向量(rank3)+關鍵字(rank1)兩路分數，RRF 後
    應超越「僅向量 rank1」的 A，藉此證明融合確有作用。
    """
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
# 檢索服務
# --------------------------------------------------------------------------- #
async def test_search_knowledge_rrf_fuses_two_paths(
    db_session, seeded_knowledge, mock_embed_e0
):
    hits = await knowledge_svc.search_knowledge(db_session, "pcc", limit=5)
    assert len(hits) == 3
    by_id = {h.id: h for h in hits}

    # 融合：C（向量 rank3 + 關鍵字 rank1）應排在「僅向量 rank1」的 A 之前。
    assert hits[0].id == seeded_knowledge["c"]

    # C 兩路皆有分數；A 只有向量分數、無關鍵字分數。
    c = by_id[seeded_knowledge["c"]]
    assert c.vec_score is not None and c.kw_score is not None
    a = by_id[seeded_knowledge["a"]]
    assert a.vec_score is not None and a.kw_score is None

    # KnowledgeHit 欄位完整（供來源卡呈現脈絡）。
    assert c.doc_id == "04-資料來源" and c.title == "標案資料來源" and c.heading == "主來源"
    assert 0.0 <= c.score <= 1.0


async def test_search_knowledge_vector_score_monotonic(
    db_session, seeded_knowledge, mock_embed_e0
):
    # 純看向量分數：A(e0)=1.0 最高，B(0.6)，C(≈0.1) 最低。
    hits = await knowledge_svc.search_knowledge(db_session, "x", limit=5)
    vec = {h.id: h.vec_score for h in hits}
    assert vec[seeded_knowledge["a"]] == pytest.approx(1.0, abs=1e-3)
    assert vec[seeded_knowledge["a"]] > vec[seeded_knowledge["b"]] > vec[seeded_knowledge["c"]]


async def test_search_knowledge_empty_query(db_session, seeded_knowledge, mock_embed_e0):
    assert await knowledge_svc.search_knowledge(db_session, "   ", limit=5) == []


async def test_search_knowledge_respects_limit(
    db_session, seeded_knowledge, mock_embed_e0
):
    hits = await knowledge_svc.search_knowledge(db_session, "x", limit=2)
    assert len(hits) == 2


# --------------------------------------------------------------------------- #
# 小助手接入（/assistant/chat）
# --------------------------------------------------------------------------- #
async def test_assistant_surfaces_knowledge_sources(
    client, seeded, seeded_knowledge, mock_embed_e0, monkeypatch
):
    """方法／規則型問題：meta 應帶 knowledge 來源，且知識片段進入 grounding prompt。"""
    captured: dict = {}

    async def fake_stream(messages, **kw):
        captured["messages"] = messages
        yield "依知識庫整理如下。"

    monkeypatch.setattr("app.services.llm.stream_chat", fake_stream)

    resp = await client.post(CHAT, json=_payload("標案分級的標準是什麼"))
    assert resp.status_code == 200
    events = _events(resp.text)

    meta = next(e for e in events if e.get("type") == "meta")
    assert meta["scope"] == "tender_sql + semantic_search + knowledge_base"
    assert meta["tool_contract"]["status"] == "active"

    knowledge_sources = [s for s in meta["sources"] if s["kind"] == "knowledge"]
    assert knowledge_sources, "應至少有一筆知識庫來源"
    k = knowledge_sources[0]
    assert k["tender_id"] is None
    assert k["source"] == "知識庫"
    assert k["doc_id"] and k["heading"]
    assert k["excerpt"]

    # 知識片段被嵌入 grounding system prompt（含知識庫區塊與內容）。
    sys_content = captured["messages"][0]["content"]
    assert "[知識庫片段]" in sys_content
    assert "潛力" in sys_content or "類別" in sys_content or "資料來源" in sys_content


async def test_assistant_knowledge_sources_have_no_tender_id(
    client, seeded, seeded_knowledge, mock_embed_e0, monkeypatch
):
    """回歸：知識來源 tender_id 必為 None，且不污染標案來源的 id 集合。"""

    async def fake_stream(messages, **kw):
        yield "好的。"

    monkeypatch.setattr("app.services.llm.stream_chat", fake_stream)

    resp = await client.post(CHAT, json=_payload("分級"))
    meta = next(e for e in _events(resp.text) if e.get("type") == "meta")

    tender_ids = {s["tender_id"] for s in meta["sources"] if s["kind"] != "knowledge"}
    assert None not in tender_ids
    assert all(
        s["tender_id"] is None for s in meta["sources"] if s["kind"] == "knowledge"
    )

# -*- coding: utf-8 -*-
"""GET /api/v1/index/status 的索引／向量覆蓋率測試。

對照：彙整 Tender 總數、已向量化標案數、category 缺口、三張向量表概況。
seed_basic 植入 4 筆標案（high/mid/low/tmu），其中 tmu 的 category 為 NULL；
再手動植入 2 筆 TenderVector 與 2 筆 KnowledgeChunk（同一 doc）。
不植入 DecisionVector（避開 Evaluation 外鍵）→ 斷言其 rows==0。
"""
from __future__ import annotations

import pytest_asyncio

from app.models.knowledge import EMBED_DIM, KnowledgeChunk, TenderVector

STATUS = "/api/v1/index/status"


def _vec(dims: dict[int, float]) -> list[float]:
    v = [0.0] * EMBED_DIM
    for i, x in dims.items():
        v[i] = x
    return v


@pytest_asyncio.fixture
async def seeded_index(seeded, db_session):
    """在 seed_basic 之上植入：2 筆 TenderVector（high/mid）、2 筆 KnowledgeChunk（同 doc）。"""
    db_session.add_all(
        [
            TenderVector(
                tender_id=seeded["high"], embedding=_vec({0: 1.0}),
                model="bge-m3", content="high",
            ),
            TenderVector(
                tender_id=seeded["mid"], embedding=_vec({1: 1.0}),
                model="bge-m3", content="mid",
            ),
        ]
    )
    db_session.add_all(
        [
            KnowledgeChunk(
                doc_id="01-分級與類別", title="分級與類別", heading="A",
                chunk_index=0, content="x", tokens="x",
                embedding=_vec({0: 1.0}), model="bge-m3",
            ),
            KnowledgeChunk(
                doc_id="01-分級與類別", title="分級與類別", heading="B",
                chunk_index=1, content="y", tokens="y",
                embedding=_vec({1: 1.0}), model="bge-m3",
            ),
        ]
    )
    await db_session.commit()
    return seeded


async def test_status_counts(client, seeded_index):
    body = (await client.get(STATUS)).json()
    # seed_basic 植入 4 筆標案，其中 tmu 的 category 為 NULL
    assert body["tenders_total"] == 4
    assert body["tenders_vectorized"] == 2
    assert body["tenders_category_missing"] == 1
    assert body["tender_coverage"] == 0.5  # 2/4


async def test_status_table_breakdown(client, seeded_index):
    body = (await client.get(STATUS)).json()
    assert body["tender_vectors"]["rows"] == 2
    assert body["tender_vectors"]["distinct_subjects"] == 2
    assert body["tender_vectors"]["models"] == {"bge-m3": 2}
    assert body["knowledge_chunks"]["rows"] == 2
    assert body["knowledge_docs"] == 1


async def test_status_empty_decision_vectors(client, seeded_index):
    body = (await client.get(STATUS)).json()
    # 未植入 DecisionVector / DocSummary
    assert body["decision_vectors"]["rows"] == 0
    assert body["doc_summaries"] == 0


async def test_status_zero_baseline(client):
    """無任何資料時：總數 0、覆蓋率 0、不除以零。"""
    body = (await client.get(STATUS)).json()
    assert body["tenders_total"] == 0
    assert body["tender_coverage"] == 0.0
    assert body["knowledge_docs"] == 0

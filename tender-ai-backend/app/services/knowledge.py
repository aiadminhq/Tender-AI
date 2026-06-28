# -*- coding: utf-8 -*-
"""SL4 知識庫檢索服務：向量 + 關鍵字混合（RRF 融合）。

回應願景「安裝小助手，把整個資料庫與知識庫都能回答使用者提問」：本服務負責
「知識庫」這一路——對 ``knowledge_chunks`` 同時做語意（pgvector cosine）與關鍵字
（jieba 斷詞 + Postgres ``to_tsvector('simple', tokens)`` / ``ts_rank``）檢索，再以
RRF（Reciprocal Rank Fusion，k=60）融合兩路排名，取最相關的切塊回傳。

- 語意路擅長「換句話說」的近義命中；關鍵字路擅長精確詞（如「最有利標」「復興崗」）。
- 兩路皆只觸及 Layer A 公開知識，無個資。查詢向量由 ``embedding.embed_query`` 產生，
  測試以 monkeypatch 替換、不連 Ollama；關鍵字路為純 SQL，離線可測。
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import KnowledgeChunk
from app.services import embedding
from app.services.text_index import tokenize_cn

# RRF 常數：rank 越前貢獻越大；k 緩衝避免第 1 名獨大（業界慣用 60）。
_RRF_K = 60
# 各路候選池大小（融合前各取 top-N，再融合取 limit）
_POOL = 20


@dataclass
class KnowledgeHit:
    """一筆知識庫命中（供 assistant grounding 與前端來源卡）。"""

    id: int
    doc_id: str
    title: str
    heading: str | None
    content: str
    score: float  # 融合後正規化分數（0..1，僅供排序／呈現參考）
    vec_score: float | None  # 語意 cosine 分數（1 - distance），未命中該路為 None
    kw_score: float | None  # 關鍵字 ts_rank 原始分數，未命中該路為 None


async def _vector_candidates(
    session: AsyncSession, vec: list[float], pool: int
) -> list[tuple[KnowledgeChunk, float]]:
    """語意近鄰：回 (chunk, cosine_score) 依距離遞增。"""
    dist = KnowledgeChunk.embedding.cosine_distance(vec)
    stmt = (
        select(KnowledgeChunk, dist.label("distance"))
        .order_by(dist.asc())
        .limit(pool)
    )
    rows = (await session.execute(stmt)).all()
    out: list[tuple[KnowledgeChunk, float]] = []
    for chunk, distance in rows:
        score = max(0.0, min(1.0, 1.0 - float(distance)))
        out.append((chunk, score))
    return out


async def _keyword_candidates(
    session: AsyncSession, q_tokens: list[str], pool: int
) -> list[tuple[KnowledgeChunk, float]]:
    """關鍵字檢索：jieba 詞元組 OR tsquery，依 ts_rank 遞減。無詞元則回空。"""
    if not q_tokens:
        return []
    # 詞元為 ^[\w一-鿿]+$（已過濾標點），以 ' | ' 組 OR tsquery，安全可內插。
    query_str = " | ".join(dict.fromkeys(q_tokens))  # 去重保序
    tsvector = func.to_tsvector("simple", KnowledgeChunk.tokens)
    tsquery = func.to_tsquery("simple", query_str)
    rank = func.ts_rank(tsvector, tsquery)
    stmt = (
        select(KnowledgeChunk, rank.label("rank"))
        .where(tsvector.op("@@")(tsquery))
        .order_by(rank.desc())
        .limit(pool)
    )
    rows = (await session.execute(stmt)).all()
    return [(chunk, float(r)) for chunk, r in rows]


def _rrf_fuse(
    vec_list: list[tuple[KnowledgeChunk, float]],
    kw_list: list[tuple[KnowledgeChunk, float]],
    *,
    limit: int,
) -> list[KnowledgeHit]:
    """RRF 融合兩路排名（1-based），回 top-limit 的 KnowledgeHit。"""
    acc: dict[int, dict] = {}

    def _ingest(ranked, key):
        for rank, (chunk, score) in enumerate(ranked, start=1):
            slot = acc.setdefault(
                chunk.id,
                {"chunk": chunk, "rrf": 0.0, "vec_score": None, "kw_score": None},
            )
            slot["rrf"] += 1.0 / (_RRF_K + rank)
            slot[key] = score

    _ingest(vec_list, "vec_score")
    _ingest(kw_list, "kw_score")

    # 理論最大值（兩路皆第 1 名）：用於把 rrf 正規化到 0..1。
    max_rrf = 2.0 / (_RRF_K + 1)
    ranked = sorted(acc.values(), key=lambda s: s["rrf"], reverse=True)[:limit]
    return [
        KnowledgeHit(
            id=s["chunk"].id,
            doc_id=s["chunk"].doc_id,
            title=s["chunk"].title,
            heading=s["chunk"].heading,
            content=s["chunk"].content,
            score=round(min(1.0, s["rrf"] / max_rrf), 4),
            vec_score=s["vec_score"],
            kw_score=s["kw_score"],
        )
        for s in ranked
    ]


async def search_knowledge(
    session: AsyncSession, q_text: str, *, limit: int = 5, pool: int = _POOL
) -> list[KnowledgeHit]:
    """知識庫混合檢索：語意 + 關鍵字，RRF 融合取 top-limit。

    任一路為空（如查詢無有效詞元、或表為空）仍可由另一路給出結果；兩路皆空回 []。
    """
    q_text = (q_text or "").strip()
    if not q_text:
        return []
    vec = await embedding.embed_query(q_text)
    vec_list = await _vector_candidates(session, vec, pool)
    kw_list = await _keyword_candidates(session, tokenize_cn(q_text), pool)
    if not vec_list and not kw_list:
        return []
    return _rrf_fuse(vec_list, kw_list, limit=limit)


# --------------------------------------------------------------------------- #
# 知識庫調閱（瀏覽，非檢索）：列文件、看單篇全部切塊
# --------------------------------------------------------------------------- #
@dataclass
class KnowledgeDoc:
    """一份知識文件的摘要列（供「調閱知識庫」清單）。"""

    doc_id: str
    title: str
    chunks: int  # 該文件被切成幾塊


async def list_docs(session: AsyncSession) -> list[KnowledgeDoc]:
    """列出知識庫所有文件（依 doc_id 聚合），依 doc_id 排序。

    同一 doc_id 的切塊共用 title，取 min 即可代表；只觸及 Layer A 公開知識。
    """
    stmt = (
        select(
            KnowledgeChunk.doc_id,
            func.min(KnowledgeChunk.title).label("title"),
            func.count().label("chunks"),
        )
        .group_by(KnowledgeChunk.doc_id)
        .order_by(KnowledgeChunk.doc_id)
    )
    rows = (await session.execute(stmt)).all()
    return [
        KnowledgeDoc(doc_id=r.doc_id, title=r.title, chunks=int(r.chunks)) for r in rows
    ]


async def get_doc_chunks(
    session: AsyncSession, doc_id: str
) -> list[KnowledgeChunk]:
    """取單篇文件的全部切塊，依 chunk_index 遞增（供逐段調閱）。

    查無此文件回空清單（由 API 層轉 404）。
    """
    stmt = (
        select(KnowledgeChunk)
        .where(KnowledgeChunk.doc_id == doc_id)
        .order_by(KnowledgeChunk.chunk_index.asc())
    )
    return list((await session.execute(stmt)).scalars().all())

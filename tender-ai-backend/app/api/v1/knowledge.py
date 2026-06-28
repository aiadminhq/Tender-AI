# -*- coding: utf-8 -*-
"""知識庫檢索／調閱 API（Layer A 公開知識，唯讀）。

把原本僅 MCP 內部可用的混合檢索（services.knowledge.search_knowledge）對外開成 REST，
並提供文件清單與單篇逐段調閱，讓任何前端／工具不經小助手也能查知識庫。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.knowledge import (
    KnowledgeChunkOut,
    KnowledgeDocDetail,
    KnowledgeDocItem,
    KnowledgeDocsResponse,
    KnowledgeSearchHit,
    KnowledgeSearchResponse,
)
from app.services import knowledge as kb

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.get("/search", response_model=KnowledgeSearchResponse)
async def search_knowledge(
    q: str = Query(min_length=1, description="自然語言查詢字串"),
    limit: int = Query(default=5, ge=1, le=50),
    session: AsyncSession = Depends(get_session),
) -> KnowledgeSearchResponse:
    """知識庫混合檢索（語意 + 關鍵字，RRF 融合）。"""
    hits = await kb.search_knowledge(session, q, limit=limit)
    return KnowledgeSearchResponse(
        items=[KnowledgeSearchHit.model_validate(h) for h in hits],
        count=len(hits),
        query=q,
    )


@router.get("/docs", response_model=KnowledgeDocsResponse)
async def list_docs(
    session: AsyncSession = Depends(get_session),
) -> KnowledgeDocsResponse:
    """列出知識庫所有文件（依 doc_id 聚合）。"""
    docs = await kb.list_docs(session)
    return KnowledgeDocsResponse(
        items=[KnowledgeDocItem.model_validate(d) for d in docs],
        count=len(docs),
    )


@router.get("/docs/{doc_id}", response_model=KnowledgeDocDetail)
async def get_doc(
    doc_id: str,
    session: AsyncSession = Depends(get_session),
) -> KnowledgeDocDetail:
    """調閱單篇文件的全部切塊（依 chunk_index 遞增）。查無此文件 → 404。"""
    chunks = await kb.get_doc_chunks(session, doc_id)
    if not chunks:
        raise HTTPException(status_code=404, detail=f"knowledge doc {doc_id} not found")
    return KnowledgeDocDetail(
        doc_id=doc_id,
        title=chunks[0].title,
        count=len(chunks),
        chunks=[KnowledgeChunkOut.model_validate(c) for c in chunks],
    )

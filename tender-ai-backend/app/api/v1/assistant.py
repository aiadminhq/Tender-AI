# -*- coding: utf-8 -*-
"""標案助手串流 API。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.assistant import (
    AssistantChatRequest,
    AssistantThreadDetailOut,
    AssistantThreadListOut,
    AssistantThreadMessageOut,
    AssistantThreadOut,
)
from app.services import assistant_store
from app.services.assistant import stream_chat_events

router = APIRouter(prefix="/assistant", tags=["assistant"])

# 登入身分尚未落地：對話留存一律掛在佔位擁有者（見 CLAUDE.md Layer B 紅線）。
_DEFAULT_OWNER = "default"


@router.post("/chat")
async def chat(
    payload: AssistantChatRequest,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    return StreamingResponse(
        stream_chat_events(session, payload),
        media_type="application/x-ndjson; charset=utf-8",
    )


@router.get("/threads", response_model=AssistantThreadListOut)
async def list_threads(
    limit: int = 20,
    session: AsyncSession = Depends(get_session),
) -> AssistantThreadListOut:
    """列出近期對話串（依最近活動排序），供前端浮窗／指揮中心回顯。"""
    threads = await assistant_store.list_threads(
        session, _DEFAULT_OWNER, limit=max(1, min(limit, 100))
    )
    return AssistantThreadListOut(
        threads=[AssistantThreadOut.model_validate(t) for t in threads]
    )


@router.get("/threads/{thread_id}", response_model=AssistantThreadDetailOut)
async def get_thread(
    thread_id: str,
    session: AsyncSession = Depends(get_session),
) -> AssistantThreadDetailOut:
    """取單一對話串的完整訊息（依寫入序），供前端 hydrate 接續上次對話。"""
    thread = await assistant_store.get_thread(session, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="thread not found")
    messages = await assistant_store.get_thread_messages(session, thread_id)
    return AssistantThreadDetailOut(
        **AssistantThreadOut.model_validate(thread).model_dump(),
        messages=[AssistantThreadMessageOut.model_validate(m) for m in messages],
    )


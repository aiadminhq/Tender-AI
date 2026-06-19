# -*- coding: utf-8 -*-
"""標案助手串流 API。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.assistant import AssistantChatRequest
from app.services.assistant import stream_chat_events

router = APIRouter(prefix="/assistant", tags=["assistant"])


@router.post("/chat")
async def chat(
    payload: AssistantChatRequest,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    return StreamingResponse(
        stream_chat_events(session, payload),
        media_type="application/x-ndjson; charset=utf-8",
    )


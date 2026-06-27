# -*- coding: utf-8 -*-
"""標案助手串流 API。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import decode_token
from app.db.session import get_session
from app.models.behavior import User
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

# 未登入／示範模式沿用佔位擁有者；有 Bearer token 時用登入者 id 做個人歷史隔離。
_DEFAULT_OWNER = "default"


async def _assistant_owner_id(
    session: AsyncSession,
    authorization: str | None,
) -> str:
    """有 Bearer token 時用登入者 id 隔離個人歷史；無 token 則沿用 demo default。"""
    if not authorization:
        return _DEFAULT_OWNER
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid authorization header",
        )
    payload = decode_token(authorization[len("Bearer "):].strip())
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token invalid or expired",
        )
    user = await session.get(User, int(payload["uid"]))
    if user is None or not user.whitelist_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="user not found or inactive",
        )
    return str(user.id)


@router.post("/chat")
async def chat(
    payload: AssistantChatRequest,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    owner_user_id = await _assistant_owner_id(session, authorization)
    return StreamingResponse(
        stream_chat_events(session, payload, owner_user_id=owner_user_id),
        media_type="application/x-ndjson; charset=utf-8",
    )


@router.get("/threads", response_model=AssistantThreadListOut)
async def list_threads(
    limit: int = 20,
    q: str | None = None,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> AssistantThreadListOut:
    """列出近期對話串（依最近活動排序），供前端浮窗／指揮中心回顯。"""
    owner_user_id = await _assistant_owner_id(session, authorization)
    threads = await assistant_store.list_threads(
        session, owner_user_id, limit=max(1, min(limit, 100)), query=q
    )
    return AssistantThreadListOut(
        threads=[AssistantThreadOut.model_validate(t) for t in threads]
    )


@router.get("/threads/{thread_id}", response_model=AssistantThreadDetailOut)
async def get_thread(
    thread_id: str,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> AssistantThreadDetailOut:
    """取單一對話串的完整訊息（依寫入序），供前端 hydrate 接續上次對話。"""
    owner_user_id = await _assistant_owner_id(session, authorization)
    thread = await assistant_store.get_thread(session, thread_id)
    if thread is None or thread.owner_user_id != owner_user_id:
        raise HTTPException(status_code=404, detail="thread not found")
    messages = await assistant_store.get_thread_messages(session, thread_id)
    return AssistantThreadDetailOut(
        **AssistantThreadOut.model_validate(thread).model_dump(),
        messages=[AssistantThreadMessageOut.model_validate(m) for m in messages],
    )

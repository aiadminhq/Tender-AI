# -*- coding: utf-8 -*-
"""小助手對話留存 service（Phase 4）。

封裝 ``assistant_threads`` / ``assistant_messages`` 的讀寫：建串（冪等）、
append 訊息（首則使用者訊息補 title、bump 活動時間）、列串、取訊息。

Layer B 紅線（見 CLAUDE.md）：登入未落地前一律 ``owner_user_id="default"``、
``consent_state="pending-consent"``、``layer_b_opt_in=False``——不具名、不共享、
對外永不揭露。本層只碰對話留存，不寫評分／權重，也不組裝任何行為明細。

排序刻意用「最新訊息 id」而非 ``updated_at``：Postgres ``now()`` 在同一交易內為定值，
單交易連續寫多串時 ``updated_at`` 會相同；訊息 id 為全域單調自增，據此排序最穩定。
"""
from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assistant import AssistantMessage, AssistantThread

# thread title 取首則使用者訊息，截斷上限（與 model String(120) 一致）。
_TITLE_MAX = 120


async def ensure_thread(
    session: AsyncSession,
    thread_id: str,
    *,
    scope: str,
    owner_user_id: str = "default",
) -> AssistantThread:
    """取得既有 thread；不存在則以安全預設建立（不覆寫既有 scope/owner）。"""
    existing = await session.get(AssistantThread, thread_id)
    if existing is not None:
        return existing

    thread = AssistantThread(
        id=thread_id,
        owner_user_id=owner_user_id,
        scope=scope,
        consent_state="pending-consent",
        layer_b_opt_in=False,
    )
    session.add(thread)
    await session.flush()
    return thread


async def append_message(
    session: AsyncSession,
    thread_id: str,
    *,
    role: str,
    content: str,
    sources: list | None = None,
) -> AssistantMessage:
    """append 一則訊息；首則使用者訊息補 thread.title，並 bump updated_at。"""
    message = AssistantMessage(
        thread_id=thread_id,
        role=role,
        content=content,
        sources=sources,
    )
    session.add(message)

    thread = await session.get(AssistantThread, thread_id)
    if thread is not None:
        if role == "user" and not thread.title:
            thread.title = content[:_TITLE_MAX]
        # bump 活動時間（顯示用）；排序另以最新訊息 id 為準，不依賴此值。
        thread.updated_at = func.now()

    await session.flush()
    return message


async def list_threads(
    session: AsyncSession,
    owner_user_id: str = "default",
    *,
    limit: int = 20,
    query: str | None = None,
) -> list[AssistantThread]:
    """列出某擁有者的 thread，依最近活動排序；query 可搜尋標題與訊息內容。"""
    last_msg = (
        select(
            AssistantMessage.thread_id.label("thread_id"),
            func.max(AssistantMessage.id).label("last_id"),
        )
        .group_by(AssistantMessage.thread_id)
        .subquery()
    )
    stmt = (
        select(AssistantThread)
        .outerjoin(last_msg, last_msg.c.thread_id == AssistantThread.id)
        .where(AssistantThread.owner_user_id == owner_user_id)
        .order_by(
            func.coalesce(last_msg.c.last_id, 0).desc(),
            AssistantThread.created_at.desc(),
        )
        .limit(limit)
    )
    q = (query or "").strip()
    if q:
        term = f"%{q}%"
        message_match = (
            select(AssistantMessage.id)
            .where(
                AssistantMessage.thread_id == AssistantThread.id,
                AssistantMessage.content.ilike(term),
            )
            .exists()
        )
        stmt = stmt.where(or_(AssistantThread.title.ilike(term), message_match))
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_thread(
    session: AsyncSession, thread_id: str
) -> AssistantThread | None:
    """取單一 thread；不存在回 None（供 API 轉 404）。"""
    return await session.get(AssistantThread, thread_id)


async def get_thread_messages(
    session: AsyncSession, thread_id: str
) -> list[AssistantMessage]:
    """取某 thread 的訊息，依寫入序（id 單調）排序。"""
    stmt = (
        select(AssistantMessage)
        .where(AssistantMessage.thread_id == thread_id)
        .order_by(AssistantMessage.id.asc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())

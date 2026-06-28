# -*- coding: utf-8 -*-
"""Phase 4 對話留存（assistant_threads / assistant_messages）service 層測試。

留存紅線（見 CLAUDE.md Layer B）：登入身分到位前一律
``owner_user_id="default"``、``consent_state="pending-consent"``、
``layer_b_opt_in=False``——不具名、不共享、對外永不揭露。
"""
from __future__ import annotations

import pytest

from app.services import assistant_store as store

pytestmark = pytest.mark.asyncio


async def test_ensure_thread_creates_with_safe_defaults(db_session):
    thread = await store.ensure_thread(db_session, "t-1", scope="assistant")
    await db_session.commit()

    assert thread.id == "t-1"
    assert thread.scope == "assistant"
    # 登入未落地：預設不具名、不共享。
    assert thread.owner_user_id == "default"
    assert thread.consent_state == "pending-consent"
    assert thread.layer_b_opt_in is False


async def test_ensure_thread_is_idempotent(db_session):
    first = await store.ensure_thread(db_session, "t-1", scope="assistant")
    await db_session.commit()
    again = await store.ensure_thread(db_session, "t-1", scope="assistant_page")
    await db_session.commit()

    assert again.id == first.id
    # 既有 thread 不被第二次呼叫覆寫 scope。
    assert again.scope == "assistant"
    threads = await store.list_threads(db_session)
    assert len(threads) == 1


async def test_append_message_sets_title_from_first_user_prompt(db_session):
    await store.ensure_thread(db_session, "t-1", scope="assistant")
    await store.append_message(
        db_session, "t-1", role="user", content="台北市有哪些資訊系統標案？"
    )
    await db_session.commit()

    threads = await store.list_threads(db_session)
    assert threads[0].title == "台北市有哪些資訊系統標案？"


async def test_append_assistant_message_persists_sources(db_session):
    await store.ensure_thread(db_session, "t-1", scope="assistant")
    sources = [{"kind": "tender", "tender_id": 7, "title": "某標案"}]
    await store.append_message(
        db_session, "t-1", role="assistant", content="這是回答", sources=sources
    )
    await db_session.commit()

    messages = await store.get_thread_messages(db_session, "t-1")
    assert len(messages) == 1
    assert messages[0].role == "assistant"
    assert messages[0].content == "這是回答"
    assert messages[0].sources == sources


async def test_get_thread_messages_ordered_by_creation(db_session):
    await store.ensure_thread(db_session, "t-1", scope="assistant")
    await store.append_message(db_session, "t-1", role="user", content="問題一")
    await store.append_message(db_session, "t-1", role="assistant", content="回答一")
    await store.append_message(db_session, "t-1", role="user", content="問題二")
    await db_session.commit()

    messages = await store.get_thread_messages(db_session, "t-1")
    assert [m.content for m in messages] == ["問題一", "回答一", "問題二"]


async def test_list_threads_orders_by_recent_activity(db_session):
    await store.ensure_thread(db_session, "old", scope="assistant")
    await store.ensure_thread(db_session, "new", scope="assistant")
    # 在 old 上後寫一筆訊息 → bump updated_at → 應排到最前。
    await store.append_message(db_session, "old", role="user", content="嗨")
    await db_session.commit()

    threads = await store.list_threads(db_session)
    assert threads[0].id == "old"


async def test_list_threads_filters_by_owner(db_session):
    await store.ensure_thread(db_session, "mine", scope="assistant")
    await store.ensure_thread(
        db_session, "other", scope="assistant", owner_user_id="someone-else"
    )
    await db_session.commit()

    threads = await store.list_threads(db_session, owner_user_id="default")
    assert [t.id for t in threads] == ["mine"]

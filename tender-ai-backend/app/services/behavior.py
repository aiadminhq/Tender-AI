# -*- coding: utf-8 -*-
"""Layer B 行為/回饋寫入服務（白名單合作範圍內共享、對外不揭露；永不進任何公開 repo）。

對應 handoff 附錄 C 行為端點：save/accept/rate/note/share、events、saved-searches。
user_id 省略時落到「預設使用者」（單一團隊；名稱中性，不放真實人名／email）。
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EntityNotFound
from app.models.behavior import (
    Annotation,
    Evaluation,
    Event,
    SavedSearch,
    Share,
    TenderUserState,
    User,
)
from app.models.tender import Tender

# 預設使用者名稱：中性，避免把真實人名寫進程式碼／向量 metadata
DEFAULT_USER_NAME = "default"


# --------------------------------------------------------------------------- #
# 使用者解析
# --------------------------------------------------------------------------- #
async def get_or_create_default_user(session: AsyncSession) -> User:
    user = (
        await session.execute(select(User).where(User.name == DEFAULT_USER_NAME))
    ).scalar_one_or_none()
    if user is None:
        user = User(name=DEFAULT_USER_NAME, role="member")
        session.add(user)
        await session.flush()
    return user


async def resolve_user_id(session: AsyncSession, user_id: int | None) -> int:
    """寫入路徑用：None → 取/建預設使用者；給定 id → 驗證存在，否則 404。"""
    if user_id is None:
        return (await get_or_create_default_user(session)).id
    if await session.get(User, user_id) is None:
        raise EntityNotFound(f"user {user_id} not found")
    return user_id


async def _ensure_tender(session: AsyncSession, tender_id: int) -> None:
    if await session.get(Tender, tender_id) is None:
        raise EntityNotFound(f"tender {tender_id} not found")


# --------------------------------------------------------------------------- #
# tender_user_state（save/accept/rate → upsert）
# --------------------------------------------------------------------------- #
async def _upsert_state(
    session: AsyncSession, user_id: int, tender_id: int, **fields
) -> TenderUserState:
    stmt = (
        pg_insert(TenderUserState)
        .values(user_id=user_id, tender_id=tender_id, **fields)
        .on_conflict_do_update(
            index_elements=["user_id", "tender_id"],
            set_={**fields, "updated_at": func.now()},
        )
    )
    await session.execute(stmt)
    await session.flush()
    return (
        await session.execute(
            select(TenderUserState).where(
                TenderUserState.user_id == user_id,
                TenderUserState.tender_id == tender_id,
            )
        )
    ).scalar_one()


async def set_saved(
    session: AsyncSession, user_id: int | None, tender_id: int, saved: bool
) -> TenderUserState:
    uid = await resolve_user_id(session, user_id)
    await _ensure_tender(session, tender_id)
    return await _upsert_state(session, uid, tender_id, saved=saved)


async def set_status(
    session: AsyncSession, user_id: int | None, tender_id: int, status: str
) -> TenderUserState:
    uid = await resolve_user_id(session, user_id)
    await _ensure_tender(session, tender_id)
    return await _upsert_state(session, uid, tender_id, status=status)


async def set_star(
    session: AsyncSession, user_id: int | None, tender_id: int, star: int
) -> TenderUserState:
    uid = await resolve_user_id(session, user_id)
    await _ensure_tender(session, tender_id)
    return await _upsert_state(session, uid, tender_id, star=star)


# --------------------------------------------------------------------------- #
# annotations / shares / events
# --------------------------------------------------------------------------- #
async def add_note(
    session: AsyncSession, user_id: int | None, tender_id: int, note: str
) -> Annotation:
    uid = await resolve_user_id(session, user_id)
    await _ensure_tender(session, tender_id)
    row = Annotation(user_id=uid, tender_id=tender_id, note=note)
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return row


async def add_share(
    session: AsyncSession, user_id: int | None, tender_id: int, channel: str | None
) -> Share:
    uid = await resolve_user_id(session, user_id)
    await _ensure_tender(session, tender_id)
    row = Share(user_id=uid, tender_id=tender_id, channel=channel)
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return row


async def add_event(
    session: AsyncSession,
    user_id: int | None,
    event_type: str,
    tender_id: int | None,
    payload: dict | None,
) -> Event:
    uid = await resolve_user_id(session, user_id)
    if tender_id is not None:
        await _ensure_tender(session, tender_id)
    row = Event(user_id=uid, type=event_type, tender_id=tender_id, payload=payload)
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return row


# --------------------------------------------------------------------------- #
# evaluation（標案判斷 ✓/✗/⭐ → 手動 upsert ＋ judgment 事件）
# --------------------------------------------------------------------------- #
async def add_evaluation(
    session: AsyncSession,
    user_id: int | None,
    tender_id: int,
    feasible: str,
    rationale: str | None,
    criteria: dict | None,
) -> Evaluation:
    """寫入/更新單筆標案判斷（Layer B，具名、consent-aware 由聚合層把關）。

    ``Evaluation`` 無 (user_id, tender_id) 唯一鍵（既有資料可能已有重複），故以
    「取最新一筆→有則更新、無則新增」的手動 upsert，避免新增 migration。
    同時發一筆 ``judgment`` 事件（記極性與 chips），供行為時序與後續分析。
    """
    uid = await resolve_user_id(session, user_id)
    await _ensure_tender(session, tender_id)

    existing = (
        await session.execute(
            select(Evaluation)
            .where(Evaluation.user_id == uid, Evaluation.tender_id == tender_id)
            .order_by(Evaluation.created_at.desc(), Evaluation.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if existing is not None:
        existing.feasible = feasible
        existing.rationale = rationale
        existing.criteria = criteria
        row = existing
    else:
        row = Evaluation(
            user_id=uid,
            tender_id=tender_id,
            feasible=feasible,
            rationale=rationale,
            criteria=criteria,
        )
        session.add(row)
    await session.flush()
    await session.refresh(row)

    # judgment 事件：payload 記極性、是否精選、chips 與是否填了原因（不存自由文字本體，
    # 自由文字留在 Evaluation.rationale，避免重複落地）。
    featured = bool((criteria or {}).get("featured"))
    chips = (criteria or {}).get("chips")
    await add_event(
        session,
        uid,
        "judgment",
        tender_id,
        {
            "feasible": feasible,
            "featured": featured,
            "chips": chips,
            "has_rationale": bool(rationale),
        },
    )
    return row


# --------------------------------------------------------------------------- #
# saved_searches
# --------------------------------------------------------------------------- #
async def create_saved_search(
    session: AsyncSession,
    user_id: int | None,
    name: str,
    query_text: str | None,
    filter_json: dict | None,
) -> SavedSearch:
    uid = await resolve_user_id(session, user_id)
    row = SavedSearch(
        user_id=uid, name=name, query_text=query_text, filter_json=filter_json
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return row


async def list_saved_searches(
    session: AsyncSession, user_id: int | None
) -> list[SavedSearch]:
    """讀取路徑：不建立預設使用者（避免唯讀請求產生寫入副作用）。"""
    if user_id is None:
        user = (
            await session.execute(
                select(User).where(User.name == DEFAULT_USER_NAME)
            )
        ).scalar_one_or_none()
        if user is None:
            return []
        uid = user.id
    else:
        if await session.get(User, user_id) is None:
            raise EntityNotFound(f"user {user_id} not found")
        uid = user_id

    rows = (
        (
            await session.execute(
                select(SavedSearch)
                .where(SavedSearch.user_id == uid)
                .order_by(SavedSearch.created_at.desc(), SavedSearch.id.desc())
            )
        )
        .scalars()
        .all()
    )
    return list(rows)

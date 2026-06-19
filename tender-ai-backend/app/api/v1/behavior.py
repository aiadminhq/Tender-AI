# -*- coding: utf-8 -*-
"""Layer B 行為/回饋寫入 API（save/accept/rate/note/share、events、saved-searches）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.behavior import (
    AcceptRequest,
    AnnotationOut,
    EventOut,
    EventRequest,
    NoteRequest,
    RateRequest,
    SavedSearchCreate,
    SavedSearchOut,
    SaveRequest,
    ShareOut,
    ShareRequest,
    StateOut,
)
from app.services import behavior as bsvc

router = APIRouter(tags=["behavior"])


@router.post("/tenders/{tender_id}/save", response_model=StateOut)
async def save_tender(
    tender_id: int,
    body: SaveRequest,
    session: AsyncSession = Depends(get_session),
) -> StateOut:
    st = await bsvc.set_saved(session, body.user_id, tender_id, body.saved)
    await session.commit()
    return StateOut.model_validate(st)


@router.post("/tenders/{tender_id}/accept", response_model=StateOut)
async def accept_tender(
    tender_id: int,
    body: AcceptRequest,
    session: AsyncSession = Depends(get_session),
) -> StateOut:
    st = await bsvc.set_status(session, body.user_id, tender_id, body.status)
    await session.commit()
    return StateOut.model_validate(st)


@router.post("/tenders/{tender_id}/rate", response_model=StateOut)
async def rate_tender(
    tender_id: int,
    body: RateRequest,
    session: AsyncSession = Depends(get_session),
) -> StateOut:
    st = await bsvc.set_star(session, body.user_id, tender_id, body.star)
    await session.commit()
    return StateOut.model_validate(st)


@router.post("/tenders/{tender_id}/note", response_model=AnnotationOut)
async def note_tender(
    tender_id: int,
    body: NoteRequest,
    session: AsyncSession = Depends(get_session),
) -> AnnotationOut:
    row = await bsvc.add_note(session, body.user_id, tender_id, body.note)
    await session.commit()
    return AnnotationOut.model_validate(row)


@router.post("/tenders/{tender_id}/share", response_model=ShareOut)
async def share_tender(
    tender_id: int,
    body: ShareRequest,
    session: AsyncSession = Depends(get_session),
) -> ShareOut:
    row = await bsvc.add_share(session, body.user_id, tender_id, body.channel)
    await session.commit()
    return ShareOut.model_validate(row)


@router.post("/events", response_model=EventOut)
async def post_event(
    body: EventRequest,
    session: AsyncSession = Depends(get_session),
) -> EventOut:
    row = await bsvc.add_event(
        session, body.user_id, body.type, body.tender_id, body.payload
    )
    await session.commit()
    return EventOut.model_validate(row)


@router.get("/saved-searches", response_model=list[SavedSearchOut])
async def get_saved_searches(
    user_id: int | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[SavedSearchOut]:
    rows = await bsvc.list_saved_searches(session, user_id)
    return [SavedSearchOut.model_validate(r) for r in rows]


@router.post("/saved-searches", response_model=SavedSearchOut)
async def post_saved_search(
    body: SavedSearchCreate,
    session: AsyncSession = Depends(get_session),
) -> SavedSearchOut:
    row = await bsvc.create_saved_search(
        session, body.user_id, body.name, body.query_text, body.filter_json
    )
    await session.commit()
    return SavedSearchOut.model_validate(row)

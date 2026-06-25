# -*- coding: utf-8 -*-
"""Layer B 行為/回饋寫入 API（save/accept/rate/note/share、events、saved-searches）。"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.db.session import get_session
from app.models.behavior import User
from app.schemas.behavior import (
    AcceptRequest,
    AnnotationOut,
    EvaluateRequest,
    EvaluateResult,
    EvaluationOut,
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
from app.services import realtime_learn

logger = logging.getLogger(__name__)

router = APIRouter(tags=["behavior"])


@router.post("/tenders/{tender_id}/save", response_model=StateOut)
async def save_tender(
    tender_id: int,
    body: SaveRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> StateOut:
    st = await bsvc.set_saved(session, user.id, tender_id, body.saved)
    await session.commit()
    return StateOut.model_validate(st)


@router.post("/tenders/{tender_id}/accept", response_model=StateOut)
async def accept_tender(
    tender_id: int,
    body: AcceptRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> StateOut:
    st = await bsvc.set_status(session, user.id, tender_id, body.status)
    await session.commit()
    return StateOut.model_validate(st)


@router.post("/tenders/{tender_id}/rate", response_model=StateOut)
async def rate_tender(
    tender_id: int,
    body: RateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> StateOut:
    st = await bsvc.set_star(session, user.id, tender_id, body.star)
    await session.commit()
    return StateOut.model_validate(st)


@router.post("/tenders/{tender_id}/note", response_model=AnnotationOut)
async def note_tender(
    tender_id: int,
    body: NoteRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AnnotationOut:
    row = await bsvc.add_note(session, user.id, tender_id, body.note)
    await session.commit()
    return AnnotationOut.model_validate(row)


@router.post("/tenders/{tender_id}/share", response_model=ShareOut)
async def share_tender(
    tender_id: int,
    body: ShareRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ShareOut:
    row = await bsvc.add_share(session, user.id, tender_id, body.channel)
    await session.commit()
    return ShareOut.model_validate(row)


@router.post("/tenders/{tender_id}/evaluate", response_model=EvaluateResult)
async def evaluate_tender(
    tender_id: int,
    body: EvaluateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> EvaluateResult:
    """標案判斷（✓ 可行／✗ 不可行／⭐ 精選）寫入 Layer B，並即時觸發 Layer B→C 學習。

    流程：upsert Evaluation ＋ 發 judgment 事件 → commit → 即時重算關鍵字權重
    （個人線＋consent-aware 團隊線，append-only）。即時學習失敗不影響判斷已落地，
    僅回傳 learning=None。
    """
    row = await bsvc.add_evaluation(
        session,
        user.id,
        tender_id,
        body.feasible,
        body.rationale,
        body.criteria,
    )
    await session.commit()

    # 即時學習用獨立 session（讀得到已 commit 的最新判斷）；可運作才回傳摘要。
    # realtime_learn.learn_after_evaluation(...) 路徑不動（owner 知情覆寫）。
    learning: dict | None = None
    try:
        learning = await realtime_learn.learn_after_evaluation()
    except Exception:  # noqa: BLE001 — 學習失敗不可吞掉判斷結果
        logger.exception("realtime_learn after evaluation failed (tender=%s)", tender_id)

    return EvaluateResult(
        evaluation=EvaluationOut.model_validate(row),
        learning=learning,
    )


@router.post("/events", response_model=EventOut)
async def post_event(
    body: EventRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> EventOut:
    row = await bsvc.add_event(
        session, user.id, body.type, body.tender_id, body.payload
    )
    await session.commit()
    return EventOut.model_validate(row)


@router.get("/saved-searches", response_model=list[SavedSearchOut])
async def get_saved_searches(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[SavedSearchOut]:
    rows = await bsvc.list_saved_searches(session, user.id)
    return [SavedSearchOut.model_validate(r) for r in rows]


@router.post("/saved-searches", response_model=SavedSearchOut)
async def post_saved_search(
    body: SavedSearchCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SavedSearchOut:
    row = await bsvc.create_saved_search(
        session, user.id, body.name, body.query_text, body.filter_json
    )
    await session.commit()
    return SavedSearchOut.model_validate(row)

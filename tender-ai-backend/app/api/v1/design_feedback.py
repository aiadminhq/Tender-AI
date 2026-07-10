# -*- coding: utf-8 -*-
"""Design feedback API for annotation tool, assistant capture, and CLI aggregation."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import decode_token
from app.db.session import get_session
from app.models.behavior import User
from app.schemas.design_feedback import (
    DesignFeedbackCreateRequest,
    DesignFeedbackCreateResponse,
    DesignFeedbackListResponse,
    DesignFeedbackOut,
    DesignFeedbackSummaryResponse,
)
from app.services import design_feedback as dfsvc

router = APIRouter(prefix="/design-feedback", tags=["design-feedback"])

_DEFAULT_OWNER = "default"


async def _owner_id(session: AsyncSession, authorization: str | None) -> str:
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


@router.post("", response_model=DesignFeedbackCreateResponse)
async def create_design_feedback(
    payload: DesignFeedbackCreateRequest,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> DesignFeedbackCreateResponse:
    owner_user_id = await _owner_id(session, authorization)
    batch_id, rows = await dfsvc.create_batch(session, payload, owner_user_id)
    await session.commit()
    return DesignFeedbackCreateResponse(
        batch_id=batch_id,
        count=len(rows),
        items=[DesignFeedbackOut.model_validate(row) for row in rows],
    )


@router.get("", response_model=DesignFeedbackListResponse)
async def list_design_feedback(
    limit: int = 100,
    target_cli: str | None = None,
    mine: bool = False,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> DesignFeedbackListResponse:
    owner_user_id = await _owner_id(session, authorization) if mine else None
    rows = await dfsvc.list_items(
        session,
        limit=limit,
        target_cli=target_cli,
        owner_user_id=owner_user_id,
    )
    return DesignFeedbackListResponse(
        items=[DesignFeedbackOut.model_validate(row) for row in rows]
    )


@router.get("/summary", response_model=DesignFeedbackSummaryResponse)
async def design_feedback_summary(
    limit: int = 100,
    target_cli: str | None = None,
    mine: bool = False,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> DesignFeedbackSummaryResponse:
    owner_user_id = await _owner_id(session, authorization) if mine else None
    rows = await dfsvc.list_items(
        session,
        limit=limit,
        target_cli=target_cli,
        owner_user_id=owner_user_id,
    )
    return DesignFeedbackSummaryResponse(
        count=len(rows),
        markdown=dfsvc.render_markdown(rows),
    )

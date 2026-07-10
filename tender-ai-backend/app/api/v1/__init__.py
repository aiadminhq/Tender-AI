# -*- coding: utf-8 -*-
"""v1 API 聚合 router（掛載於 /api/v1）。"""
from fastapi import APIRouter

from app.api.v1.admin import router as admin_router
from app.api.v1.assistant import router as assistant_router
from app.api.v1.auth import router as auth_router
from app.api.v1.behavior import router as behavior_router
from app.api.v1.design_feedback import router as design_feedback_router
from app.api.v1.index_status import router as index_router
from app.api.v1.knowledge import router as knowledge_router
from app.api.v1.learning import router as learning_router
from app.api.v1.me import router as me_router
from app.api.v1.push import router as push_router
from app.api.v1.reasoning import router as reasoning_router
from app.api.v1.search import router as search_router
from app.api.v1.settings import router as settings_router
from app.api.v1.tenders import router as tenders_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(tenders_router)
api_router.include_router(behavior_router)
api_router.include_router(design_feedback_router)
api_router.include_router(search_router)
api_router.include_router(knowledge_router)
api_router.include_router(index_router)
api_router.include_router(assistant_router)
api_router.include_router(reasoning_router)
api_router.include_router(push_router)
api_router.include_router(learning_router)
api_router.include_router(me_router)
api_router.include_router(admin_router)
api_router.include_router(auth_router)
api_router.include_router(settings_router)

__all__ = ["api_router"]

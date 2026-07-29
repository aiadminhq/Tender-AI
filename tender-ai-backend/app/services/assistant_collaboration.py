# -*- coding: utf-8 -*-
"""小助手的 Layer B/C 證據組裝。

本模組只讀既有資料表，並在送進 LLM 前完成合作範圍檢查：
- Layer B 只會顯示白名單且已同意共享成員的註記、評估與事件摘要。
- Layer C 個人權重只給本人；團隊權重只給已去識別化的聚合結果。
- 原始 event payload、email 與未同意成員資料永不進 prompt 或來源卡。
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.behavior import Annotation, Evaluation, Event, User
from app.models.knowledge import KeywordWeight, UserKeywordWeight
from app.models.tender import Tender


@dataclass(slots=True)
class CollaborationEvidence:
    layer: str
    title: str
    content: str
    tender_id: int | None = None


_TEAM_TERMS = ("layer b", "團隊", "同事", "誰", "做了什麼", "評論", "評價", "註記")
_LEARNING_TERMS = ("layer c", "學到", "偏好", "權重", "判準", "進化")


def needs_collaboration_evidence(prompt: str) -> bool:
    lowered = prompt.lower()
    return any(term in lowered for term in _TEAM_TERMS + _LEARNING_TERMS)


async def collect_collaboration_evidence(
    session: AsyncSession,
    *,
    actor: User | None,
    prompt: str,
    focus_tender_id: int | None,
) -> list[CollaborationEvidence]:
    """依使用者提問取最少必要的協作證據，沒有合作權限時明確回報原因。"""
    if not needs_collaboration_evidence(prompt):
        return []
    if actor is None or not actor.whitelist_active:
        return [
            CollaborationEvidence(
                layer="access",
                title="團隊協作資料",
                content="需要以已開通的公司白名單帳號登入，才能查詢 Layer B/C 團隊資料。",
            )
        ]

    evidence: list[CollaborationEvidence] = []
    lowered = prompt.lower()
    include_team = any(term in lowered for term in _TEAM_TERMS)
    include_learning = any(term in lowered for term in _LEARNING_TERMS)
    tender_filter = [Evaluation.tender_id == focus_tender_id] if focus_tender_id else []

    if include_team:
        evaluation_rows = await session.execute(
            select(Evaluation, User, Tender)
            .join(User, User.id == Evaluation.user_id)
            .join(Tender, Tender.id == Evaluation.tender_id)
            .where(User.whitelist_active.is_(True), User.consent_shared.is_(True), *tender_filter)
            .order_by(Evaluation.created_at.desc())
            .limit(6)
        )
        for evaluation, user, tender in evaluation_rows.all():
            rationale = " ".join((evaluation.rationale or "未填原因").split())[:180]
            evidence.append(
                CollaborationEvidence(
                    layer="B",
                    title=f"{user.name} 對「{tender.name}」的評估",
                    tender_id=tender.id,
                    content=f"結論：{evaluation.feasible or '待議'}。理由：{rationale}",
                )
            )

        annotation_rows = await session.execute(
            select(Annotation, User, Tender)
            .join(User, User.id == Annotation.user_id)
            .join(Tender, Tender.id == Annotation.tender_id)
            .where(
                User.whitelist_active.is_(True),
                User.consent_shared.is_(True),
                *([Annotation.tender_id == focus_tender_id] if focus_tender_id else []),
            )
            .order_by(Annotation.created_at.desc())
            .limit(4)
        )
        for annotation, user, tender in annotation_rows.all():
            note = " ".join(annotation.note.split())[:180]
            evidence.append(
                CollaborationEvidence(
                    layer="B",
                    title=f"{user.name} 對「{tender.name}」的註記",
                    tender_id=tender.id,
                    content=note,
                )
            )

        event_rows = await session.execute(
            select(Event, User, Tender)
            .join(User, User.id == Event.user_id)
            .outerjoin(Tender, Tender.id == Event.tender_id)
            .where(User.whitelist_active.is_(True), User.consent_shared.is_(True))
            .order_by(Event.ts.desc())
            .limit(5)
        )
        for event, user, tender in event_rows.all():
            subject = f"「{tender.name}」" if tender else "標案清單"
            evidence.append(
                CollaborationEvidence(
                    layer="B",
                    title=f"{user.name} 的近期動作",
                    tender_id=tender.id if tender else None,
                    content=f"對 {subject} 進行「{event.type}」。",
                )
            )

    if include_learning:
        personal_rows = await session.execute(
            select(UserKeywordWeight)
            .where(UserKeywordWeight.user_id == actor.id)
            .order_by(UserKeywordWeight.weight.desc())
            .limit(6)
        )
        for row in personal_rows.scalars():
            evidence.append(
                CollaborationEvidence(
                    layer="C",
                    title="你的個人化判準",
                    content=f"{row.polarity} 關鍵字「{row.term}」，權重 {row.weight:.2f}，樣本 {row.support}。",
                )
            )

        team_rows = await session.execute(
            select(KeywordWeight).order_by(KeywordWeight.weight.desc()).limit(6)
        )
        for row in team_rows.scalars():
            evidence.append(
                CollaborationEvidence(
                    layer="C",
                    title="團隊聚合判準",
                    content=f"{row.polarity} 關鍵字「{row.term}」，權重 {row.weight:.2f}，樣本 {row.support}。",
                )
            )

    if not evidence:
        evidence.append(
            CollaborationEvidence(
                layer="B/C",
                title="團隊協作與學習資料",
                content="目前沒有符合已同意共享範圍的資料可引用。",
            )
        )
    return evidence[:16]

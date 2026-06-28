# -*- coding: utf-8 -*-
"""SL6 自我進化編排服務（self-evolve）。

把「系統隨使用者行為自我演進」這條迴圈變得**可排程、可追溯、可視化**——
但**不重寫**已測試的 ``learn_keywords`` 核心，只在其外層編排：

  run_evolution:
    1) 呼叫既有 ``learn_keywords``（自管 session、自行 commit）做一輪權重學習，
       拿回該批 revision_batch 與增刪統計。
    2) 另開 session 讀「學習後的當前 top 重點詞／避免詞」（= 系統推斷的承標判準詞彙）。
    3) 聚合使用者行為信號（top 類別／城市／來源、事件型別計數、評估樣本與判準鍵）。
    4) 將以上 append 一列進 ``evolution_logs``（稽核軌跡），回傳摘要。

  aggregate_behavior_signals:
    純讀，user_id 嚴格隔離，回傳 Layer A 聚合統計（皆為計數與公開衍生詞彙）。

  get_evolution_status:
    最新一筆進化日誌 + 歷史時間軸 + 當前生效權重（即時，實際驅動排序）。

**隱私鐵則**：所有對外欄位僅含 Layer A 聚合統計與公開衍生詞彙——
無人名／email、不回放任何個別 rationale 文字或原始 payload。
``evolution_logs`` append-only，不更新。
"""
from __future__ import annotations

from collections import Counter

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EntityNotFound
from app.db.session import AsyncSessionLocal
from app.jobs.learn_keywords import learn_keywords
from app.models.behavior import Evaluation, Event, User
from app.models.knowledge import EvolutionLog, KeywordWeight
from app.models.tender import Source, Tender
from app.services.behavior import DEFAULT_USER_NAME

# 預設 top 詞彙 / top 信號維度的取樣數
_TOP_TERMS = 8
_TOP_DIMS = 5


# --------------------------------------------------------------------------- #
# 使用者解析（唯讀：不建立預設使用者，避免聚合查詢產生寫入副作用）
# --------------------------------------------------------------------------- #
async def _resolve_user_for_read(
    session: AsyncSession, user_id: int | None
) -> int | None:
    if user_id is None:
        user = (
            await session.execute(
                select(User).where(User.name == DEFAULT_USER_NAME)
            )
        ).scalar_one_or_none()
        return user.id if user is not None else None
    if await session.get(User, user_id) is None:
        raise EntityNotFound(f"user {user_id} not found")
    return user_id


# --------------------------------------------------------------------------- #
# top 權重（學習後當前生效的承標判準詞彙）
# --------------------------------------------------------------------------- #
async def _top_weights(
    session: AsyncSession, polarity: str, limit: int = _TOP_TERMS
) -> list[dict]:
    rows = (
        await session.execute(
            select(
                KeywordWeight.term, KeywordWeight.weight, KeywordWeight.support
            )
            .where(KeywordWeight.polarity == polarity)
            .order_by(KeywordWeight.weight.desc(), KeywordWeight.support.desc())
            .limit(limit)
        )
    ).all()
    return [
        {"term": term, "weight": round(float(weight), 4), "support": int(support)}
        for term, weight, support in rows
    ]


async def _top_dimension(
    session: AsyncSession, column, uid: int, limit: int = _TOP_DIMS
) -> list[dict]:
    """events → tenders join 後，依某標案維度（類別／城市）取 top 計數。"""
    n = func.count().label("n")
    rows = (
        await session.execute(
            select(column, n)
            .join(Event, Event.tender_id == Tender.id)
            .where(Event.user_id == uid, column.isnot(None))
            .group_by(column)
            .order_by(n.desc())
            .limit(limit)
        )
    ).all()
    return [{"value": value, "count": int(count)} for value, count in rows]


# --------------------------------------------------------------------------- #
# 行為信號聚合（Layer A 聚合統計，user_id 隔離）
# --------------------------------------------------------------------------- #
async def aggregate_behavior_signals(
    session: AsyncSession, user_id: int | None
) -> dict:
    """聚合使用者「實際在關注什麼」的量化快照。

    皆為計數與公開衍生詞彙（標案類別／城市／來源、事件型別、評估判準鍵），
    **不含**任何人名／email／個別評語原文。user_id 為 None（查無使用者）時回空骨架。
    """
    empty = {
        "user_id": user_id,
        "events_total": 0,
        "event_type_counts": {},
        "top_categories": [],
        "top_cities": [],
        "top_sources": [],
        "evaluation_counts": {},
        "top_criteria": [],
    }
    if user_id is None:
        return empty

    # 事件型別計數（view / open_detail / apply_filter / ...）
    type_rows = (
        await session.execute(
            select(Event.type, func.count())
            .where(Event.user_id == user_id)
            .group_by(Event.type)
        )
    ).all()
    event_type_counts = {str(t): int(c) for t, c in type_rows}

    # top 類別 / 城市（events join tenders）
    top_categories = await _top_dimension(session, Tender.category, user_id)
    top_cities = await _top_dimension(session, Tender.city, user_id)

    # top 來源（PCC / TMU，需經 Source join）
    n = func.count().label("n")
    src_rows = (
        await session.execute(
            select(Source.name, n)
            .select_from(Event)
            .join(Tender, Event.tender_id == Tender.id)
            .join(Source, Tender.source_id == Source.id)
            .where(Event.user_id == user_id)
            .group_by(Source.name)
            .order_by(n.desc())
            .limit(_TOP_DIMS)
        )
    ).all()
    top_sources = [{"value": name, "count": int(c)} for name, c in src_rows]

    # 評估結論計數（可行 / 不可行 / 待議）
    eval_rows = (
        await session.execute(
            select(Evaluation.feasible, func.count())
            .where(Evaluation.user_id == user_id)
            .group_by(Evaluation.feasible)
        )
    ).all()
    evaluation_counts = {str(f or "未填"): int(c) for f, c in eval_rows}

    # 評估判準鍵聚合（criteria JSONB 的 truthy 鍵；鍵名為領域判準，非 PII）
    crit_rows = (
        await session.execute(
            select(Evaluation.criteria).where(
                Evaluation.user_id == user_id,
                Evaluation.criteria.isnot(None),
            )
        )
    ).scalars().all()
    crit_counter: Counter = Counter()
    for crit in crit_rows:
        if isinstance(crit, dict):
            for key, val in crit.items():
                if val:
                    crit_counter[str(key)] += 1
    top_criteria = [
        {"key": key, "count": count}
        for key, count in crit_counter.most_common(_TOP_TERMS)
    ]

    return {
        "user_id": user_id,
        "events_total": sum(event_type_counts.values()),
        "event_type_counts": event_type_counts,
        "top_categories": top_categories,
        "top_cities": top_cities,
        "top_sources": top_sources,
        "evaluation_counts": evaluation_counts,
        "top_criteria": top_criteria,
    }


# --------------------------------------------------------------------------- #
# 序列化
# --------------------------------------------------------------------------- #
def _log_to_dict(log: EvolutionLog) -> dict:
    return {
        "id": log.id,
        "batch": log.batch,
        "trigger": log.trigger,
        "feasible_samples": log.feasible_samples,
        "infeasible_samples": log.infeasible_samples,
        "keywords_added": log.keywords_added,
        "keywords_updated": log.keywords_updated,
        "revision_rows": log.revision_rows,
        "top_positive": log.top_positive or [],
        "top_negative": log.top_negative or [],
        "negative_candidates": log.negative_candidates or [],
        "signals": log.signals or {},
        "created_at": log.created_at.isoformat() if log.created_at else None,
    }


# --------------------------------------------------------------------------- #
# 進化編排（run / status）
# --------------------------------------------------------------------------- #
async def run_evolution(
    session_factory=None,
    trigger: str = "manual",
    min_support: int = 2,
    user_id: int | None = None,
    top_n: int = _TOP_TERMS,
) -> dict:
    """跑一輪自我進化：學習權重 → 讀 top 判準詞 → 聚合行為信號 → 寫稽核日誌。

    不重寫 ``learn_keywords`` 核心（其自管 session 並自行 commit）；本函式僅在外層
    編排並另開 session 讀／寫 ``evolution_logs``。回傳該筆日誌的 dict。
    """
    if session_factory is None:
        session_factory = AsyncSessionLocal

    # 1) 既有學習迴圈（自管 session、自行 commit、append 一批 keyword_weight_revisions）
    stats = await learn_keywords(
        session_factory=session_factory, min_support=min_support
    )

    # 2) 另開 session：讀學習後 top 權重 + 聚合信號 + 寫 EvolutionLog
    async with session_factory() as session:
        top_positive = await _top_weights(session, "positive", top_n)
        top_negative = await _top_weights(session, "negative", top_n)
        uid = await _resolve_user_for_read(session, user_id)
        signals = await aggregate_behavior_signals(session, uid)

        log = EvolutionLog(
            batch=stats["revision_batch"],
            trigger=trigger,
            feasible_samples=stats["feasible_samples"],
            infeasible_samples=stats["infeasible_samples"],
            keywords_added=stats["keywords_added"],
            keywords_updated=stats["keywords_updated"],
            revision_rows=stats["revision_rows"],
            top_positive=top_positive,
            top_negative=top_negative,
            # 疑似迴避詞候選（附理由的建議，供人工審核；非自動負權重）
            negative_candidates=stats.get("negative_candidates") or [],
            signals=signals,
        )
        session.add(log)
        await session.commit()
        await session.refresh(log)
        return _log_to_dict(log)


async def get_evolution_status(
    session: AsyncSession,
    history_limit: int = 10,
    active_limit: int = 12,
) -> dict:
    """進化現況：最新日誌 + 歷史時間軸 + 當前生效權重（即時驅動排序）。"""
    logs = (
        await session.execute(
            select(EvolutionLog)
            .order_by(EvolutionLog.created_at.desc(), EvolutionLog.id.desc())
            .limit(history_limit)
        )
    ).scalars().all()

    total_runs = (
        await session.execute(select(func.count()).select_from(EvolutionLog))
    ).scalar_one()

    # 當前 keyword_weights（即時讀取、未快取——這就是實際在排序使用的判準）
    active_positive = await _top_weights(session, "positive", active_limit)
    active_negative = await _top_weights(session, "negative", active_limit)

    return {
        "total_runs": int(total_runs),
        "latest": _log_to_dict(logs[0]) if logs else None,
        "history": [_log_to_dict(log) for log in logs],
        "active_positive": active_positive,
        "active_negative": active_negative,
    }

# -*- coding: utf-8 -*-
"""SL5 主動推播服務（Layer B 寫入，但對外只回傳 Layer A 安全內容）。

「重自動推播」：把 SL2（關鍵字權重）＋SL3（可中標推理）學到的承標判準，每日轉成
一批「值得優先評估」的標案推播，落進 push_logs，前端通知面板即時呈現。

流程（run_push）：
  1) 以 SL2 學習可行度排序（query.list_tenders, sort="feas"）取候選池。
  2) 以顯示可行度（feasibility_score）門檻過濾。
  3) 跨日去重：近 lookback_days 已推給此使用者的標案排除（避免天天重複推同一案）。
  4) 取前 limit 筆，逐案 reasoning.explain_tender 產生 criteria_fit（score）與
     headline（reason），寫入 push_logs；(user_id, tender_id, run_date) 唯一 →
     同日重跑 idempotent。

所有推播內容只引用 Layer A 公開欄位與聚合結果，**不含人名／email 或個別評語原文**；
user_id 嚴格隔離。
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import desc, func, nulls_last, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import EntityNotFound
from app.models.behavior import User
from app.models.push import PushLog
from app.models.tender import Source, Tender
from app.schemas.push import PushDigestOut, PushItemOut, PushRunResult
from app.services.behavior import DEFAULT_USER_NAME, resolve_user_id
from app.services.query import _latest_snapshot_subq
from app.services.query import list_tenders
from app.services.reasoning import explain_tender
from app.schemas.tender import TenderQuery


# --------------------------------------------------------------------------- #
# 使用者解析（讀取路徑：不建立預設使用者，避免唯讀請求產生寫入副作用）
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


def _row_to_item(row) -> PushItemOut:
    """(PushLog, Tender|None, source, cur_days_left) → 推播卡。"""
    p: PushLog = row[0]
    t: Tender | None = row[1]
    return PushItemOut(
        id=p.id,
        tender_id=p.tender_id,
        run_date=p.run_date,
        score=p.score,
        tier=p.tier,
        reason=p.reason,
        channel=p.channel,
        status=p.status,
        pushed_at=p.pushed_at,
        read_at=p.read_at,
        name=t.name if t is not None else None,
        org=t.org if t is not None else None,
        category=t.category if t is not None else None,
        city=t.city if t is not None else None,
        budget_wan=t.budget_wan if t is not None else None,
        deadline_roc=t.deadline_roc if t is not None else None,
        days_left=row.cur_days_left,
        source=row.source,
        link=t.link if t is not None else None,
    )


# --------------------------------------------------------------------------- #
# 推播批次
# --------------------------------------------------------------------------- #
async def run_push(
    session: AsyncSession,
    user_id: int | None = None,
    *,
    limit: int | None = None,
    min_score: int | None = None,
    lookback_days: int | None = None,
    run_date: date | None = None,
) -> PushRunResult:
    """產生（或補齊）某批次日的推播。預設參數取自 settings（供排程呼叫）。"""
    uid = await resolve_user_id(session, user_id)
    limit = settings.push_daily_limit if limit is None else limit
    min_score = settings.push_min_score if min_score is None else min_score
    lookback_days = (
        settings.push_lookback_days if lookback_days is None else lookback_days
    )
    if run_date is None:
        run_date = date.today()

    # 1) 候選池：以學習可行度排序，取較寬的前段（再於下方過濾／去重）
    #    明確 include_expired=True 以保留 push 既有契約：候選池不套用清單 API 的
    #    「預設只回 active」過濾（該預設是為了前端首頁焦點，屬列表消費端的決定）。
    #    push 是否該剔除已截止案是另一個獨立產品決策，若要開啟需連同 push 測試一併調整。
    q = TenderQuery(
        sort="feas", page=1, page_size=max(limit * 6, 30), include_expired=True
    )
    items, _, _ = await list_tenders(session, q)

    # 2) 顯示可行度門檻
    pool = [it for it in items if (it.feasibility_score or 0) >= min_score]

    # 3) 跨日去重：[run_date - lookback, run_date) 已推過的標案排除
    since = run_date - timedelta(days=lookback_days)
    recent = set(
        (
            await session.execute(
                select(PushLog.tender_id).where(
                    PushLog.user_id == uid,
                    PushLog.run_date >= since,
                    PushLog.run_date < run_date,
                    PushLog.tender_id.isnot(None),
                )
            )
        )
        .scalars()
        .all()
    )
    fresh = [it for it in pool if it.id not in recent][:limit]
    skipped = sum(1 for it in pool if it.id in recent)

    # 同日已推（idempotent 重跑：略過已存在者，靠唯一鍵兜底）
    same_day = set(
        (
            await session.execute(
                select(PushLog.tender_id).where(
                    PushLog.user_id == uid,
                    PushLog.run_date == run_date,
                    PushLog.tender_id.isnot(None),
                )
            )
        )
        .scalars()
        .all()
    )

    # 4) 逐案推理 → 寫入
    created = 0
    for it in fresh:
        if it.id in same_day:
            continue
        reasoning = await explain_tender(session, it.id, uid)
        stmt = (
            pg_insert(PushLog)
            .values(
                user_id=uid,
                tender_id=it.id,
                run_date=run_date,
                score=reasoning.criteria_fit,
                tier=it.tier,
                reason=reasoning.headline,
                channel="in_app",
                status="pending",
            )
            .on_conflict_do_nothing(constraint="uq_push_user_tender_date")
        )
        await session.execute(stmt)
        created += 1
    await session.flush()

    digest = await get_digest(session, uid, run_date=run_date)
    return PushRunResult(
        run_date=run_date, created=created, skipped=skipped, items=digest.items
    )


async def get_digest(
    session: AsyncSession,
    user_id: int | None = None,
    *,
    run_date: date | None = None,
) -> PushDigestOut:
    """通知面板：某批次日（預設最新）的推播卡 + 跨全部批次的未讀數。"""
    uid = await _resolve_user_for_read(session, user_id)
    if uid is None:
        return PushDigestOut()

    if run_date is None:
        run_date = (
            await session.execute(
                select(func.max(PushLog.run_date)).where(PushLog.user_id == uid)
            )
        ).scalar()
    if run_date is None:
        return PushDigestOut()

    latest = _latest_snapshot_subq()
    stmt = (
        select(
            PushLog,
            Tender,
            Source.name.label("source"),
            latest.c.days_left.label("cur_days_left"),
        )
        .join(Tender, Tender.id == PushLog.tender_id, isouter=True)
        .join(Source, Source.id == Tender.source_id, isouter=True)
        .join(latest, latest.c.tender_id == Tender.id, isouter=True)
        .where(PushLog.user_id == uid, PushLog.run_date == run_date)
        .order_by(nulls_last(desc(PushLog.score)), PushLog.id.asc())
    )
    rows = (await session.execute(stmt)).all()
    items = [_row_to_item(r) for r in rows]

    unread = (
        await session.execute(
            select(func.count())
            .select_from(PushLog)
            .where(PushLog.user_id == uid, PushLog.status == "pending")
        )
    ).scalar() or 0

    return PushDigestOut(
        run_date=run_date, unread=int(unread), total=len(items), items=items
    )


async def mark_read(
    session: AsyncSession, user_id: int | None = None, *, push_id: int | None = None
) -> int:
    """標記已讀。push_id 給定 → 單筆；省略 → 該使用者全部未讀。回傳更新筆數。"""
    uid = await resolve_user_id(session, user_id)
    stmt = (
        update(PushLog)
        .where(PushLog.user_id == uid, PushLog.status == "pending")
        .values(status="read", read_at=func.now())
        .execution_options(synchronize_session=False)
    )
    if push_id is not None:
        stmt = stmt.where(PushLog.id == push_id)
    res = await session.execute(stmt)
    await session.flush()
    return res.rowcount or 0

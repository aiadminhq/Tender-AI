# -*- coding: utf-8 -*-
"""標案查詢服務（Layer A）。

核心：每個標案以「最新一筆每日快照」呈現 tier／剩餘天數
（row_number() over(partition by tender_id order by run_date desc) 取 rn==1）。
篩選／排序語義對齊 prototype/index.html 的 passes()／sortFn()：
  - tier/cat/city/src：多選 IN（空集合＝不過濾）。
  - deadline：最新快照剩餘天數 <= deadline。
  - budget_min/max：budget_wan 區間（NULL 預算於有界時被排除）。
  - focus：OR（任一關鍵字命中 name+org+category）。
  - avoid：NOT（任一關鍵字命中即排除）。
  - q：AND（空白/逗號/頓號斷詞，每詞皆須命中）。
  - sort：feas|feasibility_score|days|budget|tier；feas／feasibility_score（同義）
    於 SL2 閉合學習迴圈上線後，以「KeywordWeight 學習權重 + tier」綜合排序；
    冷啟動（keyword_weights 為空）時 feas_raw=0，退化為純 tier 排序。
"""
from __future__ import annotations

import re

from sqlalchemy import and_, asc, case, desc, func, nulls_last, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EntityNotFound
from app.models.behavior import TenderUserState
from app.models.knowledge import KeywordWeight
from app.models.revision import TenderRevision
from app.models.tender import DailyTender, Source, Tender
from app.schemas.tender import (
    AttachmentItem,
    RevisionDetail,
    SnapshotItem,
    TenderDetail,
    TenderListItem,
    TenderQuery,
    UserStateOut,
)

# q 斷詞：空白／半形逗號／全形逗號／頓號
_Q_SPLIT = re.compile(r"[\s,，、]+")


def _latest_snapshot_subq():
    """每個 tender 的最新一筆每日快照（rn==1）。"""
    rn = (
        func.row_number()
        .over(
            partition_by=DailyTender.tender_id,
            order_by=DailyTender.run_date.desc(),
        )
        .label("rn")
    )
    ranked = select(
        DailyTender.tender_id.label("tender_id"),
        DailyTender.tier.label("tier"),
        DailyTender.days_left.label("days_left"),
        DailyTender.run_date.label("run_date"),
        rn,
    ).subquery()
    return (
        select(
            ranked.c.tender_id,
            ranked.c.tier,
            ranked.c.days_left,
            ranked.c.run_date,
        )
        .where(ranked.c.rn == 1)
        .subquery()
    )


def _haystack():
    """關鍵字比對欄位：name + org + category（concat_ws 自動略過 NULL）。"""
    return func.concat_ws(" ", Tender.name, Tender.org, Tender.category)


def _tier_rank(tier_col):
    """tier 排序權重：priority<high<mid<low<其他（NULL→99 殿後）。"""
    return case(
        (tier_col == "priority", 0),
        (tier_col == "high", 1),
        (tier_col == "mid", 2),
        (tier_col == "low", 3),
        else_=99,
    )


def _tier_weight(tier_col):
    """tier 的「越大越好」綜合分量（與 feas_raw 同向相加）：
    priority=3 > high=2 > mid=1 > low=0 > 其他/NULL=-1。"""
    return case(
        (tier_col == "priority", 3),
        (tier_col == "high", 2),
        (tier_col == "mid", 1),
        (tier_col == "low", 0),
        else_=-1,
    )


def _feasibility_score_expr():
    """SL2 學習可行度原始分（feas_raw）：對 ``keyword_weights`` 做相關子查詢，
    凡關鍵詞命中 haystack（name+org+category）即累加帶符號權重——
    positive 加分、negative 扣分。COALESCE 確保無命中／冷啟動時為 0。

    以 ``correlate(Tender)`` 綁定外層 Tender，故每列各算一次（標案數×關鍵詞數，
    本機資料量下可接受）；term 由 jieba 斷詞而來，不含 ``%``/``_`` 萬用字元。
    """
    hay = _haystack()
    signed = case(
        (KeywordWeight.polarity == "negative", -KeywordWeight.weight),
        else_=KeywordWeight.weight,
    )
    matched = case(
        (hay.ilike(func.concat("%", KeywordWeight.term, "%")), signed),
        else_=0.0,
    )
    return (
        select(func.coalesce(func.sum(matched), 0.0))
        .select_from(KeywordWeight)
        .correlate(Tender)
        .scalar_subquery()
    )


# tier 基底可行度（無任何 KeywordWeight 命中時的冷啟動值，0–100）
_TIER_BASE_FEAS = {"priority": 78, "high": 70, "mid": 52, "low": 38}


def _display_feasibility(tier: str | None, feas_raw) -> float:
    """顯示用可行度（0–100）：tier 基底 + feas_raw 線性微調，clamp[1,99]。"""
    base = _TIER_BASE_FEAS.get(tier or "", 45)
    raw = float(feas_raw or 0.0)
    return float(max(1, min(99, round(base + raw * 12))))


def _build_filtered(q: TenderQuery):
    """組裝主查詢（含 join 與篩選），回傳 (stmt, latest 子查詢, feas_raw 運算式)。"""
    latest = _latest_snapshot_subq()
    feas_raw = _feasibility_score_expr()
    stmt = (
        select(
            Tender,
            Source.name.label("source"),
            latest.c.tier.label("tier"),
            latest.c.days_left.label("days_left"),
            feas_raw.label("feas_raw"),
        )
        .join(Source, Source.id == Tender.source_id)
        .join(latest, latest.c.tender_id == Tender.id, isouter=True)
    )

    conds = []
    if q.tier:
        conds.append(latest.c.tier.in_(q.tier))
    if q.cat:
        conds.append(Tender.category.in_(q.cat))
    if q.city:
        conds.append(Tender.city.in_(q.city))
    if q.src:
        conds.append(Source.name.in_(q.src))
    if q.deadline is not None:
        conds.append(latest.c.days_left <= q.deadline)
    if q.budget_min is not None:
        conds.append(Tender.budget_wan >= q.budget_min)
    if q.budget_max is not None:
        conds.append(Tender.budget_wan <= q.budget_max)

    hay = _haystack()
    if q.focus:
        conds.append(or_(*[hay.ilike(f"%{kw}%") for kw in q.focus]))
    for kw in q.avoid:
        conds.append(~hay.ilike(f"%{kw}%"))
    if q.q:
        for tok in _Q_SPLIT.split(q.q.strip()):
            if tok:
                conds.append(hay.ilike(f"%{tok}%"))

    if conds:
        stmt = stmt.where(and_(*conds))
    return stmt, latest, feas_raw


def _order_by(q: TenderQuery, latest, feas_raw):
    days = latest.c.days_left
    rank = _tier_rank(latest.c.tier)
    if q.sort == "days":
        return [nulls_last(asc(days))]
    if q.sort == "budget":
        return [nulls_last(desc(Tender.budget_wan))]
    if q.sort == "tier":
        return [asc(rank), nulls_last(asc(days))]
    # feas／feasibility_score（預設）：SL2 學習可行度 + tier 綜合分（越大越前），
    # 同分以剩餘天數（少者優先）破題。冷啟動 feas_raw=0 → 退化為純 tier 排序。
    combined = feas_raw + _tier_weight(latest.c.tier)
    return [desc(combined), nulls_last(asc(days))]


def _row_to_item(row) -> TenderListItem:
    t: Tender = row[0]
    return TenderListItem(
        id=t.id,
        source=row.source,
        case_pk=t.case_pk,
        name=t.name,
        org=t.org,
        category=t.category,
        budget_wan=t.budget_wan,
        deadline_roc=t.deadline_roc,
        deadline_iso=t.deadline_iso,
        tender_method=t.tender_method,
        city=t.city,
        link=t.link,
        tier=row.tier,
        days_left=row.days_left,
        first_seen=t.first_seen,
        last_seen=t.last_seen,
        feasibility_score=_display_feasibility(row.tier, getattr(row, "feas_raw", None)),
    )


async def list_tenders(
    session: AsyncSession, q: TenderQuery
) -> tuple[list[TenderListItem], int]:
    """回傳 (分頁後清單, 符合條件總數)。"""
    stmt, latest, feas_raw = _build_filtered(q)

    total = await session.scalar(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    )

    stmt = stmt.order_by(*_order_by(q, latest, feas_raw), asc(Tender.id))
    stmt = stmt.limit(q.page_size).offset((q.page - 1) * q.page_size)
    rows = (await session.execute(stmt)).all()
    return [_row_to_item(r) for r in rows], int(total or 0)


def _revision_to_detail(rev: TenderRevision) -> RevisionDetail:
    """TenderRevision ORM → RevisionDetail（附件/資格碼做防呆正規化）。"""
    codes = rev.qualification_codes if isinstance(rev.qualification_codes, list) else []
    attachments: list[AttachmentItem] = []
    raw_atts = rev.attachments if isinstance(rev.attachments, list) else []
    for a in raw_atts:
        if not isinstance(a, dict):
            continue
        attachments.append(
            AttachmentItem(
                filename=a.get("filename"),
                url=a.get("url"),
                archived=bool(a.get("storage_uri")),
                skipped=a.get("skipped"),
                error=a.get("error"),
            )
        )
    return RevisionDetail(
        revision_no=rev.revision_no,
        fetched_at=rev.fetched_at,
        award_method=rev.award_method,
        deposit_required=rev.deposit_required,
        deposit_amount_twd=rev.deposit_amount_twd,
        deposit_raw_text=rev.deposit_raw_text,
        qualification_codes=[str(c) for c in codes],
        qualification_text=rev.qualification_text,
        category_main=rev.category_main,
        category_name=rev.category_name,
        category_raw=rev.category_raw,
        performance_period=rev.performance_period,
        performance_location=rev.performance_location,
        subsidy_source=rev.subsidy_source,
        extra_note=rev.extra_note,
        attachments=attachments,
    )


async def get_tender_detail(
    session: AsyncSession, tender_id: int, user_id: int | None
) -> TenderDetail:
    """單案詳情：主檔 + 最新快照 + 歷史快照 + 該使用者狀態。查無則 EntityNotFound。"""
    latest = _latest_snapshot_subq()
    stmt = (
        select(
            Tender,
            Source.name.label("source"),
            latest.c.tier.label("tier"),
            latest.c.days_left.label("days_left"),
            _feasibility_score_expr().label("feas_raw"),
        )
        .join(Source, Source.id == Tender.source_id)
        .join(latest, latest.c.tender_id == Tender.id, isouter=True)
        .where(Tender.id == tender_id)
    )
    row = (await session.execute(stmt)).first()
    if row is None:
        raise EntityNotFound(f"tender {tender_id} not found")

    item = _row_to_item(row)

    snaps = (
        await session.execute(
            select(
                DailyTender.run_date,
                DailyTender.tier,
                DailyTender.days_left,
            )
            .where(DailyTender.tender_id == tender_id)
            .order_by(DailyTender.run_date.desc())
        )
    ).all()
    snapshots = [
        SnapshotItem(run_date=s.run_date, tier=s.tier, days_left=s.days_left)
        for s in snaps
    ]

    user_state = None
    if user_id is not None:
        st = await session.get(
            TenderUserState, {"user_id": user_id, "tender_id": tender_id}
        )
        if st is not None:
            user_state = UserStateOut.model_validate(st)

    # 最新詳情版本：僅在 enrich 過（current_revision_id 有值）時投影；否則 None。
    revision = None
    rev_id = row.Tender.current_revision_id
    if rev_id is not None:
        rev = await session.get(TenderRevision, rev_id)
        if rev is not None:
            revision = _revision_to_detail(rev)

    return TenderDetail(
        **item.model_dump(),
        snapshots=snapshots,
        user_state=user_state,
        revision=revision,
    )

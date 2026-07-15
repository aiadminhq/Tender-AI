# -*- coding: utf-8 -*-
"""標案查詢服務（Layer A）。

核心：每個標案以「最新一筆每日快照」呈現剩餘天數，潛力分級（tier）則由團隊線
可行性分數（物化於 ``tenders.feasibility_team``）分帶而來，而非直接沿用報表 tier
（見 _derived_tier_expr）。
篩選／排序語義對齊 prototype/index.html 的 passes()／sortFn()：
  - tier：多選 IN，比對的是「分帶後的潛力分級」（priority 覆寫／分數分帶／報表回退）。
  - cat/city/src：多選 IN（空集合＝不過濾）。
  - deadline：最新快照剩餘天數 <= deadline。
  - budget_min/max：budget_wan 區間（NULL 預算於有界時被排除）。
  - focus：OR（任一關鍵字命中 name+org+category）。
  - avoid：NOT（任一關鍵字命中即排除）。
  - q：AND（空白/逗號/頓號斷詞，每詞皆須命中）。
  - sort：feas|feasibility_score|days|budget|tier；feas／feasibility_score（同義）
    以物化的團隊線可行性分數 feasibility_team 為主鍵（高→低、NULL 殿後），
    再以潛力分級、剩餘天數破題；冷啟動（全未物化）退化為純潛力分級排序。
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

from sqlalchemy import (
    and_,
    asc,
    case,
    desc,
    false,
    func,
    null,
    nulls_last,
    or_,
    select,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EntityNotFound
from app.services.cursor import (
    decode_cursor,
    encode_cursor,
    filters_fingerprint,
)
from app.models.behavior import TenderUserState
from app.models.knowledge import KeywordWeight, TierThresholdRevision
from app.models.revision import TenderRevision
from app.models.tender import DailyTender, Source, Tender
from app.schemas.tender import (
    AttachmentItem,
    RevisionDetail,
    SnapshotItem,
    StructuredItem,
    TenderDetail,
    TenderListItem,
    TenderQuery,
    UserStateOut,
)
from app.services.detail_parser import structure_text

# q 斷詞：空白／半形逗號／全形逗號／頓號
_Q_SPLIT = re.compile(r"[\s,，、]+")

_TAIPEI = ZoneInfo("Asia/Taipei")


def taipei_today() -> date:
    """以台灣時區推得「今天」。deadline_iso 為台灣日期的 naive date，
    後端可能跑在 UTC，用本地日期會在跨日邊界誤判有效性，故一律以 Asia/Taipei 為準。
    """
    return datetime.now(_TAIPEI).date()


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


# 種子分帶切點（Stage 1 預設；= 既有 verdict 帶界 ≥62 strong / ≥42 consider）。
# Stage 2 的 learn_tier_thresholds 以信心校準學出新切點、append 寫入
# TierThresholdRevision 後，查詢端自動改讀最新一列覆寫（見 _latest_tier_thresholds）。
SEED_C_HIGH = 62
SEED_C_LOW = 42


async def _latest_tier_thresholds(session: AsyncSession) -> tuple[int, int]:
    """讀最新一筆 ``TierThresholdRevision`` 的 (c_high, c_low)；無則回種子 (62, 42)。

    Stage 1 尚無門檻學習產物，恆回種子。Stage 2 學出新切點並 append 寫入本表後，
    查詢端即自動改讀最新一列（單列、id 索引），毋須改查詢碼。
    """
    row = (
        await session.execute(
            select(TierThresholdRevision.c_high, TierThresholdRevision.c_low)
            .order_by(TierThresholdRevision.id.desc())
            .limit(1)
        )
    ).first()
    if row is None:
        return SEED_C_HIGH, SEED_C_LOW
    return int(row.c_high), int(row.c_low)


def _band_tier_expr(score_col, c_high: int, c_low: int):
    """團隊線可行性分數 → 潛力帶：≥c_high→'high'、≥c_low→'mid'、否則→'low'；
    分數為 NULL（尚未物化）→ NULL（由 _derived_tier_expr 回退報表分級）。"""
    return case(
        (score_col.is_(None), null()),
        (score_col >= c_high, "high"),
        (score_col >= c_low, "mid"),
        else_="low",
    )


def _derived_tier_expr(latest, c_high: int, c_low: int):
    """最終潛力分級（查詢端唯一真相），coalesce 三段優先序：

    1. 報表快照 tier == 'priority'（人工／規則層級強訊號）→ 直接 'priority'，凌駕分數；
    2. 否則 ``feasibility_team`` 非 NULL → 用分帶值（high/mid/low）；
    3. ``feasibility_team`` 為 NULL（冷啟動／新案未物化）→ 回退報表快照 tier。
    """
    return case(
        (latest.c.tier == "priority", "priority"),
        (
            Tender.feasibility_team.is_not(None),
            _band_tier_expr(Tender.feasibility_team, c_high, c_low),
        ),
        else_=latest.c.tier,
    )


def _build_filtered(q: TenderQuery, c_high: int, c_low: int, today: date):
    """組裝主查詢（含 join 與篩選），回傳 (stmt, latest 子查詢, feas_raw, derived_tier)。

    tier 的投影與篩選一律用 _derived_tier_expr（潛力分級＝可行性分數分帶），
    而非報表快照 tier；feas_raw 僅供冷啟動（feasibility_team 為 NULL）時的顯示回退。

    ``today`` 為判定「有效」的基準日（Asia/Taipei）；``q.include_expired`` 為 False 時
    只留 deadline_iso 為 NULL 或 >= today 的案（在資料層擋掉已截止案）。
    """
    latest = _latest_snapshot_subq()
    feas_raw = _feasibility_score_expr()
    derived_tier = _derived_tier_expr(latest, c_high, c_low)
    stmt = (
        select(
            Tender,
            Source.name.label("source"),
            derived_tier.label("tier"),
            latest.c.days_left.label("days_left"),
            feas_raw.label("feas_raw"),
        )
        .join(Source, Source.id == Tender.source_id)
        .join(latest, latest.c.tender_id == Tender.id, isouter=True)
    )

    conds = []
    if not q.include_expired:
        # 有效案＝未設截止日（NULL）或截止日尚未過（>= 今天）。
        conds.append(or_(Tender.deadline_iso.is_(None), Tender.deadline_iso >= today))
    if q.tier:
        conds.append(derived_tier.in_(q.tier))
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
    return stmt, latest, feas_raw, derived_tier


@dataclass
class _OrderSpec:
    """單一排序鍵：SQL 運算式＋方向＋NULL 擺放＋從結果列取出鍵值的方式。

    同一份 spec 同時餵給 ORDER BY、keyset WHERE、以及「把最後一列編進 cursor」，
    確保三者用的是同一個排序語義（單一真相）。
    """

    expr: Any  # SQL 運算式（排序欄位／計算式）
    descending: bool  # True＝DESC
    nulls_last: bool  # True＝NULL 殿後（本專案排序皆 nulls_last）
    extract: Callable[[Any], Any]  # 從結果列取出此鍵的 Python 值（供編 cursor 用）


def _order_specs(q: TenderQuery, latest, feas_raw, derived_tier) -> list[_OrderSpec]:
    """依 active sort 組出「排序鍵向量」；末位恆為 tender.id（一致 tiebreak，非 NULL）。

    語義與舊 _order_by 完全一致，只是改以結構化 spec 表述，好讓 keyset 與 cursor 共用。
    """
    days = latest.c.days_left
    tier_rank = _tier_rank(derived_tier)

    def _days_of(row):
        return row.days_left

    def _tier_rank_of(row):
        # 與 _tier_rank 的 CASE 對齊（priority<high<mid<low<其他）。
        return {"priority": 0, "high": 1, "mid": 2, "low": 3}.get(row.tier, 99)

    def _budget_of(row):
        return row[0].budget_wan

    def _feas_of(row):
        return row[0].feasibility_team

    def _id_of(row):
        return row[0].id

    id_spec = _OrderSpec(Tender.id, descending=False, nulls_last=False, extract=_id_of)

    if q.sort == "days":
        specs = [_OrderSpec(days, False, True, _days_of)]
    elif q.sort == "budget":
        specs = [_OrderSpec(Tender.budget_wan, True, True, _budget_of)]
    elif q.sort == "tier":
        # 依最終潛力分級排序（priority<high<mid<low），同級以剩餘天數破題。
        specs = [
            _OrderSpec(tier_rank, False, False, _tier_rank_of),
            _OrderSpec(days, False, True, _days_of),
        ]
    else:
        # feas／feasibility_score（預設）：以物化的團隊線可行性分數為主鍵（高→低、
        # 未物化 NULL 殿後），再以潛力分級、剩餘天數破題。冷啟動（全 NULL）時退化為
        # 純潛力分級排序，與舊行為相容。
        specs = [
            _OrderSpec(Tender.feasibility_team, True, True, _feas_of),
            _OrderSpec(tier_rank, False, False, _tier_rank_of),
            _OrderSpec(days, False, True, _days_of),
        ]
    return specs + [id_spec]


def _order_by_clauses(specs: list[_OrderSpec]):
    """把 spec 轉成 SQLAlchemy ORDER BY 子句。"""
    clauses = []
    for s in specs:
        direction = desc(s.expr) if s.descending else asc(s.expr)
        clauses.append(nulls_last(direction) if s.nulls_last else direction)
    return clauses


def _keyset_after(specs: list[_OrderSpec], keys: list[Any]):
    """組出「排序上嚴格落在最後一列之後」的 keyset 條件（lexicographic）。

    對排序鍵向量 (c1..cn) 與最後一列的值 (v1..vn)，逐層展開：

        after(c1,v1) OR (eq(c1,v1) AND (after(c2,v2) OR (eq(c2,v2) AND ...)))

    每一層依該鍵的方向與 NULL 擺放決定 after／eq 的實際比較（見 _after_one/_eq_one）。
    末位 id 非 NULL 且 ASC，最單純，保證整體嚴格遞進、不重不漏。
    """
    # 由最內層往外組。
    predicate = None
    for spec, val in reversed(list(zip(specs, keys))):
        after = _after_one(spec, val)
        if predicate is None:
            predicate = after
        else:
            predicate = or_(after, and_(_eq_one(spec, val), predicate))
    return predicate


def _after_one(spec: _OrderSpec, val):
    """單一鍵：值嚴格「在 val 之後」（依方向＋NULL 擺放）。"""
    col = spec.expr
    if val is None:
        # nulls_last：NULL 是最大／最後，其後再無列 → 無條件為假。
        # nulls_first（本專案未用）：NULL 之後是所有非 NULL 列。
        if spec.nulls_last:
            return false()
        return col.is_not(None)
    # val 非 NULL：
    if spec.descending:
        base = col < val
    else:
        base = col > val
    if spec.nulls_last:
        # NULL 排在所有非 NULL 之後 → NULL 也算「在 val 之後」。
        return or_(base, col.is_(None))
    return base


def _eq_one(spec: _OrderSpec, val):
    """單一鍵：值與 val「相等」（NULL 視為相等，以正確遞進到次要鍵）。"""
    col = spec.expr
    if val is None:
        return col.is_(None)
    return col == val


def _row_to_item(row) -> TenderListItem:
    t: Tender = row[0]
    # 顯示用可行度：優先用物化的團隊線分數（即分帶來源）；尚未物化（NULL）時回退
    # 既有 _display_feasibility（此時 row.tier 已回退為報表分級，基底一致）。
    feas_team = t.feasibility_team
    feasibility_score = (
        float(feas_team)
        if feas_team is not None
        else _display_feasibility(row.tier, getattr(row, "feas_raw", None))
    )
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
        feasibility_score=feasibility_score,
    )


async def list_tenders(
    session: AsyncSession, q: TenderQuery, *, today: date | None = None
) -> tuple[list[TenderListItem], int, str | None]:
    """回傳 (分頁後清單, 符合條件總數, next_cursor)。

    分頁模式擇一：

    - **cursor（keyset，優先）**：帶 ``q.cursor`` 時，以 cursor 內編碼的排序鍵向量組
      keyset WHERE，只掃「下一頁一側」的列，避免深分頁 offset 成本，且對每日新資料
      插入穩定不跳號。cursor 與當前 sort＋filters 不一致時，由 decode_cursor 拋
      CursorError（API 轉 400）。
    - **page（offset，相容）**：未帶 cursor 時沿用舊 page/page_size offset 行為。

    兩種模式皆多回一個 ``next_cursor``：尚有下一頁時為 opaque token，否則為 None。
    """
    c_high, c_low = await _latest_tier_thresholds(session)
    today = today or taipei_today()
    stmt, latest, feas_raw, derived_tier = _build_filtered(q, c_high, c_low, today)

    total = await session.scalar(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    )

    specs = _order_specs(q, latest, feas_raw, derived_tier)
    stmt = stmt.order_by(*_order_by_clauses(specs))

    fingerprint = filters_fingerprint(q)
    use_cursor = q.cursor is not None

    if use_cursor:
        keys = decode_cursor(q.cursor, q.sort, fingerprint)
        stmt = stmt.where(_keyset_after(specs, keys))
        # 多抓一列判斷是否還有下一頁（keyset 免 offset 掃描）。
        stmt = stmt.limit(q.page_size + 1)
        rows = (await session.execute(stmt)).all()
        has_more = len(rows) > q.page_size
        rows = rows[: q.page_size]
    else:
        # 相容舊 offset 分頁：多抓一列判斷下一頁（不改 total 語義）。
        stmt = stmt.limit(q.page_size + 1).offset((q.page - 1) * q.page_size)
        rows = (await session.execute(stmt)).all()
        has_more = len(rows) > q.page_size
        rows = rows[: q.page_size]

    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        keys_out = [spec.extract(last) for spec in specs]
        next_cursor = encode_cursor(q.sort, fingerprint, keys_out)

    return [_row_to_item(r) for r in rows], int(total or 0), next_cursor


def _revision_to_detail(rev: TenderRevision) -> RevisionDetail:
    """TenderRevision ORM → RevisionDetail（附件/資格碼做防呆正規化）。"""
    codes = rev.qualification_codes if isinstance(rev.qualification_codes, list) else []
    # 資格結構化條目：優先用已落庫值；尚未回填時即時由 qualification_text 重算（純函式、
    # 冪等），使前端在 migration/backfill 跑完前就能呈現表格。
    raw_items = rev.qualification_items if isinstance(rev.qualification_items, list) else None
    if raw_items:
        qual_items = [
            StructuredItem(
                kind=str(it.get("kind", "")),
                label=it.get("label"),
                content=str(it.get("content", "")),
                params=it.get("params") if isinstance(it.get("params"), dict) else {},
            )
            for it in raw_items
            if isinstance(it, dict)
        ]
    else:
        qual_items = [
            StructuredItem(kind=it.kind, label=it.label, content=it.content, params=it.params)
            for it in structure_text(rev.qualification_text)
        ]
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
        qualification_items=qual_items,
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
    c_high, c_low = await _latest_tier_thresholds(session)
    latest = _latest_snapshot_subq()
    derived_tier = _derived_tier_expr(latest, c_high, c_low)
    stmt = (
        select(
            Tender,
            Source.name.label("source"),
            derived_tier.label("tier"),
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

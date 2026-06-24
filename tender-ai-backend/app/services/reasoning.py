# -*- coding: utf-8 -*-
"""SL3 意圖與推理引擎：可解釋的「為何可中標」推理。

願景對齊：
- 「懂得學習操作者為何點擊／選關鍵字」→ 以 events（open_detail/click_link/dwell）
  推導 engaged 類別/城市，作為行為偏好訊號。
- 「推理使用者衡量可中標的標準是基於什麼因素跟關係」→ 以 evaluations（可行/不可行）
  對每個結構化特徵（類別/城市/來源/預算）算 lift（相對基準可行率的提升），
  再疊加 SL2 關鍵字權重，組成逐條 reason code 與一個可解釋的 criteria_fit。

為何不用重 ML：目前標記樣本僅數十筆（24），LightGBM/XGBoost+Optuna 會過擬合且
不可解釋。此處改採**透明的關聯/lift 模型 + Laplace 平滑**——本身即可逐項解釋，
無需 SHAP。介面（特徵抽取/輪廓/解釋）與資料規模脫鉤，待樣本成長（建議 ≥200）
可在不改 API 下換成學習式排序器。

鐵則：離線、不連網；只讀本機 DB。回傳的證據文字僅引用 Layer A 公開欄位與聚合
統計，不外洩任何個別評語原文或人名／email。
"""
from __future__ import annotations

import statistics
from collections import Counter
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EntityNotFound
from app.models.behavior import Event, Evaluation
from app.models.knowledge import KeywordWeight
from app.models.tender import DailyTender, Source, Tender
from app.services import manual_keywords
from app.schemas.reasoning import (
    CategorySignal,
    CriteriaProfileOut,
    ReasonCode,
    TenderReasoningOut,
)

# 行為：視為「明確投入」的事件型別（用於推導 engaged 偏好）
_ENGAGED_TYPES = ("open_detail", "click_link", "dwell")
# 視為正向標記的評估值（待議不參與 lift）
_FEASIBLE = "可行"
_INFEASIBLE = "不可行"

# lift 視為「有方向」的門檻（避免雜訊翻轉方向）
_DIR_EPS = 0.05

# 各因素對 criteria_fit 的權重（可解釋、可調；類別主導、預算次要、行為最弱）
_W_CATEGORY = 1.0
_W_CITY = 0.5
_W_BUDGET_IN = 0.12
_W_BUDGET_OUT = -0.10
_W_KEYWORD = 0.15
_W_KEYWORD_CAP = 0.25
_W_BEHAVIOR = 0.06

# §3.2 分類直接映射先驗：當該分類「尚無個人評估歷史」時，以領域知識給方向
# （對齊 learn_keywords._CATEGORY_POLARITY；資料一旦累積即改以 lift 為準，資料優先）。
# 僅納入「方向已認證」的類別；財物/勞務 樣本少且 0% 可行率尚未認證，見 _CATEGORY_UNVERIFIED。
_CATEGORY_PRIOR = {
    "工程": "positive",      # 樣本 100% 可行（方向明確）
    "營繕工程": "positive",  # 樣本 100% 可行（方向明確）
}
# 方向「待認證」的類別：樣本顯示偏低可行率但尚未認證 → 冷啟動先給中性 0.0（不扣分），
# 待累積足量評估後改由 lift（資料優先分支）自然帶出方向。
_CATEGORY_UNVERIFIED = {"財物", "勞務"}
# 先驗影響量：足以定方向（base 0.5 → 0.68 / 0.32），但弱於有資料時的 lift。
_W_CATEGORY_PRIOR = 0.18

# §3.3 預算絕對軟閾值：當「尚無個人承接區間」時的退場信號（萬元）。
# 弱信號，不主導；有個人預算歷史時改走 in/out-range 個人化邏輯。
_BUDGET_HI_WAN = 300
_BUDGET_LO_WAN = 100
_W_BUDGET_SOFT_HI = 0.08
_W_BUDGET_SOFT_LO = -0.06

_LAPLACE = 1.0  # 加法平滑（每類別 +1 可行 +1 不可行的先驗）


@dataclass(slots=True)
class _Agg:
    """單一分類取值的可行/不可行累計。"""

    feasible: int = 0
    infeasible: int = 0


@dataclass(slots=True)
class CriteriaProfile:
    """內部用判準輪廓（含查表 dict，API 輸出時轉成 CriteriaProfileOut）。"""

    n_evaluations: int = 0
    n_events: int = 0
    base_rate: float = 0.5
    category: dict[str, CategorySignal] = field(default_factory=dict)
    city: dict[str, CategorySignal] = field(default_factory=dict)
    source: dict[str, CategorySignal] = field(default_factory=dict)
    budget_min: int | None = None
    budget_max: int | None = None
    budget_median: int | None = None
    kw_positive: list[str] = field(default_factory=list)
    kw_negative: list[str] = field(default_factory=list)
    engaged_categories: list[str] = field(default_factory=list)
    engaged_cities: list[str] = field(default_factory=list)


def _laplace_signal(value: str, agg: _Agg, base_rate: float) -> CategorySignal:
    support = agg.feasible + agg.infeasible
    p = (agg.feasible + _LAPLACE) / (support + 2 * _LAPLACE)
    return CategorySignal(
        value=value,
        p_feasible=round(p, 4),
        lift=round(p - base_rate, 4),
        support=support,
        feasible=agg.feasible,
        infeasible=agg.infeasible,
    )


def _aggregate(
    rows: list[tuple], idx: int, base_rate: float
) -> dict[str, CategorySignal]:
    """把 (feasible, category, city, budget, source) 列依某欄聚合成 CategorySignal。"""
    buckets: dict[str, _Agg] = {}
    for row in rows:
        feasible_label = row[0]
        value = row[idx]
        if not value or feasible_label not in (_FEASIBLE, _INFEASIBLE):
            continue
        agg = buckets.setdefault(value, _Agg())
        if feasible_label == _FEASIBLE:
            agg.feasible += 1
        else:
            agg.infeasible += 1
    return {v: _laplace_signal(v, a, base_rate) for v, a in buckets.items()}


async def build_criteria_profile(
    session: AsyncSession, user_id: int | None = None
) -> CriteriaProfile:
    """從評估＋事件＋學習關鍵字，推導操作者的承標判準輪廓（離線、唯讀）。"""
    eval_stmt = (
        select(
            Evaluation.feasible,
            Tender.category,
            Tender.city,
            Tender.budget_wan,
            Source.name,
        )
        .join(Tender, Tender.id == Evaluation.tender_id)
        .join(Source, Source.id == Tender.source_id)
    )
    if user_id is not None:
        eval_stmt = eval_stmt.where(Evaluation.user_id == user_id)
    rows = [tuple(r) for r in (await session.execute(eval_stmt)).all()]

    feasible_n = sum(1 for r in rows if r[0] == _FEASIBLE)
    infeasible_n = sum(1 for r in rows if r[0] == _INFEASIBLE)
    total = feasible_n + infeasible_n
    base_rate = feasible_n / total if total else 0.5

    profile = CriteriaProfile(n_evaluations=len(rows), base_rate=round(base_rate, 4))
    profile.category = _aggregate(rows, 1, base_rate)
    profile.city = _aggregate(rows, 2, base_rate)
    profile.source = _aggregate(rows, 4, base_rate)

    feas_budgets = [
        int(r[3]) for r in rows if r[0] == _FEASIBLE and r[3] is not None
    ]
    if feas_budgets:
        profile.budget_min = min(feas_budgets)
        profile.budget_max = max(feas_budgets)
        profile.budget_median = int(statistics.median(feas_budgets))

    # SL2 學習關鍵字：只取正向 top（負向避免詞一律人工專屬，學習詞不得帶出負向）。
    pos_rows = list(
        (
            await session.execute(
                select(KeywordWeight).where(KeywordWeight.polarity != "negative")
            )
        ).scalars()
    )
    pos = sorted(pos_rows, key=lambda k: k.weight or 0.0, reverse=True)
    profile.kw_positive = [k.term for k in pos[:6]]
    # 避免詞預設空；本人「手動」迴避詞由下方 apply_overrides 併入（負分人工專屬紅線）。
    profile.kw_negative = []

    # 行為訊號：你「點開／點連結／停留」最多的類別/城市
    ev_stmt = (
        select(Event.type, Tender.category, Tender.city)
        .join(Tender, Tender.id == Event.tender_id)
        .where(Event.tender_id.isnot(None))
    )
    if user_id is not None:
        ev_stmt = ev_stmt.where(Event.user_id == user_id)
    ev_rows = (await session.execute(ev_stmt)).all()
    profile.n_events = len(ev_rows)
    cat_ctr: Counter[str] = Counter()
    city_ctr: Counter[str] = Counter()
    for etype, category, city in ev_rows:
        if etype not in _ENGAGED_TYPES:
            continue
        if category:
            cat_ctr[category] += 1
        if city:
            city_ctr[city] += 1
    profile.engaged_categories = [c for c, _ in cat_ctr.most_common(3)]
    profile.engaged_cities = [c for c, _ in city_ctr.most_common(3)]

    # Phase 2：套上本人在推理卡上的「手動」關鍵字覆寫（add／remove）。
    # 手動「迴避」詞（kind=negative）即唯一合規負分來源：合併後既進顯示輪廓
    # （kw_negative），也由 explain_tender 取用驅動 per-tender 計分（負分人工專屬
    # 紅線）；系統學習詞只供正向，永不帶出負分。
    if user_id is not None:
        overrides = await manual_keywords.list_overrides(session, user_id)
        if overrides:
            profile.kw_positive, profile.kw_negative, profile.engaged_categories = (
                manual_keywords.apply_overrides(
                    profile.kw_positive,
                    profile.kw_negative,
                    profile.engaged_categories,
                    overrides,
                )
            )
    return profile


# --------------------------------------------------------------------------- #
# 輪廓 → API 輸出
# --------------------------------------------------------------------------- #
def _confidence(n_eval: int) -> str:
    if n_eval >= 30:
        return "high"
    if n_eval >= 8:
        return "medium"
    return "low"


def _sorted_signals(d: dict[str, CategorySignal]) -> list[CategorySignal]:
    return sorted(d.values(), key=lambda s: s.lift, reverse=True)


def _profile_summary(p: CriteriaProfile) -> str:
    if p.n_evaluations == 0:
        return (
            "尚未累積評估紀錄；目前先以標案分級與 SL2 學習關鍵字推估可中標可能，"
            "隨著你逐案標記可行／不可行，判準會自動更精準。"
        )
    likes = [s.value for s in _sorted_signals(p.category) if s.lift > _DIR_EPS]
    avoids = [
        s.value for s in sorted(p.category.values(), key=lambda s: s.lift)
        if s.lift < -_DIR_EPS
    ]
    parts: list[str] = [f"根據你已標記的 {p.n_evaluations} 筆評估："]
    if likes:
        parts.append(f"偏好承接「{'、'.join(likes)}」類")
    if avoids:
        parts.append(f"通常迴避「{'、'.join(avoids)}」類")
    if p.budget_min is not None and p.budget_max is not None:
        parts.append(f"承接預算多落在 {p.budget_min}–{p.budget_max} 萬")
    if p.engaged_categories:
        parts.append(f"近期最常點開「{'、'.join(p.engaged_categories)}」")
    return "；".join(parts) + "。"


def profile_to_out(p: CriteriaProfile) -> CriteriaProfileOut:
    return CriteriaProfileOut(
        n_evaluations=p.n_evaluations,
        n_events=p.n_events,
        base_rate=p.base_rate,
        category_signals=_sorted_signals(p.category),
        city_signals=_sorted_signals(p.city),
        source_signals=_sorted_signals(p.source),
        budget_feasible_min=p.budget_min,
        budget_feasible_max=p.budget_max,
        budget_feasible_median=p.budget_median,
        top_keywords_positive=p.kw_positive,
        top_keywords_negative=p.kw_negative,
        engaged_categories=p.engaged_categories,
        engaged_cities=p.engaged_cities,
        summary=_profile_summary(p),
        confidence=_confidence(p.n_evaluations),  # type: ignore[arg-type]
    )


# --------------------------------------------------------------------------- #
# 單案推理
# --------------------------------------------------------------------------- #
def _direction(impact: float) -> str:
    if impact > _DIR_EPS:
        return "positive"
    if impact < -_DIR_EPS:
        return "negative"
    return "neutral"


def _haystack(t: Tender) -> str:
    return " ".join(p for p in (t.name, t.org, t.category) if p)


def _keyword_reason(
    t: Tender,
    positive_kws: list[KeywordWeight],
    manual_negatives: list[str],
    learned_negatives: list[KeywordWeight] | None = None,
) -> tuple[float, ReasonCode | None]:
    """掃描關鍵字命中，回傳 (impact, reason_code|None)。

    - 正向來自 SL2 閉合學習（``positive_kws``，可由資料自動學）。
    - 負向有兩源：
      1. ``manual_negatives``：本人手動指定的迴避詞，全強度（1.0）計負。
      2. ``learned_negatives``：即時判斷學習派生的團隊負權（帶 NEG_LEARN_NOTE
         標記、consent-aware），以「權重幅度」柔性計負。此為 2026-06-24 本人
         明確覆寫「負分人工專屬」紅線後的路徑（見設計規格 §2.1）。
    """
    hay = _haystack(t)
    pos: list[str] = []
    neg: list[str] = []  # 人工迴避詞
    learned_neg: list[str] = []  # 學習派生負權
    signed = 0.0
    for k in positive_kws:
        term = (k.term or "").strip()
        if not term or term not in hay:
            continue
        signed += float(k.weight or 0.0)
        pos.append(term)
    for term in manual_negatives:
        term = (term or "").strip()
        if not term or term not in hay:
            continue
        # 人工迴避詞以全強度（1.0）計負，貫徹「人說要避開就避開」。
        signed -= 1.0
        neg.append(term)
    for k in (learned_negatives or []):
        term = (k.term or "").strip()
        if not term or term not in hay:
            continue
        # 學習負權以幅度（lift）柔性計負（weight 存正幅度，此處施加負號）。
        signed -= float(k.weight or 0.0)
        learned_neg.append(term)
    if not pos and not neg and not learned_neg:
        return 0.0, None
    impact = max(-_W_KEYWORD_CAP, min(_W_KEYWORD_CAP, signed * _W_KEYWORD))
    bits: list[str] = []
    if pos:
        bits.append(f"命中正向關鍵字「{'、'.join(pos[:4])}」")
    if neg:
        bits.append(f"命中你設定的迴避關鍵字「{'、'.join(neg[:4])}」")
    if learned_neg:
        bits.append(f"命中團隊判斷學到的負向關鍵字「{'、'.join(learned_neg[:4])}」")
    if neg and learned_neg:
        evidence_tail = "（正向來自 SL2 閉合學習；負向含你的人工迴避詞與團隊判斷學習）"
    elif neg:
        evidence_tail = "（正向來自 SL2 閉合學習；負向為你人工指定的迴避詞）"
    elif learned_neg:
        evidence_tail = "（正向來自 SL2 閉合學習；負向為團隊判斷即時學習所得）"
    else:
        evidence_tail = "（來自 SL2 閉合學習）"
    return impact, ReasonCode(
        factor="keyword",
        label="學習關鍵字",
        value="、".join((pos + neg + learned_neg)[:4]),
        direction=_direction(impact),
        impact=round(impact, 4),
        evidence="；".join(bits) + evidence_tail,
    )


async def _latest_snapshot(session: AsyncSession, tender_id: int):
    row = (
        await session.execute(
            select(DailyTender.tier, DailyTender.days_left)
            .where(DailyTender.tender_id == tender_id)
            .order_by(DailyTender.run_date.desc())
            .limit(1)
        )
    ).first()
    return (row[0], row[1]) if row else (None, None)


async def explain_tender(
    session: AsyncSession, tender_id: int, user_id: int | None = None
) -> TenderReasoningOut:
    """對單一標案輸出可中標推理（fit + 逐條 reason code + 結論）。查無 → 404。"""
    t = await session.get(Tender, tender_id)
    if t is None:
        raise EntityNotFound(f"tender {tender_id} not found")

    profile = await build_criteria_profile(session, user_id)
    tier, days_left = await _latest_snapshot(session, tender_id)
    # 正向學習詞：所有非負極性。
    positive_kws = list(
        (
            await session.execute(
                select(KeywordWeight).where(KeywordWeight.polarity != "negative")
            )
        ).scalars()
    )
    # 負向兩源：①本人手動迴避詞（profile.kw_negative）。②即時判斷學習派生的團隊
    # 負權——只取帶標記（notes 非空）者；遺留的「自動」負向（notes 為 NULL）仍被
    # 忽略並由 learn_keywords 清除，維持紅線測試與向後相容。
    manual_negatives = list(profile.kw_negative)
    learned_negatives = list(
        (
            await session.execute(
                select(KeywordWeight).where(
                    KeywordWeight.polarity == "negative",
                    KeywordWeight.notes.is_not(None),
                )
            )
        ).scalars()
    )

    weighted: list[tuple[float, ReasonCode]] = []
    neutral: list[ReasonCode] = []
    fit = profile.base_rate

    # 1) 標的類別（主導因素）
    if t.category:
        sig = profile.category.get(t.category)
        if sig is not None:
            impact = sig.lift * _W_CATEGORY
            fit += impact
            pct = round(sig.p_feasible * 100)
            weighted.append((
                impact,
                ReasonCode(
                    factor="category",
                    label="標的類別",
                    value=t.category,
                    direction=_direction(impact),
                    impact=round(impact, 4),
                    evidence=(
                        f"「{t.category}」類在你過去評估中 {sig.feasible}/{sig.support} "
                        f"判為可行（{pct}%），相對基準{'偏好' if impact > 0 else '迴避'}"
                    ),
                ),
            ))
        else:
            prior = _CATEGORY_PRIOR.get(t.category)
            if prior == "positive":
                impact = _W_CATEGORY_PRIOR
                fit += impact
                weighted.append((
                    impact,
                    ReasonCode(
                        factor="category",
                        label="標的類別",
                        value=t.category,
                        direction=_direction(impact),
                        impact=round(impact, 4),
                        evidence=(
                            f"「{t.category}」類採購在領域經驗中普遍可承接"
                            "（分類先驗；待你累積評估後改以實際偏好為準）"
                        ),
                    ),
                ))
            elif t.category in _CATEGORY_UNVERIFIED:
                # 方向待認證：先給中性 0.0、不扣分，但說明與「全無紀錄」不同。
                neutral.append(ReasonCode(
                    factor="category",
                    label="標的類別",
                    value=t.category,
                    direction="neutral",
                    impact=0.0,
                    evidence=(
                        f"「{t.category}」類過往樣本可行率偏低，但樣本數不足、方向尚未認證，"
                        "暫不納入評分（待累積評估後改以實際偏好為準）"
                    ),
                ))
            else:
                neutral.append(ReasonCode(
                    factor="category",
                    label="標的類別",
                    value=t.category,
                    direction="neutral",
                    impact=0.0,
                    evidence=f"「{t.category}」類尚無評估紀錄，無法判定偏好",
                ))

    # 2) 地點（次要因素）
    if t.city:
        sig = profile.city.get(t.city)
        if sig is not None:
            impact = sig.lift * _W_CITY
            fit += impact
            weighted.append((
                impact,
                ReasonCode(
                    factor="city",
                    label="標的地點",
                    value=t.city,
                    direction=_direction(impact),
                    impact=round(impact, 4),
                    evidence=(
                        f"{t.city} 在你過去評估的可行率為 "
                        f"{round(sig.p_feasible * 100)}%（{sig.feasible}/{sig.support}）"
                    ),
                ),
            ))

    # 3) 預算 fit
    if t.budget_wan is not None and profile.budget_min is not None:
        lo, hi = profile.budget_min, profile.budget_max
        if lo <= t.budget_wan <= (hi or lo):
            fit += _W_BUDGET_IN
            weighted.append((
                _W_BUDGET_IN,
                ReasonCode(
                    factor="budget",
                    label="預算區間",
                    value=f"{t.budget_wan} 萬",
                    direction="positive",
                    impact=_W_BUDGET_IN,
                    evidence=f"預算 {t.budget_wan} 萬落在你承接區間 {lo}–{hi} 萬內",
                ),
            ))
        else:
            fit += _W_BUDGET_OUT
            weighted.append((
                _W_BUDGET_OUT,
                ReasonCode(
                    factor="budget",
                    label="預算區間",
                    value=f"{t.budget_wan} 萬",
                    direction="negative",
                    impact=_W_BUDGET_OUT,
                    evidence=f"預算 {t.budget_wan} 萬落在你承接區間 {lo}–{hi} 萬之外",
                ),
            ))
    elif t.budget_wan is not None:
        # §3.3 尚無個人承接區間 → 絕對軟閾值（弱信號；100–300 萬視為中性不發 reason）
        if t.budget_wan >= _BUDGET_HI_WAN:
            impact = _W_BUDGET_SOFT_HI
        elif t.budget_wan < _BUDGET_LO_WAN:
            impact = _W_BUDGET_SOFT_LO
        else:
            impact = 0.0
        if impact != 0.0:
            fit += impact
            weighted.append((
                impact,
                ReasonCode(
                    factor="budget",
                    label="預算規模",
                    value=f"{t.budget_wan} 萬",
                    direction=_direction(impact),
                    impact=round(impact, 4),
                    evidence=(
                        f"預算約 {t.budget_wan} 萬，"
                        + ("達工程案常見規模（≥300 萬），偏向可承接"
                           if impact > 0 else
                           "偏小（<100 萬），多為小型採購，承接價值較低")
                        + "（預算軟閾值；尚無你的承接區間時的概略判斷）"
                    ),
                ),
            ))

    # 4) SL2 學習關鍵字
    kw_impact, kw_reason = _keyword_reason(
        t, positive_kws, manual_negatives, learned_negatives
    )
    if kw_reason is not None:
        fit += kw_impact
        weighted.append((kw_impact, kw_reason))

    # 5) 行為偏好（你常點開的類別）
    if t.category and t.category in profile.engaged_categories:
        fit += _W_BEHAVIOR
        weighted.append((
            _W_BEHAVIOR,
            ReasonCode(
                factor="behavior",
                label="點擊偏好",
                value=t.category,
                direction="positive",
                impact=_W_BEHAVIOR,
                evidence=f"你近期常主動點開「{t.category}」類標案，顯示關注度高",
            ),
        ))

    # 6) 急迫性（中性提示，不影響 fit，僅供決策節奏）
    if days_left is not None and days_left <= 7:
        neutral.append(ReasonCode(
            factor="urgency",
            label="截止急迫",
            value=f"剩 {days_left} 天",
            direction="neutral",
            impact=0.0,
            evidence=(
                f"距截止僅 {days_left} 天，"
                + ("已逾期" if days_left < 0 else "若要投標需盡快決策")
            ),
        ))

    fit = max(0.03, min(0.97, fit))
    criteria_fit = round(fit * 100)
    if criteria_fit >= 62:
        verdict = "strong"
        headline = "判準高度吻合，建議優先評估投標"
    elif criteria_fit >= 42:
        verdict = "consider"
        headline = "部分判準吻合，建議進一步評估"
    else:
        verdict = "weak"
        headline = "與你的承標判準偏離，多半可略過"

    weighted.sort(key=lambda x: abs(x[0]), reverse=True)
    reasons = [rc for _, rc in weighted] + neutral

    return TenderReasoningOut(
        tender_id=tender_id,
        criteria_fit=criteria_fit,
        verdict=verdict,  # type: ignore[arg-type]
        headline=headline,
        reasons=reasons,
        profile=profile_to_out(profile),
    )

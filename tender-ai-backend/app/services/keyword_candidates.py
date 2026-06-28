# -*- coding: utf-8 -*-
"""速覽配對（swipe）判斷原因表單的關鍵字候選服務（SL3 輔助，唯讀、離線）。

對應本人需求 C：把相關關鍵字拆成「字（單字）」與「詞（斷詞）」供本人選取，
標註「因哪些關鍵字而做此判斷」。本服務只**讀**並組裝候選，**不寫**任何權重。

回傳四塊：
- ``words``：對標題＋機關以 jieba 斷詞（沿用 ``text_index.tokenize_cn``，離線
  bundled dict、不連網），保序去重。
- ``chars``：標題＋機關中相異的 CJK 單字，保序。
- ``positive_hits``：本人學習正向詞 ∩ 本標案文字 → ✓/⭐ 由前端預選（正向可自動學）。
- ``recommended_negative``：取最新 ``EvolutionLog.negative_candidates``（系統由資料
  浮現、附理由的『疑似迴避』建議）與本標案文字的交集 → ✗ 由前端預選**但需人確認**。

紅線（negative-keywords-human-only）：``recommended_negative`` 僅為**建議**，附
``lift``／``reason``；真正寫入 ``kind=negative`` 只發生在本人於表單按下確認後走
``POST /me/keywords``。**此端點不得寫入任何負權重**（commit 7f56ff0 已回歸人工專屬）。
"""
from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EntityNotFound
from app.models.knowledge import EvolutionLog
from app.models.tender import Tender
from app.services import reasoning as reasoning_svc
from app.services.text_index import tokenize_cn

# 中日韓統一表意文字（單字抽取用）
_CJK = re.compile(r"[一-鿿]")


async def keyword_candidates(
    session: AsyncSession, tender_id: int, user_id: int | None = None
) -> dict:
    """組裝某標案的字／詞候選＋正向命中＋系統負向建議。查無標案 → 404。"""
    tender = await session.get(Tender, tender_id)
    if tender is None:
        raise EntityNotFound(f"tender {tender_id} not found")

    title = tender.name or ""
    org = tender.org or ""
    text = f"{title} {org}".strip()
    low = text.lower()
    title_low = title.lower()

    # 詞：jieba 斷詞，保序去重
    words: list[dict] = []
    seen: set[str] = set()
    for tok in tokenize_cn(text):
        if tok in seen:
            continue
        seen.add(tok)
        words.append({"term": tok, "in_title": tok in title_low})

    # 字：相異 CJK 單字，保序
    chars: list[dict] = []
    seen_c: set[str] = set()
    for ch in text:
        if _CJK.match(ch) and ch not in seen_c:
            seen_c.add(ch)
            chars.append({"term": ch, "in_title": ch in title})

    # 正向命中：本人學習正向詞 ∩ 文字（✓/⭐ 前端預選）
    profile = await reasoning_svc.build_criteria_profile(session, user_id)
    positive_hits = [t for t in profile.kw_positive if t and t.lower() in low]

    # 系統建議負向候選（附理由）∩ 文字（✗ 前端預選但需人確認；此端點不寫負權重）
    latest = (
        await session.execute(
            select(EvolutionLog)
            .order_by(EvolutionLog.created_at.desc(), EvolutionLog.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    recommended_negative: list[dict] = []
    if latest and latest.negative_candidates:
        for c in latest.negative_candidates:
            term = (c or {}).get("term")
            if term and term.lower() in low:
                recommended_negative.append(
                    {
                        "term": term,
                        "lift": float(c.get("lift") or 0.0),
                        "reason": c.get("reason") or "",
                    }
                )

    return {
        "tender_id": tender.id,
        "title": title,
        "org": tender.org,
        "words": words,
        "chars": chars,
        "positive_hits": positive_hits,
        "recommended_negative": recommended_negative,
    }

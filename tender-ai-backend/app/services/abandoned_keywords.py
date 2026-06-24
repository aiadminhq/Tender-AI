# -*- coding: utf-8 -*-
"""本人「淘汰過的標案」字根候選聚合服務（個人化線、唯讀、離線）。

對應需求 P3「規則字根連動 — 強化自動拆解字根，又 tag 可以加速操作體驗」：把本人
**實際淘汰**（速覽 ✗/pass，或狀態＝放棄）的標案標題，拆成「字根（2-gram）」與
「詞（jieba 斷詞）」，跨案以「出現在幾件你淘汰的標案」做文件頻次統計，組成一份
『建議迴避字根』候選清單，供本人在規則頁一鍵檢視、批次加入迴避詞。

判斷「淘汰」的訊號（取聯集，皆為本人自有資料、不需共享同意）：
- ``events``：``type='view'`` 且 ``payload.scope='swipe'`` 且 ``payload.action='pass'``。
- ``tender_user_state``：``status='放棄'``。

排除規則（讓候選保持「可立即採納的新建議」）：
- 已在本人正向清單的詞 → 不建議迴避（不能叫人避開自己喜歡的）。
- 已在本人手動迴避清單的詞 → 已處理過，不再重複建議。

紅線（negative-keywords-human-only）：本服務**只讀並聚合**，附 ``count``／``sample_titles``
供人判斷，**絕不寫入任何負權重**。真正歸負分只發生在本人於規則頁按下「加入迴避」、
經 ``POST /me/keywords``（``kind=negative``）寫入——採納與否一律由人拍板。
"""
from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.behavior import Event, TenderUserState
from app.models.tender import Tender
from app.services import reasoning as reasoning_svc
from app.services.text_index import tokenize_cn

# 中日韓統一表意文字（2-gram 字根抽取用）
_CJK = re.compile(r"[一-鿿]")


def _cjk_bigrams(text: str) -> list[str]:
    """取標題中「連續兩個 CJK 字」的滑窗 2-gram；跨越非 CJK 字元處不成 gram。"""
    grams: list[str] = []
    prev_cjk = ""
    for ch in text:
        if _CJK.match(ch):
            if prev_cjk:
                grams.append(prev_cjk + ch)
            prev_cjk = ch
        else:
            prev_cjk = ""
    return grams


async def _abandoned_tender_ids(session: AsyncSession, user_id: int) -> set[int]:
    """本人淘汰過的標案 id（速覽 pass 事件 ∪ 狀態＝放棄）。"""
    ids: set[int] = set()

    pass_rows = await session.execute(
        select(Event.tender_id).where(
            Event.user_id == user_id,
            Event.tender_id.isnot(None),
            Event.type == "view",
            Event.payload["scope"].astext == "swipe",
            Event.payload["action"].astext == "pass",
        )
    )
    ids.update(tid for (tid,) in pass_rows if tid is not None)

    status_rows = await session.execute(
        select(TenderUserState.tender_id).where(
            TenderUserState.user_id == user_id,
            TenderUserState.status == "放棄",
        )
    )
    ids.update(tid for (tid,) in status_rows if tid is not None)

    return ids


async def abandoned_keyword_candidates(
    session: AsyncSession,
    user_id: int,
    *,
    min_count: int = 2,
    limit: int = 40,
) -> dict:
    """聚合本人淘汰標案標題的字根／詞候選。只讀、不寫任何權重。

    回傳 ``candidates`` 依「出現件數」降序（同分時較長字根優先、再字典序），每筆附
    最多 3 筆示例標題。``count`` ＝出現在幾件你淘汰的標案（文件頻次，每案至多計一次）。
    """
    tender_ids = await _abandoned_tender_ids(session, user_id)
    if not tender_ids:
        return {"user_id": user_id, "abandoned_count": 0, "candidates": []}

    rows = await session.execute(
        select(Tender.id, Tender.name).where(Tender.id.in_(tender_ids))
    )
    titles: list[str] = [name for (_id, name) in rows if name]

    # 排除集：本人正向詞（不建議迴避）＋已手動迴避詞（不重複建議），小寫比對。
    profile = await reasoning_svc.build_criteria_profile(session, user_id)
    excluded = {t.lower() for t in profile.kw_positive if t}
    excluded |= {t.lower() for t in profile.kw_negative if t}

    # 文件頻次：每個 term 在幾件標案出現（每案至多計一次）＋是否為 jieba 詞＋示例標題。
    doc_count: dict[str, int] = {}
    is_word: dict[str, bool] = {}
    samples: dict[str, list[str]] = {}

    for title in titles:
        # 詞（jieba，已過濾 len>=2）優先標記；字根（2-gram）補充。詞與字根同 term 時詞勝。
        words = set(tokenize_cn(title))
        roots = set(_cjk_bigrams(title))
        for term in words | roots:
            if not term or term.lower() in excluded:
                continue
            doc_count[term] = doc_count.get(term, 0) + 1
            if term in words:
                is_word[term] = True
            else:
                is_word.setdefault(term, False)
            bucket = samples.setdefault(term, [])
            if len(bucket) < 3 and title not in bucket:
                bucket.append(title)

    candidates = [
        {
            "term": term,
            "kind": "word" if is_word.get(term) else "root",
            "count": cnt,
            "sample_titles": samples.get(term, []),
        }
        for term, cnt in doc_count.items()
        if cnt >= min_count
    ]
    # 出現件數↓、字根長度↓（較長＝較具體）、字典序↑
    candidates.sort(key=lambda c: (-c["count"], -len(c["term"]), c["term"]))

    return {
        "user_id": user_id,
        "abandoned_count": len(tender_ids),
        "candidates": candidates[:limit],
    }

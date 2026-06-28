# -*- coding: utf-8 -*-
"""推理卡「手動關鍵字覆寫」服務（Phase 2）。

讓使用者在「為什麼·推理」卡的偏好／迴避／常點開區塊親手 add／remove 關鍵字，
並把這些**人下的決定**合併回系統「學習」出的判準輪廓。三件事：

- ``upsert_manual_keyword``：以 (user, term, kind) 複合鍵 upsert 一列覆寫
  （``excluded`` 切換 add／remove）。
- ``list_overrides``：讀本人所有覆寫列。
- ``apply_overrides``（純函式）：把覆寫套到學習出的 (positive, negative, engaged)
  三清單上——學習詞保序、排除 ``excluded=True`` 的詞、尾端接上手動新增的詞、
  不重複。

治理：手動「迴避」(kind=negative, excluded=False) 即「負分一律由人手動給」的
唯一合規路徑（系統不得自動產生負分，見記憶 negative-keywords-human-only）。
個人化線只用本人資料、不需共享同意（CLAUDE.md Layer B）。離線、只讀寫本機 DB。

計分注入（顯示＋計分皆已接通）：``reasoning.build_criteria_profile`` 先把
``kw_negative`` 清空再併入本人手動迴避詞，``reasoning.explain_tender`` 即以該清單
（＝本人人工迴避詞）作為 per-tender 計分的**唯一**負分來源；系統學習詞只供正向、
永不帶出負分（負分人工專屬紅線，見記憶 negative-keywords-human-only）。
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.preference import UserManualKeyword

# 合法的覆寫類別（對應推理卡三區塊）
KINDS = ("positive", "negative", "engaged")


async def upsert_manual_keyword(
    session: AsyncSession,
    user_id: int,
    term: str,
    kind: str,
    excluded: bool,
) -> UserManualKeyword:
    """以 (user_id, term, kind) 複合鍵 upsert 一列覆寫。

    既有列只更新 ``excluded``（在原列上切換 add／remove），不新增重複列。
    呼叫端負責 commit。
    """
    row = await session.get(UserManualKeyword, (user_id, term, kind))
    if row is None:
        row = UserManualKeyword(
            user_id=user_id, term=term, kind=kind, excluded=excluded
        )
        session.add(row)
    else:
        row.excluded = excluded
    await session.flush()
    return row


async def list_overrides(
    session: AsyncSession, user_id: int
) -> list[UserManualKeyword]:
    """讀本人所有手動覆寫列。"""
    rows = (
        await session.execute(
            select(UserManualKeyword).where(UserManualKeyword.user_id == user_id)
        )
    ).scalars()
    return list(rows)


def apply_overrides(
    positive: list[str],
    negative: list[str],
    engaged: list[str],
    overrides: list[UserManualKeyword],
) -> tuple[list[str], list[str], list[str]]:
    """把手動覆寫套到三個學習清單上（純函式、可單測）。

    每個 kind：保留學習詞原序、剔除 ``excluded=True`` 的詞、再把 ``excluded=False``
    的手動新增詞接到尾端（已存在者不重複）。
    """
    by_kind: dict[str, list[UserManualKeyword]] = {k: [] for k in KINDS}
    for o in overrides:
        by_kind.setdefault(o.kind, []).append(o)

    def _merge(base: list[str], kind: str) -> list[str]:
        rows = by_kind.get(kind, [])
        excluded = {o.term for o in rows if o.excluded}
        added = [o.term for o in rows if not o.excluded]
        result = [t for t in base if t not in excluded]
        for t in added:
            if t not in result:
                result.append(t)
        return result

    return (
        _merge(positive, "positive"),
        _merge(negative, "negative"),
        _merge(engaged, "engaged"),
    )

# -*- coding: utf-8 -*-
"""標案詳情規格表欄位顯示設定 service（團隊共用 → 單列 id=1，get-or-create）。

封裝 ``detail_field_visibility_config`` 的讀／寫。設定決定詳情頁那張常態性規格表
要隱藏哪些欄位（``hidden_fields``＝被隱藏的欄位鍵清單；空陣列＝全部顯示）。

對照 app/services/brain_config.py 的單列模式。``hidden_fields`` 一律正規化為
去重、字串、排序穩定的 list，避免髒輸入污染團隊共用設定。
"""
from __future__ import annotations

from typing import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings import DetailFieldVisibilityConfig

# 固定單列主鍵。
_ROW_ID = 1


def _normalize(values: Iterable[object]) -> list[str]:
    """正規化 hidden_fields：轉字串、去空白、去重、保留出現順序。"""
    seen: set[str] = set()
    out: list[str] = []
    for v in values:
        key = str(v).strip()
        if key and key not in seen:
            seen.add(key)
            out.append(key)
    return out


async def get_or_create(session: AsyncSession) -> DetailFieldVisibilityConfig:
    """取得單列設定；不存在則以預設（hidden_fields=[]，全部顯示）建立。"""
    config = await session.get(DetailFieldVisibilityConfig, _ROW_ID)
    if config is not None:
        return config

    config = DetailFieldVisibilityConfig(id=_ROW_ID, hidden_fields=[])
    session.add(config)
    await session.flush()
    return config


async def update(
    session: AsyncSession, changes: dict[str, object]
) -> DetailFieldVisibilityConfig:
    """更新 hidden_fields（未送則不動）。傳入清單會被正規化後整批覆蓋。"""
    config = await get_or_create(session)
    if "hidden_fields" in changes:
        raw = changes["hidden_fields"]
        config.hidden_fields = _normalize(raw if isinstance(raw, (list, tuple)) else [])
    await session.flush()
    return config

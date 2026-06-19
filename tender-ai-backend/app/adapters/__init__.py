# -*- coding: utf-8 -*-
"""來源 adapter registry:``iter_adapters`` / ``get_adapter`` / ``source_seeds``。

``source_seeds()`` 取代 ``backfill._SOURCE_BASE`` 成為 sources 種子的唯一真實來源
(``ensure_sources`` 改由此驅動,等價輸出)。
"""
from __future__ import annotations

from app.adapters.base import FetchResult, SourceAdapter
from app.adapters.pcc import PCCAdapter
from app.adapters.tmu import TMUAdapter

# 註冊順序固定:PCC(主資料源)、TMU(第二資料源)。單例,供 registry 查詢。
_ADAPTERS: tuple[SourceAdapter, ...] = (PCCAdapter(), TMUAdapter())
_BY_NAME: dict[str, SourceAdapter] = {a.source_name: a for a in _ADAPTERS}


def iter_adapters() -> tuple[SourceAdapter, ...]:
    """回傳所有已註冊 adapter(固定順序)。"""
    return _ADAPTERS


def get_adapter(name: str) -> SourceAdapter | None:
    """依來源名稱取 adapter;未知來源回 ``None``。"""
    return _BY_NAME.get(name)


def source_seeds() -> dict[str, str]:
    """``{source_name: base_url}``,供 ``ensure_sources`` 建立 sources 種子列。"""
    return {a.source_name: a.base_url for a in _ADAPTERS}


__all__ = [
    "FetchResult",
    "SourceAdapter",
    "iter_adapters",
    "get_adapter",
    "source_seeds",
]

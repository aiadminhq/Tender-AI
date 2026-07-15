# -*- coding: utf-8 -*-
"""清單 cursor（keyset）分頁的編解碼與失效判斷。

cursor 為 opaque token：``base64url(JSON)``。JSON 內含

- ``v``：cursor schema 版本（未來變動時可辨識拒收）。
- ``sort``：產生此 cursor 時的 active sort key。
- ``fp``：篩選條件指紋（filters fingerprint）——把「會影響結果集與排序」的
  查詢欄位正規化後雜湊。切換排序或任一篩選都會讓指紋改變。
- ``keys``：最後一筆列的「排序鍵向量」（各排序欄位值，末位恆為 tender.id）。
  keyset WHERE 以此組出「落在下一頁一側」的條件。

設計選擇：cursor 與「當前請求的 sort＋filters」必須一致，否則 keyset 語義會錯亂
（排序欄位對不上、或篩選改變導致跳號）。不一致時由服務層拋 ``CursorError`` → API 轉 400，
讓前端明確重置回第一頁，而非悄悄回錯資料。
"""
from __future__ import annotations

import base64
import hashlib
import json
from typing import Any

CURSOR_VERSION = 1


class CursorError(Exception):
    """cursor 無法解析／版本不符／與當前 sort＋filters 不一致；API 層轉 400。"""

    def __init__(self, detail: str = "invalid cursor") -> None:
        self.detail = detail
        super().__init__(detail)


def filters_fingerprint(q: Any) -> str:
    """把 TenderQuery 中「會影響結果集」的欄位正規化後雜湊成穩定指紋。

    僅涵蓋篩選與 sort；分頁欄位（page/page_size/cursor）不納入，
    因為換頁本就不該讓指紋改變。多選欄位排序後比對（順序不應影響語義）。
    """
    payload = {
        "sort": q.sort,
        "tier": sorted(q.tier or []),
        "cat": sorted(q.cat or []),
        "city": sorted(q.city or []),
        "src": sorted(q.src or []),
        "deadline": q.deadline,
        "budget_min": q.budget_min,
        "budget_max": q.budget_max,
        "focus": sorted(q.focus or []),
        "avoid": sorted(q.avoid or []),
        "q": (q.q or "").strip(),
        # include_expired 會改變結果集（含/不含已截止案），必須納入指紋，
        # 否則切換此開關後沿用舊 cursor 會拿到跨集合、跳號的錯誤結果。
        "include_expired": bool(getattr(q, "include_expired", False)),
    }
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def encode_cursor(sort: str, fingerprint: str, keys: list[Any]) -> str:
    """把 (sort, fingerprint, keys) 打包成 opaque base64url token。"""
    payload = {"v": CURSOR_VERSION, "sort": sort, "fp": fingerprint, "keys": keys}
    blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(blob).decode("ascii")


def decode_cursor(token: str, sort: str, fingerprint: str) -> list[Any]:
    """解出 keys；token 損毀／版本不符／sort 或 filters 指紋不一致 → CursorError。"""
    try:
        raw = base64.urlsafe_b64decode(token.encode("ascii"))
        payload = json.loads(raw.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 — 任何解碼錯誤一律視為壞 cursor
        raise CursorError("cursor 無法解析") from exc

    if not isinstance(payload, dict) or payload.get("v") != CURSOR_VERSION:
        raise CursorError("cursor 版本不符")
    keys = payload.get("keys")
    if not isinstance(keys, list) or not keys:
        raise CursorError("cursor 內容不完整")
    if payload.get("sort") != sort:
        raise CursorError("cursor 與當前排序不一致，請重置為第一頁")
    if payload.get("fp") != fingerprint:
        raise CursorError("cursor 與當前篩選條件不一致，請重置為第一頁")
    return keys

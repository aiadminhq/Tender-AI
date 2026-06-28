# -*- coding: utf-8 -*-
"""即時學習（Layer B → Layer C）薄包裝。

單筆標案判斷（``Evaluation``）寫入後，由 API 層同步呼叫本模組，立即把 Layer B
養分重算成 Layer C 關鍵字權重，讓「當下的判斷立刻影響推播與排序」。

設計重點（見 docs/superpowers/specs/2026-06-24-judgment-actions-realtime-learning-design.md）：

- **即時 ≡ 批次**：直接複用 ``learn_keywords``，不另寫一套學習邏輯，避免即時／批次
  結果分歧。差別只在 ``allow_auto_negative=True``——本人 2026-06-24 明確覆寫
  「負分人工專屬」紅線後，負向判斷也即時派生團隊負權（帶 NEG_LEARN_NOTE 標記、
  append-only、consent-aware、可回退）。
- **append-only／consent-aware**：完全沿用 ``learn_keywords`` 既有保證（寫
  ``KeywordWeightRevision`` 審計批次、只聚合 whitelist_active && consent_shared）。
- **不向量化**：``learn_keywords`` 只動關鍵字權重，不觸發 embedding；遵守「批次抓取
  進行中先不向量化」原則。
- **自帶 session**：用 ``session_factory`` 開獨立 session，與呼叫端的請求交易解耦，
  確保評估已 commit 後才重算（讀得到最新一筆判斷）。
"""
from __future__ import annotations

from app.jobs.learn_keywords import learn_keywords


async def learn_after_evaluation(session_factory=None) -> dict:
    """單筆判斷寫入後的即時重算，回傳精簡摘要供前端提示。

    Args:
        session_factory: 測試可注入；預設由 learn_keywords 落到 AsyncSessionLocal。

    Returns:
        精簡摘要 dict（關鍵字新增/更新數、樣本數、本批 revision、consent 人數、
        負向候選數）。底層完整 stats 不全部外流，避免把內部細節帶到前端。
    """
    stats = await learn_keywords(
        session_factory=session_factory,
        allow_auto_negative=True,  # 即時：正負皆即時寫團隊權重（本人覆寫紅線）
    )
    return {
        "keywords_added": stats.get("keywords_added", 0),
        "keywords_updated": stats.get("keywords_updated", 0),
        "feasible_samples": stats.get("feasible_samples", 0),
        "infeasible_samples": stats.get("infeasible_samples", 0),
        "consenting_users": stats.get("consenting_users", 0),
        "revision_batch": stats.get("revision_batch"),
        # 仍保留候選清單供管理者審核（即使負向已即時寫入，候選資訊有助稽核）。
        "negative_candidates": stats.get("negative_candidates", []),
    }

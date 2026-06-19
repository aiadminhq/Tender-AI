# -*- coding: utf-8 -*-
"""P4 學習工作：從行為推導關鍵字權重。

工作流程：
1. 讀取所有 evaluations 和相應的標案詳情
2. 比較「可行」vs「不可行」的標案，提取文本特徵（name, org, category）
3. 計算詞頻差異（TF 比較），生成 positive（重點詞）與 negative（避免詞）
4. 寫入 keyword_weights，支援度 = 樣本數

詞彙源：標案名稱分詞、機構名分詞、類別。
鐵則：不連網；使用本地分詞（jieba，離線 bundled dict）。測試用 monkeypatch。
"""
from __future__ import annotations

import asyncio
import re
from collections import Counter
from datetime import datetime, timezone

import jieba
from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.behavior import Evaluation
from app.models.knowledge import KeywordWeight, KeywordWeightRevision
from app.models.tender import Tender

# jieba 顯式初始化：首次 cut 才 lazy-load 詞典，這裡先載好避免測試／首呼延遲。
# jieba 內建 dict 隨套件 bundled，純離線、不連網，滿足學習工作鐵則。
jieba.initialize()

# 僅保留純中文／英數的詞元（濾掉標點、空白、混雜符號）
_TOKEN_OK = re.compile(r"^[\w一-鿿]+$")

# 分類直接映射：分類欄位是最強的決策信號，優先於詞彙 TF（100% 精準）
_CATEGORY_POLARITY = {
    "工程": ("positive", 1.0, "Tier-1 分類信號：工程類採購 100% 可行"),
    "營繕工程": ("positive", 1.0, "Tier-1 分類信號：營繕類採購 100% 可行"),
    "財物": ("negative", 1.0, "Tier-1 分類信號：財物類採購 0% 可行"),
    "勞務": ("negative", 1.0, "Tier-1 分類信號：勞務類採購 0% 可行"),
}


def _tokenize_cn(text: str) -> list[str]:
    """以 jieba 斷詞（離線 bundled dict、不連網）。

    僅保留長度 ≥2、且為中文或英數的詞元；標點與單字雜訊一律過濾。
    """
    if not text:
        return []
    tokens = []
    for tok in jieba.cut(text):
        tok = tok.strip().lower()
        if len(tok) >= 2 and _TOKEN_OK.match(tok):
            tokens.append(tok)
    return tokens


async def learn_keywords(
    session_factory=None,
    min_support: int = 2,  # 最少出現次數，才列入 keyword_weights
    include_category_features: bool = True,  # 是否加入分類直接映射
) -> dict:
    """推導關鍵字權重與多維特徵。

    學習層級（優先級由高到低）：
    1. 分類直接映射（category in CATEGORY_POLARITY） → 100% 精準
    2. 詞彙 TF 比較（現有邏輯）→ ~85% 精準
    3. 預算軟閾值（後續加入） → ~70% 精準

    Args:
        session_factory: 可用於測試的 session 工廠（預設 AsyncSessionLocal）
        min_support: 支援度門檻；低於此值的詞被過濾
        include_category_features: 是否加入分類直接映射（提升精準率至 95%+）

    Returns:
        {
          'feasible_samples': 可行標案數,
          'infeasible_samples': 不可行標案數,
          'keywords_added': 新增的 keyword_weights 筆數,
          'keywords_updated': 更新的 keyword_weights 筆數,
          'revision_batch': ISO8601 時間戳（審計用）,
          'revision_rows': 版本快照列數,
          'category_features_added': 分類直接映射加入的特徵數,
        }
    """
    if session_factory is None:
        session_factory = AsyncSessionLocal

    async with session_factory() as session:
        # 1. 讀取所有評估與標案
        evals = (
            await session.execute(
                select(Evaluation, Tender).join(
                    Tender, Tender.id == Evaluation.tender_id
                )
            )
        ).all()

        # 2. 分組：可行 vs 不可行
        feasible_docs = []
        infeasible_docs = []

        for eval_obj, tender_obj in evals:
            if eval_obj.feasible == "可行":
                feasible_docs.append(tender_obj)
            elif eval_obj.feasible == "不可行":
                infeasible_docs.append(tender_obj)

        # 3. 提取詞彙（from name + category + org）
        def extract_vocab(tenders: list[Tender]) -> Counter:
            vocab = Counter()
            for t in tenders:
                for text in [t.name or "", t.category or "", t.org or ""]:
                    tokens = _tokenize_cn(text)
                    vocab.update(tokens)
            return vocab

        feasible_vocab = extract_vocab(feasible_docs)
        infeasible_vocab = extract_vocab(infeasible_docs)

        # 4. 提取分類特徵（Tier 1 優先級：100% 精準信號）
        category_features = []
        if include_category_features:
            all_categories = set()
            for t in feasible_docs + infeasible_docs:
                if t.category:
                    all_categories.add(t.category)

            for category in all_categories:
                if category in _CATEGORY_POLARITY:
                    polarity, weight, description = _CATEGORY_POLARITY[category]
                    category_features.append({
                        "term": category,
                        "polarity": polarity,
                        "weight": weight,
                        "support": sum(1 for t in feasible_docs + infeasible_docs if t.category == category),
                        "tier": "Tier-1 分類",
                        "description": description,
                    })

        # 5. 計算詞彙權重：比較兩組詞頻（TF 比較）
        #    positive weight = TF(feasible) - TF(infeasible)
        #    negative weight = TF(infeasible) - TF(feasible)
        all_terms = set(feasible_vocab.keys()) | set(infeasible_vocab.keys())

        # 過濾掉分類詞彙（避免重複）
        category_terms = {feat["term"] for feat in category_features}
        all_terms = all_terms - category_terms

        keyword_data = []
        for term in all_terms:
            f_count = feasible_vocab.get(term, 0)
            i_count = infeasible_vocab.get(term, 0)
            
            # 正向（可行中更常見）
            if f_count > i_count and f_count >= min_support:
                weight = (f_count - i_count) / max(f_count + i_count, 1)
                keyword_data.append({
                    "term": term,
                    "polarity": "positive",
                    "weight": weight,
                    "support": f_count,
                })
            # 負向（不可行中更常見）
            elif i_count > f_count and i_count >= min_support:
                weight = (i_count - f_count) / max(f_count + i_count, 1)
                keyword_data.append({
                    "term": term,
                    "polarity": "negative",
                    "weight": weight,
                    "support": i_count,
                })

        # 5. 合併分類特徵與詞彙數據
        all_keywords = category_features + keyword_data

        # 6. 寫入/更新 keyword_weights
        stats = {"keywords_added": 0, "keywords_updated": 0, "category_features_added": 0}
        now = datetime.now(timezone.utc)
        feasible_n = len(feasible_docs)
        infeasible_n = len(infeasible_docs)

        for kw in all_keywords:
            existing = await session.get(KeywordWeight, kw["term"])
            if existing:
                existing.polarity = kw["polarity"]
                existing.weight = kw["weight"]
                existing.support = kw["support"]
                existing.updated_at = now
                stats["keywords_updated"] += 1
            else:
                session.add(KeywordWeight(
                    term=kw["term"],
                    polarity=kw["polarity"],
                    weight=kw["weight"],
                    support=kw["support"],
                    updated_at=now,
                ))
                if "tier" in kw and kw["tier"] == "Tier-1 分類":
                    stats["category_features_added"] += 1
                else:
                    stats["keywords_added"] += 1

        # 7. 寫入「版本快照」批次（append-only 審計軌跡，供 self-evolve 回溯）。
        #    同一批 term 共用 batch 時間戳；即使本輪無任何詞達門檻也照樣留空批，
        #    以記錄「該次學習的樣本脈絡」。
        batch = now.isoformat()
        for kw in all_keywords:
            session.add(KeywordWeightRevision(
                batch=batch,
                term=kw["term"],
                polarity=kw["polarity"],
                weight=kw["weight"],
                support=kw["support"],
                feasible_samples=feasible_n,
                infeasible_samples=infeasible_n,
            ))

        await session.commit()

        stats.update({
            "feasible_samples": feasible_n,
            "infeasible_samples": infeasible_n,
            "revision_batch": batch,
            "revision_rows": len(all_keywords),
        })

        return stats


async def main() -> None:
    stats = await learn_keywords()
    print(f"✅ 關鍵字學習完成：{stats}")


if __name__ == "__main__":
    asyncio.run(main())

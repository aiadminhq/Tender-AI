# -*- coding: utf-8 -*-
"""P4 學習工作：從行為推導關鍵字權重（雙軌：團隊線＋個人線）。

工作流程：
1. 讀取所有 evaluations 與相應的標案詳情、評估者帳號（含白名單／同意旗標）
2. **團隊線（keyword_weights）**：只納入 `whitelist_active && consent_shared` 的
   使用者行為（consent-aware join，伺服器端強制），比較「可行」vs「不可行」的
   標案，提取文本特徵（name, org, category），計算詞頻差異（TF 比較）。**只**自動學
   positive（重點詞）寫入 keyword_weights；偏負向的詞改列為「候選建議」附理由
   （`negative_candidates`）供人審核，**絕不自動寫入負權重**（負分人工專屬紅線，
   見 CLAUDE.md P4/P5、記憶 negative-keywords-human-only）。支援度 = 樣本數。
3. **個人線（user_keyword_weights / preference_profiles）**：對**每位**有評估紀錄的
   使用者，只用本人評估各自做一次 TF 比較，寫入 `user_keyword_weights`（複合主鍵
   user_id + term）與高層輪廓 `preference_profiles`。個人線只用本人資料、只服務本人，
   **不需同意**（自有資料）、不進團隊庫、不對他人揭露。

詞彙源：標案名稱分詞、機構名分詞、類別。
鐵則：不連網；使用本地分詞（jieba，離線 bundled dict）。測試用 monkeypatch。
"""
from __future__ import annotations

import asyncio
import re
from collections import Counter
from datetime import datetime, timezone

import jieba
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.models.behavior import Evaluation, User
from app.models.knowledge import (
    KeywordWeight,
    KeywordWeightRevision,
    UserKeywordWeight,
)
from app.models.preference import PreferenceProfile, UserManualKeyword
from app.models.tender import Tender

# jieba 顯式初始化：首次 cut 才 lazy-load 詞典，這裡先載好避免測試／首呼延遲。
# jieba 內建 dict 隨套件 bundled，純離線、不連網，滿足學習工作鐵則。
jieba.initialize()

# 僅保留純中文／英數的詞元（濾掉標點、空白、混雜符號）
_TOKEN_OK = re.compile(r"^[\w一-鿿]+$")

# 分類直接映射：分類欄位是最強的決策信號，優先於詞彙 TF（100% 精準）。
# 僅納入「方向已認證」的正向類別；財物/勞務 樣本少且 0% 可行率尚未認證，不寫死負向，
# 改讓其負向只在真實 TF 資料累積後自然浮現（資料優先；對齊 reasoning._CATEGORY_UNVERIFIED）。
_CATEGORY_POLARITY = {
    "工程": ("positive", 1.0, "Tier-1 分類信號：工程類採購 100% 可行"),
    "營繕工程": ("positive", 1.0, "Tier-1 分類信號：營繕類採購 100% 可行"),
}

# preference_profiles 每欄取前 N 名（避免輪廓卡片爆量）
_PROFILE_TOP_N = 10


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


def _extract_vocab(tenders: list[Tender]) -> Counter:
    """從一組標案的 name/category/org 抽出詞頻。"""
    vocab: Counter = Counter()
    for t in tenders:
        for text in [t.name or "", t.category or "", t.org or ""]:
            vocab.update(_tokenize_cn(text))
    return vocab


def _category_features(
    feasible_docs: list[Tender], infeasible_docs: list[Tender]
) -> list[dict]:
    """Tier-1 分類直接映射特徵（100% 精準信號）。"""
    features: list[dict] = []
    all_docs = feasible_docs + infeasible_docs
    seen = {t.category for t in all_docs if t.category}
    for category in seen:
        if category in _CATEGORY_POLARITY:
            polarity, weight, description = _CATEGORY_POLARITY[category]
            features.append({
                "term": category,
                "polarity": polarity,
                "weight": weight,
                "support": sum(1 for t in all_docs if t.category == category),
                "tier": "Tier-1 分類",
                "description": description,
            })
    return features


def _compute_keyword_data(
    feasible_vocab: Counter,
    infeasible_vocab: Counter,
    min_support: int,
    exclude_terms: set[str],
) -> tuple[list[dict], list[dict]]:
    """以 TF 比較推導關鍵字訊號，回傳 ``(positives, negative_candidates)``。

    - **positives**：可行樣本中明顯較常出現的詞，可由資料自動學成正向權重。
      weight = (TF_feasible - TF_infeasible) / (TF_feasible + TF_infeasible)
    - **negative_candidates**：在不可行樣本較常出現的「疑似迴避詞」。**只作為附
      理由的候選建議供人審核，絕不寫入任何負權重**——負分一律由人手動給出
      （見 CLAUDE.md P4/P5 與記憶 negative-keywords-human-only）。系統可在累積到
      足夠 lift 證據時把可疑詞列為候選並附理由，但採納與否最終由人確認。
    """
    all_terms = (set(feasible_vocab) | set(infeasible_vocab)) - exclude_terms
    positives: list[dict] = []
    negative_candidates: list[dict] = []
    for term in all_terms:
        f_count = feasible_vocab.get(term, 0)
        i_count = infeasible_vocab.get(term, 0)
        if f_count > i_count and f_count >= min_support:
            positives.append({
                "term": term,
                "polarity": "positive",
                "weight": (f_count - i_count) / max(f_count + i_count, 1),
                "support": f_count,
            })
        elif i_count > f_count and i_count >= min_support:
            # 紅線：不可行樣本較常出現 → 只列為「候選建議」附理由，永不自動給負分。
            lift = (i_count - f_count) / max(f_count + i_count, 1)
            negative_candidates.append({
                "term": term,
                "feasible_count": f_count,
                "infeasible_count": i_count,
                "lift": round(lift, 4),
                "support": i_count,
                "reason": (
                    f"在「不可行」樣本出現 {i_count} 次、「可行」{f_count} 次"
                    "（偏負向）；依紅線負分需人工確認，建議審核是否列為迴避關鍵字"
                ),
            })
    return positives, negative_candidates


async def _learn_personal_line(
    session,
    rows_by_user: dict[int, list[tuple[Evaluation, Tender]]],
    min_support: int,
    now: datetime,
) -> dict:
    """個人線：對每位使用者用本人評估算 user_keyword_weights + preference_profiles。

    不需同意（自有資料、只服務本人）。個人線樣本通常少，故 min_support 沿用傳入值，
    但預算／類別輪廓不受 min_support 限制（直接彙整本人可行案）。

    紅線：``user_keyword_weights`` 只寫正向、並清除遺留負向；``avoid_keywords`` 只
    取本人「手動」迴避詞（``UserManualKeyword`` kind=negative），系統學習不得自動
    產生負分（見 CLAUDE.md P4/P5、記憶 negative-keywords-human-only）。
    """
    users_processed = 0
    ukw_written = 0
    ukw_negatives_purged = 0
    profiles_written = 0

    for user_id, pairs in rows_by_user.items():
        feasible_docs = [t for ev, t in pairs if ev.feasible == "可行"]
        infeasible_docs = [t for ev, t in pairs if ev.feasible == "不可行"]
        if not feasible_docs and not infeasible_docs:
            continue
        users_processed += 1

        f_vocab = _extract_vocab(feasible_docs)
        i_vocab = _extract_vocab(infeasible_docs)
        # 紅線：個人線也只自動學「正向」；負向僅作候選（此處不外顯，丟棄）。
        positives, _neg_candidates = _compute_keyword_data(
            f_vocab, i_vocab, min_support, set()
        )

        # user_keyword_weights：複合主鍵 (user_id, term)，只寫正向（負分人工專屬）。
        for kw in positives:
            existing = await session.get(
                UserKeywordWeight, (user_id, kw["term"])
            )
            if existing:
                existing.polarity = kw["polarity"]
                existing.weight = kw["weight"]
                existing.support = kw["support"]
                existing.updated_at = now
            else:
                session.add(UserKeywordWeight(
                    user_id=user_id,
                    term=kw["term"],
                    polarity=kw["polarity"],
                    weight=kw["weight"],
                    support=kw["support"],
                    updated_at=now,
                ))
            ukw_written += 1

        # 清除任何遺留的個人「負向」權重（紅線：系統不得自動產生負分）。
        # 先前可能被某次升級為正向的同詞列已在上方 upsert 翻面，不會被本刪除誤殺。
        purge_res = await session.execute(
            delete(UserKeywordWeight).where(
                UserKeywordWeight.user_id == user_id,
                UserKeywordWeight.polarity == "negative",
            )
        )
        ukw_negatives_purged += purge_res.rowcount or 0

        # preference_profiles：高層輪廓（重點詞自動學；避免詞只取本人「手動」迴避詞）
        positives_sorted = sorted(
            positives, key=lambda k: k["weight"], reverse=True
        )
        # 避免詞一律來自本人手動指定的迴避詞（UserManualKeyword, kind=negative）。
        manual_avoid = (
            await session.execute(
                select(UserManualKeyword.term).where(
                    UserManualKeyword.user_id == user_id,
                    UserManualKeyword.kind == "negative",
                    UserManualKeyword.excluded.is_(False),
                )
            )
        ).scalars().all()
        preferred_categories = sorted(
            {t.category for t in feasible_docs if t.category}
        )
        budgets = [t.budget_wan for t in feasible_docs if t.budget_wan is not None]

        profile = (
            await session.execute(
                select(PreferenceProfile).where(
                    PreferenceProfile.user_id == user_id
                )
            )
        ).scalar_one_or_none()
        fields = {
            "top_keywords": [k["term"] for k in positives_sorted[:_PROFILE_TOP_N]],
            "avoid_keywords": list(manual_avoid)[:_PROFILE_TOP_N],
            "preferred_categories": preferred_categories,
            "budget_min": min(budgets) if budgets else None,
            "budget_max": max(budgets) if budgets else None,
            "updated_at": now,
        }
        if profile:
            for key, val in fields.items():
                setattr(profile, key, val)
        else:
            session.add(PreferenceProfile(user_id=user_id, **fields))
        profiles_written += 1

    return {
        "personal_users_processed": users_processed,
        "user_keyword_weights_written": ukw_written,
        "user_keyword_weights_negatives_purged": ukw_negatives_purged,
        "preference_profiles_written": profiles_written,
    }


async def learn_keywords(
    session_factory=None,
    min_support: int = 2,  # 最少出現次數，才列入 keyword_weights
    include_category_features: bool = True,  # 是否加入分類直接映射
) -> dict:
    """推導關鍵字權重與多維特徵（團隊線＋個人線）。

    學習層級（優先級由高到低）：
    1. 分類直接映射（category in CATEGORY_POLARITY） → 100% 精準
    2. 詞彙 TF 比較（現有邏輯）→ ~85% 精準
    3. 預算軟閾值（後續加入） → ~70% 精準

    **團隊線**只納入 `whitelist_active && consent_shared` 的使用者行為（伺服器端
    consent-aware join）；撤回者自當下起不再納入。**個人線**對每位使用者各自用本人
    評估計算，不需同意。

    Args:
        session_factory: 可用於測試的 session 工廠（預設 AsyncSessionLocal）
        min_support: 支援度門檻；低於此值的詞被過濾
        include_category_features: 是否加入分類直接映射（提升精準率至 95%+）

    Returns:
        {
          'feasible_samples', 'infeasible_samples',          # 團隊線（已過濾同意）樣本數
          'keywords_added', 'keywords_updated',
          'category_features_added',
          'negative_candidates',                              # 疑似迴避詞候選＋理由（供人審）
          'keyword_negatives_purged',                         # 清除的遺留自動負向列數
          'revision_batch', 'revision_rows',
          'consenting_users',                                 # 納入團隊聚合的使用者數
          'personal_users_processed',                         # 個人線處理的使用者數
          'user_keyword_weights_written',
          'user_keyword_weights_negatives_purged',
          'preference_profiles_written',
        }
    """
    if session_factory is None:
        session_factory = AsyncSessionLocal

    async with session_factory() as session:
        # 1. 讀取所有評估＋標案＋評估者帳號（含白名單／同意旗標）
        rows = (
            await session.execute(
                select(Evaluation, Tender, User)
                .join(Tender, Tender.id == Evaluation.tender_id)
                .join(User, User.id == Evaluation.user_id)
            )
        ).all()

        # 2. 個人線分組：所有使用者（不分同意，自有資料）
        rows_by_user: dict[int, list] = {}
        for eval_obj, tender_obj, user_obj in rows:
            rows_by_user.setdefault(user_obj.id, []).append((eval_obj, tender_obj))

        # 3. 團隊線分組：consent-aware join——只納入白名單且已同意者
        feasible_docs: list[Tender] = []
        infeasible_docs: list[Tender] = []
        consenting_users: set[int] = set()
        for eval_obj, tender_obj, user_obj in rows:
            if not (user_obj.whitelist_active and user_obj.consent_shared):
                continue  # 未開通或未同意（含已撤回）：不納入團隊聚合
            consenting_users.add(user_obj.id)
            if eval_obj.feasible == "可行":
                feasible_docs.append(tender_obj)
            elif eval_obj.feasible == "不可行":
                infeasible_docs.append(tender_obj)

        # 4. 團隊線詞彙與分類特徵
        feasible_vocab = _extract_vocab(feasible_docs)
        infeasible_vocab = _extract_vocab(infeasible_docs)

        category_features = (
            _category_features(feasible_docs, infeasible_docs)
            if include_category_features
            else []
        )
        category_terms = {feat["term"] for feat in category_features}

        positives, negative_candidates = _compute_keyword_data(
            feasible_vocab, infeasible_vocab, min_support, category_terms
        )

        # 5. 合併分類特徵與「正向」詞彙數據（負向只列候選、不寫權重，見紅線）
        all_keywords = category_features + positives

        # 6. 寫入/更新 keyword_weights（團隊線）
        stats = {
            "keywords_added": 0,
            "keywords_updated": 0,
            "category_features_added": 0,
        }
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
                if kw.get("tier") == "Tier-1 分類":
                    stats["category_features_added"] += 1
                else:
                    stats["keywords_added"] += 1

        # 6b. 清除遺留的「自動產生」負向詞（紅線：避免詞只能人工給）。
        #     只刪 notes 為 NULL 的自動負向；保留 notes 非空的「人工標註」全域負向詞，
        #     維持向後相容（本輪不把人工全域負向接進計分；計分只吃個人手動迴避詞）。
        purge_res = await session.execute(
            delete(KeywordWeight).where(
                KeywordWeight.polarity == "negative",
                KeywordWeight.notes.is_(None),
            )
        )
        negatives_purged = purge_res.rowcount or 0

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

        # 8. 個人線：每位使用者各自用本人評估算個人權重與輪廓（不需同意）
        personal_stats = await _learn_personal_line(
            session, rows_by_user, min_support, now
        )

        await session.commit()

        stats.update({
            "feasible_samples": feasible_n,
            "infeasible_samples": infeasible_n,
            "revision_batch": batch,
            "revision_rows": len(all_keywords),
            "consenting_users": len(consenting_users),
            # 疑似迴避詞「候選建議」（附理由）；絕不自動成為負權重，供人審核採納。
            "negative_candidates": negative_candidates,
            "keyword_negatives_purged": negatives_purged,
        })
        stats.update(personal_stats)

        return stats


async def main() -> None:
    stats = await learn_keywords()
    print(f"✅ 關鍵字學習完成：{stats}")


if __name__ == "__main__":
    asyncio.run(main())

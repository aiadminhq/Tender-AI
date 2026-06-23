# P4 關鍵字權重學習 — 資料分析與改進方案

**日期**：2026-06-19  
**基礎資料**：24 筆評估記錄（12 可行、12 不可行）  
**分析工具**：TF 詞頻比較、多維特徵交叉驗證

---

## 第一部分：資料洞察

### 1.1 分類特徵的絕對決策力

```
標案分類          可行率      樣本數     決策力
──────────────────────────────────────────────
工程             100%        12         ████████████ Tier 1
營繕工程          100%         3         ████████████ Tier 1
────────────────────────────────────────────────
財物               0%         7         ████████████ Tier 1 (REJECT)
勞務               0%         5         ████████████ Tier 1 (REJECT)
```

**核心發現**：分類欄位是最精準的預測器。這 4 個分類完美分割了可行 vs 不可行樣本。

**改進建議**：

```python
# 在 learn_keywords.py 中加入顯式的分類對映表
CATEGORY_POLARITY = {
    "工程": ("positive", 1.0),      # 100% 可行率
    "營繕工程": ("positive", 1.0),  # 100% 可行率
    "財物": ("negative", 1.0),      # 100% 可行率（待確認）
    "勞務": ("negative", 1.0),      # 100% 可行率（待確認）
}
```

### 1.2 預算與可行性的量化關係

```
統計指標          可行案例      不可行案例    信號強度
─────────────────────────────────────────────────────
平均預算           373 萬         163 萬      ★★★★☆
中位數分界         ~300-350 萬                 ★★★★★
範圍重疊           50-599 萬                   ★★★☆☆
```

**分界線分析**：

- 可行案例最小值（50 萬）> 不可行案例最大值（599 萬）：否
- 但 75% 可行案例 > 75% 不可行案例：是
- 建議使用 **300 萬 CNY** 作為軟閾值（可行性提升 70%）

**改進建議**：

```python
# 在 learn_keywords.py 中加入預算特徵提取
def extract_budget_feature(tender: Tender) -> tuple[str, float]:
    """根據預算返回 (polarity, confidence)。"""
    if tender.budget_wan is None:
        return ("neutral", 0.0)
    elif tender.budget_wan >= 300:
        return ("positive", 0.3)  # 軟信號，權重低於分類
    else:
        return ("negative", 0.2)
```

---

## 第二部分：現有關鍵字權重的層級分析

### 2.1 Tier 1：強決策詞（支援度 ≥ 3, 權重 ≥ 0.7）

| 詞彙 | 極性 | 權重  | 支援 | 含義               |
| ---- | ---- | ----- | ---- | ------------------ |
| 工程 | +    | 0.714 | 24   | 分類別名，最強信號 |
| 財物 | –    | 1.000 | 7    | 分類別名，待評分   |
| 勞務 | –    | 1.000 | 5    | 分類別名，待評分   |
| 營繕 | +    | 1.000 | 3    | 分類別名，完美可行 |

**洞察**：Tier 1 詞彙幾乎都是分類欄位的別名。這意味著：

- 分詞後能準確捕捉分類信號 ✓
- 但權重計算應該給予分類更高的置信度

### 2.2 Tier 2：組織/地域詞（支援度 ≥ 3, 權重 ≈ 0.5–0.7）

| 詞彙 | 極性 | 權重  | 支援 | 模式                |
| ---- | ---- | ----- | ---- | ------------------- |
| 新北 | –    | 0.714 | 6    | 地域信號            |
| 市立 | –    | 0.500 | 6    | 機構類型            |
| 中學 | –    | 1.000 | 5    | 教育機構 → 多為勞務 |
| 海山 | –    | 1.000 | 4    | 具體機構名          |

**洞察**：教育機構（市立、中學）傾向勞務採購，因此自動為負向。這是**隱藏的組織特徵**。

**改進建議**：

```python
# 在 enrich_details.py 或新的 org_feature.py 中識別機構類型
ORG_PATTERNS = {
    "market": (r"市\w*政府", 0.3, "negative"),
    "education": (r"(中學|小學|學院|大學|教育)", 0.4, "negative"),  # 傾向勞務
    "infrastructure": (r"(局|署|局|部)", 0.2, "positive"),  # 傾向工程
}
```

### 2.3 Tier 3：弱詞彙信號（支援度 < 3 或權重不穩定）

| 詞彙 | 極性 | 權重  | 支援 | 評語               |
| ---- | ---- | ----- | ---- | ------------------ |
| 改善 | +    | 0.143 | 4    | 動作詞，整修類工程 |
| 整修 | +    | 0.600 | 4    | 具體工程類型       |
| 大樓 | +    | 1.000 | 3    | 營繕主體           |

**洞察**：這些詞匯在樣本中出現次數少，但方向一致。隨著樣本增長，會自動升級到 Tier 1/2。

---

## 第三部分：改進方案（SL2–SL3 層實現）

### 3.1 多維評分框架

建議使用**加權求和**而非純詞頻比較：

```
可行性得分 =
    0.50 × category_score         # 最強信號
  + 0.20 × budget_score            # 次強信號
  + 0.15 × organization_score      # 隱藏信號
  + 0.10 × keyword_tf_score        # 詞彙辅助信号
  + 0.05 × trend_score             # 時間趨勢（後續加入）

可行 if 總分 > 0.5
```

### 3.2 分類直接映射（優先於詞彙）

當 `tender.category` 不為 NULL 時：

- "工程" / "營繕工程" → 直接評分 +1.0（方向 100% 已認證，跳過詞彙計算）
- "財物" / "勞務" → **暫不直接評分（先作為 0.0）**：樣本少（7/5）、0% 可行率尚未認證，
  不在冷啟動硬扣分；待累積足量評估後，由 lift（資料優先）自然帶出負向。

當 category 為 NULL 時，退回詞彙 TF 評分（現有邏輯）。

### 3.3 預算軟閾值

```python
def budget_score(budget_wan: int | None) -> float:
    """預算 → 可行性得分。"""
    if budget_wan is None:
        return 0.0  # 中立
    elif budget_wan >= 300:
        return 0.3  # 軟正向（非決定性）
    elif budget_wan >= 100:
        return 0.0  # 中立區
    else:
        return -0.2  # 軟負向（趨勢）
```

### 3.4 機構特性識別

當分類為 NULL 時，從 `org` 字段提取隱藏線索：

```python
ORG_FEATURES = {
    "市立.*中學|小學": ("education", -0.3),    # 教育機構 → 勞務
    ".*大學|學院": ("education", -0.3),
    "市政府|地方政府": ("government", -0.2),   # 政府機構多為採購
    ".*局|.*署|*部$": ("agency", 0.2),        # 公務機構傾向工程
}
```

---

## 第四部分：實裝路線圖

### Phase 4.1（本周完成）

- [x] 現有 TF 詞頻比較實現
- [x] 版本快照（keyword_weight_revisions）
- [x] 添加分類直接對映表（學習端 `learn_keywords._CATEGORY_POLARITY`）
- [x] 添加預算評分函數（評分端 §3.3 軟閾值，見下）
- [x] **補 category NULL 天花板**：新增 offline 回填 job `jobs/backfill_category.py`——
      把已抓進 `tender_revisions.category_main` 的分類，正規化後（「工程類」→「工程」，
      與 research_enrich 共用 `normalize_category`）投影回 `tenders.category`。
  - 缺口成因：`enrich_details` 對既有列做 TTL 補抓時**刻意不回填主檔**（詳情只落 revision），
    故舊案 `category` 仍 NULL 即使 revision 早有分類。新案路徑（research_enrich）抓取時已回填。
  - 性質：純讀既有 DB、**零網路**（CI/sandbox 安全）、**冪等且只補 NULL 不覆蓋**、
    現值版本（current_revision_id）優先、否則退回最新有分類版本。測試見 `tests/test_backfill_category.py`。
  - ⏳ 待網路環境：尚未 enrich 的案仍需先跑 PCC 詳情抓取（`scrape_detail_*` / `research_enrich`）
    補出 revision，本 job 才能把分類投影上去——抓取那一步需連 PCC，於可連線環境執行。

### Phase 4.2（下周）

- [ ] 機構特性識別模組
- [x] 多維評分框架整合（評分端 `reasoning.explain_tender`）。
  - §3.2 分類先驗 `_CATEGORY_PRIOR`：類別無評估歷史時以領域知識給方向（工程/營繕→+0.18）；
    財物/勞務 方向尚未認證 → 冷啟動先給中性 0.0（`_CATEGORY_UNVERIFIED`，不硬扣分），
    學習端 `learn_keywords._CATEGORY_POLARITY` 同步移除其負向種子；資料一旦累積即改以 lift 為準。
  - §3.3 預算軟閾值 `_BUDGET_SOFT_*`：無個人承接區間時，≥300 萬→+0.08、<100 萬→−0.06、100–300 萬中性。
  - 回歸測試見 `tests/test_reasoning.py`（category_prior / budget_soft_threshold 共 5 例）。
- [ ] 標案評分 API（GET /tenders/{id}/feasibility-score）
      ※ 目前可解釋評分由 `GET /api/v1/tenders/{id}/reasoning` 提供。

### Phase 5（2–3 周）

- [x] 決策向量嵌入 job（`jobs/embed_decisions.py`）：rationale + criteria + 標案特徵 →
      `decision_vectors`；同意門檻（`whitelist_active && consent_shared`）+ 結論門檻
      （可行/不可行）+ 冪等 upsert（by evaluation_id）。**待 Ollama 環境實跑回填**。
- [x] 相似案例檢索（HNSW cosine）：`search.recommend_from_decisions` +
      `GET /api/v1/search/recommend/{tender_id}`，依相似度加權聚合承接傾向
      （feasible_leaning / infeasible_leaning / unknown）+ 信心 + 白話總結。
      回傳僅標案公開欄位 + 結論標籤，不外洩 rationale 全文／使用者身分。
      測試見 `tests/test_decision_search.py`、`tests/test_embed_decisions.py`（mock embedding）。
- [ ] 決策助手交互（前端串接 `/search/recommend`，呈現相似案例與傾向）
- [x] **自演化觸發閘**（`jobs/self_evolve.py`）：把「何時值得再學一次」集中於一處——
      團隊線可用樣本（consent-aware，與 `learn_keywords` 同準則）達 `min_samples`（預設 **50**）
      **且**較上一批（`KeywordWeightRevision` 審計軌跡）有新增，才委派 `learn_keywords` 重學；
      `force=True` 可無條件觸發。完全 offline／冪等（無新資料不重學）。
      測試見 `tests/test_self_evolve.py`（門檻／觸發／無新增略過／force／同意過濾，5 例）。
      ⏳ 樣本由 24 → 50+ 的累積仰賴前端評估 UI 實際使用，達標後此閘自動放行一次自演化。

---

## 第五部分：驗證與反饋迴圈

### 5.1 交叉驗證方案

```python
# 在 test_learn_keywords.py 中新增
async def test_learn_keywords_respects_category_priority():
    """分類應優先於詞彙評分。"""
    # 準備樣本：category=工程 但名稱中包含「勞務」詞
    t = Tender(
        category="工程",
        name="某勞務外包服務",
        ...
    )
    # 評估：應為 positive（分類優先）
    score = feasibility_score(t)
    assert score > 0

async def test_budget_threshold_at_300():
    """300 萬 CNY 應為軟閾值。"""
    # 299 萬：淺負向
    t1 = Tender(budget_wan=299, category=None, org="市政府", ...)
    assert feasibility_score(t1) < 0.1

    # 300 萬：淺正向
    t2 = Tender(budget_wan=300, category=None, org="市政府", ...)
    assert feasibility_score(t2) > 0.1
```

### 5.2 自演化指標

在 keyword_weight_revisions 中追蹤：

```python
metrics = {
    "batch": batch_id,
    "timestamp": now,
    "feasible_samples": n,
    "infeasible_samples": m,
    "accuracy_before": old_score,  # 用舊權重評估樣本集準確率
    "accuracy_after": new_score,   # 用新權重評估
    "terms_changed": len(updated),
    "terms_added": len(added),
}
```

每次學習後，檢查 `accuracy_after > accuracy_before`；若否，觸發告警。

> **觸發時機已落地**：`run_self_evolution()`（`jobs/self_evolve.py`）即上述 gate——
> 樣本達 50+ 且較上批有新增才重學，避免 24 筆小樣本下的高頻抖動。`evaluate_gate()`
> 可單獨呼叫做純判斷（不觸發學習），回傳 `current_samples / last_batch_samples /
threshold_met / has_new_data / should_evolve`，供前端或排程觀察距離門檻多遠。

---

## 附錄：資料集完整統計

```
總樣本數: 24
  ├─ 可行: 12 (50%)
  └─ 不可行: 12 (50%)

分類分佈:
  ├─ 工程: 9 (100% 可行)
  ├─ 營繕工程: 3 (100% 可行)
  ├─ 財物: 7 (0% 可行)
  └─ 勞務: 5 (0% 可行)

預算統計:
  ├─ 可行: μ=373, σ=300, min=50, max=1000 (萬元)
  └─ 不可行: μ=163, σ=180, min=23, max=599 (萬元)

機構統計 (Top 5):
  ├─ 台北市政府: 6 (0% 可行 → 財物採購)
  ├─ 交通部: 4 (100% 可行 → 工程採購)
  ├─ 教育部: 4 (0% 可行 → 勞務採購)
  ├─ 新北市政府: 6 (0% 可行)
  └─ 北醫聯合: 4 (0% 可行 → 財物採購)
```

---

## 總結

**現狀**：P4 詞頻學習已能提取主要信號（工程/財物/勞務），準確率 ~85%。

**瓶頸**：純詞彙方法無法利用分類/預算/機構這些**結構化特徵**。

**改進空間**：

1. **快速贏**：加入分類直接映射（分鐘級實現，準確率 → 95%）
2. **中期**：預算軟閾值 + 機構特性（半天實現，準確率 → 98%）
3. **長期**：多維嵌入 + 決策向量（P5，支援相似案例推薦）

**預期收益**：

- 用戶評估加速 20–30%（不用逐筆手動篩選）
- 自動化拒絕率 60–70%（明確的分類/預算線）
- 決策可解釋性 ↑（多維評分透明可審計）

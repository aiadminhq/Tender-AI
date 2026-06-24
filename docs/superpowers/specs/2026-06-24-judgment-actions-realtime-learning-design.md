# 設計規格：標案判斷行為（✓/✗/⭐）＋原因表單＋即時 Layer B→C 學習

- 日期：2026-06-24
- 分支：`claude/busy-sagan-gm197s`
- 範圍：be（評估 API、即時學習）／fe（焦點列 enrich、清單三鈕、原因表單）／data（KeywordWeightRevision）／docs（治理＋記憶覆寫）

---

## 1. 目標（來自本人需求）

1. 今日焦點標案收合時呈現更多資訊。
2. 清單每一列**收合時就有** ✓/✗（與 ⭐）操作鈕。
3. 每個好／壞判斷後要填**大致原因**。
4. ✓/✗/⭐ 三者語意更明確、差異清楚。
5. 統一原則：每個 ✓/✗/⭐ 都要求填大致原因，計入 **Layer B**。
6. 若 AI 大腦可運作，**即時**把 Layer B 養分轉成 **Layer C**。
7. 判斷後**立即影響推播結果與演算法**。

## 2. 已拍板決策

- **三鈕語意（判斷三分）**
  - ✓ 可行：「這案可行／想投」(go) → `Evaluation.feasible=可行`，正向。
  - ✗ 不可行：「不適合／該避開」(no-go) → `Evaluation.feasible=不可行`，負向。
  - ⭐ 精選：「重點關注／標竿案例」（強正向＋可作學習範本，清單可置頂）→ `Evaluation.feasible=可行` ＋ `criteria.featured=true`，正向加權。
- **原因表單（chips＋選填文字）**：依極性給常見理由 chips（多選，存 `criteria`）＋一行選填自由文字（存 `rationale`）。選填、不強制擋送，但柔性鼓勵至少給一個訊號。
- **即時學習範圍（本人明確覆寫紅線）**
  - ✓/⭐ 正向：即時派生正向關鍵字 → 寫團隊 `keyword_weights`（append-only revision，consent-aware）→ 即時影響團隊推播。
  - ✗ 負向：**本人明確決定覆寫 `negative-keywords-human-only` 鐵則**，負向也**即時寫團隊負權重**（不再僅止於候選待審）。

### 2.1 紅線覆寫紀錄（重要）

- 原鐵則（記憶 `negative-keywords-human-only`、`docs/governance/04` 與 CLAUDE.md「AI 大腦決策原則」）：**系統不得自動寫入負權重**，負向只能列候選＋理由由人確認。
- 2026-06-24 本人（alex@hqdesign.tw，專案擁有者）在知情下（已兩次明確告知衝突與風險）決定**覆寫**：負向判斷即時寫入團隊負權重。
- 已告知風險：**單人誤判可能污染全團隊排序**。
- 安全網（仍保留，降低覆寫風險）：
  1. **append-only**：負權重一律寫 `KeywordWeightRevision` 審計批次，不就地覆蓋，可逐筆回溯／回退。
  2. **consent-aware**：只有 `whitelist_active && consent_shared` 的使用者其負向判斷才併入團隊線。
  3. **具名**：每筆 revision 記來源 user_id／批次時間，對外輸出去識別化。
  4. **可回退**：保留管理者一鍵停用／回退某批負權重的能力（沿用既有 revision 機制）。
- 同步動作：更新記憶 `negative-keywords-human-only` 與治理文件，註明此覆寫與生效日，避免往後 session 再衝突。

## 3. 後端設計

### 3.1 新增評估寫入 API

- `POST /api/v1/tenders/{id}/evaluate`
  - body：`user_id`、`feasible` ∈ {可行, 不可行}、`rationale?`（自由文字）、`criteria?`（JSON：選中的 chips、`featured?`）。
  - 行為：upsert `Evaluation`（Layer B，具名、consent-aware）；發 `event`（type=`judgment`，payload 記極性與 chips）。
  - 回傳：寫入結果 ＋ 即時學習摘要（本次新增／更新的關鍵字、是否影響團隊線）。
- schema：`app/schemas/behavior.py` 新增 `EvaluateRequest`；`EventType` 增 `judgment`。

### 3.2 即時學習路徑（新）

- 新增 `app/services/realtime_learn.py`（或在 `services/behavior.py` 內串）：單筆評估寫入後同步觸發：
  - **個人線**：即時更新該 user 的偏好（影響自己的推薦排序）。
  - **團隊線**（consent 通過時）：對該標案標題／關鍵欄位斷詞，依極性派生候選詞，寫入 `keyword_weights` 對應的 `KeywordWeightRevision`（`batch=now.isoformat()`，記 `feasible_samples`/`infeasible_samples`），正負皆即時寫入（負向因覆寫而即時）。
  - 冪等與防呆：批次抓取（embedding job）進行中時，遵守既有「先不向量化」原則；即時學習只動關鍵字權重，不觸發向量化。
- 推播即時反映：`services/push.py` / `reasoning.explain_tender` 已即時讀最新 `keyword_weights`，無需快取層即生效。

### 3.3 既有約束保留

- `learn_keywords.py` 批次與 `self_evolve` 閘（≥50＋有新增）維持不變，作為重算與校正；即時路徑為其增量補強，不取代。

## 4. 前端設計

### 4.1 今日焦點 enrich（`components/tenders/focus-row.tsx`）

- 收合列新增：機關、預算、類別、截止倒數（沿用 LabelTags／DaysLeft 既有元件，house style 不變）。
- 收合列加入 ✓/✗/⭐ 三鈕（目前焦點列無操作鈕）。

### 4.2 清單三鈕語意改造（`components/tenders/tender-row.tsx`）

- 既有 ⭐/✗/✓（收藏／略過／承接）改為「判斷三分」語意，串新的 `POST /evaluate`。
- 收合即顯示（桌機列／手機卡皆然，沿用既有位置）。

### 4.3 原因表單（新元件 `components/tenders/judgment-reason-popover.tsx`）

- 點任一鈕 → 彈出 popover：極性對應 chips（多選）＋一行選填文字 ＋ 送出。
- chips 文案 zh／en 成對，繁中預設，加入 `i18n/strings.ts`。
- 送出 → `lib/api.ts` 新增 `postEvaluate(id, {feasible, rationale, criteria})`（沿用 `withUser()` 注入 user_id、fire-and-forget＋樂觀更新）。

### 4.4 設計品味

- 依 House style：Noto Sans TC、16px 圓角、Bento、些微陰影；popover 輕量不阻擋。
- UI 產出後以 `impeccable`（product 模式）稽核打磨。

## 5. 資料流

```
使用者點 ✓/✗/⭐
  → popover 填 chips/理由
  → POST /tenders/{id}/evaluate (Layer B: Evaluation, 具名, consent-aware)
  → realtime_learn:
       個人線：即時更新 → 影響自己推薦
       團隊線(consent)：派生關鍵字 → KeywordWeightRevision(append-only) → keyword_weights
  → push/recommend 即時讀最新權重 → 立即影響推播
```

## 6. 測試

- be：`test_behavior`（evaluate 端點 happy/驗證）、`test_realtime_learn`（正向／負向即時寫 revision、consent 過濾、append-only、抓取中不向量化）。
- fe：型別＋build；瀏覽器驗證三鈕＋popover＋焦點列 enrich。

## 7. 不做（YAGNI）

- 不動他人並行的 auth／account／profile_consent 與 tender-drawer 可行性工作。
- 不重寫 scraper／批次學習主流程。
- 不加快取層（推播本就即時讀權重）。

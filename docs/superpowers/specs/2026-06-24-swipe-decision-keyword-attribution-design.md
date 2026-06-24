# 設計規格：速覽配對（Swipe）判斷原因表單＋關鍵字歸因＋確實入庫

- 日期：2026-06-24
- 分支：`claude/busy-sagan-gm197s`
- 範圍：be（關鍵字候選端點）／fe（速覽卡 enrich、判斷原因對話框、可選字／詞、awaitable 入庫）／docs（治理對齊）
- 對應頁面：`tender-ai-frontend/src/pages/swipe-page.tsx`（速覽配對）
- 與既有 `2026-06-24-judgment-actions-realtime-learning-design.md`（清單/焦點列）為**不同表面、不同語意**：本案**不覆寫**負分人工專屬紅線。

---

## 1. 目標（來自本人需求，A/B/C/D）

- **A**：速覽卡（收合時）呈現更多標案資訊（招標方式、地點、案號等）、命中關鍵字由 4 增為約 6。
- **B**：每次按 ✓（感興趣）／⭐（收藏）／✗（略過）時，跳出對話框輸入「保留原因」；行為事件在對話框關閉時**送出一次**。
- **C**：對話框內把相關關鍵字拆成**字（單字）**與**詞（斷詞）**並可選取，讓本人標註「因哪些關鍵字而做此判斷」，且**確實入庫**。
- **D**：入庫須 awaitable、有成功／失敗回饋（toast）。

## 2. 已拍板決策（/goal「ABCD都開發」＋ C 釐清）

- **每次都跳對話框，但可一鍵略過**（不強制填）。
- **後端中文斷詞＋單字，全部可選**（jieba，沿用 `tokenize_cn`）。
- **存 event ＋ 寫入學習關鍵字管線**（`POST /me/keywords`）。
- **C 紅線（關鍵）**：✗ 略過時，系統**可自動生成負分關鍵字推薦並預選**，但**唯有本人實際按下確認，才會真正歸屬為負分**（寫 `kind=negative`）。系統**不得**自動寫負權重。此即遵循、**非覆寫** `negative-keywords-human-only`（見記憶與 `docs/governance/04`；commit `7f56ff0` 已回歸人工專屬）。

## 3. 後端設計

### 3.1 新增關鍵字候選端點（唯讀、離線）

- `GET /api/v1/tenders/{tender_id}/keyword-candidates?user_id=`
  - 落在 `app/api/v1/reasoning.py`（無 prefix，與 `/tenders/{id}/reasoning` 並列）。
  - 服務：新增 `app/services/keyword_candidates.py`，沿用 `text_index.tokenize_cn`（jieba 離線 bundled dict）。
  - 回傳 `KeywordCandidatesOut`：
    - `tender_id`、`title`、`org`
    - `words`：jieba 斷詞（len≥2、保序去重），各帶 `in_title`。
    - `chars`：標題＋機關中的相異 CJK 單字（保序），各帶 `in_title`。
    - `positive_hits`：本人**學習正向詞** ∩ 本標案文字 → ✓/⭐ 時前端**預選**（正向可自動學）。
    - `recommended_negative`：取最新 `EvolutionLog.negative_candidates` 與本標案 tokens 的交集，**附 `lift`／`reason`** → ✗ 時前端**預選但需人按確認**（系統建議、非自動負分）。
  - schema：`app/schemas/reasoning.py` 新增 `KeywordToken`／`NegativeCandidate`／`KeywordCandidatesOut`。
  - 查無標案 → 404（`EntityNotFound`，沿用既有處理）。

### 3.2 入庫沿用既有端點（不新增 EventType、不覆寫紅線）

- 行為事件：沿用 `POST /events`，`type` 仍用既有封閉列舉（`view`／`click_link`），swipe 細節放 `payload`（`scope="swipe"`、`action`、`reason`、`selected_words`、`selected_chars`）。
- 關鍵字歸因：沿用 `POST /me/keywords`（`upsert_manual_keyword`）：
  - ✓/⭐：勾選詞以 `kind=positive, action=add` 寫入。
  - ✗：勾選詞以 `kind=negative, action=add` 寫入——**僅在本人對話框中確認送出**時才寫（人工專屬唯一合規路徑）。

## 4. 前端設計

### 4.1 速覽卡 enrich（`pages/swipe-page.tsx` 的 `SwipeCardFace`）

- 收合 fact grid 補：招標方式（`tenderMethod`）、地點（`city`）、案號（`caseNo`），沿用既有 `Fact` 樣式與 house style。
- 命中關鍵字 `hits` 由 `.slice(0,4)` 改為約 6。

### 4.2 判斷原因對話框（新元件 `components/swipe/swipe-decision-dialog.tsx`）

- 觸發：`commit(action)` 時先開對話框（fly-out 動畫延後到對話框關閉後），三動作皆然；可一鍵略過。
- 內容：原因 textarea（選填）＋ C 的字／詞可選 chips（分「詞」「字」兩區）。
  - ✓/⭐：`positive_hits` 預選為正向。
  - ✗：`recommended_negative` 預選並標示「系統建議·需你確認」徽記＋ hover 顯示理由。
- 關閉行為：
  - **確認**：awaitable 寫 `POST /me/keywords`（每個選中詞）＋送一次 `POST /events`；成功 toast「已記錄」、失敗 toast「記錄失敗，可重試」；完成後才執行原 accept/save/pass 副作用與 fly-out。
  - **略過**：仍送一次 `POST /events`（payload 記 `reason=null, selected=[]`），不寫關鍵字；執行副作用與 fly-out。

### 4.3 awaitable 入庫（D，`lib/`）

- `lib/events.ts` 增 awaitable 變體（回傳 `Promise<boolean>`，不吞錯給呼叫端判斷成功與否）；既有 fire-and-forget `trackEvent` 保留。
- `lib/api.ts` 既有 `postKeywordOverride(term, kind, action, signal?)` 直接重用（會 throw，利於成功／失敗判斷）。

### 4.4 設計品味

- House style：Noto Sans TC、16px 圓角、Bento、些微陰影；對話框輕量、可鍵盤操作（Esc 略過、Enter 確認）。
- i18n：所有新文案 zh／en 成對加入 `i18n/strings.ts`，繁中預設。
- UI 產出後以 `impeccable`（product 模式）稽核打磨。

## 5. 資料流

```
使用者按 ✓/⭐/✗
  → 開對話框（GET keyword-candidates 取字/詞＋預選）
  → 填原因（選填）＋勾選關鍵字（✗ 的負分候選預選但需確認）
  → 確認：
       for each 選中詞 → POST /me/keywords（✓/⭐: positive；✗: negative，人工確認）
       POST /events（payload: scope=swipe, action, reason, selected_*）
       成功/失敗 toast → 執行 accept/save/pass 副作用 + fly-out
  → 略過：POST /events（空原因/空選取）→ 副作用 + fly-out
```

## 6. 測試

- be：`test_keyword_candidates`（回應結構：words/chars/positive_hits；**紅線保證 recommended_negative 僅為建議、附 reason、端點本身不寫任何負權重**；404）。
- be：沿用 `test_behavior`／`me/keywords` 既有測試確認 upsert 行為不變。
- fe：型別＋build；瀏覽器驗證卡片 enrich、對話框三動作、字/詞可選、入庫 toast。

## 7. 不做（YAGNI）

- 不新增後端 EventType（封閉列舉，細節進 payload）。
- 不覆寫負分人工專屬紅線（與清單/焦點列 spec 的即時負權重決策不同）。
- 不重寫 scraper／批次學習主流程／向量化。

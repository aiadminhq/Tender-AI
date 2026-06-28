# 標案評分管理／決策回顧（Decision Review）設計

> 日期：2026-06-24 · 分支：`claude/busy-sagan-gm197s`
> 需求單一句話：戰情總覽／標案清單／速覽配對等頁面，按完 ⭐／✓／✗ 之後，要能 (1) 去規則設定，(2) 進一個「行為**之後**」的標案評分管理系統，重新檢視自己存留／淘汰的標案。

> **狀態（2026-06-25 補注）**：✅ 已實作（2026-06-24）。決策回顧頁 `/decisions`、唯讀端點 `GET /me/tender-decisions`（由 Layer B 行為訊號重建）、規則頁「建議迴避字根」唯讀端點 `GET /me/abandoned-keyword-candidates`（不寫權重，需本人按「加入迴避」走 `POST /me/keywords` kind=negative）。對應 commit `284e6dd`、`99fb5ec`、`ab217ea`、`61044ba`。
> 本規格為設計當時記錄，內文不再回改；最新行為以程式碼與 `docs/governance/05-進度與白話術語.md` 進度表為準。

---

## 0. 三個已拍板的決定（本計畫的邊界）

| 面向       | 拍板答案                                | 對計畫的影響                                                                                                          |
| ---------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 後端範圍   | **前後端一起**                          | 新增 `GET /me/tender-decisions` 聚合端點＋前端接線；DB 相關部分需在「連得到 DB」的環境驗證（雲端連不到，僅能 mock）。 |
| 規則連動   | **強化自動拆解字根 + tag 加速操作體驗** | 跨「已淘汰」標案聚合斷詞（jieba 詞 ＋ CJK 字 ＋ 視情況 2-gram 字根），算出**候選迴避詞 tag**，一鍵交人確認。          |
| 可執行動作 | **可重新分流（建議）**                  | 撤銷淘汰、在 收藏／承接／淘汰 之間移動、補具名淘汰理由並寫回狀態。                                                    |

> 紅線（最高優先，不得違反）：**負分關鍵字只能由人確認才生效**。系統可自動「算出候選＋附理由＋預選」，但唯有本人按下確認，才會經既有 `postKeywordOverride(term,"negative","add")` → `POST /me/keywords` 歸入負向偏好。系統永不自動寫負權重。`財物`／`勞務` 維持中性 `0.0`。（見記憶 `negative-keywords-human-only`）

---

## 1. 現況盤點（為何要建這個，缺口在哪）

### 1.1 已有、要「重用」的東西（不要重造）

- **`SwipeDecisionDialog`**（`src/components/swipe/swipe-decision-dialog.tsx`）：已把候選詞拆「詞（jieba）／字（CJK）」成可選 `KwChip`，pass 預選 `recommendedNegative`、確認才 `postKeywordOverride(negative)`。紅線已落地。→ 決策回顧頁的「候選 tag」UX 直接沿用這套元件與資料流。
- **後端 per-tender 候選**：`app/services/keyword_candidates.py` → `GET /tenders/{id}/keyword-candidates`，回 `{words, chars, positiveHits, recommendedNegative}`。
- **`app/jobs/learn_keywords.py`** 的 `_tokenize_cn()`（jieba，離線、bundled dict）、負向候選 TF-lift 計算、`EvolutionLog.negative_candidates`（JSONB, append-only）。
- **前端評分狀態**（`src/store/app-data.tsx`）：`starred`／`skipped` 兩個 localStorage Set；`accept()` 另建 KanbanCard(todo)＋TenderProject(watching)。
- 可重用 UI：`Badge`/`TierBadge`、`detail-bits`（`Fact`/`MeterRow`/`SimilarCasesList`/`CAT_ICON`）、`KwChip`。

### 1.2 缺口（要新增/補的）

| #   | 缺口                                                                                                               | 位置                      |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| G1  | 沒有「決策回顧」頁與路由／導覽入口                                                                                 | 前端 routes / nav         |
| G2  | `app-data` 沒有 `isSkipped`/`isAccepted` getter、沒有「重新分流」方法、沒有淘汰理由儲存                            | `src/store/app-data.tsx`  |
| G3  | 速覽左滑「略過」**刻意不寫入 `skipped`**（`swipe-page.tsx:304` 訊號式、永不刪除/隱藏）→ 被淘汰的卡不會出現在回顧頁 | `swipe-page.tsx`          |
| G4  | 沒有聚合端點：把「目前使用者所有決策」一次撈回                                                                     | 後端 `me.py`              |
| G5  | 沒有「跨已淘汰標案」的聚合字根候選端點（規則連動的核心）                                                           | 後端新 service + 端點     |
| G6  | 規則設定的 avoid 詞目前只存 localStorage，沒走 `postKeywordOverride` 寫回後端                                      | `rules` workspace（既有） |

---

## 2. 架構設計

### 2.1 狀態模型（單一事實來源：app-data）

把「一個標案目前的處置」收斂成一個衍生狀態，避免 starred/skipped/accepted 三個 Set 各說各話：

```
disposition(id) =
  accepted  (有 KanbanCard 或 TenderProject)  ← 優先級最高
  | starred (在 starred Set)
  | skipped (在 skipped Set)
  | none
```

桶（bucket）對應白話：

- **存留**：`accepted`（已承接）＋ `starred`（收藏）
- **淘汰**：`skipped`
- 一張卡可同時 starred＋accepted；回顧頁以「承接 > 收藏」歸主桶，但仍標出它也被收藏。

#### app-data 新增 API（G2）

```ts
// getters
isSkipped(id): boolean
isAccepted(id): boolean            // 有 kanbanCard 或 project 指向此 tenderId
dispositionOf(id): "accepted" | "starred" | "skipped" | "none"

// 重新分流（可重新分流＝建議）——單一入口，自動清掉互斥狀態
reclassify(id, to: "accepted" | "starred" | "skipped" | "none", opts?: { reason?: string }): void
//  to=accepted → 從 skipped 移除、建/復用 KanbanCard+Project（重用既有 accept 內部邏輯）
//  to=starred  → 從 skipped 移除、加入 starred
//  to=skipped  → 加入 skipped、寫 discardReason（具名＋時戳）、postAccept "放棄"
//  to=none     → 從三者移除（撤銷淘汰/取消收藏的中性化）

// 具名淘汰理由（Layer B：依登入帳號具名）
discardReasonOf(id): { reason: string; by: string; at: string } | null
setDiscardReason(id, reason): void   // by=currentMember, at=now
```

- 持久化：沿用既有 localStorage 模式，新增 `tender:discard-reason`（`Record<id,{reason,by,at}>`）。
- `reclassify` 內部**復用**既有 `accept`/`skip`/`toggleStar`/`postAccept`，不另起 API 寫法。

### 2.2 速覽左滑的處置（G3）— 推薦做法

衝突：既有設計「左滑＝只發訊號、永不刪除/隱藏」，但回顧頁需要看得到被淘汰的標案。

**推薦解法（保留誠實、又可回顧）：**

- **一鍵略過**（`handleSkip`）維持原樣：只送訊號、**不**寫處置（誠實，不假裝你做了決定）。
- **確認並記錄**（`handleConfirm`, action=pass）時：除了既有寫關鍵字＋事件，**額外呼叫 `reclassify(id,"skipped",{reason})`** 把它正式記成「淘汰」＋具名理由。
- 速覽卡片本身用 cursor 前進，不依賴 `skipped` Set，所以寫入不影響滑卡 UX；也不會「隱藏」原始標案（清單/總覽是否過濾 skipped 另見 §2.5）。

> 效果：**刻意按下確認**的淘汰才進回顧頁；隨手略過不留痕。符合「行為之後再檢視」的語意。

### 2.3 後端：聚合決策端點（G4）

`GET /me/tender-decisions`（personal-line，本人資料、免 consent）

- query：`?status=&saved=&star=`（可選過濾）
- 來源：`TenderUserState`（saved/status/star/updated_at）＋ `Annotation`（理由/筆記）join 公開 `Tender`（Layer A 欄位）。
- 回傳（去識別化 N/A，這是本人看本人）：
  ```json
  { "items": [ { "tenderId","title","org","category","budget","deadline",
                 "disposition":"accepted|starred|skipped",
                 "status":"觀望|備標中|...","reason":"...","updatedAt":"..." } ],
    "counts": { "accepted":n, "starred":n, "skipped":n } }
  ```
- 前端 `src/lib/api.ts` 加 `fetchUserDecisions(filter?)`；**需 DB 環境驗證**（雲端不行）。
- 前端離線/連不到時 fallback：用 app-data 的本地狀態渲染（與既有 mock 策略一致）。

### 2.4 後端：跨淘汰標案的聚合字根候選（G5）— 規則連動核心

新 service `app/services/abandoned_keywords.py` + 端點 `GET /me/abandoned-keyword-candidates`：

1. 取本人 `skipped`／status=放棄 的標案集合（Layer A 文字：title＋org＋摘要）。
2. **強化字根拆解**：
   - `_tokenize_cn()` jieba 詞（既有）
   - CJK 單字（既有 `_CJK`）
   - **新增 2-gram 字根**：對標題連續 CJK 做 bi-gram（如「外牆」「牆防」…），補 jieba 漏切的複合詞根；len≥2、過濾停用字。
3. 統計：每個候選的**支持度**（出現在幾件被淘汰標案）＋交叉比對 `EvolutionLog.negative_candidates` 的 lift。
4. 回傳排序候選 `[{term, kind:"word|char|bigram", support, lift?, reason}]`，附人話理由（「在你淘汰的 7 件中出現 5 件」）。
5. **紅線**：此端點**只回候選**，不寫任何權重。寫入仍只能由人在 UI 按確認 → `postKeywordOverride(term,"negative","add")`。

> bi-gram 屬離線純函式，可加 `tender-ai-backend/tests/` 單元測試（不需 DB）。

### 2.5 清單/總覽是否過濾 skipped（需確認的小決策）

- 若現況清單會把 `skipped` 過濾掉：維持，淘汰的標案天然「沉到」回顧頁，符合語意。
- 若不過濾：在回顧頁用 disposition 分桶即可，無需改清單。
- **動作**：實作前用一次 grep 確認 `filteredTenders` 是否引用 `skipped`，再決定（不預改清單行為）。

---

## 3. 前端頁面設計（G1）

新頁 `src/pages/decision-review-page.tsx`，路由 `/decisions`，導覽加「決策回顧」項。

### 3.1 版面（House style：Bento、16px 圓角、單一 signal accent、類別以 icon 形狀區分）

```
┌───────────────────────────────────────────────┐
│ 決策回顧            [前往規則設定 →]   ← 入口(需求(1)) │
│ 概況列：存留 12 · 收藏 8 · 承接 4 · 淘汰 9       │ ← counts
├───────────────────────────────────────────────┤
│ Tabs: [全部] [存留] [收藏] [承接] [淘汰]         │
├───────────────────────────────────────────────┤
│ ┌── 標案列 (重用 detail-bits) ───────────────┐  │
│ │ [類別icon] 標題  機關  預算  截止  狀態badge │  │
│ │ 淘汰理由：⋯(具名 by Alex)                    │  │
│ │ [撤銷淘汰] [→收藏] [→承接] [補理由] [開詳情]  │  │ ← 重新分流(需求(3))
│ └──────────────────────────────────────────┘  │
├───────────────────────────────────────────────┤
│ ▸ 從你淘汰的標案，建議的迴避字根 (需求(2))        │
│   [外牆×5] [泥作×4] [景觀×3] ⋯ 可多選           │ ← 重用 KwChip + abandoned-candidates
│   [一鍵加入規則的迴避清單（需你確認）]            │ → postKeywordOverride(negative)
└───────────────────────────────────────────────┘
```

### 3.2 連到規則設定（需求 (1)）

- 頁首「前往規則設定 →」連到既有 rules 路由。
- 底部「建議迴避字根」區塊 = 規則連動的具體落點：候選 tag 一鍵交人確認後寫回 avoid 規則（同時補 G6：rules avoid 寫回後端）。

### 3.3 重新分流互動（需求 (3)）

- 每列動作呼叫 `reclassify(...)`；樂觀更新 + 失敗回滾（無 toast 系統 → 就地狀態，比照 SwipeDecisionDialog）。
- 「補理由」開小對話框（可直接重用/精簡 `SwipeDecisionDialog` 的 reason+KwChip 區塊）。
- 撤銷淘汰 = `reclassify(id,"none")`。

---

## 4. Layer B / 合規（PR 必寫三件事）

- **① 同意基礎**：決策回顧讀寫的是**本人**行為（personal-line），本人看本人免額外 consent；只有進入「團隊共享知識庫」才受 `whitelist_active && consent_shared` 閘控（本功能不放寬該閘）。
- **② 共享範圍**：淘汰理由／具名標示僅在 @hqdesign.tw 白名單內可見；對外永不揭露。
- **③ 對外隔離**：行為資料不進公開版控／GitHub Pages；任何匯出去識別化。
- 紅線重申：迴避字根候選自動產生，**負分歸屬只在人按確認後**。

---

## 5. i18n（zh 預設，zh/en 成對）

新增鍵（範例）：`navDecisionReview`、`decisionReviewTitle`、`decisionGotoRules`、`decisionBucketKept/Starred/Accepted/Skipped`、`decisionUndoSkip`、`decisionMoveToStar/Accept`、`decisionAddReason`、`decisionReasonBy`、`abandonedKwTitle`、`abandonedKwHint`、`abandonedKwConfirm`、`abandonedKwSupport`（「在 {n} 件中出現」）。

---

## 6. 分階段實作（建議順序，可逐段 commit）

| Phase                      | 內容                                                                                                                                                                                        | 可在雲端驗證？                  | 驗證                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------- |
| **P0**                     | grep 確認清單是否過濾 skipped（§2.5）；定案 disposition 規則                                                                                                                                | ✅                              | 讀碼                                                        |
| **P1（前端核心，全可驗）** | app-data 新增 getter/`reclassify`/discardReason（G2）＋ `decision-review-page` ＋ 路由/導覽（G1）＋ i18n。fetchUserDecisions 先用本地狀態 fallback。                                        | ✅                              | `npx tsc -b` + `npx vitest run`（於 `tender-ai-frontend/`） |
| **P2（速覽接線）**         | confirm-pass 額外 `reclassify(skipped)`（G3）；補理由對話框重用                                                                                                                             | ✅                              | tsc + vitest + 手動滑卡                                     |
| **P3（規則連動）**         | 後端 `abandoned_keywords.py`＋`GET /me/abandoned-keyword-candidates`（含 2-gram 純函式測試）；前端「建議迴避字根」區塊接線、一鍵 `postKeywordOverride(negative)`；補 G6（rules avoid 寫回） | bi-gram 純函式 ✅；端點需 DB ⚠️ | pytest（純函式）＋ DB 環境整合測                            |
| **P4（聚合端點）**         | 後端 `GET /me/tender-decisions`（G4）＋前端 `fetchUserDecisions` 換真資料                                                                                                                   | ⚠️ 需 DB                        | DB 環境整合測                                               |

> 雲端（此環境）連不到 DB/PCC/Ollama：**P1、P2、P3 的純函式**可完整驗證；**P3 端點、P4** 標記為「待 DB 環境驗證」，不在雲端宣稱通過。

---

## 7. 風險 / 未決

1. **清單過濾行為**（§2.5）— 實作前 grep 定案，避免誤改既有 deck/list。
2. **accept 的反向移動**：把「已承接」移回淘汰時，KanbanCard/Project 怎麼處理？建議 MVP：軟移動（保留卡片、僅改 disposition 與狀態為放棄），並在 PR 註明，避免破壞看板既有資料。
3. **2-gram 噪音**：bi-gram 會產生較多雜訊候選 → 用支持度門檻（出現 ≥2 件）＋ lift 排序過濾，且永遠只是「候選」。
4. **端點命名一致性**：`/me/tender-decisions` vs 既有 `/me/keywords` 風格需對齊現有 `me.py` 路由慣例（實作時對照）。

---

## 8. 一句話總結

P1 先把「決策回顧頁＋可重新分流＋具名理由」這條**前端全可驗**的主幹做起來（含規則設定入口），P2 把速覽的確認淘汰接進來，P3 加「跨淘汰標案的字根候選 tag → 人確認才寫負分」，P4 補真資料聚合端點。全程守住「負分只由人確認」的紅線與 Layer B 邊界。

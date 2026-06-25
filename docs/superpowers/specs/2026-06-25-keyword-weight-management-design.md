---
狀態：設計已核可（口頭），實作中
日期：2026-06-25
分支：claude/busy-sagan-gm197s
功能代號：規則頁升級 → 「關鍵字與權重」管理頁（取代 /rules）
作者：Claude（與 alex@hqdesign.tw 腦力激盪）
---

# 關鍵字與權重管理頁（取代「規則設定」）

## 1. 目標與背景

把現有 `/rules`「規則設定」頁，升級成一個**可操作的「關鍵字與權重」管理頁**：

1. 使用者在**任何頁面選取文字**，彈窗點「加入偏好關鍵字 / 加入迴避關鍵字」後，
   關鍵字能**順利回流**到這一頁、並反映在清單中。（選字彈窗本身已於 `ac631db` 落地，
   回流目標即本頁的三份本地清單。）
2. 本頁提供**詳細的關鍵字與權重排列管理**：除了人工三清單，還要能**檢視系統「學到」的
   權重排序**與**各維度（類別／縣市／來源）的傾向強弱**，並可把學到的詞**一鍵採納**進
   人工清單。

> 這是把先前核可的設計 mockup 轉為真實、接真端點、可操作的頁面。

## 2. 關鍵資料約束（決定整頁呈現方式）

盤點後端後確認：**後端沒有「每個關鍵字的絕對數值權重」GET 端點**。可用的真實資料只有：

| 來源               | 端點 / 機制                                                     | 內容                                                                                                                                                                                       | 是否帶數字                                   |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| 團隊學到的判準輪廓 | `fetchReasoningProfile()` → `GET /reasoning/profile`            | `topKeywordsPositive/Negative`（**已依權重排序的字串陣列**）、`categorySignals/citySignals/sourceSignals`、`budgetFeasibleMin/Median/Max`、`confidence`、`nEvaluations/nEvents`、`summary` | 關鍵字**無數字**；維度 signal **有**真實數字 |
| 維度 signal        | 同上 `CategorySignal`                                           | `value, pFeasible, lift, support, feasible, infeasible`（`lift = 可行機率 − 基準可行率`）                                                                                                  | **有真實數字**                               |
| 人工三清單         | `useAppData()` + localStorage（`rules:focus/avoid/hard`）       | 使用者本人維護的重點／避免／硬排除詞                                                                                                                                                       | 無權重（清單）                               |
| 建議迴避字根       | `fetchAbandonedKeywordCandidates()`                             | 由本人實際淘汰標題聚出的候選詞 + 出現次數                                                                                                                                                  | 有次數                                       |
| 寫入路徑           | `postKeywordOverride(term, kind, action)` → `POST /me/keywords` | `kind ∈ {positive, negative, engaged}`；回傳合併後輪廓                                                                                                                                     | —                                            |

**設計決策（已拍板）**：採**前端組合既有真端點**，不新增後端端點、不捏造數值。權重一律以
**真實資訊**呈現：

- 關鍵字 → 以**真實排名**（後端已按權重排序）+ rank 推導的**相對強度條**呈現，且**明確標示
  為「相對強度／排名」而非絕對分數**。不顯示任何虛構的「87 分」式數字。
- 維度傾向 → 以 `CategorySignal` 的**真實 lift** 畫**雙向（diverging）長條**（右正左負），
  附 `pFeasible%` 與 `support` 樣本數。
- 預算 → 真實 `min–median–max`。
- 信心度／樣本數 → 真實 `confidence` + `nEvaluations/nEvents`。

理由：① 後端確無每詞數值權重；② 雲端環境連不到 `learn_keywords`／Ollama，無法驗證任何捏造值；
③ 資料誠實是本專案價值；④ 對「只為了好看」的新後端端點採 YAGNI。

## 3. 治理紅線（必須維持，逐條對齊）

- **負分人工專屬**：學到的「迴避關鍵字」只是**團隊已學到的負向候選**；唯有使用者本人按
  「加入避免」才會經 `postKeywordOverride(term,"negative","add")` 真正歸負分並落本地 avoid 清單。
  本頁**不**自動把任何詞寫成負分。（沿用 `AbandonedRoots` 既有合規路徑。）
- **append-only / consent-aware**：所有寫入走既有 `postKeywordOverride`（後端已是 append-only
  審計、僅納入 `whitelist_active && consent_shared`）。本頁不繞過、不改動該機制。
- **Layer B 邊界**：`/reasoning/profile` 回傳的是**去識別化的聚合結果**（無個別評語原文／人名）。
  本頁只呈現這些聚合值；不顯示任何個人層級行為明細，符合「合作範圍內共享、對外永不揭露」。
- **具名共享**：學到的權重是白名單團隊線的共享結果，本頁以「團隊已學到」語意呈現（不偽裝成
  個人私有，也不外流）。

## 4. 頁面結構（Bento，取代 RulesPanel 既有內容並擴充）

頁面骨架不變：`RulesPage = <PageHeader title=關鍵字與權重 /> + <RulesPanel />`。
`RulesPanel` 由上而下：

1. **提示列 + 進階編輯**（沿用）：`Alert(rulesHint)` + 「進階編輯」Dialog(`RulesWorkspace`)。
2. **我的關鍵字規則**（沿用，可操作核心）：三張 `KeywordEditor` 卡——
   重點(focus, signal/加權)、避免(avoid, mid/降權)、硬排除(hard, danger/自動剔除)。
   這是「選字彈窗回流」的落點，維持原樣。
3. **學到的權重排序**（新增 `LearnedWeights`）：
   - 頂部：信心度 Badge + `nEvaluations 依據評估 · nEvents 互動事件` + 一句 `summary`。
   - 兩欄排序清單：**偏好（加權）** / **迴避（降權）**。每列 = `#rank` + 詞 +
     相對強度條（依 rank 線性遞減，末位仍留可見細條）+ 動作鈕：
     - 偏好：「加入重點」→ `postKeywordOverride(term,"positive","add")` + `addKeywords("focus",[term])`
     - 迴避：「加入避免」→ `postKeywordOverride(term,"negative","add")` + `addKeywords("avoid",[term])`（紅線合規）
     - 已在對應本地清單者顯示「已在清單」、不可重複加。
   - 明確副標：「依權重高低排序（相對強度，非絕對分數）」。
4. **各維度傾向**（`LearnedWeights` 內）：類別／縣市／來源三組**雙向 lift 長條**
   （每組取 |lift| 前 6），每列 = 取值 + diverging bar（右正 tier-high／左負 tier-low，
   寬度 = |lift| / 該維度 maxAbs）+ `pFeasible%` + `support 樣本`。某維度無資料則不顯示。
5. **預算可行區間**（`LearnedWeights` 內）：`min–median–max`（沿用 `reasoningBudgetRange` 文案）。
6. **建議迴避字根**（沿用 `AbandonedRoots`）。

退化行為：`fetchReasoningProfile()` 回 `null`（後端不可達／離線）→ `LearnedWeights` 顯示
精簡提示（`lwUnavailable`），**不阻斷**頁面其他功能；資料不足（樣本太少）→ `lwEmpty` 引導。

## 5. 元件與檔案

| 動作 | 檔案                                                                                 | 說明                                                                                           |
| ---- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 新增 | `src/components/rules/learned-weights.tsx`                                           | 抓 profile + 排序清單 + 維度 bar + 預算；含本檔內小元件 `RankRow`／`SignalBars`                |
| 修改 | `src/components/rules/rules-panel.tsx`                                               | 三編輯器與 `AbandonedRoots` 之間插入 `<LearnedWeights />`，並為「我的關鍵字規則」加分區標題    |
| 修改 | `src/i18n/strings.ts`                                                                | 重新命名 `navRules`/`rulesSub` 反映新身分；新增 `lw*` 與 `rulesMyKeywords` 等成對（zh/en）文案 |
| 沿用 | `keyword-editor.tsx`／`abandoned-roots.tsx`／`rules-workspace.tsx`／`rules-page.tsx` | 不改邏輯                                                                                       |

`LearnedWeights` 為**純內容元件、無 props**（與 `AbandonedRoots` 一致）：自抓 `fetchReasoningProfile`、
經 `useAppData()` 取本地清單與 `addKeywords`、用 `postKeywordOverride` 寫入。視覺語言沿用
`reasoning-panel.tsx`（tier-high/mid/low、signal、confidence Badge、tnum 等位字）。

## 6. House style / i18n

- 繁中 Noto Sans TC；數字 tnum；16px 圓角；Bento 卡片；僅些微陰影；lucide-react 圖示。
- 新文案 zh/en 成對，繁中預設。
- 互動鈕 idle/saving/done/error 狀態與 `AbandonedRoots` 一致。

## 7. 驗證

- vite dev `@5173` preview：頁面渲染、三清單可增刪、學到排序兩欄顯示、維度 diverging bar 正確
  （後端可達時有真實值；不可達時顯示 `lwUnavailable` 不崩）、「加入重點／避免」後對應本地清單更新且
  按鈕轉「已在清單」。
- 不新增後端端點、不動學習 job；前端型別 `pnpm build`/tsc 綠。

## 8. 非目標（YAGNI）

- 不做每關鍵字絕對數值權重（後端不存在、無法驗證）。
- 不新增後端端點。
- 不做拖曳排序（排序由系統學習決定，人工只能採納／移除，不手動排名）。

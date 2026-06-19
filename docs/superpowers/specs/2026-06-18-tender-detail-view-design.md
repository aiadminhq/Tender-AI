# Tender AI — 標案詳情視圖大改版（Phase 1，純前端）

> 日期：2026-06-18 ｜ 狀態：設計定版（待 writing-plans）
> 範圍決策：**純前端**。後端零變更（不碰 scraper、不改 schema）。
> 後端尚未吐出的欄位一律以「待補」佔位呈現，待後續獨立 ticket 補。

## 1. 背景與目標

現行標案詳情是窄版 `Dialog` 單欄堆疊（`tender-drawer.tsx`），欄位稀少。
使用者要求把它升級為**資訊豐富的寬版雙欄詳情**：完整欄位、可解釋的可行性
分數、關鍵匹配、行動鈕（承接/儲存/轉發/評價/註記/意義標籤）、以及更強的
排序與篩選。

本期（Phase 1）只做**前端**：重排版面、即時計算可行性與關鍵命中、接既有
後端寫入端點。需要後端額外吐資料的欄位（履約地點、資格摘要、附件、可見
註記、評價理由入 RAG、tag 權重後台）一律以「待補」佔位，介面預留，等後續
ticket 上線後自動填。

### 非目標（本期不做，列後續 ticket）

- 後端序列化加法（吐 revision 欄位、/rate 收 rationale、詳情帶 annotations）。
- 惠強辦公室距離／油資（geocoding）。
- RAG 相似歷史案實算（bge-m3 未安裝）。
- 多人「真正可見」的社群層（綁登入）。
- tag 權重後台（-10~10 推薦演算法）。

## 2. 既有約束（沿用，不違反）

- 不引入 Radix；沿用自寫 UI primitive（`Dialog`/`Badge`/`Button`/`Input`）。
- 前端目錄非 git repo → 原地編輯，不能 worktree 隔離。
- i18n `strings.ts` 為 `as const`，zh/en 必須成對加 key，否則 `TextKey` 編譯失敗。
- 後端寫入皆 fire-and-forget；localStorage 仍是前端真相來源，寫入失敗不影響 UI。
- 不碰 scraper／`tables[4]`／SkipSSLAdapter。

## 3. 架構與版面

把 `tender-drawer.tsx` 的窄版內容改為**寬版雙欄**（沿用既有 `Dialog`，
`max-w-5xl`；手機 `max-w-[95vw]` 退回單欄堆疊）。

```
┌─ Dialog ──────────────────────────────────────────────┐
│ 標題：標案名稱（line-clamp-2）                          │
│ 標籤列：來源(PCC/TMU) · 類別色標(工程/勞務/財物) · 城市  │
│         + 可行性分數徽章 + ⭐儲存                         │
├──────────────────────┬────────────────────────────────┤
│ 左欄（主資訊 2/3）     │ 右欄（行動 + 社群 1/3）           │
│ · 剩餘天數警示條       │ · 承接 / 略過                    │
│ · 可行性進度條+tooltip │ · ⭐儲存（公開/私人 toggle 佔位） │
│ · 事實格：機關/聯絡人  │ · 轉發（/share）                 │
│   /預算/截止ROC+ISO/   │ · 評價（5★，理由欄＝本地佔位）    │
│   招標方式/採購性質/案號│ · 意義標籤（前端命中 chip）       │
│ · 關鍵匹配（命中數+chip）│ · 註記（localStorage，顯示使用者）│
│ · 額外詳情（待補佔位：  │                                  │
│   履約地點/資格/附件）   │                                  │
│ · RAG 相似案（待補佔位）│                                  │
└──────────────────────┴────────────────────────────────┘
```

### 共用元件（`detail-bits.tsx` 擴充）

- 既有：`Fact` / `MeterRow` / `SectionLabel`（保留）。
- 新增：`LabelTags`（來源+類別色標+城市）、`FeasibilityBadge`（分數徽章+
  tooltip 拆解）、`DaysLeftBanner`（<7 天紅色警示）、`PlaceholderBlock`
  （「待補」佔位，附說明此欄位待後端 ticket）、`RatingStars`（5★ 可點）。

## 4. 可行性分數（前端啟發式，可解釋）

新增 `src/lib/feasibility.ts`，純函式 `computeFeasibility(tender, rules) →
{ score: number; breakdown: { label: string; delta: number }[] }`。

公式（0–100，clamp）：

```
+ 關鍵字命中：focus 規則 + 內建室內裝修詞庫（整修/教室/空間改善/防水/室內/
              裝修/修繕/拆除）逐詞比對 title+org，每命中 +8
+ 類別匹配：works +20 / goods +8 / services +4
+ 預算適配：落在 (0, 5000萬] 甜蜜區 +15；過大遞減
+ 截止適配：剩餘 >14 天 +10；7–14 天 +4；<7 天 −8
− 硬排除命中 → 直接壓到 ≤30
```

- tooltip 列出每項加減與總分（例：`+整修(8) +工程(20) +預算(15) −截止近(8) = 73`）。
- 命中字現以**前端即時計算**（live `tags` 目前為空），不依賴後端。
- RAG 上線後把「室內裝修匹配度/歷史相似案」併入 breakdown，介面不變。

## 5. 關鍵匹配 / 意義標籤（前端即時計算）

新增 `src/lib/keyword-hits.ts`：以 localStorage 的 focus 規則 + 內建詞庫
比對 `title+org`，回傳命中詞陣列。詳情顯示「命中 N 個」+ chip 列。
與可行性共用同一比對來源（避免兩處邏輯分歧）。

## 6. 行動鈕接線

| 鈕       | 端點                        | 本期做法                                                                                |
| -------- | --------------------------- | --------------------------------------------------------------------------------------- |
| 承接     | `POST /accept`（備標中）    | 已接，沿用                                                                              |
| 略過     | `POST /accept`（放棄）      | 已接，沿用                                                                              |
| ⭐儲存   | `POST /save`                | 已接；加「公開/私人」toggle UI（值存 localStorage，後端參數不變）                       |
| 評價     | `POST /rate`（star）        | **新接** `postRate(id, star)`；理由欄寫入 localStorage 佔位（後端 rationale 待 ticket） |
| 轉發     | `POST /share`               | **新接** `postShare(id, channel)`；channel = link/email                                 |
| 註記     | `POST /note` + localStorage | 寫入已接；讀取仍 localStorage（顯示使用者名），「大家可見」待後端 ticket                |
| 意義標籤 | 前端計算                    | 顯示命中 chip；新增/權重後台待 ticket                                                   |

`api.ts` 新增 `postRate`、`postShare`（比照既有 `postSave/postAccept/postNote`
的 fire-and-forget 模式）。

## 7. 排序與篩選

- 排序：`SortKey = feasibility|deadline|budget|score` 已存在；feasibility 用
  第 4 節分數（取代目前 `FEAS_BY_TIER` 佔位）。預設序：可行性 > 剩餘天數 >
  預算 > 截止日。
- 篩選：`FilterState` 已含 `categories/orgKeyword/deadlineFrom-To/tagFilter`
  （前一波擴充）。本期新增：
  - 「北部城市限定」chip（台北/新北/基隆/桃園）。
  - 「當日新案」chip（`first_seen == 今天` 或 `lastSeen` 當日）。
  - **URL query 同步**：篩選狀態序列化進 `?` query，可分享連結還原。

## 8. 資料流

```
list (GET /tenders) ──adapt──▶ Tender[]
  └─ computeFeasibility(t, rules) ──▶ score + breakdown（render 時算，不入 store）
  └─ keywordHits(t, rules) ──▶ chip 列
click row ──▶ Dialog 開（沿用 selectedId 控制流）
  ├─ 讀：tender 既有欄位 + localStorage（star/comment/save/public）
  └─ 寫：行動鈕 fire-and-forget POST（save/accept/rate/share/note）
            + 樂觀更新 localStorage（真相來源）
待補欄位 ──▶ PlaceholderBlock（履約地點/資格/附件/RAG 相似/可見註記）
```

## 9. 錯誤處理

- 後端寫入失敗：靜默（既有 `postBehavior` try/catch 模式），不回滾 localStorage。
- 詳情缺欄位（mock 或 null）：對應 `Fact` 不渲染；待補區塊顯示 `PlaceholderBlock`。
- URL query 解析失敗：退回 `DEFAULT_FILTER`，不拋錯。
- 可行性 breakdown 空：徽章仍顯示分數，tooltip 顯示「依預設權重」。

## 10. 測試 / 驗收

- `npm run build` 型別/編譯通過。
- 純函式單元測：`computeFeasibility`（各加減項、硬排除壓低、clamp 邊界）、
  `keywordHits`（命中/未命中/大小寫）、URL query 序列化往返。
- Preview MCP（vite dev runtime serverId）：
  1. 點標案列 → 寬版雙欄 Dialog；Esc/backdrop 關閉。
  2. 可行性徽章 hover → tooltip 顯示拆解。
  3. 剩餘 <7 天 → 紅色警示條。
  4. 評價點 5★ → `POST /rate` 200；轉發 → `POST /share` 200。
  5. 待補欄位顯示佔位（非空白、非錯誤）。
  6. 「北部城市」「當日新案」chip 過濾列表變化；URL 帶 query、重載還原。
  7. `preview_screenshot` 收尾佐證。

## 11. 受影響檔案（預估）

- `src/components/tenders/tender-drawer.tsx`（雙欄改版）
- `src/components/tenders/detail-bits.tsx`（新增共用元件）
- `src/lib/feasibility.ts`（新）、`src/lib/keyword-hits.ts`（新）
- `src/lib/api.ts`（新增 `postRate`/`postShare`）
- `src/components/tenders/filter-bar.tsx`（北部城市/當日新案 chip）
- `src/lib/url-filter.ts`（新，URL query 同步）+ 篩選頁接線
- `src/i18n/strings.ts`（成對新增 key）
- 對應 `*.test.ts`（純函式）

## 12. Commit 備註

此工作區（`Tender AI/` 及其 `tender-ai-frontend`/`tender-ai-backend`）**非 git
repo**，無法依 brainstorming 慣例 commit spec；本檔以檔案形式留存於
`docs/superpowers/specs/`。如需版控，後續可在此層 `git init` 或併入既有
`aiadminhq` repo。

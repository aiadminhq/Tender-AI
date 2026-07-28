# 任務交接：儀表板「199 筆＋今日焦點空白」（診斷完成、修復待實作）

此檔供人工貼入 Codex／Claude Code 或供下一個 session 接手；不含任何自動執行指令。

狀態：**已診斷，根因確認；等 owner 拍板 P1 載入策略後才動 code。** 分支 `main`（尚未切到 `claude/*` 開發分支）。

## PURPOSE

修復 production 儀表板兩個症狀：① 主頁「今日焦點」一大塊空白；② 清單／高潛力只顯示 199 筆、類型分佈 100% 工程。使用者原始需求：「先幫我規劃如何幫我解決 supabase 還是沒辦法正常串接顯示」。

## 判斷（結論）

**Supabase 串接正常，問題在前端資料載入策略，不在後端／DB。** 兩個症狀是同一條因果鏈。完整分析已寫入 `docs/governance/08-本地雲端後台串接Lessons.md` §4（根因 B）與 §7。

- Supabase 正常：`health` 200、`/tenders` 401（需 key）、UI 顯示 199 > mock 12 筆 → 確定吃到 live data。
- 根因：`store/app-data.tsx` 初次載入只抓第一頁 cursor（約 199 筆）就當全部，忽略 API 的 `count`，不沿 `next_cursor` 續抓；儀表板頁沒有「載入更多」按鈕。
- 第一頁依 feasibility 全是高分工程案、截止日多已過（今天 2026-07-15）→ 統計只算到這頁（199／100% 工程），且 `dashboard-page.tsx` 的 focus 過濾「截止日 ≥ 今天」把整頁濾空 → 空白區塊。

## TASK（修復計畫，尚未執行）

1. **P0 驗證**：帶 key 跑 `curl -s -H "X-API-Key: $APP_API_KEY" '.../api/v1/tenders?page_size=3' | jq '.count'`，確認真實 `count` 與截止日分佈（勿把 key 印進 log／commit）。
2. **P1 全量載入（核心，待決策後做）**：儀表板初次載入改抓完整資料集。`lib/api.ts` 已有現成 `fetchTenders()` 迴圈（沿 `next_cursor` 抓到 `null`），直接複用即可；配 loading skeleton。
3. **P2 空集合 fallback**：`dashboard-page.tsx:32` 的「今日焦點」——當「可投標」集合為空時改顯示「即將截止／最高可行性」前 8 筆，不要讓區塊整塊空白。
4. **P3 統計改用後端 `count`**：清單／高潛力筆數改讀 API 回傳的 `count`，不要用「已載入頁數」當總數。
5. 類型分佈 100% 工程另屬 `backfill_category.py`（約 79% `category` NULL）議題，與本任務分開處理。
6. 執行與變更相稱的驗證（型別檢查／build／preview 觀察），回報結果。

## 待決策（BLOCKER：需 owner 選 P1 載入策略）

- **(A) 進站自動抓全量（建議）**：初次載入迴圈 `next_cursor` 抓到底（約 2266 筆／約 12 次請求）＋ loading skeleton。複用既有 `fetchTenders()`，改動最小。
- **(B) 分頁載入＋新增後端聚合 endpoint**：首屏更輕，但需新後端 API。
- **(C) 先驗證再定**：先跑 P0 帶 key 的 curl 確認 `count` 與截止日分佈，再選 A/B。

（先前用 AskUserQuestion 詢問時工具權限串流中斷，尚未取得選擇；下一個 session 需重新請 owner 確認再動 code。）

## CONTEXT（相關檔）

- `@tender-ai-frontend/src/store/app-data.tsx`（初次載入 effect ~402–428；`metrics` ~675–699；`loadMore`）
- `@tender-ai-frontend/src/pages/dashboard-page.tsx`（`focus` 過濾 32–34）
- `@tender-ai-frontend/src/components/tenders/focus-list.tsx`（空陣列即空白）
- `@tender-ai-frontend/src/lib/api.ts`（`fetchTenders()` 迴圈 ~340；`PAGE_SIZE=200`；`count`／`next_cursor` 對應）
- `@tender-ai-frontend/src/data/tenders.ts`（mock 僅 12 筆，用來排除 mock fallback）
- `@docs/governance/08-本地雲端後台串接Lessons.md`（§4 診斷順序、§5 smoke test、§6 禁止事項、§7 本案詳解）

## CONSTRAINTS（紅線，嚴守 Lessons §6）

- 不為了讓畫面出現資料而切回 mock data。
- 不只調高前端 page size 來掩蓋 cursor 沒續抓。
- 未確認 API 回傳 DB 錯誤前不換 Supabase host。
- 不刪除或重建所有 Vercel env；只 patch 指定 key 與 scope。
- 不把 production 前端重新指向舊 Railway API。
- 修復只碰前端載入策略與 focus fallback，不動後端／DB。
- 不把 token／DATABASE_URL／API key 印到終端、log、commit 或文件。
- 動 code 前先切 `claude/<主題>` 分支；未經同意不 push 其他分支、不開 PR。

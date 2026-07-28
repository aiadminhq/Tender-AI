# Claude Code 任務：Tender AI 全站 UI/UX 與後台資料串接稽核

## 使用方式

目前版本已發布至 `origin/main`，最新 commit 為 `77c6809`。請直接複製下方完整任務提示詞，人工貼入 Claude Code 進行唯讀稽核。

若需在稽核後直接實作，請先保留稽核報告，再將 prompt 內的 `MODE: analysis` 改為 `MODE: write`，並確認使用獨立分支，不要直接覆蓋其他未完成工作。

## 完整任務提示詞（可直接交給 Claude Code）

```text
PURPOSE:
對 Tender AI 做一次完整、可追溯、以證據為基礎的 UI/UX 與後台資料串接稽核。成功條件：
1. 找出全站會影響使用者理解、操作效率、RWD、可及性、狀態呈現與視覺一致性的問題；
2. 確認每一個主要畫面上的數字、標籤、日期、預算、分級、可行性、供應商覆蓋、通知、看板與標案詳情都來自正確的 API／store／後端資料，而非過期 mock 或重複計算；
3. 產出帶有 file:line 證據、嚴重度、重現步驟、根因、修復建議、測試證據與優先級的報告；
4. 不以「build 通過」當作 UI 或資料正確的證明，必須把後端 payload、前端 mapping、畫面 DOM 與互動結果串起來驗證。

TASK:
Phase 0 — 工作區與基線
- 讀取 AGENTS.md、CLAUDE.md（若存在）與 docs/governance/ 相關規範。
- 先執行 git status --short、git branch --show-current、git log -3 --oneline；不可 reset、checkout、stash 或覆蓋既有 WIP。
- 確認 monorepo 結構：tender-ai-frontend/（React 19 + Vite + Tailwind v4 + pnpm）與 tender-ai-backend/（FastAPI + PostgreSQL/pgvector + uv）。
- 記錄可用命令、目前分支、目前版本與測試基線。

Phase 1 — 全站 UI/UX 稽核
請檢查至少以下路由與核心流程：
- /：戰情總覽、KPI、圖表、今日焦點、資料空狀態。
- /tenders：搜尋、篩選、排序、列表、載入更多、通知、標案詳情與 RWD。
- /swipe：左右／上下滑動、中心點擊展開、看詳情、收藏、略過、復原與鍵盤操作。
- /kanban：欄位、拖曳、卡片、狀態、負責人、空欄與窄螢幕版面。
- /insights、/push、/assistant、/decisions、/rules、/settings、/design-system、/charts。

使用 Browser/IAB 或現有 Playwright 流程實際檢查 1440x900、1024x768、768x1024、390x844 四種尺寸；若 Browser/IAB 不可用，才使用 Playwright Chromium 並明確記錄原因。每個問題需附：
- 路由、viewport、元素或區塊；
- 使用者看見／操作到的實際問題；
- screenshot 或 DOM 證據；
- 建議修復與影響範圍。

UI/UX 檢查清單：
- 資訊階層：標案名稱、機關、預算、截止日、分級、可行性、類別與案號的優先順序是否合理。
- RWD：標題是否被擠掉、篩選是否可收合、表格／卡片是否橫向溢出、側欄／topbar／bottom nav 是否互相遮擋。
- 狀態：loading、empty、error、offline、已截止、沒有詳情版本、沒有 tags、API timeout 是否都有可理解的呈現。
- 互動：按鈕是否真的可操作、點擊與拖曳是否衝突、展開／收合是否保留焦點、復原是否可預期、危險操作是否有清楚 feedback。
- 可及性：semantic HTML、heading hierarchy、label、aria-expanded、keyboard、focus-visible、color contrast、reduced motion、螢幕閱讀器文字。
- 視覺：設計系統 token 是否一致使用；white/orange palette、border、radius、shadow、Noto Sans、數字等寬字、icon stroke 與密度是否統一。
- 文案與 i18n：繁中／英文是否完整成對；數字、日期、金額、狀態文字是否不會截斷或產生歧義。
- 圖表：圖例、tooltip、座標、單位、0 值、只有一種分類、資料不足與 responsive resize 是否正確。
- feedback flow：標註面板是否能清楚區分「複製任務提示詞」、後端彙整與原始 Markdown；成功、下載後援與手動遞交狀態是否可理解。

Phase 2 — 後台資料串接稽核
請沿著「後端 endpoint → schema → service/query → frontend API client → store/context → component」逐條追蹤，不可只看型別名稱。

至少驗證：
- /api/v1/tenders 與篩選、排序、分頁／載入更多是否一致。
- tender list item 的 id、title、org、source、budget、deadline、publishedAt、tier、score、feasibility、supplierCoverage、category、tags、caseNo、tenderMethod、city、link 是否正確映射。
- /api/v1/tenders/{id} 的 revision、performanceLocation、performancePeriod、awardMethod、deposit、qualification、attachments 是否在詳情頁使用正確版本，缺資料時是否 graceful degradation。
- 使用者狀態 API：accept、save/star、skip/reclassify、undo、kanban 卡片與 decisions 是否一致且不重複寫入。
- dashboard KPI 與圖表是否以同一批資料、同一時間範圍、同一分母計算；確認百分比與「總數／進行中／截止／承接」沒有混用。
- push notifications 的 unread、搜尋、篩選與 read state 是否與後端資料一致。
- design-feedback 的 localStorage、手動提示詞複製／下載、backend POST、summary/sync 是否符合目前文件；不得把 token、payload 或 Layer B 個資寫入公開文件或 log。
- 所有日期與金額的 timezone、民國／西元顯示、TWD 單位與 null／0 的處理。
- mock、fixture、fallback、cached data 與 live API 的邊界；標記任何會在 production 被誤當真實資料的路徑。

資料正確性方法：
- 對每個關鍵畫面抓一份實際 network response，記錄 request URL、query、status、payload shape 與時間。
- 將 payload 中 3–5 筆代表資料逐欄對照 DOM；至少包含一筆有 revision、一筆缺 revision、一筆已截止、一筆無 tags／無 city 的資料。
- 若能使用本機 backend，使用既有 test database／fixture 以 read-only 查詢比對 API；不可修改或清除資料。
- 找到 mismatch 時，指出是後端 query、schema、serializer、API client、store selector、format helper 還是 component mapping 的責任。

Phase 3 — 驗證與報告
- 執行 frontend：pnpm run build、pnpm test、pnpm run lint。
- 執行 backend：cd tender-ai-backend && uv run pytest；若環境缺少資料庫，區分「測試 skip」與「測試失敗」，不可混寫。
- 執行核心 browser smoke：載入 /、/tenders、/swipe、/kanban；完成一次搜尋／篩選、展開詳情、滑卡展開、收藏或承接、看板操作與設計回饋狀態檢查。
- 請建立 docs/claude-code-uiux-data-audit-report.md，內容包含：摘要、版本基線、路由覆蓋矩陣、UI/UX 問題表、資料串接矩陣、嚴重度（P0/P1/P2/P3）、證據 file:line／route／viewport、修復建議、測試結果、尚未驗證項目與下一階段計畫。
- 報告不可只列「可再優化」；每一項必須說明使用者影響、根因、驗證方式與最小修復範圍。

MODE: analysis

CONTEXT:
@AGENTS.md @CLAUDE.md @docs/governance/**/* @docs/design-feedback-workflow.md
@tender-ai-frontend/src/**/* @tender-ai-frontend/vite.config.ts
@tender-ai-frontend/package.json @tender-ai-backend/app/**/* @tender-ai-backend/tests/**/*
Memory: Tender AI 已有 backend design_feedback_items、POST/GET /api/v1/design-feedback、summary/sync 與 frontend dev annotation flow；請以目前程式碼與 live payload 重新驗證，不要直接相信歷史文件。

EXPECTED:
- 先輸出稽核摘要與 P0/P1 清單，再完成報告檔案。
- 每個問題包含：ID、嚴重度、路由／viewport、證據、使用者影響、根因、建議修復、驗證方式。
- 提供 UI/UX 與資料串接的 coverage matrix，明確標示 verified／partial／blocked。
- 提供最小可執行的下一步清單，依「資料正確性 → 阻塞操作 → RWD → 可及性 → 視覺細節」排序。
- 不要在 review mode 修改 application code；若發現需要修改，列出精確檔案與建議 patch 邊界。

CONSTRAINTS:
- 不可 reset、checkout、stash、刪除或覆蓋既有未提交工作。
- 不可使用假資料證明 live data 正確；mock 只能用於明確標註的 fallback／測試。
- 不可把 secrets、tokens、個人 Layer B 行為資料放入報告、commit 或 log。
- 保留現有白色／橘色設計系統與真實產品資訊架構；不要另起一套視覺概念。
- 只修改本任務允許的稽核報告文件；application code 僅在使用者明確批准 write phase 後修改。
```

## 稽核完成後的實作提示詞

若 review report 已確認且要讓 Claude Code 直接修復，使用以下追加指令，並把 `MODE` 改成 `write`：

```text
讀取 docs/claude-code-uiux-data-audit-report.md，依 P0 → P1 → P2 順序實作修復。

每一批修改前：
- 只處理報告中已列出的檔案與直接相依檔案；
- 先補或更新可重現測試；
- 對資料問題先修正 contract/mapping，再調整 UI；
- 對 UI 問題維持目前 design tokens、i18n、accessibility 與 responsive container；
- 不要用假資料掩蓋 API 缺欄位或錯誤。

每一批修改後：
- 執行最小相關測試，再執行 pnpm run build、pnpm test、pnpm run lint；
- 若碰到後端資料路徑，執行 uv run pytest；
- 用 Browser/IAB 在 1440px 與 390px 驗證核心流程；
- 回報 changed files、根因、測試結果、尚未修復項與 rollback boundary。

完成後更新 docs/claude-code-uiux-data-audit-report.md 的 remediation status，但不要自行 commit 或 push，除非使用者另外授權。
```

# 任務交接：標案清單資訊層級重整

此提示詞供人工貼入 Codex、Claude Code 或其他開發工具；不包含任何自動執行指令。

## PURPOSE

改善 `/tenders` 標案清單的閱讀優先順序：標案名稱必須是每列最先被辨識的資訊；高潛力、預算與其他輔助資訊應清楚，但不能與名稱競爭。

## 已收集的設計回饋

- 路由：`/tenders`
- 目標元件：`TenderRow`／標案清單列
- 原始意圖：優化版面呈現；標案名稱應該最重要，而非目前與其他欄位權重接近的閱讀順序。

## TASK

1. 檢閱 `tender-ai-frontend/src/components/tenders/tender-row.tsx`、`tender-table.tsx` 與其共用資料／樣式，確認桌面與窄螢幕的現況。
2. 將 `tender.title` 設為主要視覺錨點：保留足夠寬度、可讀的行高與合理截斷；不讓預算、狀態或操作按鈕擠壓標題。
3. 將「高潛力」等分級、標籤、採購來源、預算、公告／截止資訊及可行性分數整理為次要資訊層，使用一致且低干擾的 token；維持真實 `Tender` 資料欄位。
4. 在窄螢幕改用明確的資訊堆疊：標題始終位於第一列，次要資料可換行；避免水平溢出、過度截斷與僅靠 hover 才能理解的內容。
5. 保留既有排序、點擊開啟詳情、選取、收藏與行動操作的行為與無障礙名稱。
6. 執行與變更相稱的驗證（型別檢查、測試或 build），並回報結果。

## CONTEXT

`@tender-ai-frontend/src/components/tenders/tender-row.tsx`

`@tender-ai-frontend/src/components/tenders/tender-table.tsx`

`@tender-ai-frontend/src/pages/tenders-page.tsx`

`@tender-ai-frontend/src/index.css`

## EXPECTED

- 僅提交與標案清單資訊階層、RWD 和必要測試直接相關的修改。
- 說明桌面與窄螢幕採用的版面規則，以及每個次要資訊的取捨。
- 列出變更檔案與驗證結果；若資料模型不足，先明確說明阻礙，勿以 mock 資料取代真實欄位。

## CONSTRAINTS

- 保留目前全站設計系統與既有資料契約。
- 不重做側欄、頂列或其他頁面，也不碰無關的未提交工作。
- 不自動 stage、commit 或啟動任何外部工具。

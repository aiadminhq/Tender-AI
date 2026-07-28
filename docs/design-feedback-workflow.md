# Design Feedback Workflow

本文件定義 Tender AI 的設計回饋流：前端標註、AI 小助手記錄、後端彙整，以及由使用者
手動遞交的開發任務提示詞。

## 操作流程

1. 啟動前端 dev server，開啟任一頁面的「設計標註」工具。
2. 點選畫面元素，填寫視覺、互動、文案、版面或其他回饋。
3. 在右下角 dock 選擇目標：
   - `Codex`、`Claude Code`、`Gemini`、`OpenCode`：產生結構化任務提示詞並複製到剪貼簿（若無法複製則下載 Markdown）。**不會啟動任何 CLI，也不會建立本機交接檔案**。
   - `後端彙整`：只 POST 到 `/api/v1/design-feedback`，保留帳號與批次。
   - `原始 Markdown（複製）`：只複製原始標註資料，供自行貼入其他工具。
4. 使用者自行將提示詞貼到目標 CLI；系統會清楚顯示「已複製」或「已下載」，不會假稱已派送或執行。

## 後端 API

- `POST /api/v1/design-feedback`
  - 用於標註工具或 AI 小助手寫入 UI/UX 修改意見。
  - 有 Bearer token 時以登入者 id 隔離；無 token 時落到 `default`。
  - body 欄位：`source`、`target_cli`、`items[]`。
- `GET /api/v1/design-feedback`
  - 讀取近期回饋，可用 `target_cli`、`mine`、`limit` 篩選。
- `GET /api/v1/design-feedback/summary`
  - 回傳可直接交給 CLI 的 markdown 彙整。

## 後端彙整的手動交接提示詞

若需從後端彙整多人回饋，可手動同步產生可審閱、可自行貼入目標工具的交接提示詞：

- `design-feedback/handoffs/<cli>/latest.md`：完整任務 prompt 與本批設計回饋。

該檔案不包含執行命令；請先檢閱內容，再由使用者自行貼入 Codex、Claude Code 或其他
目標工具。系統不會啟動、控制或追蹤任何本機 CLI。

## 從後端同步多人回饋

本地開發機可從後端彙整 API 拉取多人帳號回饋，產生供人工遞交的 Markdown：

```bash
npm --prefix tender-ai-frontend run feedback:sync -- --target codex --api http://127.0.0.1:8000/api/v1
```

輸出位置：`design-feedback/handoffs/<cli>/latest.md`。

## AI 小助手整合

AI 小助手若要替使用者記下介面或操作體驗問題，應呼叫
`POST /api/v1/design-feedback`，並設定：

- `source`: `assistant`
- `target_cli`: 使用者選擇的 CLI，或 `null`
- `items[].route`: 使用者當下頁面
- `items[].comment`: 使用者原始意見
- `items[].metadata`: 可放 thread id、focus tender id、browser context 等輔助資訊

這些資料會進後端 DB，供多人帳號彙整，再產生成可人工遞交的後續開發任務。

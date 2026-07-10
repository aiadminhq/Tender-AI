# Design Feedback Workflow

本文件定義 Tender AI 的設計回饋流：前端標註、AI 小助手記錄、後端彙整，以及本地
CLI 開發接手。

## 操作流程

1. 啟動前端 dev server，開啟任一頁面的「設計標註」工具。
2. 點選畫面元素，填寫視覺、互動、文案、版面或其他回饋。
3. 在右下角 dock 選擇目標：
   - `本地 inbox`：append 到 ignored runtime 檔 `design-feedback/inbox.md`。
   - `後端彙整`：POST 到 `/api/v1/design-feedback`，保留帳號與批次。
   - `Claude Code`、`Codex`、`Hermes`、`OpenCode`、`Antigravity`、`Gemini`：同時寫入
     `design-feedback/inbox.md` 與 `design-feedback/outbox/<cli>/latest.md`。
4. CLI 讀 `outbox/<cli>/latest.md` 後，依現有設計系統與測試門檻執行優化。

## 後端 API

- `POST /api/v1/design-feedback`
  - 用於標註工具或 AI 小助手寫入 UI/UX 修改意見。
  - 有 Bearer token 時以登入者 id 隔離；無 token 時落到 `default`。
  - body 欄位：`source`、`target_cli`、`items[]`。
- `GET /api/v1/design-feedback`
  - 讀取近期回饋，可用 `target_cli`、`mine`、`limit` 篩選。
- `GET /api/v1/design-feedback/summary`
  - 回傳可直接交給 CLI 的 markdown 彙整。

## CLI outbox

每個 CLI 目標會產生：

- `design-feedback/outbox/<cli>/latest.md`：完整任務 prompt 與本批設計回饋。
- `design-feedback/outbox/<cli>/run.command.md`：可在 repo root 執行的參考命令。

支援 `ccw cli` 的目標會生成類似：

```bash
ccw cli --tool claude --mode write --cd . -p "$(cat design-feedback/outbox/claude/latest.md)"
```

不在 `ccw cli` 支援清單內的目標會生成 best-effort 原生命令，執行前需確認本機 CLI
已安裝且支援 headless prompt。

## 從後端同步多人回饋到本地 CLI

本地開發機可從後端彙整 API 拉取多人帳號回饋，並自動寫入 CLI outbox：

```bash
npm --prefix tender-ai-frontend run feedback:sync -- --target codex --api http://127.0.0.1:8000/api/v1
```

輸出位置：

- `design-feedback/outbox/<cli>/latest.md`
- `design-feedback/outbox/<cli>/run.command.md`

## AI 小助手整合

AI 小助手若要替使用者記下介面或操作體驗問題，應呼叫
`POST /api/v1/design-feedback`，並設定：

- `source`: `assistant`
- `target_cli`: 使用者選擇的 CLI，或 `null`
- `items[].route`: 使用者當下頁面
- `items[].comment`: 使用者原始意見
- `items[].metadata`: 可放 thread id、focus tender id、browser context 等輔助資訊

這些資料會進後端 DB，供多人帳號彙整，再由本地 CLI 透過 summary endpoint 或 outbox
取得後續開發任務。

# Design Feedback Workflow

本文件定義 Tender AI 的設計回饋流：前端標註、AI 小助手記錄、後端彙整，以及本地
CLI 開發接手。

## 操作流程

1. 啟動前端 dev server，開啟任一頁面的「設計標註」工具。
2. 點選畫面元素，填寫視覺、互動、文案、版面或其他回饋。
3. 在右下角 dock 選擇目標：
   - `Codex`、`Claude Code`、`Gemini`、`OpenCode`（本機開發預設為 Codex）：直接由 Vite dev middleware
     派送至對應的 `ccw cli --mode write`。回饋會 best-effort 同步至後端，供多人彙整，但**不會建立 inbox／outbox 檔案**。
   - `後端彙整`：只 POST 到 `/api/v1/design-feedback`，保留帳號與批次。
   - `手動匯出（inbox）`：append 到 ignored runtime 檔 `design-feedback/inbox.md`；僅供無法直接派送時的備援。
4. Dock 會顯示本機 CLI 的 queued／processing／completed 狀態。若派送端點不存在、CLI 未啟動或非本機瀏覽器，介面會明確退回剪貼簿／下載備援，不會假稱已派送。

> 安全邊界：Vite server 即使對區網開放，`/__design-feedback/dispatch` 與 job status 僅接受 loopback request；只有開發機本身的瀏覽器能啟動 CLI。

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

手動同步或特別需要可審閱 handoff 檔時，每個 CLI 目標仍可產生：

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

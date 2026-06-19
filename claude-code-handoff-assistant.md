# Tender AI — Claude Code 交接文件：標案助手切片

> 適用範圍：`tender-ai-frontend/` + `tender-ai-backend/` 的 **assistant-ui 標案助手** 第一個可操作切片。
> 目標：把現行 Vite + React 前端接成可定製的標案助手 shell，後端提供可串流的對話介面，先接既有 tender SQL / semantic search，並保留後續 document knowledge base 的 tool contract。

---

## 1. 目前已完成什麼

### 後端

- 新增 `/api/v1/assistant/chat` 串流路由。
- 新增 assistant 專用 schemas：
  - `AssistantChatRequest`
  - `AssistantChatMessage`
  - `AssistantChatMetaOut`
  - `AssistantChatDeltaOut`
  - `AssistantChatDoneOut`
  - `AssistantSourceOut`
  - `AssistantToolContractOut`
- 新增 assistant retrieval orchestration service：
  - 先讀最新 user prompt
  - 以現有 `tender` SQL 查詢取候選
  - 以 `search/semantic` 補充語意命中
  - 若 prompt 中可抽出標案 id，會嘗試 `search/similar/{id}`
  - 以 NDJSON 串流回傳 `meta` / `delta` / `done`
- 保留未來文件知識庫工具契約：
  - `document_knowledge_base`
  - `v1`
  - `reserved`

### 前端

- 已確認前端已經安裝 `@assistant-ui/react` 與 `@assistant-ui/react-markdown`。
- 已確認現有前端是 Vite + React + Tailwind，適合直接加 assistant shell，不需要換框架。
- 已確認可用 `LocalRuntime + ChatModelAdapter` 的方式對接自訂 REST / FastAPI backend。

### 目前切片的設計原則

- 不碰 revision / snapshot migration 範圍。
- 不把對話直接送外部模型。
- 先做 retrieval assistant，不做完整 LLM orchestration。
- 前端 shell 只消耗 `/assistant/chat`，不直連資料庫。

---

## 2. 為什麼這樣切

這個切片的目的不是把 AI 做滿，而是先把「可操作」的骨架立起來：

- 使用者可以在前端輸入問題。
- 後端可以即時串流回覆。
- 回覆會先依據現有標案資料與語意搜尋結果，不會空轉。
- 後續要接文件 knowledge base，只要替換 service 層，不必重做前端 shell。

---

## 3. 前端 agent 怎麼用

### 適用時機

前端 agent 適合處理這些內容：

- `tender-ai-frontend/src/pages/*`
- `tender-ai-frontend/src/components/*`
- `tender-ai-frontend/src/lib/*`
- `tender-ai-frontend/src/App.tsx`
- `tender-ai-frontend/src/i18n/strings.ts`
- `tender-ai-frontend/src/index.css`

### 何時該用前端 agent

當任務涉及以下情況時，用前端 agent：

- 新增或修改 assistant shell UI
- 串接 assistant-ui runtime
- 調整路由、導航、頁面布局
- 調整 Tailwind / design token / responsiveness
- 把 backend streaming response 接到畫面

### 前端 agent 的實作方向

- 用 `LocalRuntime + ChatModelAdapter` 連 `/api/v1/assistant/chat`
- assistant shell 以現有 Tender AI 的 typography、色彩、drawer / shell 模式為準
- 不要改成 Next.js route，不要引入不必要的狀態管理框架
- 顯示至少三塊：
  - message thread
  - composer
  - evidence / source rail

### 前端 agent 交付時要注意

- 只改與 assistant shell 直接相關的檔案
- 保持現有 design system
- 若新增 route，記得同步 nav / i18n
- 不要把 assistant shell 做成靜態展示頁，必須能送出訊息並收到串流回覆

---

## 4. 後端 agent 怎麼用

### 適用時機

後端 agent 適合處理這些內容：

- `tender-ai-backend/app/api/v1/*`
- `tender-ai-backend/app/services/*`
- `tender-ai-backend/app/schemas/*`
- `tender-ai-backend/tests/*`

### 何時該用後端 agent

當任務涉及以下情況時，用後端 agent：

- 新增 API contract
- 調整 retrieval / orchestration
- 串接 tender SQL / semantic search / similar search
- 新增 streaming response
- 補測試與 fixture

### 後端 agent 的實作方向

- `/assistant/chat` 先維持 retrieval-first
- 若 semantic search 失敗，要 graceful fallback 到 SQL / list query
- 若 future document knowledge base 還沒好，不要阻塞整個聊天流程
- 串流格式維持 NDJSON，方便前端逐步消費

### 後端 agent 交付時要注意

- route / schema / service / test 要一起看
- 若改到查詢或搜尋邏輯，要先確認沒有碰到 revision / snapshot migration
- 若加新欄位，前端 helper 要同步

---

## 5. 測試與驗證流程

### 後端驗證

建議依序做：

1. 跑 unit / integration tests。
2. 確認 `/api/v1/assistant/chat` 回傳 NDJSON。
3. 確認 meta event 有 sources 與 tool contract。
4. 確認 semantic search / similar search 失敗時會 fallback。

### 前端驗證

建議依序做：

1. `pnpm build`
2. `pnpm lint`
3. 啟動前端 dev server
4. 打開 assistant route
5. 輸入測試問題，確認能送出並看到串流回覆
6. 確認 evidence rail 有跟著更新

### 驗收點

- 有新的 user message
- 有串流中的 assistant reply
- 有 source / evidence 顯示
- 有 fallback 行為
- 介面在桌機與窄螢幕下都可用

---

## 6. 之後如何交給你測試

如果要把這個切片交回給我測試，請直接說明以下三件事：

1. 要測後端、前端，或兩者一起。
2. 要用真實 DB / 真實搜尋，還是只跑 fixture。
3. 是否要我補 browser QA 或只做命令列驗證。

我收到後會直接接手：

- 後端：跑測試、修 streaming contract、補 route / schema / fallback。
- 前端：跑 build / lint、啟動頁面、修 runtime 與 UI 互動。
- 兩者一起：先 backend contract，再 frontend runtime，再 browser 驗證。

### 建議交回格式

```text
請接手測試這個 assistant 切片：
1. 後端 / 前端 / 兩者一起
2. 測試範圍：fixture / 真實 DB / 真實搜尋
3. 需要檢查的頁面或 API
4. 是否允許我一併修正發現的問題
```

---

## 7. 當前技術邊界

- 這不是完整聊天產品，第一版是 retrieval assistant。
- 不會先接外部 LLM。
- 不會在這個切片做 document knowledge base 真正查詢，只保留 contract。
- 不碰 revision / snapshot schema migration。

---

## 8. 下一步建議

1. 完成 frontend assistant page 與 `LocalRuntime` 接線。
2. 補 backend streaming 測試。
3. 補 frontend build / lint 驗證。
4. 再考慮把 document knowledge base tool contract 接成真實查詢。


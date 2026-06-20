# Hand-off → Codex：小助手（AI Assistant）開發 + 行為觀測歸檔

> 對象：Codex（負責小助手前端 + 行為埋點線）
> 交付者：本地 Claude（負責後端/資料層）
> 日期：2026-06-19
> 專案：Tender AI（monorepo，`aiadminhq/Tender-AI`，**private**）

---

## 0. 你的任務範圍（一句話）

把「小助手」從現在的「頂欄按鈕 → 右側 Sheet」改造成 **畫面右下角浮動入口**，可切換 **sidebar / 浮動視窗（自動調整大小）**；修掉它**預設出現的問題**；並在使用者點擊互動時，**只做行為紀錄（logging）**，把行為歸檔到登入帳號。**不要**在這條線接 AI 學習/向量——那是之後本地端模型離線解析的事。

明確的「做 / 不做」：

| 做                                                     | 不做                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| 小助手 UI（右下入口 / sidebar / 浮動視窗自動調整大小） | 不在小助手回應裡組裝任何 Layer B 行為明細                               |
| 修小助手預設出現的問題（見 §4）                        | 不接向量學習 / keyword 權重到小助手                                     |
| 點擊後開始觀測：常點標案、輸入的關鍵字等，**只記錄**   | 不自己做登入系統（用現有 HQadmin 佔位，見 §6）                          |
| 把行為事件 `POST /events` 歸檔到登入帳號               | 不改後端爬蟲 `tender_daily.py` / scraper / `tables[4]` / SkipSSLAdapter |
| 行為資料留在本地 DB，等本地模型離線解析                | 不推到 `main`/正式站；不直接動 prod                                     |

---

## 1. 專案結構與這段時間的關鍵變化/決策

### 1.1 架構速覽

```
Tender AI/  (monorepo, private)
├── tender-ai-backend/    Python 3.12 / FastAPI / SQLAlchemy 2.0 async / psycopg3
│                         / PostgreSQL 16 + pgvector / Ollama bge-m3(1024維) + qwen3.5:9b
│                         uv + .venv，pytest（目前 105+ 測試全綠）
│   DB: postgresql+psycopg://tender:tender@localhost:5432/tenderai
└── tender-ai-frontend/   React + TypeScript + Vite + Tailwind
                          無 Radix、自寫 UI primitive（ui/sheet.tsx 等）
                          i18n: src/i18n/strings.ts（zh/en 成對，TextKey、as const）
                          localStorage 為前端狀態真相來源
```

**資料三層（務必理解，攸關紅線）**

- **Layer A** 公開標案資料 — 可公開、可從原始 HTML 重建。
- **Layer B** 同事的行為與想法（events / 收藏 / 評分 / 想法）— **白名單(@hqdesign.tw)合作範圍內共享、依登入帳號具名；對外永不揭露、永不進任何公開 repo / GitHub Pages；需本人同意；只進本地 DB**。
- **Layer C** 學出來的知識（向量 / 權重 / 理由）— 衍生物可重算；對外須去識別化。

> 你這條線會**產生 Layer B 資料**（行為紀錄），但**小助手的回應只能引用 Layer A + 公開領域知識**，絕不能把 Layer B 明細吐回畫面。這是硬紅線。

### 1.2 這段時間的重要決策/變化（你接手前需知道）

1. **Layer A 已去重（2026-06-19）**：標案從 1,761 → **1,136 筆**（PCC 1,124 + TMU 12）。原因是舊 ingest parser 把 case_pk 存成未解碼 base64，與 backfill 的數字版產生 625 筆完全重複（連帶 625 灌水向量）。已四階段稽核後安全去重，備份在 `tender-ai-backend/data/backups/tenderai-predeudup-20260619.dump`。
2. **bge-m3 向量已落地**：1,136 筆 **1:1 全覆蓋、0 孤兒**。→ **語意檢索 `/search/semantic`、相似 `/search/similar/{id}` 現在可用了**（之前因缺模型被擋，現已解除）。
3. **小助手 LLM 已可生成（SL1 完成）**：`assistant.py` 用 qwen3.5:9b 串流、防幻覺 grounding；Ollama 不可用/逾時/空輸出會優雅退回模板（HTTP 仍 200）。
4. **分支政策**：本專案規定在 `claude/<主題>` 分支開發（目前 session 環境用 `claude/busy-sagan-gm197s`）。**改 code 一律 dev→staging→prod，不直接動 `main`/正式站**。你回傳的代碼我會在這個流程裡整合。
5. **CI 環境限制**：雲端/CI 連不到 PCC 招標網也連不到本機 Ollama。任何需要真連線（語意檢索實測、LLM 生成）的驗證，要在本機環境跑。

---

## 2. 小助手現況（你要改的東西在哪）

### 2.1 前端入口（要重構）

`tender-ai-frontend/src/components/assistant/assistant-launcher.tsx`

- **現狀**：頂欄一顆 ghost `<Button>`（`<Bot/>` icon）→ 開**右側** `<Sheet open width="sm:max-w-lg">`。
- **要改成**：畫面**右下角浮動入口** → 點擊可切 **sidebar 模式** 與 **浮動視窗模式（可自動調整大小）**。
- 串流：`streamAssistantChat(history, {onMeta, onText, onDone}, signal)`（來自 `src/lib/assistant.ts`）。
- `Turn = {role, text, sources?, error?}`；`patchLastAssistant` 更新最後一則；`SourceChip` 區分標案來源 vs 知識來源。
- **既有埋點（保留並沿用）**：
  - 開啟：`trackEvent("view", {payload:{scope:"assistant_open"}})`
  - 提問：`trackEvent("search", {payload:{scope:"assistant", q:prompt}})`
  - 點來源：`trackEvent("click_link", {tenderId?, payload:{scope:"assistant", kind, source, docId?, heading?}})`

### 2.2 後端小助手服務（理解即可，原則上你不用改；要改先跟我對齊）

`tender-ai-backend/app/services/assistant.py`

- `stream_chat_events(session, payload)` async generator：先吐 meta（sources）行，再吐 delta 行，最後 done 行。**delta 是「累積全文 replace」語意**（不是增量 append），前端要照這個語意 render。
- 證據來源：`_collect_candidates`（SQL 列表 + 語意檢索 + similar）+ `_collect_knowledge`（知識庫 RRF hybrid）。
- **硬規則（檔案內已註明）**：「證據只含公開欄位（A 層）與公開領域知識；不在此處組裝任何 Layer B 行為明細。」→ 你做 UI 時也不能把行為資料塞進對話。

### 2.3 行為埋點 client（你的「觀測 → 紀錄」主要靠它）

`tender-ai-frontend/src/lib/events.ts`

- `trackEvent(type, {tenderId?, payload?})` → `POST {API_BASE}/events`，`keepalive:true`，**fire-and-forget、靜默吞錯、不阻塞 UI**。
- `EventType = "view" | "open_detail" | "click_link" | "dwell" | "apply_filter" | "search" | "sort"`。
- **目前不帶 user_id**：後端自動取/建立預設使用者（見 §6）。登入接上後才帶真實 user_id 具名。
- 可被 `VITE_USE_API==="false"` 或 `VITE_TRACK==="false"` 關閉。

---

## 3. 資料串接清單：哪些「已可串」、哪些「還沒串」

### ✅ 已可直接串給小助手 / 行為線

| 能力                           | 端點 / 物件                                                                                                          | 狀態                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 標案列表（去重後 1,136 筆）    | `GET /api/v1/tenders`、`GET /tenders/{id}`                                                                           | 前端已接                                      |
| **語意檢索 / 相似標案**        | `GET /search/semantic`、`/search/similar/{id}`                                                                       | 後端就緒、**剛解除封鎖**（前端尚未接 → 可接） |
| 知識庫檢索                     | 小助手後端內部已用（RRF hybrid）                                                                                     | 就緒                                          |
| **行為事件流（觀測紀錄）**     | `POST /events`（7 種 type）                                                                                          | 前端已接、fire-and-forget                     |
| 收藏/接受/註記寫入             | `POST /tenders/{id}/save`、`/accept`、`/note`                                                                        | 前端已接                                      |
| 已存搜尋                       | `GET\|POST /saved-searches`                                                                                          | 前端已接                                      |
| **行為歸檔 schema（Layer B）** | `app/models/behavior.py`：`users / events / tender_user_state / annotations / evaluations / shares / saved_searches` | 表已存在                                      |

`behavior.py` 重點欄位（給你理解「歸檔到登入帳號」靠什麼）：

- `User`: id / name / email(unique, nullable) / role / created_at
- `Event`: id / **user_id(FK CASCADE, indexed)** / ts / type / tender_id(FK SET NULL) / **payload JSONB** ← 你要記錄的「常點標案 / 輸入關鍵字」就放 payload + type
- `TenderUserState`: 複合 PK(user_id, tender_id) / saved / status / star(1–5)
- `Evaluation`: feasible / criteria JSONB / rationale / **embedding vector(1024) ← Layer C，尚未建，先別碰**

### ⛔ 尚未串接（先別接，或屬之後階段）

| 缺口                                    | 說明                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| **登入 / 真實 user_id 綁定**            | 現用 HQadmin/HQadmin 佔位；登入系統未做。行為現在都歸到後端自動建的預設使用者（見 §6）     |
| 本地模型離線解析行為                    | 你只負責「記錄 + 歸檔」；之後由本地 Claude/Ollama 離線把行為解析成洞察。**不在你這條線做** |
| `/feasibility`、`/keywords/suggestions` | 後端有/規劃中，前端未接；非本任務必需                                                      |
| rate / share 寫入                       | 前端尚未接；非本任務必需                                                                   |
| 向量學習 / keyword 權重 → 小助手        | **刻意排除**（使用者明確說 AI 學習/向量先不用）                                            |

### 契約落差（接 API 時注意，別自行改契約）

1. `tier`：後端 4 級（priority/high/mid/low），前端 3 級（high/mid/low）。
2. `source`：前端有 TPC/NPC，後端只有 PCC/TMU。
3. `user_state.status` enum 與前端 Kanban mock 的對應需確認。
   > 這些**列為待對齊**，不要在小助手線單方面改動 domain/badge/api 契約。

---

## 4. 「預設出現的問題」要修什麼

請以實測為準（在能連 Ollama 的本機跑），常見方向：

- 小助手**一打開就自動冒出**內容/空泡泡/預設訊息的觀感問題 → 改成乾淨初始狀態（空狀態提示，不自動發話）。
- delta「累積全文 replace」語意若被當成 append → 會出現文字疊字/重複，render 要照 replace。
- Ollama 不可用時的 fallback 文案要明確（目前會退模板、HTTP 200），別讓使用者以為壞掉。
- i18n：小助手所有新文案 **zh/en 成對**加進 `strings.ts`，否則 `TextKey` 型別編譯失敗；繁中為預設。
  > 你實測後把「實際的預設問題清單 + 修法」回報，我再一起 review。

---

## 5. UI 規格（右下入口 / sidebar / 浮動視窗自動調整大小）

- **入口**：固定畫面右下角浮動鈕（`fixed bottom-* right-*`），lucide `Bot` icon，符合 House style。
- **兩種展開形態 + 可切換**：
  1. **Sidebar 模式**：貼右側、固定寬（可沿用既有 Sheet 的 Esc/backdrop/scroll-lock 行為）。
  2. **浮動視窗模式**：可拖動 + **自動調整大小**（resize），不被頂欄綁死。
  - 提供一顆切換鈕在兩形態間切（狀態建議用 localStorage 持久化，比照既有 theme/lang 裸 key 寫法）。
- **House style（技能不得覆蓋本專案規範）**：
  - 繁中字體只用 `Noto Sans TC`；英文 `Inter`/`SF Pro Text`；數字/code `JetBrains Mono`/`SF Mono`。
  - 極簡直線、零手寫/抖動；統一 **16px 圓角**；Bento 卡片分區；只允許些微陰影 `0 1px 2px rgba(0,0,0,.06)`，禁濃重投影。
  - 無 Radix，沿用自寫 primitive 與 Tailwind token（border/card/muted/tier-\*）。
- **z-index 注意**：專案另有計畫使用 Dialog/Sheet `z-50`、MaximizableCard overlay `z-40`（見 `stateless-strolling-scott.md` 前端改造計畫）。小助手浮動層請選不衝突的層級並在 PR 註明，避免跟那條線打架。

> ⚠️ **協調**：另有一個雲端 session 在做前端 8 項 UI 改造（`/Users/christianwu/.codex/plans/stateless-strolling-scott.md`，含 Dialog primitive、sidebar 折疊、MaximizableCard）。你動的檔案盡量**只限 `assistant-launcher.tsx` 與新建的小助手元件**，避免與那條線改到同檔。要動共用檔（strings.ts / app-context）先跟我說，我來協調時序。

---

## 6. 帳號/登入現況（「歸檔到登入帳號」目前怎麼運作）

- 目前**沒有真正的登入**：`HQadmin / HQadmin` 是開發佔位。
- `trackEvent` 不帶 user_id → 後端自動取/建立預設使用者，行為先全歸到它。
- **未來**：登入接上後，`trackEvent` 要帶**真實 user_id（具名）**，行為才正確歸到該白名單帳號。你現在把 payload 結構設計好（type + 標案 id + 關鍵字等），等登入一上線就能無痛具名歸檔。
- 上線前：HQadmin 佔位要換成真實密碼雜湊 + session/JWT，憑證移到環境變數、不進 repo（這部分不是你做，但你設計 events 結構時要假設「之後會有真 user_id」）。

---

## 7. 約束（你必須遵守）

- **Layer B 紅線**：行為資料只進本地 DB、白名單具名共享、對外永不揭露、需同意；**絕不進公開 repo / Pages**；小助手回應**不得**含行為明細。PR 要寫清楚 ①同意基礎 ②共享範圍 ③對外隔離方式。
- **機密**：不印/不複製/不 commit 任何 secret；範例用 `${VAR}` 佔位。
- **分支/流程**：dev→staging→prod，**不碰 `main`/prod**；不重寫爬蟲（`tender_daily.py`/scraper/`tables[4]`/SkipSSLAdapter）。
- **i18n**：新文案 zh/en 成對，繁中預設。
- **Commit**：Conventional Commits + 範圍標籤（`be`/`fe`/`data`/`infra`/`docs`），身分 aiadminhq，結尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- **覆蓋前先讀**：要改既有檔先讀內容；與描述不符或非你所建，停下回報而非覆蓋。

---

## 8. 你回傳後，本地 Claude 怎麼處理你的資料/代碼

> 這段是給使用者 + 我自己的對接約定。

1. **接收形式**：你回傳 diff / 檔案。我會在 `tender-ai-frontend/` 原地審查（前端目錄非獨立 git repo，無法用 worktree 隔離）。
2. **靜態檢查**：跑 `npm run build` / `tsc` 確認型別與 i18n 成對 key 無誤。
3. **Layer B 洩漏稽核**：人工 + grep 檢查小助手回應路徑「絕不含行為明細」；確認 events 只送後端、不進任何對外視圖。
4. **行為驗證**：用 Claude Preview MCP（serverId `tender-ai-dev`, port 5173）實跑：開小助手 → `preview_console_logs` 無 error → 切 sidebar/浮動視窗/resize → `preview_network` 確認 `POST /events` 有送（type/payload 正確）→ `preview_screenshot` 收尾。
5. **後端測試**：若你的改動牽動後端，跑 `pytest`（目前 105/105 綠，要維持）。
6. **整合**：通過後我才把它整進 dev 分支，再走 staging→prod。**不直接進 main/prod**。
7. **行為資料的後續**：你產出的 events 我這邊負責「之後叫本地端模型離線解析」——你不用管解析，只要保證紀錄結構乾淨、可歸戶、payload 欄位語意清楚（建議在 PR 附一份「我送了哪些 type / payload 欄位」對照表）。

---

## 9. 建議的 events payload 設計（給你起手，可討論）

沿用現有 7 種 type，不要新增後端 enum（避免改契約）。用 `payload.scope` 區分小助手情境：

| 觀測目標             | type          | 建議 payload                                                       |
| -------------------- | ------------- | ------------------------------------------------------------------ |
| 開啟小助手           | `view`        | `{scope:"assistant_open", mode:"sidebar"\|"float"}`                |
| 提問/輸入關鍵字      | `search`      | `{scope:"assistant", q:"<關鍵字>"}`                                |
| 點小助手給的來源     | `click_link`  | `{scope:"assistant", kind, source, docId?, heading?}` + `tenderId` |
| 常點標案（一般列表） | `open_detail` | `{...}` + `tenderId`                                               |
| 停留時間             | `dwell`       | `{scope, ms}`（keepalive 確保卸載時送達）                          |

> 「常點哪些標案 / 常打什麼關鍵字」＝ 後端對 `events` 依 user_id 聚合即可得，**你只要負責把事件如實送出**，不用在前端做統計。

---

最後更新：2026-06-19（本地 Claude 交付）

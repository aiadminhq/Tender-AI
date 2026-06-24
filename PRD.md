---
title: "tender-ai-prd-260617"
type: project
category: development
tags: [tender-ai, prd, nextjs, fastapi, postgres, pgvector, rag, learning-loop]
status: in-progress
created: 2026-06-17
updated: 2026-06-23
author: claude-cowork
---

# Tender AI｜產品需求文件（PRD）

> 版本 v0.1（draft）｜2026-06-17｜對應 HQ 案源開發 / tender-bot v2 重建。
> 配套文件：`design-handoff-claude-design.md`（UI/UX 診斷與設計交付）、`規劃-後台資料庫與RAG學習迴圈.md`（資料模型與學習迴圈）。本 PRD 為統合藍圖。

---

## 1. 產品概述

### 1.1 背景

惠強室內裝修的「案源開發」目前由 `tender-bot` 每日爬政府電子採購網（PCC）+ 北醫聯合採購（TMU），產出靜態 HTML 報表發佈到 GitHub Pages。此模式可用但有三大限制：報表頁無法篩選/排序/搜尋、無資料庫、無法沉澱使用者（David）的判斷力。

### 1.2 願景

把每日標案流轉為一個**會學習的案源決策系統**：David 在前台操作（篩選、儲存、評價、承接），系統把這些行為沉澱成資料與知識，透過 RAG 與可行性模型，**越用越懂「什麼案對惠強可行」**，並讓遠端同事也能即時查看。

### 1.3 產品名稱

**Tender AI**。

### 1.4 設計方向佐證

Codex 已產出的新版列表列（截圖）已體現目標型態：一列含 **標的標籤（TMU/PCC）、預算（3,360 萬）、剩餘天數（12 天）、可行性分數（76% 進度條）、「承接」行動鈕**——其中「可行性分數」與「承接」正是本系統學習迴圈的前台出口。

> 註：該截圖之標案經查證為 demo／樣本資料（PCC 全文檢索查無此案），僅作 UI 範例，非真實標案。

---

## 2. 目標與成功指標

| 目標               | 指標（KPI）                                              |
| ------------------ | -------------------------------------------------------- |
| 縮短挑案時間       | David 從「打開→決定承接/略過」的平均時間下降             |
| 提升可行性判斷命中 | 系統建議「可行」且 David 採納（承接）的比例上升          |
| 沉澱判斷力         | `evaluations` 累積筆數、可行性模型對歷史決策的回測準確率 |
| 篩選自我進化       | 由行為學出的「重點/避免關鍵字」被採用數                  |
| 遠端可用           | 同事可遠端查看、月活躍使用                               |

---

## 3. 使用者與角色

- **David（主要操作者／決策者）**：每日挑案、評估可行性、承接或略過、寫判斷理由。系統主要向他學習。
- **同事（遠端檢視者）**：查看清單、已承接案、報表；唯讀為主。
- **Admin（David 或副理本人）**：維護關鍵字（重點/避免）、`PRIORITY_RULES`、預算門檻、可行性 rubric、手動重跑、看執行 log、匯出。

Persona 紅旗（取自 UI/UX 診斷）：現況報表頁零篩選、a11y 不足、無排序——本產品須直接解決。

---

## 4. 範圍

### 4.1 In scope（本期）

六大畫面（見 §6）、可組合篩選器、行為捕捉、RAG 語意搜尋與文件摘要、可行性分數與學習迴圈、後台 admin、雙主題、自架部署與遠端存取。

### 4.2 Out of scope（暫不）

多公司/多租戶、自動投標、對外公開的完整 app（公開層維持唯讀報表）、行動原生 App。

### 4.3 不更動

`tender_daily.py` scraper 核心（`tables[4]`／`SkipSSLAdapter`／PCC 連線）——僅新增資料庫寫入 sink。

---

## 5. 技術架構

自架為核心（公司有常開主機、可跑本地模型），雲端只當對外殼：

- **前端／UI**：Next.js（App Router）。
- **後端 API／背景工作**：Python FastAPI（複用既有 Python 爬蟲與 ML 生態）。
- **資料庫**：PostgreSQL + **pgvector**（關聯式 + 向量同一引擎，自架最簡）。
- **模型**：本地 Ollama／vLLM 做 embeddings 與大量初步消化；高品質推理（可行性、文件摘要）呼叫 **Anthropic Claude API**。
- **爬蟲**：保留 PCC/TMU 既有；需登入的資料源用 Playwright + persistent context（session 重用）。
- **部署**：app + DB 跑在主機，經 **Cloudflare Tunnel**（或 Tailscale）安全曝光給小團隊（自帶 HTTPS + Access 白名單，不開對外 port）；每夜 DB dump 至雲端（R2/S3）做 DR。
- **公開層**：現行 GitHub Pages 每日報表維持為唯讀對外視圖，與內部 app 隔離。

> 架構修正說明：先前評估的 Cloudflare D1/Vectorize 適合「零主機 serverless」；既有常開主機 + 本地模型，改採 Postgres/pgvector 自架為核心更省成本、利於學習迴圈即時回饋。Next.js 仍保留日後上雲彈性。

部署模式取捨：採「**主機直連（經 tunnel）**」而非「抓完上傳」——因學習迴圈靠即時捕捉行為再回饋，上傳模式會切碎資料、增加延遲。唯公開唯讀報表續用上傳/發佈模式。

---

## 6. 功能需求（依畫面）

### 6.1 首頁儀表板

今日重點（⭐ 最優先 + 即將截止的高潛力）、趨勢摘要、快速進入今日清單、全域篩選入口。

- 驗收：開啟即見今日可行性前列案件與關鍵統計；無資料有 empty-state。

### 6.2 標案列表頁（取代每日報表頁）

完整 filter bar + 可排序資料表/卡片切換 + 即時筆數 + empty-state；跨日期區間、非單日靜態。每列含可行性分數與「承接」鈕（如截圖）。

- 篩選維度（可 AND 組合）：潛力分級、截止窗（含「排除 7 天內，最優先除外」開關）、預算區間、標的分類（工程/財物/勞務）、城市、資料源、**重點關鍵字（納入/加權）**、**避免關鍵字（排除）**。
- 排序：截止日／預算／潛力／命中關鍵字數／**可行性分數**，升降序。
- 互動：語意化 `<button aria-pressed>`、全鍵盤、focus ring、觸控≥44px、篩選狀態存 URL/localStorage、clear-all、0 結果給「放寬條件」CTA。
- 驗收：任一條件組合即時更新筆數；窄屏表格改卡片；篩選可分享（URL）。

### 6.3 標案詳情頁

全欄位 + PCC 原始連結 + RAG「相似歷史標案/相似可行案」+「招標文件摘要」+ 操作：⭐ 儲存、轉發、進度（觀望/備標中/已投/得標/放棄）、1–5 星、可行性評估（rubric）、自由註記。

- 驗收：每個操作即時寫入行為層；可行性助手給出帶理由的建議。

### 6.4 RAG 語意搜尋頁

自然語言查詢 → 語意結果 + 摘要卡；可存為 saved search（提示詞 + 篩選預設）。

- 驗收：中文自然語言查得到相關案；可重用提示詞。

### 6.5 後台 admin

- **關鍵字雙區**：重點關鍵字（納入/加權）、避免關鍵字（排除）；含「由行為學出的建議，一鍵採用」。
- 規則可視化：`PRIORITY_RULES`、`MAX_BUDGET`、`EXCLUDE_WITHIN_DAYS`。
- 手動重跑 + 執行 log；標記/加星/備註管理；匯出 Excel/PDF。
- 驗收：改設定即影響後續篩選/排序；重跑可見成功/失敗 log。

### 6.6 登入頁

小團隊單公司 auth（Cloudflare Access 或 email 白名單）。

### 6.7 標案助手（assistant-ui）

在既有網站嵌入可串流回覆的「標案助手」，第一階段採 **assistant-ui** 作為 React 對話介面，後端沿用 FastAPI Agent/RAG API。assistant-ui 官方支援 Next.js，亦可透過 custom runtime／AI SDK runtime 整合任何 React-based framework；因此目前 Vite + React 前端可直接導入，**不以遷移 Next.js 為前置條件**。若日後改採 Next.js，可使用 App Router + AI SDK v6 route handler，保留相同對話元件與 Agent tool contract。

- **入口**：全站右下角 FAB 浮鈕（非阻擋式 popover，無遮罩、主畫面照常可操作）＋浮窗標題列「指揮中心」連結至整頁工作台 `/assistant`（左對話、右情境，依 `?tender=<id>` 帶入當前標案）；帶入目前頁面、標案 ID、篩選條件與登入使用者作為受控 context。
- **第一階段能力**：自然語言搜尋、單案問答、相似案、案件比較、推薦理由、引用原始公告與文件頁碼。
- **Agent tools（先唯讀）**：`search_tenders`、`get_tender_detail`、`get_current_revision`、`search_documents`、`compare_tenders`、`explain_recommendation`、`get_user_saved_tenders`。
- **回答規則**：日期／預算／分類等精確條件先走 SQL；內容問題走 Hybrid RAG；無 citation 不得斷言資格、金額或期限；更正公告須標示 revision。
- **權限**：Agent 不得代替使用者承接、投標或修改後台規則；未來 write tool 必須逐次顯示 human-in-the-loop 確認。
- **驗收**：支援 streaming、停止生成、重試、錯誤狀態、mobile；回答 citation 可開啟對應標案／文件；不得將 Layer B（合作範圍內）資料傳入未核准的外部服務。

#### 6.7.1 開發難度與交付切片

| 切片              | 內容                                                            | 難度   | 可操作驗收                               |
| ----------------- | --------------------------------------------------------------- | ------ | ---------------------------------------- |
| A. UI shell       | assistant-ui 對話抽屜、輸入、streaming mock、錯誤與 empty state | 低～中 | 可在 Vite 現站開關、輸入、停止與重試     |
| B. FastAPI bridge | 對話 endpoint、SSE/data stream、thread/user context、API auth   | 中     | 可完成多輪問答，刷新後 thread 可恢復     |
| C. RAG tools      | SQL + full-text + pgvector、citation、revision-aware retrieval  | 中～高 | 問答可追溯至案號、版本、文件與頁碼       |
| D. Agent tools    | 搜尋、比較、推薦解釋、目前頁面 context                          | 中     | Agent 可用結構化卡片比較案件，不執行寫入 |
| E. 行為學習串接   | 搜尋／點擊／篩選事件、偏好更新、每日推薦                        | 高     | 能說明推薦原因並接受使用者回饋           |

第一個可操作里程碑為 A + B：先完成 UI、thread 與 mock／最小 FastAPI 串流，再由使用者實際操作驗證。確認互動方式合適後才進入 C～E，避免在 UX 未定案前投入完整 Agent/RAG 整合。

---

## 7. 學習迴圈與 AI 行為

```
前台操作 → 行為訊號(Layer B) → 推導 → 權重/模型 → 回饋前台(可行性分數+排序+關鍵字建議) → 新操作…
```

- **訊號**：外顯（儲存/轉發/承接/星評/可行性評估+理由）權重高於內隱（開啟/停留/點連結/篩選軌跡）。
- **關鍵字學習**：比較「被承接/評可行」vs「略過/評不可行」的詞頻 → 重點/避免關鍵字候選 → admin 一鍵採用（人在迴圈）。
- **可行性標準學習**：`evaluations.criteria`（預算/工期/分類/機關關係/競爭/利潤…）累積 → 可行性特徵權重。
- **可行性分數 + 理由**：結合關鍵字權重 + 標準特徵 + 與「可行」歷史決策的向量相似度 → 產出分數（如截圖 76%）與理由（「與你 06-08 評為可行的某案相似…」）。
- **冷啟動**：模型未成熟前分數僅作建議，不取代人判斷。
- **行為學習開關**：開啟後記錄該使用者的搜尋、點擊、標案詳情瀏覽、篩選／排序軌跡，以及授權範圍內的收藏、承接、評價與註記訊號。
- **持續更新**：行為學習採增量累積；既有偏好與歷史訊號不因暫時停止操作、重新登入或模型更新而清除，後續資料持續修正權重與推薦結果。
- **保留原則**：使用者行為與偏好模型預設長期保留並持續優化；系統更新、重嵌與模型換版須保留可追溯的原始事件與 profile version，不以重新訓練為由覆寫歷史。
- **可解釋推薦**：首頁「每日推薦」先以規則、個人偏好、相似已承接案、截止可執行性與多樣性組合排序；每案顯示推薦理由，並接受「符合／不符合」回饋。
- **身份與隱私（合作範圍模型）**：事件以內部 `user_id`（對應白名單登入帳號，原則 `@hqdesign.tw`）關聯，並**依登入帳號名稱具名標示貢獻者**；原始行為、偏好 profile 與 recommendation log 屬 Layer B，**在白名單合作範圍內與同事及 AI/agent 共享、互相學習**（需本人同意），但**不進公開 repo**，對外揭露的向量 metadata 須去識別化。未來若開放外界註冊登入，須經邀請／授權納入白名單才算合作範圍內。詳見 `CLAUDE.md`。

---

## 8. 資料模型（摘要）

三層（詳見 `規劃-後台資料庫與RAG學習迴圈.md`）：

- **Layer A 標案 Corpus**（公開可重生）：`tenders`、`daily_runs`、`daily_tender`、`sources`。
- **Layer B 行為/回饋**（白名單合作範圍內共享、對外私有）：`events`、`tender_user_state`、`annotations`、`evaluations`、`shares`、`saved_searches`。
- **Layer C 知識/RAG**：Vectorize/pgvector 的 `tender_vectors`、`decision_vectors`；`keyword_weights`、`doc_summaries`。
- **回填**：parser 解析 `tender-reports/reports/*.html`（32 份歷史）→ Layer A；之後 scraper 直寫。

---

## 9. 非功能需求（NFR）

- **可用性／a11y**：WCAG AA（對比、鍵盤、focus、觸控 ≥44px、語意 HTML、skip-link）。
- **效能**：列表互動即時；embeddings 批次離峰跑。
- **安全／隱私**：Layer B/決策向量/註記在**白名單合作範圍內共享、對外私有**，永不進公開 repo；合作範圍內可依登入帳號具名，對外揭露的向量 metadata 須去識別化、不含人名/email；帳密放 secret manager；對外經 tunnel + auth（email 白名單，原則 `@hqdesign.tw`）。
- **語系／雙語**：繁體中文為預設語系，專業術語保留英文；頂部單一 `EN／中` 按鈕切換，經 localStorage 持久化，文案以 `strings.ts` 的 zh／en 成對 key 管理；切換語系不重設篩選、收藏、評價或 Dialog 狀態。
- **字體**：繁體中文僅使用 `Noto Sans TC`；英文使用 `Inter`／`SF Pro Text` 等非襯線字；數字與程式碼使用 `JetBrains Mono`／`SF Mono`；不使用任何裝飾性或手寫字體。
- **視覺風格**：極簡直線、零抖動、零手寫；統一 16px 圓角；以 Bento 卡片、間距、邊框與背景建立資訊層級；卡片可帶些微陰影（`0 1px 2px rgba(0,0,0,.06)`），但禁止濃重投影或假深度。
- **RWD**：mobile/tablet/desktop；窄屏表格轉卡片。
- **主題**：light/dark 雙主題，token 化切換。

---

## 10. 里程碑（Roadmap）

| 階段                       | 內容                                                            |
| -------------------------- | --------------------------------------------------------------- |
| P1 資料層 + 回填           | Postgres schema、parser 回填 32 份歷史、scraper 新增 DB 寫入    |
| P2 前台行為捕捉            | Layer B + 前台埋點（儲存/轉發/承接/評價/註記/搜尋/篩選）        |
| P3 RAG 索引 + 語意搜尋     | embeddings、語意搜尋頁、文件摘要                                |
| P3A 標案助手可操作版       | assistant-ui shell、FastAPI streaming、thread/context、最小問答 |
| P3B 標案助手 RAG/Agent     | citation、revision-aware Hybrid RAG、唯讀 Agent tools           |
| P4 學習迴圈 v1             | 行為 → 重點/避免關鍵字建議                                      |
| P5 可行性助手 + 學習式排序 | 可行性分數與理由、每日推薦、依分數排序                          |

> P2 應最早上線——讓 David 操作從第一天就被記錄，後續學習才有燃料。

---

## 11. 風險與待決

- **主機可用性**＝服務可用性：直連模式須評估主機/網路穩定度；不穩則公開層走上傳、內部 app 直連 + 每夜備份。
- **本地模型品質**：embeddings/初步消化用本地；可行性推理/摘要建議用 Claude API 確保品質。
- **Agent UI 架構**：assistant-ui 可同時支援現行 Vite + React 與未來 Next.js；本期不因導入助手而進行框架遷移。若改走 Next.js + AI SDK v6，應另立 migration milestone，避免與 Agent/RAG 功能綁定交付。
- **行為資料長期保留**：需建立事件 schema version、profile version、備份與存取權限；推薦模型更新不得破壞歷史可追溯性。
- 待決（需 David 拍板）：① 可行性 rubric 必填欄位；② 轉發 channel 範圍；③ 學習式排序是否設預設視圖；④ 歷史回填追溯起點（repo 最早 2026-05-15）；⑤ codex 產出的 HTML 與本架構（Next.js）的整併方式。

---

## 12. 附錄

- **詞彙**：潛力分級（🟢≤14/🟡15–30/🔴≥31）、⭐ 期間最優先、承接（David 決定投入備標）、可行性分數（學習迴圈輸出）。
- **相關檔案**：`design-handoff-claude-design.md`、`規劃-後台資料庫與RAG學習迴圈.md`、`tender-reports/`（歷史資料 32 份）、`tender-bot/CLAUDE.md`（技術約束）、`plans/tender-ai-integrated-roadmap/`（整合視覺計畫：雙語詳情 wireframe／prototype 與字體・視覺房規）。
- **assistant-ui 技術依據**：[官方文件](https://www.assistant-ui.com/docs)、[安裝說明](https://www.assistant-ui.com/docs/installation)、[AI SDK v6 runtime](https://www.assistant-ui.com/docs/runtimes/ai-sdk/v6)、[GitHub（MIT）](https://github.com/assistant-ui/assistant-ui)。
- **查證附記**：截圖標案「醫院衛浴更新與感控改善工程」經 PCC 全文檢索查證為 demo 資料，非真實標案。

---

## 13. 開發狀態快照（2026-06-23）

> 回填自實作 session；本節隨開發更新，為「PRD 規劃 vs 實際落地」對照。各階段一覽見 §10 Roadmap。詳盡盤點另見 `plans/project-status-assessment/plan.mdx`。

### 13.1 技術選型偏移（與 §5 差異）

- **前端**：實際採 **Vite 8 + React 19 + TypeScript（strict）+ Tailwind v4 + react-router-dom 7**，非原訂 Next.js。原因：本期為內部工具 + demo，無 SSR 需求、Vite 啟動／建置快；日後若需 SSR/SEO 再評估遷移。路由為 BrowserRouter 真實路徑。
- **後端**：**FastAPI + SQLAlchemy 2.0 async + psycopg 3 + Pydantic v2 + PostgreSQL 16 + pgvector**，符合 §5；embeddings 用本地模型（bge-m3＝1024 維、HNSW cosine）。皆 brew 原生、無容器。
- **預覽**：兩種——**vite dev（:5173，HMR、優先）** 與靜態 build（:8771，須 rebuild + cache-bust）。

### 13.2 後端 API 現況（FastAPI `/api/v1`，30 路由，CORS 放行本機任意埠）

| 範圍     | Endpoint                                                                      | 狀態                                    |
| -------- | ----------------------------------------------------------------------------- | --------------------------------------- |
| 標案清單 | `GET /tenders`（filter/sort/page，page_size ≤ 200）                           | ✅ live、前端已接                       |
| 標案詳情 | `GET /tenders/{id}` → 主檔＋歷史快照＋user_state（含履約/資格/押標金/附件）   | ✅ live、前端 `/tenders/:id` 已取用     |
| 理由     | `GET /tenders/{id}/reasoning`、`/reasoning/profile`                           | ✅ live、前端已接（profile 視圖待確認） |
| 行為     | `POST /tenders/{id}/{save,accept,rate,note,share}`、`/events`、saved-searches | ✅ live、前端已回寫（具名 user_id）     |
| 語意     | `GET /search/semantic`、`GET /search/similar/{id}`                            | ✅ live、前端 `/search` 已接            |
| 助手     | `POST /assistant/chat`（NDJSON 串流，provider 路由＋progress 暫態）、threads  | ✅ live、前端浮窗＋指揮中心已接         |
| 設定     | `GET/PUT /settings/brain`（小助手大腦：provider／模型／CLI agent，單列）      | ✅ live（CLI 切片）、前端設定頁已接     |
| 推播     | `GET/POST /push/{digest,run,read}`                                            | ✅ live、前端 `/push` 已接              |
| 進化     | `POST /evolution/run`、`GET /evolution/status`                                | ✅ live、前端 `/evolution` 已接         |
| 帳號     | `POST /auth/login`、`GET /me`、`PUT /me/{consent,password}`、`/admin/*`       | ✅ live、前端登入/設定已接              |

### 13.3 前端畫面狀態（對應 §6，AppShell + 11 頁 + 全站浮窗）

- **6.1 儀表板**：✅ 今日焦點／KPI 已對接 live 標案；三層下鑽（清單→就地展開→彈窗→`/tenders/:id`）已收口。
- **6.2 標案列表**：✅ live（`GET /tenders?sort=feas&page_size=200`）；filter bar／排序／RWD 表格↔卡片完成。
- **6.3 標案詳情**：✅ 完整詳情頁 `/tenders/:id` 已建（事實格／量表／歷史快照／相似案／PCC 原文／履約·資格·押標金·附件區塊）；列表彈窗 `TenderDrawer` 並存。
- **6.4 語意搜尋頁**：✅ `/search` 已建（`searchSemantic` → 表格，含 search 埋點）。
- **6.5 後台 admin**：🟡 規則頁（聚焦/避免/硬排除＋關鍵字編輯）完整；設定頁含推播/小助手/**小助手大腦（provider 路由：Ollama／CLI／BYOK，CLI 切片已接）**/帳號安全/管理者改密；手動重跑改走 `/evolution` 面板，log／匯出未建。
- **6.6 登入頁**：✅ `/login` 已建（白名單 @hqdesign.tw、auth-context、改密、管理者重置）。
- **6.7 標案助手**：✅ FAB 非阻擋浮窗（`@assistant-ui/react`）＋整頁指揮中心 `/assistant`；Phase 1 引導、Phase 2 全螢幕完成，Phase 3 情境接檢索／Phase 4 留存待補。
- **其他**：`/swipe` 速配、`/kanban` 看板（具名註記＋轉傳）、`/insights` 洞察（部分 mock）、`/push` 推播、`/evolution` 進化、`/settings` 設定皆已建。

### 13.4 已落地：標案詳情強化（原本次評估，已完成）

需求①每列點擊展開更多資訊、②「查看完整詳情」→ 獨立頁面，**皆已落地**：今日焦點兩段式下鑽（就地展開→彈窗）＋ 獨立詳情頁 `/tenders/:id`（取 `GET /tenders/{id}`、含歷史快照與相似案）＋ 行為回寫（具名）。enrich 已補履約/資格/押標金/附件欄位，詳情 API 與前端 `RevisionDetailBlock` 同步到位。

### 13.5 已知債務

- 清單分頁仍取前 200／共 ~1,136 筆，待真分頁。
- `category` 後端約 79%（~900/1,136）為 null，是知識學習特徵覆蓋天花板；回填走 `backfill_category`（只補 NULL、冪等、offline）。
- feasibility／supplierCoverage／score 部分仍為 tier 衍生佔位，續隨 P4/P5 真實 lift 數據收斂。
- 多數 live 標案截止日早於今日 → 顯示「已截止」（資料屬實，非 bug）。
- PCC 詳情頁「常駐型 CAPTCHA」阻擋全自動補詳情，需瀏覽器互動式抓取（架構級決策）。
- 登入信任邊界為 Phase 1 輕量版（admin 以 `X-User-Role` 標頭把關），session/token Phase 2 待補。

### 13.6 小助手大腦可選（provider 路由器，CLI 切片已落地）

讓操作者在設定頁選擇「小助手視窗」背後由哪個大腦回答。開發期單機單操作者 → **全域單列設定**（`assistant_brain_config` id=1，get-or-create）。

- **三 provider 路由**（`app/services/brain.py`，依 `config.provider` 分派，未知 → `BrainError`）：
  - `ollama`：包現行 `llm.stream_chat`，逐塊 yield `delta`（增量），本機模型可換。
  - `cli`：以 headless agentic CLI 為大腦（目前支援 `claude -p … --output-format stream-json`）。CLI 已注入 `tender-ai-brain` MCP，**全自主**呼叫 MCP 工具；text 區塊累積、`tool_use` → `progress` 暫態（如「查詢中：search_tenders」）、`result` → 一則 `delta`。
  - `byok`：自帶金鑰走雲端（Anthropic messages stream）；system 訊息抽到頂層 `system`。
- **串流協定**：`BrainChunk(kind="delta"|"progress")`。`delta` 為增量（前端累積後 REPLACE）；`progress` 為暫態狀態（直接轉發、不落地、不入留存）。非 CLI 大腦不發 progress → 恆為 null，前端 `lib/assistant.ts` 以 `evt.type` 區分、向後相容。
- **祕密隔離（紅線）**：BYOK 金鑰本體只進 `.env`（`settings.anthropic_api_key`）；`/settings/brain` 只讀寫非密欄位，`byok_key_set` 由 `.env` 即時推導，永不回傳金鑰本體。**CLI 切片完全不碰任何祕密。**
- **Layer B 安全點**：CLI 全自主路徑的 Layer B 邊界由 **MCP 工具輸出層**把關（去識別化／白名單），非靠 `assistant.py` 組 prompt；`llm.py` 一律不把 Layer B 行為塞進外部模型 prompt。
- **交付切片序**：CLI（已落地）＞ BYOK ＞ Ollama 換模型。設計細節見 `docs/superpowers/specs/2026-06-23-assistant-brain-picker-design.md`。

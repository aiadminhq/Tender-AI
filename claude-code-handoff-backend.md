---
title: "tender-ai-claude-code-handoff-backend-260617"
type: reference
category: development
tags: [tender-ai, claude-code, handoff, fastapi, postgres, pgvector, backend]
status: draft
created: 2026-06-17
author: claude-cowork
---

# Claude Code Hand-off｜Tender AI 後端（FastAPI + Postgres + pgvector）

> 用途：直接貼給 **Claude Code** 開始開發後端與背景工作。前端走「靜態 HTML 原型 →（滿意後）Next.js」，**本後端可平行先做**。
> 鐵則：**不重寫既有爬蟲核心** `tender_daily.py`（`tables[4]`／`SkipSSLAdapter`／PCC 連線為已測邏輯）；只「包裝呼叫」與「新增資料庫 sink」。行為/評價/向量等資料在白名單合作範圍內共享、對外不揭露，且**永不寫進公開 repo**（合作範圍模型詳見 `CLAUDE.md`）。

---

## ① 可直接貼給 Claude Code 的提示詞

```
你是資深 Python 後端工程師。請為「Tender AI」建立後端服務與背景工作。

## 背景
這是一套台灣政府標案（PCC + 北醫 TMU）的案源決策系統。既有 Python 爬蟲 tender_daily.py
每日產出標案資料（目前只輸出靜態 HTML）。我要把它升級成有資料庫 + RAG + 行為學習的後端，
供 Next.js 前端與後台 admin 使用。完整資料模型見本檔附錄 B，API 見附錄 C。

## 技術棧（請嚴格採用）
- Python 3.12、FastAPI、Uvicorn
- SQLAlchemy 2.0（async）+ Alembic 遷移；psycopg 3 驅動
- Pydantic v2 + pydantic-settings（讀 .env）
- PostgreSQL 16 + pgvector（關聯式 + 向量同一引擎；HNSW、cosine）
- 背景排程：APScheduler（每日 ingest、embeddings 批次、學習工作）
- Embeddings：呼叫本機 Ollama HTTP（模型 bge-m3 或 nomic-embed-text）
- 摘要/可行性推理：Anthropic Messages API（高品質）
- HTML 解析（歷史回填）：lxml / BeautifulSoup4
- 測試：pytest + httpx + 一個 docker 的 postgres（或 testcontainers）
- 容器：docker-compose（postgres-pgvector、api、worker；ollama 可選）

## 限制
- 不要重寫 tender_daily.py 的 scraper 核心；以 import 或 subprocess 包裝，新增一個
  「寫入 Postgres」的 sink，靜態 HTML 輸出保留為降級備援。
- 行為、評價、註記、決策向量在白名單合作範圍內共享（依登入帳號具名），只進自架 DB、不可進任何公開 repo，對外不揭露。
- 程式碼註解可用繁體中文；對外字串繁中為主。

## 任務（依序、每階段可獨立驗收，見附錄 D）
P1 專案骨架 + DB schema（Layer A）+ Alembic + docker-compose + 歷史回填 parser
P2 標案查詢 API（篩選/排序/分頁，對應前端 filter bar）+ Layer B 行為 API
P3 Embeddings pipeline（Ollama→pgvector）+ /search/semantic + /tenders/{id}/similar
P4 學習工作：行為 → keyword_weights（重點/避免關鍵字建議）+ admin API
P5 可行性助手：decision_vectors + Anthropic 生成可行性分數與理由 + 排序

先做 P1，完成後跑起 docker-compose、Alembic migrate、回填歷史、附 pytest 綠燈，
再回報並等我確認才進 P2。每階段提供：變更摘要、如何本地執行、如何測試。
```

---

## ② 專案結構（建議 Claude Code 產生）

```
tender-ai-backend/
├── pyproject.toml
├── docker-compose.yml
├── .env.example
├── alembic.ini
├── alembic/versions/
├── app/
│   ├── main.py                 # FastAPI app, router 掛載, lifespan(啟動 APScheduler)
│   ├── core/config.py          # pydantic-settings
│   ├── core/security.py        # 認證（小團隊：API key / 信任 Cloudflare Access header）
│   ├── db/session.py           # async engine / session
│   ├── db/base.py
│   ├── models/                 # SQLAlchemy models：tender, daily_run, event, evaluation…
│   ├── schemas/                # Pydantic I/O
│   ├── api/v1/                  # routers：tenders, behavior, search, admin
│   ├── services/
│   │   ├── ingest.py           # 包裝 tender_daily.py、upsert 進 DB
│   │   ├── backfill.py         # 解析 tender-reports/reports/*.html 回填
│   │   ├── embeddings.py       # Ollama client → pgvector
│   │   ├── feasibility.py      # 分數 + Anthropic 理由
│   │   └── learning.py         # 行為 → keyword_weights
│   └── jobs/scheduler.py       # APScheduler：daily_ingest / embed_new / learn / score
└── tests/
```

---

## ③ 環境變數（`.env.example`）

```
DATABASE_URL=postgresql+psycopg://tender:tender@localhost:5432/tenderai
OLLAMA_URL=http://localhost:11434
EMBED_MODEL=bge-m3
ANTHROPIC_API_KEY=        # 高品質推理/摘要；放系統 secret，勿入版控
PCC_SCRAPER_PATH=../tender-bot/tender_daily.py
APP_API_KEY=             # 簡易後端保護（前端/Cloudflare Access 帶入）
```

---

## 附錄 A：docker-compose 重點

- `postgres`：用 `pgvector/pgvector:pg16` 映像（內建 extension）；啟動後 `CREATE EXTENSION IF NOT EXISTS vector;`（放進 Alembic 第一個 migration）。
- `api`：uvicorn `app.main:app`。
- `worker`：同 image，跑 APScheduler（或與 api 同進程，用 lifespan 啟動；小規模可同進程）。
- `ollama`：可選，或連宿主既有 Ollama。

## 附錄 B：資料模型（摘要，完整見 `規劃-後台資料庫與RAG學習迴圈.md`）

- **Layer A 標案 Corpus**：`sources`、`tenders`（case_pk 去重、name/org/category/budget_wan/deadline_iso/city/link）、`daily_runs`、`daily_tender`。
- **Layer B 行為（白名單合作範圍內共享、對外私有）**：`users`、`events`(view/open/click/dwell/filter/search)、`tender_user_state`(saved/status/star)、`annotations`、`evaluations`(feasible + criteria JSON + rationale)、`shares`、`saved_searches`。
- **Layer C 知識/RAG**：pgvector 欄位——`tenders.embedding vector(1024)`（bge-m3 維度，依模型調整）、`evaluations.embedding`（decision vectors）；`keyword_weights`(term/polarity/weight/support)、`doc_summaries`。
- 索引：對 embedding 建 HNSW（`vector_cosine_ops`）。

## 附錄 C：API（v1，對應前端）

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/v1/tenders` | 篩選（tier,cat,city,src,deadline,budget_min/max,focus[],avoid[],q,sort,page）→ 清單 + count |
| GET | `/api/v1/tenders/{id}` | 單案詳情 |
| POST | `/api/v1/tenders/{id}/save` `/accept` `/rate` `/note` `/share` | 行為寫入 |
| POST | `/api/v1/events` | telemetry 埋點 |
| POST | `/api/v1/search/semantic` | 自然語言 → 向量檢索 |
| GET | `/api/v1/tenders/{id}/similar` | 相似（可選 feasible=可行） |
| GET | `/api/v1/tenders/{id}/feasibility` | 可行性分數 + 理由 |
| GET/POST | `/api/v1/saved-searches` | 提示詞/篩選預設 |
| GET/PUT | `/api/v1/admin/keywords` | 重點/避免關鍵字 + 學習建議 |
| GET/PUT | `/api/v1/admin/rules` | PRIORITY_RULES / 門檻 |
| POST | `/api/v1/admin/rerun` | 觸發重跑 |
| GET | `/api/v1/admin/runs` | 執行 log |

篩選/排序語意需與前端原型一致（見 `prototype/index.html` 的 `passes()`／`sortFn()`）。

## 附錄 D：各階段驗收

- **P1**：`docker compose up` 起 DB；`alembic upgrade head` 建表 + vector extension；`backfill` 把 `tender-reports/reports/*.html`（32 份）灌進 `tenders`；`pytest` 綠。
- **P2**：`GET /tenders` 各篩選/排序/分頁正確；行為 API 寫入可查。
- **P3**：新案自動 embed；`/search/semantic` 中文查得到相關案；`/similar` 合理。
- **P4**：`learn` 由行為產出 `keyword_weights`；admin 顯示建議。
- **P5**：`/feasibility` 回分數 + 理由；可依分數排序。

## 附錄 E：給 Claude Code 的小提醒

- scraper 在 Cowork sandbox 連不到 PCC（proxy 403）；本後端開發/測試請用**歷史回填的 HTML** 與 fixtures，不要在 CI 連 PCC。
- 先 `alembic` 管 schema，勿手改 DB。
- embedding 維度跟著 `EMBED_MODEL` 走（bge-m3 = 1024），換模型要出新 migration。

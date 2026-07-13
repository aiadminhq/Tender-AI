# App 正式部署參數（前端 + 後端）

> 這是「把 app 真的跑起來對外」的部署設定，與 `codex/environment.md`（Codex agent 環境）**不同層**。
> 前端：Vercel 靜態站；後端：FastAPI + Postgres/pgvector（公司伺服器）。

---

## 1. 前端（Vercel）

`vercel.json` 已把 monorepo 的前端設為 static build（`tender-ai-frontend/dist`），SPA fallback 到 `index.html`。

| 項目 | 值 |
| --- | --- |
| Framework preset | Other（用 repo 內 `vercel.json`） |
| Root directory | repo 根（`vercel.json` 內已指向 `tender-ai-frontend/`） |
| Build command | `pnpm --dir tender-ai-frontend run build` |
| Output directory | `tender-ai-frontend/dist` |
| Install command | `pnpm install --frozen-lockfile` |
| Node 版本 | 20 |

### 前端環境變數（Vercel → Project → Settings → Environment Variables）

| Key | Production 值 | 說明 |
| --- | --- | --- |
| `VITE_API_BASE` | `https://<後端網域>/api/v1` | 後端 API base；未設時預設 `http://localhost:8000/api/v1` |
| `VITE_API_KEY` | （放後端 `APP_API_KEY` 相同值） | 帶 `X-API-Key`；dev/staging 可不設 |
| `VITE_USE_API` | `true` | 設 `false` 進純 mock 模式（不外連） |
| `VITE_TRACK` | `true` | 埋點開關；設 `false` 關閉行為追蹤 |

---

## 2. 後端（FastAPI + Postgres/pgvector，公司伺服器）

啟動：`uv run uvicorn app.main:app --host 0.0.0.0 --port 8000`
DB：`docker compose up -d`（`pgvector/pgvector:pg16`，帳密庫名對齊預設 `DATABASE_URL`）。

### 後端環境變數（`.env`，已 gitignore；正式值放系統 secret）

| Key | Production 值 | 說明 |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+psycopg://tender:<強密碼>@<db-host>:5432/tenderai` | 正式務必覆寫密碼 |
| `OLLAMA_URL` | `http://<ollama-host>:11434` | embeddings 用；需可連 Ollama |
| `EMBED_MODEL` | `bge-m3` | 1024 維；部署後 `ollama pull bge-m3` |
| `CHAT_MODEL` | `qwen3.5:9b` | 助理生成模型 |
| `ASSISTANT_USE_LLM` | `true` | 無 Ollama 時設 `false` 退回模板 |
| `ANTHROPIC_API_KEY` | （系統 secret） | 高品質推理/摘要；勿入版控 |
| `APP_API_KEY` | （系統 secret） | 後端 API 保護；與前端 `VITE_API_KEY` 一致 |
| `CORS_ORIGINS` | `https://<前端網域>` | 逗號分隔白名單；正式填前端網域 |
| `PCC_SCRAPER_PATH` | `../tender-bot/tender_daily.py` | 抓 PCC 用；僅能連線環境跑 |

### DB compose 覆寫（正式）

| Key | 值 |
| --- | --- |
| `POSTGRES_USER` | `tender` |
| `POSTGRES_PASSWORD` | （強密碼，與 `DATABASE_URL` 一致） |
| `POSTGRES_DB` | `tenderai` |
| `POSTGRES_PORT` | `5432` |

部署後跑 migration：`uv run alembic upgrade head`（首個 migration 會 `CREATE EXTENSION vector`）。

---

## 3. 對外存取（與現有慣例一致）

- 後端建議置於 **Cloudflare Access** 之後（`env.example` CORS 註解已提到），由 Access 帶入受保護的 API。
- 前端網域與後端網域須互相對齊：`CORS_ORIGINS`（後端）↔ `VITE_API_BASE`（前端）。

---

## 4. 部署前檢查清單

- [ ] 後端 `.env` 密碼、`APP_API_KEY`、`ANTHROPIC_API_KEY` 已填且不入版控。
- [ ] `alembic upgrade head` 成功、`ollama pull bge-m3` 完成（semantic search 才可跑）。
- [ ] 前端 `VITE_API_BASE` 指向正式後端、`VITE_API_KEY` 與後端一致。
- [ ] `CORS_ORIGINS` = 前端正式網域。

---

最後更新：2026-07-10

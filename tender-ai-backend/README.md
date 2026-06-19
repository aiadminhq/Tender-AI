# Tender AI 後端

政府採購標案的 **Corpus + 行為/RAG 學習迴圈** 後端：FastAPI + PostgreSQL 16/pgvector + SQLAlchemy 2.0 async + Alembic。

接續既有的 `tender-bot` 每日報表系統——**不重寫爬蟲核心**（`tender_daily.py` 的 `tables[4]`／`SkipSSLAdapter`／PCC 連線為已測邏輯），只「讀回其歷史產出」並新增資料庫 sink 與查詢/學習層。

## 資料分層

| 層                | 內容                                                                          | 可公開？     |
| ----------------- | ----------------------------------------------------------------------------- | ------------ |
| **A 標案 Corpus** | `sources` / `tenders` / `daily_runs` / `daily_tender`，由報表回填，公開可重生 | 是（可重生） |
| **B 行為/回饋**   | 點擊、評價、註記、決策——**白名單(@hqdesign.tw)合作範圍內共享＋依登入帳號具名；不進公開 repo、對外不揭露** | 內部共享／對外否 |
| **C 知識/RAG**    | pgvector 向量（bge-m3＝1024 維，HNSW cosine）                                 | 視內容       |

> **隱私硬規則（合作範圍模型）**：Layer B 在白名單合作範圍內共享、依登入帳號具名，供同事與 AI/agent 互相學習（需公司帳號＋本人同意）；但**不進公開版控 repo**，對外揭露的向量 metadata 須去識別化、不放人名／email。詳見根目錄 `CLAUDE.md` 與 `docs/governance/`。

**目前進度＝P1（Layer A：schema + 解析器 + 歷史回填 + 綠燈測試）。** B/C 與 API 查詢於 P2+ 開發。

## 先決條件

- Python 3.12（已用 `uv` 釘版，`>=3.12,<3.13`）
- [uv](https://docs.astral.sh/uv/)
- PostgreSQL 16 + pgvector（本機 brew 或公司伺服器 docker，見下）

## 一、資料庫

### 本機開發（macOS，brew 原生）

```bash
brew install postgresql@16 pgvector
brew services start postgresql@16
PG=/opt/homebrew/opt/postgresql@16/bin   # keg-only，需用完整路徑

# 建立與預設 DATABASE_URL 一致的角色與資料庫
$PG/createuser -s tender 2>/dev/null || true
$PG/psql -d postgres -c "ALTER ROLE tender WITH PASSWORD 'tender';"
$PG/createdb -O tender tenderai
```

連線（除錯用）：

```bash
PGPASSWORD=tender /opt/homebrew/opt/postgresql@16/bin/psql -h localhost -U tender -d tenderai
```

### 公司伺服器（docker compose）

`docker-compose.yml` 提供一鍵 pgvector/pg16（認證與預設 `DATABASE_URL` 一致）：

```bash
docker compose up -d        # 起 DB
docker compose ps           # 等 healthy 再 migrate
docker compose down         # 停（保留資料卷）；down -v 才清資料
```

> 正式部署請於同層放 `.env`（已 gitignore）覆寫 `POSTGRES_PASSWORD`，並讓 `DATABASE_URL` 帶相同密碼。

## 二、安裝相依

```bash
uv sync          # 依 pyproject.toml / uv.lock 建 .venv
```

## 三、環境變數

預設值見 `app/core/config.py`，本機 brew 即使無 `.env` 也可跑。需覆寫時：

```bash
cp env.example .env          # 編輯後 .env 已被 gitignore，勿入版控
```

| 變數                | 預設                                                         | 用途                                           |
| ------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| `DATABASE_URL`      | `postgresql+psycopg://tender:tender@localhost:5432/tenderai` | 主資料庫                                       |
| `OLLAMA_URL`        | `http://localhost:11434`                                     | 本地嵌入（P3）                                 |
| `EMBED_MODEL`       | `bge-m3`                                                     | 嵌入模型；**換模型＝換維度，需出新 migration** |
| `ANTHROPIC_API_KEY` | （空）                                                       | 高品質推理/摘要（P5）；放系統 secret，勿入版控 |
| `APP_API_KEY`       | （空）                                                       | 後端簡易保護                                   |

## 四、套 schema（Alembic）

**schema 一律由 Alembic 管，勿手改 DB。**

```bash
uv run alembic upgrade head      # 建 vector extension + Layer A 四張表
uv run alembic current           # 看目前版本（head = 52513f0eb85d）
```

## 五、回填歷史報表（Layer A）

完全 offline，只讀既有 HTML 報表，不連任何外部站台（CI/sandbox 安全）；**冪等**，可重複執行：

```bash
uv run python -m app.jobs.backfill            # 預設讀 ../tender-reports/reports
uv run python -m app.jobs.backfill /path/to/reports --json backfill_report.json
```

實測（32 份報表）：去重後 **1125 筆標案**（PCC 1113／TMU 12），每日快照 4259 列；二次執行數字不變（冪等已驗證）。

## 六、測試

純函式/解析離線測試（不連 DB、不連網，CI 安全）：

```bash
uv run pytest -q
```

> DB 寫入（upsert／冪等）以「實際回填＋再跑驗證」涵蓋，不在 CI 連線測試。

## 七、跑 API（最小骨架）

```bash
uv run uvicorn app.main:app --reload
# GET /health → {"status": "ok"}
```

## 專案結構

```
app/
  core/config.py        # pydantic-settings（環境變數）
  db/{base,session}.py  # async engine / session
  models/tender.py      # Layer A ORM：Source/Tender/DailyRun/DailyTender
  services/report_parser.py  # 報表 HTML → 結構化（純函式 + BeautifulSoup，offline）
  jobs/backfill.py      # 冪等歷史回填
  main.py               # FastAPI 入口
alembic/                # 遷移（versions/）
tests/                  # offline 解析/純函式測試 + fixtures
docker-compose.yml      # 公司伺服器 DB（pgvector/pg16）
```

## 開發約束（務必遵守）

- **不重寫既有爬蟲核心**，只包裝呼叫＋新增 DB sink。
- **Layer B 資料**（行為/評價/註記/決策向量）在白名單合作範圍內共享、依登入帳號具名，但永不進公開 repo、對外不揭露。
- scraper 在 sandbox 連不到 PCC（proxy 403）；開發/測試一律用回填的 HTML 與 fixtures，**不在 CI 連 PCC**。
- schema 用 **Alembic**，勿手改 DB；換嵌入模型要出新 migration（維度跟 `EMBED_MODEL` 走）。
- 密鑰放系統 secret，勿入版控；對外揭露的向量 metadata 須去識別化、不放人名／email（合作範圍內可依登入帳號具名）。

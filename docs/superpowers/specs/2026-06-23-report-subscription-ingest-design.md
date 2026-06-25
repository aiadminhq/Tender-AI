# 報表訂閱入庫管線 — 設計文件（Stage 1）

> 日期：2026-06-23 ｜ 分支：`claude/busy-sagan-gm197s`
> 目標：讓 Tender AI 從舊系統 `aiadminhq/tender-reports` **持續訂閱**每日報表、**全量回填歷史**、**入庫**，並對**未截止/近期**標案做詳情抓取，鋪好「最終接管爬蟲」的資料底。

> **狀態（2026-06-25 補注）**：🔲 規劃中（尚未實作）。`sync_reports`／`daily_pipeline` 等尚未落地；現有 `app/jobs/ingest_daily_reports.py` 為既有匯入路徑。待排程與 Stage 1 開工。
> 本規格為設計當時記錄，內文不再回改；最新行為以程式碼與 `docs/governance/05-進度與白話術語.md` 進度表為準。

---

## 1. 背景與問題

舊系統 **tender-bot**（已上雲，GitHub Actions @ aiadminhq，每日台灣 08:00 自動爬 PCC 並發佈 HTML 日報到 `aiadminhq/tender-reports/reports/tender-YYYYMMDD.html`）是**已驗證、穩定**的爬蟲。Tender AI 已有：

- `ingest_daily_reports.py`：解析報表 HTML → 寫 `tenders`（以 `case_pk` 去重、離線、冪等）。
- `enrich_details.py`（+ `scrape_detail_cdp.py` / `scrape_detail_playwright.py`）：把報表裡 `pk=base64` 連結 → 連 PCC 詳情頁 → 落成不可變 `tender_revisions`。**唯一 live 連 PCC 的元件，CAPTCHA 閘控，只能在能連 PCC 的本機跑。**

**核心缺口（本設計要補的）**：

1. **沒有持續訂閱機制**。本地 `tender-reports/` 其實是 Tender-AI repo 的子目錄、非獨立 clone，不會自己更新；只有 32 份報表，repo 上是上線以來每日累積的全部。沒有任何排程把新報表 pull 進來。
2. `ingest_daily_reports` 只回填 `tenders` + 標註潛力，**沒寫 `daily_runs` / `daily_tender`**（每日統計與當日快照），導致 Tender AI 無法自渲染當日報表 → 無法走向「取代報表入口」。
3. 詳情抓取沒有「只抓未截止/近期」的篩選，全量歷史詳情既不必要又昂貴（CAPTCHA、慢）。

## 2. 範圍

**做（Stage 1）**：持續訂閱（獨立 clone + 定時 pull）、全量回填歷史入庫、填 `daily_runs`/`daily_tender`（鋪 Stage 2 資料底）、未截止/近期詳情抓取、本地每日編排排程、全離線測試。

**不做（另立 spec）**：Stage 3「Tender AI 自建 PCC 清單爬蟲、退役舊 tender-bot」。本次只鋪接口與資料底。

## 3. 架構

```
aiadminhq/tender-reports (GitHub，舊系統每日發佈)
        │  ① sync_reports.py：git clone + 定時 git pull（持續訂閱新資料）
        ▼
本地獨立 clone（固定路徑，含完整歷史 reports/*.html）
        │  ② ingest_daily_reports.py（強化）：解析 → 入庫
        ▼
Layer A：tenders ＋ daily_runs ＋ daily_tender（後兩者本次新填）
        │  ③ enrich_details.py（+ CDP/Playwright，加 --only-open 篩選）
        ▼
tender_revisions（Layer A 衍生；僅未截止/近期標的）
        │  ④ 離線 embed / consent-aware learn（沿用既有 job）
        ▼
AI 評分 / 語意檢索 / 自演化
```

**編排**：新增薄編排 `daily_pipeline.py`（本機 launchd，每日舊系統發報後跑）：①②④（離線恆跑）＋③（PCC 可達才跑）。各步驟失敗互不拖垮、各自記錄。

## 4. 工作單元

每個單元職責單一、介面明確、可獨立離線測試。

### 4.1 `app/jobs/sync_reports.py`（新）— 持續訂閱

- **職責**：確保本地獨立 clone 存在（不存在則 `git clone`）；`git pull --ff-only`；比對「已處理檔 hash 帳本」，回傳新增/變更的 `tender-*.html` 清單。
- **介面**：`async def sync(clone_path: Path | None = None) -> SyncResult`，其中 `SyncResult` 含 `new_files: list[Path]`、`changed_files: list[Path]`、`pulled: bool`、`offline: bool`。
- **Clone 路徑**：獨立於 Tender AI repo。預設 `~/.tenderai/tender-reports-clone`，env `TENDERAI_REPORTS_CLONE` 覆寫。Remote：`https://github.com/aiadminhq/tender-reports`。
- **離線安全**：無網路 / pull 失敗 → 記 log、`offline=True`、回傳已存在的本地檔差異（不炸）。
- **帳本**：每檔記 `path → sha256`。存放：DB 一張輕量表 `report_sync_ledger`（`filename` PK、`sha256`、`ingested_at`）優先；落地簡單、可被 ingest/pipeline 共用、可查詢。
- **冪等**：重跑只回傳 hash 變動的檔；無變動回空清單。

### 4.2 `app/jobs/ingest_daily_reports.py`（強化）— 入庫

- **保留**：既有 HTML 解析、`case_pk` 去重、潛力標註、離線冪等。
- **新增**：解析報表的每日彙總與每列 → 寫 `daily_runs`（`run_date` × `source_id` upsert：total/high/mid/low/urgent/budget_sum_wan/summary/report_file）與 `daily_tender`（`run_date` × `tender_id`：tier / days_left）。`tier` 由報表潛力等級映射（高→high、中→mid，餘 low）。
- **容錯**：逐檔解析，單檔失敗（早期報表表格結構漂移）只記 log + 計入 `parse_failures`，**不中斷整批**。
- **入口**：可接受 `reports_dir`（預設改指向 clone 的 `reports/`）或明確檔案清單（供 pipeline 傳 `sync` 的增量結果）。
- **不動**：報表 HTML 的主表為 `tables[1]`（報表自身結構，非 PCC 頁面）；與鐵則「勿重寫 PCC scraper/`tables[4]`」無關，維持現狀。

### 4.3 `app/jobs/enrich_details.py`（加篩選）— 詳情抓取

- **沿用**：revision-first 持久層、CDP/Playwright 變體、退避重試、CAPTCHA 優雅中止。**不改已驗證邏輯。**
- **新增**：CLI 旗標 `--only-open`：目標佇列僅納入 `deadline_iso >= today` 的標的，疊在既有 `new ∪ stale(TTL) ∪ retriable` 之上。「近期」定義：預設 = 未截止（`deadline_iso >= today`）；另提供 `--deadline-grace-days N`（含截止後 N 天，預設 0）。
- **鐵則**：仍是唯一 live 連 PCC 的元件；CI 絕不跑；測試 monkeypatch `fetch_detail`。

### 4.4 `app/jobs/daily_pipeline.py`（新）— 編排

- **職責**：`sync()` → `ingest(new_files)` →（離線）`embed_tenders` / consent-aware `learn`（沿用既有 job、依鐵則閘控）→ `enrich_details --only-open`（PCC 可達才跑）。
- **韌性**：每步包 try/except，單步失敗記 log 續跑下一步；回傳各步 stats 彙總。
- **入口**：`python -m app.jobs.daily_pipeline`。提供 `--skip-enrich`（純離線環境，如 CI/雲端）與 `--skip-sync`（離線重跑既有檔）旗標。
- **排程**：本機 launchd plist，每日舊系統發報後（≥ 08:30 台灣）觸發。plist 模板與安裝步驟寫入 runbook。

## 5. 資料流與冪等

- 去重：`tenders` 以 `UNIQUE(source_id, case_pk)`；PCC `source_id` 固定（沿用 backfill 既有值）。
- 帳本：`report_sync_ledger` 確保同檔不重複入庫；檔內容變更（hash 改變）才重解析。
- `daily_runs` 以 `(run_date, source_id)` upsert；`daily_tender` 以 `(run_date, tender_id)` upsert。
- 全流程可重跑、冪等；無新資料則全程 no-op。

## 6. 退役軌跡（對齊「分階段、終局接管爬蟲」）

1. **Stage 1（本設計）**：舊 tender-bot 續爬續發報；Tender AI 訂閱入庫 + 近期詳情。雙軌並行，以「入庫標案數 vs 報表列數」對帳驗證 parity。
2. **Stage 2**：`daily_runs`/`daily_tender` 填齊 → Tender AI 自渲染當日報表；與舊報表對比 K 天無落差。
3. **Stage 3（另立 spec）**：Tender AI 自建 PCC 清單爬蟲 → 退役舊 tender-bot。本次只鋪接口與資料底。

## 7. 測試（全離線、CI 安全）

- `sync_reports`：用臨時 git repo（`init` + commit fixture 報表）當 remote，斷言首次 clone、增量 pull、hash 帳本去重、離線 no-op。
- `ingest_daily_reports`：餵 fixture 報表 HTML，斷言 `tenders`、`daily_runs`、`daily_tender` 列數與欄位；含一份「結構漂移」壞檔斷言不中斷整批。
- `enrich_details --only-open`：monkeypatch `fetch_detail` 回 fixture，斷言只選 `deadline_iso >= today` 標的；grace-days 邊界。
- `daily_pipeline`：monkeypatch 各子 job，斷言步驟順序、單步失敗續跑、`--skip-enrich`/`--skip-sync` 行為。
- **鐵則**：CI 不 live 連 PCC、不連 Ollama；嵌入/學習測試離線 mock。

## 8. 鐵則對齊（CLAUDE.md）

- 不重寫已驗證 scraper / `tables[4]` / SkipSSLAdapter / SSL/重試。
- 詳情抓取仍為唯一 live 連 PCC 元件，雲端/CI 不跑。
- 分類先驗、預算軟閾值、自演化觸發閘、append-only 學習軌跡、consent-aware 團隊線 — 本設計不改 `reasoning.py`/`learn_keywords.py`，沿用既有閘控。
- Layer A 公開資料；不碰 Layer B 揭露邊界；對外不入行為資料。

## 9. 開放問題

- `daily_runs.summary` 要不要保留舊報表的整段彙總文字，或僅存結構化統計？（傾向：兩者都存，summary 存原文供回溯。）
- 帳本放 DB（`report_sync_ledger`）vs 落地 json？（傾向 DB，可被 pipeline/查詢共用。）
- launchd 失敗通知管道（log only vs 推播）？（Stage 1 傾向 log only，Stage 2 再接通知。）

# 每日標案管線自動化（Layer A → C）

> 目的：每天接手 `aiadminhq/tender-reports` 公開 repo 發布的標案索引，把後台資料庫**尚未收錄**的標案抓回、建檔，並轉成知識庫向量（Layer C）。

## 架構與資料流

```
            ┌─────────────────────────────────────────────┐
  ~08:00 TW │ GitHub Actions @ aiadminhq/tender-reports     │  ← 爬 PCC、AI 評分、
（雲端發布）│   產出 reports/tender-YYYYMMDD.html（索引頁）  │     發布每日索引
            └───────────────────────┬─────────────────────┘
                                    │ git pull（公開 repo）
  10:15 TW  ┌───────────────────────▼─────────────────────┐
（本機執行）│ launchd → run_claude_daily.sh                 │
            │   → daily_pipeline.sh（預設 direct 模式）     │
            │     （可切 TENDER_PIPELINE_MODE=claude）      │
            │                                               │
            │  Layer A  ingest_daily_reports  建索引(去重)  │  需 DB
            │           backfill              每日視圖upsert │  需 DB（offline）
            │           enrich_details        抓 PCC 建檔   │  需 DB + PCC
            │           backfill_category     回填分類      │  需 DB
            │  Layer C  embed_tenders         灌 pgvector   │  需 DB + Ollama
            └───────────────────────────────────────────────┘
```

**資料層順序＝ A → B → C**：先建 Layer A 標案 corpus，Layer B（行為/回饋）由前端使用者互動累積，Layer C（向量）由 corpus 衍生。本管線負責 **A 與 C**；**不寫入 Layer B**（紅線：Layer B 僅在白名單合作範圍內具名共享，且由 UI 行為產生）。

## 為什麼分成「雲端發布 + 本機執行」

依專案 `CLAUDE.md`／後端 `README`：**雲端／沙箱環境連不到 PCC 招標網、本機 Ollama、本機 PostgreSQL**。因此：

- 索引「發布」由 GitHub Actions（雲端）完成 —— repo 已在做，沿用現狀（約台灣 08:00 發布），**不需改動 Actions**；本機排程在其後（10:15）即可抓到當日報表。
- 「抓 PCC 詳情建檔 + 灌向量」必須在**能連到 PCC／Ollama／DB 的本機**執行 —— 由 launchd 觸發本機管線完成（預設 `direct` 直跑引擎，零 token；必要時可切 `claude` 模式）。

管線對連不到的步驟採 **fail-soft**：連線受阻就跳過該步並記錄，索引仍會照建，待能連線時補跑即可。

## runner 執行副本（TCC 根因，重要）

**症狀**：launchd 排程自 2026-06-26 起連續以 exit 126 失敗，`launchd.err.log` 反覆出現
`/bin/bash: .../run_claude_daily.sh: Operation not permitted`，導致雲端資料落後多日。

**根因**：macOS TCC 隱私保護會擋 **launchd 背景程序**讀取 `~/Desktop`／`~/Documents`／
`~/Downloads` 下的任何檔案（互動 shell 不受影響，所以手動跑都正常）。本專案工作副本在
Desktop 底下，plist 一指過去就會被擋。

**解法（2026-07-06 落地）**：在 TCC 不保護的路徑放一份**執行專用副本（runner）**，
launchd 只碰 runner，開發仍在 Desktop 工作副本進行：

```bash
# 1) 建 runner（從本機工作副本 clone，分支跟開發分支一致）
git clone --branch claude/busy-sagan-gm197s \
  "file:///Users/christianwu/Desktop/HQdesign/tender-bot/Tender AI" \
  ~/.local/share/tender-ai/runner

# 2) 建 venv
cd ~/.local/share/tender-ai/runner/tender-ai-backend && uv sync

# 3) runner 專用 .env：只放雲端 DATABASE_URL（chmod 600；值取自 Railway service variables，
#    形如 postgresql+psycopg://***@aws-0-<region>.pooler.supabase.com:5432/postgres，勿入版控）
```

**程式碼同步**：runner 是 git clone，工作副本改了管線相關程式後，需在 runner 內
`git pull origin <分支>`（或 `git fetch file:///...工作副本 <分支> && git merge FETCH_HEAD`）
再視需要 `uv sync`。管線腳本不常變動，一般只在改到 `scripts/` 或 `app/jobs/` 時需要同步。

## 檔案清單

| 檔案                                                   | 作用                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `tender-ai-backend/scripts/daily_pipeline.sh`          | 管線引擎（同步報表 → 預檢 → Layer A → Layer C）                                  |
| `scripts/automation/tender-daily.command.md`           | Claude Code slash command `/tender-daily` 的定義（待複製到 `.claude/commands/`） |
| `scripts/automation/run_claude_daily.sh`               | launchd 包裝器：載入環境後跑管線（預設 `direct` 直跑引擎；可切 `claude` 模式）   |
| `scripts/automation/com.hqdesign.tenderai.daily.plist` | launchd 排程，每日 10:15 觸發                                                    |

## 安裝（本機 macOS，一次性）

> 前置：先依上節「runner 執行副本」建好 `~/.local/share/tender-ai/runner`（含 venv 與 .env）。
> plist 範本已指向 runner 路徑；**不可改回 Desktop 路徑**（TCC 會擋，見上節）。

```bash
RUNNER="$HOME/.local/share/tender-ai/runner"

# 1) 賦予執行權限
chmod +x "$RUNNER/tender-ai-backend/scripts/daily_pipeline.sh" \
         "$RUNNER/tender-ai-backend/scripts/automation/run_claude_daily.sh"

# 2) 安裝 launchd 排程（每日 10:15）
cp "$RUNNER/tender-ai-backend/scripts/automation/com.hqdesign.tenderai.daily.plist" \
   "$HOME/Library/LaunchAgents/"
launchctl bootout   gui/$(id -u)/com.hqdesign.tenderai.daily 2>/dev/null
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.hqdesign.tenderai.daily.plist"
launchctl list | grep tenderai      # 確認已載入

# 3) 立即實測一次（真 launchd 情境，可驗證 TCC 已繞開）
launchctl kickstart gui/$(id -u)/com.hqdesign.tenderai.daily
tail -f "$RUNNER/tender-ai-backend/data/pipeline-logs/daily-$(date +%Y%m%d).log"

# （可選）安裝 Claude Code slash command 到開發工作副本
ROOT="/Users/christianwu/Desktop/HQdesign/tender-bot/Tender AI"
mkdir -p "$ROOT/.claude/commands"
cp "$ROOT/tender-ai-backend/scripts/automation/tender-daily.command.md" \
   "$ROOT/.claude/commands/tender-daily.md"
```

> GitHub Actions 發布時間**維持現狀**（約台灣 08:00），不需改動 —— 本機排程 10:15 在其後，必能抓到當日報表。若日後想更動發布時間，於 `aiadminhq/tender-reports` 既有 workflow 自行調整 `on.schedule.cron` 即可（依治理規範由本人於該 repo 提交）。

## 手動測試

```bash
# 直接跑引擎（不經 Claude）
bash "tender-ai-backend/scripts/daily_pipeline.sh"

# 或在 Claude Code 互動執行
/tender-daily

# 查看當日結果
cat tender-ai-backend/data/pipeline-logs/daily-$(date +%Y%m%d).summary.json
tail -f tender-ai-backend/data/pipeline-logs/daily-$(date +%Y%m%d).log
```

## 可調參數（環境變數）

| 變數                   | 預設                                              | 說明                                                                         |
| ---------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `TENDER_AI_ROOT`       | 專案絕對路徑                                      | 專案根覆寫                                                                   |
| `TENDER_PIPELINE_MODE` | `direct`                                          | wrapper 執行方式：`direct` 直跑引擎（零 token）／`claude` 經 `/tender-daily` |
| `REPORTS_REPO_URL`     | `https://github.com/aiadminhq/tender-reports.git` | 報表來源 repo                                                                |
| `REPORTS_CACHE`        | `~/.cache/tender-ai/tender-reports`               | 外部報表 repo 的 git clone 快取位置（**預設在專案外**，見下「版控邊界」）    |
| `ENRICH_RATE_LIMIT`    | `1.0`                                             | 每筆 PCC 抓取間隔秒數（禮貌爬取）                                            |
| `ENRICH_LIMIT`         | （無）                                            | 單次 enrich 上限，除錯用                                                     |

## 版控邊界（重要）

本管線**不會**把任何來源／中間／運維檔案提交進本 repo。落地分工如下：

| 資料                                                        | 落地位置                                          | 是否入庫                                    |
| ----------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------- |
| 外部公開 repo（`aiadminhq/tender-reports`）的 **git clone** | `~/.cache/tender-ai/tender-reports`（**專案外**） | 否（根本不在 repo 內）                      |
| 同步進來的報表 HTML（ingest 讀取源）                        | `tender-reports/reports/`（專案內）               | 否（`.gitignore` 已排除 `tender-reports/`） |
| 運行日誌／當日摘要                                          | `tender-ai-backend/data/pipeline-logs/`           | 否（已 `.gitignore`）                       |
| DB 備份 dump                                                | `tender-ai-backend/data/backups/`                 | 否（已 `.gitignore`，且 `*.dump`）          |
| PCC 原始下載                                                | `tender-ai-backend/data/downloads/`               | 否（已 `.gitignore`）                       |
| **處理完成的 Layer A / B / C**                              | PostgreSQL + pgvector（**非檔案**）               | 由 DB 承載，不經 git                        |

> 原則：**別的 repo 的 GitHub 存檔不落地進本 repo**；外部 clone 預設放專案外快取，
> 即使有人把 `REPORTS_CACHE` 覆寫回專案內，`.gitignore` 的 `**/data/tender-reports-cache/` 仍會兜底。
> 只有「處理完成」的 Layer A/B/C 結果才允許入庫——而它們存在資料庫裡，本管線不產生需提交的檔案。

## 移除排程

```bash
launchctl bootout gui/$(id -u)/com.hqdesign.tenderai.daily
rm "$HOME/Library/LaunchAgents/com.hqdesign.tenderai.daily.plist"
```

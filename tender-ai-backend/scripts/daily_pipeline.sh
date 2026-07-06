#!/usr/bin/env bash
# =============================================================================
# Tender AI — 每日標案管線（Layer A → C）
# -----------------------------------------------------------------------------
# 來源：aiadminhq/tender-reports 公開 repo（GitHub Actions 每日 10:00 TW 發布）
# 流程：
#   0. 同步公開報表 repo（git clone/pull）→ 複製新報表至專案 reports 夾
#   1. 連線預檢（PostgreSQL / Ollama / PCC）
#   2. Layer A — 標案 Corpus
#        a. ingest_daily_reports  : 解析報表、case_pk 去重、建立尚未入庫的標案索引
#        b. backfill              : 每日視圖 daily_runs/daily_tender upsert（offline）
#        c. enrich_details        : 對缺詳情者抓 PCC 標案資料建檔（需連 PCC）
#        d. backfill_category     : 回填標的分類（offline）
#   3. Layer C — 知識/RAG 向量
#        e. embed_tenders         : 把新標案灌 pgvector（only-missing；需 Ollama）
#
#   ※ Layer B（行為/回饋）由前端使用者互動累積，不在本抓取管線產生；
#     資料流順序為 A（先建 corpus）→ B（行為）→ C（向量），本腳本負責 A 與 C。
#
# 設計原則：fail-soft（連線受阻的步驟跳過而非中斷）、idempotent、完整日誌。
# =============================================================================
set -uo pipefail

# ---- 路徑設定（可用環境變數覆寫）-------------------------------------------
PROJECT_ROOT="${TENDER_AI_ROOT:-/Users/christianwu/Desktop/HQdesign/tender-bot/Tender AI}"
BACKEND_DIR="${PROJECT_ROOT}/tender-ai-backend"
REPORTS_DIR="${PROJECT_ROOT}/tender-reports/reports"          # ingest 預設讀取路徑（已 gitignore）
REPORTS_REPO_URL="${REPORTS_REPO_URL:-https://github.com/aiadminhq/tender-reports.git}"
# 外部公開 repo 的 git clone 預設放「專案外」快取，避免把別的 repo 的 .git 落地進本 repo；
# 若覆寫 REPORTS_CACHE 指回專案內，.gitignore 仍有 data/tender-reports-cache/ 兜底。
REPORTS_CACHE="${REPORTS_CACHE:-${HOME}/.cache/tender-ai/tender-reports}"

LOG_DIR="${BACKEND_DIR}/data/pipeline-logs"
DATE_TAG="$(date +%Y%m%d)"
LOG_FILE="${LOG_DIR}/daily-${DATE_TAG}.log"
SUMMARY_JSON="${LOG_DIR}/daily-${DATE_TAG}.summary.json"

# enrich / embed 參數
ENRICH_RATE_LIMIT="${ENRICH_RATE_LIMIT:-1.0}"
ENRICH_LIMIT_ARG=""
[ -n "${ENRICH_LIMIT:-}" ] && ENRICH_LIMIT_ARG="--limit ${ENRICH_LIMIT}"

mkdir -p "${LOG_DIR}" "${REPORTS_DIR}" "$(dirname "${REPORTS_CACHE}")"

# ---- 日誌工具 ---------------------------------------------------------------
log()  { printf '%s | %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "${LOG_FILE}"; }
step() { log "──────── $* ────────"; }

# 步驟結果收集（給 summary.json）
# 註：macOS 內建 bash 為 3.2，無關聯陣列（declare -A）。改用前綴變數 + 間接展開，
#     確保 launchd 無論落到哪個 bash 都能跑。步驟名僅含 [a-z_]，皆為合法變數名。
RESULT_sync=na
RESULT_ingest_daily_reports=na
RESULT_backfill_daily=na
RESULT_enrich_details=na
RESULT_backfill_category=na
RESULT_embed_tenders=na
mark()       { eval "RESULT_$1=\$2"; }   # mark <step> <ok|skip|fail>
get_result() { eval "printf '%s' \"\${RESULT_$1:-na}\""; }

log "▶ Tender AI 每日管線啟動（${DATE_TAG}）"
log "  PROJECT_ROOT = ${PROJECT_ROOT}"
log "  BACKEND_DIR  = ${BACKEND_DIR}"

if [ ! -d "${BACKEND_DIR}" ]; then
  log "✘ 找不到 BACKEND_DIR，請設定 TENDER_AI_ROOT 後重試。中止。"
  exit 1
fi
cd "${BACKEND_DIR}"

# ---- 0. 同步公開報表 repo ---------------------------------------------------
step "0. 同步報表來源 ${REPORTS_REPO_URL}"
if command -v git >/dev/null 2>&1; then
  if [ -d "${REPORTS_CACHE}/.git" ]; then
    if git -C "${REPORTS_CACHE}" pull --ff-only >>"${LOG_FILE}" 2>&1; then
      log "  git pull 成功"; mark sync ok
    else
      log "  ⚠ git pull 失敗（沿用既有快取續跑）"; mark sync warn
    fi
  else
    if git clone --depth 1 "${REPORTS_REPO_URL}" "${REPORTS_CACHE}" >>"${LOG_FILE}" 2>&1; then
      log "  git clone 成功"; mark sync ok
    else
      log "  ⚠ git clone 失敗（將直接用專案內既有報表）"; mark sync warn
    fi
  fi
  # 將快取的報表複製進專案 reports 夾（ingest 預設讀取處）
  if [ -d "${REPORTS_CACHE}/reports" ]; then
    NEW_COUNT=$(rsync -a --itemize-changes \
                  "${REPORTS_CACHE}/reports/" "${REPORTS_DIR}/" 2>>"${LOG_FILE}" \
                  | grep -c '^>f' || true)
    log "  已同步報表至專案夾，新增/更新 ${NEW_COUNT} 份"
  fi
else
  log "  ⚠ 無 git，跳過同步，使用專案內既有報表"; mark sync warn
fi

# ---- 1. 連線預檢 ------------------------------------------------------------
step "1. 連線預檢"
DB_OK=0; OLLAMA_OK=0; PCC_OK=0

# PostgreSQL（從 .env 或預設讀 DATABASE_URL 解析 host:port）
DB_URL="${DATABASE_URL:-}"
[ -z "${DB_URL}" ] && [ -f "${BACKEND_DIR}/.env" ] && \
  DB_URL="$(grep -E '^DATABASE_URL=' "${BACKEND_DIR}/.env" | head -1 | cut -d= -f2-)"
DB_URL="${DB_URL:-postgresql+psycopg://tender:tender@localhost:5432/tenderai}"
DB_HOST="$(printf '%s' "${DB_URL}" | sed -E 's#.*@([^:/]+).*#\1#')"
DB_PORT="$(printf '%s' "${DB_URL}" | sed -E 's#.*@[^:]+:([0-9]+).*#\1#')"
[ "${DB_PORT}" = "${DB_URL}" ] && DB_PORT=5432
if nc -z -w3 "${DB_HOST:-localhost}" "${DB_PORT}" >/dev/null 2>&1; then
  DB_OK=1; log "  ✓ PostgreSQL ${DB_HOST}:${DB_PORT} 可連線"
else
  log "  ✘ PostgreSQL ${DB_HOST}:${DB_PORT} 連不到 — 後續所有寫入步驟將跳過"
fi

# Ollama
OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
if curl -sf -m 3 "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; then
  OLLAMA_OK=1; log "  ✓ Ollama ${OLLAMA_URL} 可連線"
else
  log "  ✘ Ollama ${OLLAMA_URL} 連不到 — Layer C 向量化將跳過"
fi

# PCC 招標網
if curl -sf -m 5 -o /dev/null "https://web.pcc.gov.tw" 2>/dev/null; then
  PCC_OK=1; log "  ✓ PCC web.pcc.gov.tw 可連線"
else
  log "  ✘ PCC 連不到 — 詳情抓取(enrich)將跳過，索引仍會建立"
fi

run_job() {  # run_job <step-name> <gate:1|0> <gate-desc> -- <cmd...>
  local name="$1" gate="$2" desc="$3"; shift 3; shift   # 去掉 '--'
  if [ "${gate}" -ne 1 ]; then
    log "  ⏭ 跳過 ${name}（前置未滿足：${desc}）"; mark "${name}" skip; return 0
  fi
  log "  ▷ 執行 ${name}: $*"
  if uv run "$@" >>"${LOG_FILE}" 2>&1; then
    log "  ✓ ${name} 完成"; mark "${name}" ok
  else
    log "  ✘ ${name} 失敗（見日誌；續跑後續步驟）"; mark "${name}" fail
  fi
}

# ---- 2. Layer A — 標案 Corpus ----------------------------------------------
step "2. Layer A：建立／擴充標案 Corpus"
run_job ingest_daily_reports "${DB_OK}" "需 PostgreSQL" -- \
  python -m app.jobs.ingest_daily_reports
# 每日視圖（daily_runs / daily_tender）只有 backfill 會寫；冪等 upsert、純離線解析
run_job backfill_daily "${DB_OK}" "需 PostgreSQL" -- \
  python -m app.jobs.backfill "${REPORTS_DIR}" --json "${LOG_DIR}/backfill_report.json"
run_job enrich_details "$(( DB_OK & PCC_OK ))" "需 PostgreSQL + PCC" -- \
  python -m app.jobs.enrich_details --trigger daily --source PCC \
         --rate-limit "${ENRICH_RATE_LIMIT}" ${ENRICH_LIMIT_ARG}
run_job backfill_category "${DB_OK}" "需 PostgreSQL" -- \
  python -m app.jobs.backfill_category

# ---- 3. Layer C — 知識/RAG 向量 --------------------------------------------
step "3. Layer C：灌入語意向量（pgvector）"
run_job embed_tenders "$(( DB_OK & OLLAMA_OK ))" "需 PostgreSQL + Ollama" -- \
  python -m app.jobs.embed_tenders

# ---- 摘要 -------------------------------------------------------------------
step "完成摘要"
{
  printf '{\n'
  printf '  "date": "%s",\n' "${DATE_TAG}"
  printf '  "preflight": {"db": %s, "ollama": %s, "pcc": %s},\n' "${DB_OK}" "${OLLAMA_OK}" "${PCC_OK}"
  printf '  "steps": {'
  first=1
  for k in sync ingest_daily_reports backfill_daily enrich_details backfill_category embed_tenders; do
    v="$(get_result "$k")"
    [ ${first} -eq 0 ] && printf ', '
    printf '"%s": "%s"' "$k" "$v"; first=0
  done
  printf '},\n'
  printf '  "log": "%s"\n' "${LOG_FILE}"
  printf '}\n'
} | tee "${SUMMARY_JSON}" | tee -a "${LOG_FILE}"

log "✓ 摘要已寫入 ${SUMMARY_JSON}"
log "■ 管線結束"

# 任一核心步驟 fail → 回傳非 0（方便 launchd / CI 監看），但連線跳過不算失敗
for k in ingest_daily_reports enrich_details backfill_category embed_tenders; do
  [ "$(get_result "$k")" = "fail" ] && exit 2
done
exit 0

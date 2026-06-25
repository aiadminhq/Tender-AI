#!/usr/bin/env bash
# launchd 觸發的包裝器：載入登入環境後執行每日管線。
#
# 執行方式由 TENDER_PIPELINE_MODE 決定（預設 direct）：
#   direct（預設）：直接跑 daily_pipeline.sh —— 純確定性、零 token 成本，管線本身不需 LLM。
#   claude        ：以 Claude Code headless 跑 /tender-daily（可讀結果、對異常反應；會耗額度）。
# 設為 claude 但找不到 claude CLI 時，自動退回 direct（確保資料仍會更新）。
set -uo pipefail

PROJECT_ROOT="${TENDER_AI_ROOT:-/Users/christianwu/Desktop/HQdesign/tender-bot/Tender AI}"
PIPELINE_MODE="${TENDER_PIPELINE_MODE:-direct}"
LOG_DIR="${PROJECT_ROOT}/tender-ai-backend/data/pipeline-logs"
mkdir -p "${LOG_DIR}"
WRAP_LOG="${LOG_DIR}/launchd-$(date +%Y%m%d).log"

# 載入使用者環境（uv / claude / git 通常在這些路徑）
[ -f "${HOME}/.zprofile" ] && source "${HOME}/.zprofile" 2>/dev/null
[ -f "${HOME}/.zshrc" ] && source "${HOME}/.zshrc" 2>/dev/null
export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.local/bin:${PATH}"

cd "${PROJECT_ROOT}" || exit 1
echo "$(date '+%F %T') | launchd 觸發每日管線（mode=${PIPELINE_MODE}）" >>"${WRAP_LOG}"

if [ "${PIPELINE_MODE}" = "claude" ] && command -v claude >/dev/null 2>&1; then
  echo "$(date '+%F %T') | 以 Claude Code headless 執行 /tender-daily" >>"${WRAP_LOG}"
  claude -p "/tender-daily" --permission-mode acceptEdits >>"${WRAP_LOG}" 2>&1
  rc=$?
else
  [ "${PIPELINE_MODE}" = "claude" ] && \
    echo "$(date '+%F %T') | 指定 claude 模式但找不到 claude CLI，退回直接執行" >>"${WRAP_LOG}"
  echo "$(date '+%F %T') | 直接執行 daily_pipeline.sh" >>"${WRAP_LOG}"
  bash "${PROJECT_ROOT}/tender-ai-backend/scripts/daily_pipeline.sh" >>"${WRAP_LOG}" 2>&1
  rc=$?
fi
echo "$(date '+%F %T') | 結束 rc=${rc}" >>"${WRAP_LOG}"
exit ${rc}

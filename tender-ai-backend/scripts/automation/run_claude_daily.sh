#!/usr/bin/env bash
# launchd 觸發的包裝器：載入登入環境後，以 Claude Code headless 執行 /tender-daily。
# 若無 claude CLI 或 headless 失敗，退回直接執行管線腳本（確保資料仍會更新）。
set -uo pipefail

PROJECT_ROOT="${TENDER_AI_ROOT:-/Users/christianwu/Desktop/HQdesign/tender-bot/Tender AI}"
LOG_DIR="${PROJECT_ROOT}/tender-ai-backend/data/pipeline-logs"
mkdir -p "${LOG_DIR}"
WRAP_LOG="${LOG_DIR}/launchd-$(date +%Y%m%d).log"

# 載入使用者環境（uv / claude / git 通常在這些路徑）
[ -f "${HOME}/.zprofile" ] && source "${HOME}/.zprofile" 2>/dev/null
[ -f "${HOME}/.zshrc" ] && source "${HOME}/.zshrc" 2>/dev/null
export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.local/bin:${PATH}"

cd "${PROJECT_ROOT}" || exit 1
echo "$(date '+%F %T') | launchd 觸發每日管線" >>"${WRAP_LOG}"

if command -v claude >/dev/null 2>&1; then
  echo "$(date '+%F %T') | 以 Claude Code headless 執行 /tender-daily" >>"${WRAP_LOG}"
  claude -p "/tender-daily" --permission-mode acceptEdits >>"${WRAP_LOG}" 2>&1
  rc=$?
else
  echo "$(date '+%F %T') | 找不到 claude CLI，改直接執行 daily_pipeline.sh" >>"${WRAP_LOG}"
  bash "${PROJECT_ROOT}/tender-ai-backend/scripts/daily_pipeline.sh" >>"${WRAP_LOG}" 2>&1
  rc=$?
fi
echo "$(date '+%F %T') | 結束 rc=${rc}" >>"${WRAP_LOG}"
exit ${rc}

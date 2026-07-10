#!/usr/bin/env bash
# Codex 雲端環境「設定腳本 / Setup script」
# ─────────────────────────────────────────────────────────────
# 用途：容器建立後、agent 開始工作前，安裝相依、備妥可離線驗證的環境。
# 對應 Claude Code on the Web 的 SessionStart hook。
#
# 前提（跟 Claude Code 一樣的邊界）：
#   • 雲端容器用完即丟，沒 push 就不存在。
#   • 連不到 PCC 招標網與本機 Ollama；semantic search / 抓網頁需在能連線的環境驗證。
#   • 後端 DB 整合測試在無 Postgres 時自動 skip（見 tests/conftest.py）。
#
# 網路：此腳本階段允許對外（裝套件用）；agent 執行階段建議關閉對外網路。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "▶ Tender AI monorepo 根目錄：$ROOT"

# ── 後端：Python 3.12 + uv ──────────────────────────────────
echo "▶ [backend] uv sync（Python 3.12）"
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
cd "$ROOT/tender-ai-backend"
uv sync

# ── 前端：Node + pnpm ───────────────────────────────────────
echo "▶ [frontend] pnpm install（frozen lockfile）"
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable
  corepack prepare pnpm@latest --activate
fi
cd "$ROOT/tender-ai-frontend"
pnpm install --frozen-lockfile

echo "✅ 設定完成。可離線驗證："
echo "   後端：cd tender-ai-backend && uv run pytest        （無 DB 的測試自動 skip）"
echo "   前端：cd tender-ai-frontend && pnpm run build && pnpm test"

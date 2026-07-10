# CLI 大腦 × Railway 部署（內部開發專用）

> **定位**：這條路徑（`provider=cli`）是 **Aaron 內部開發／實驗專用**，不是正式環境大腦。
> 正式環境固定走 **byok**（OpenRouter/Anthropic 相容端點，見根 `Dockerfile` 與
> 記憶 `byok-openrouter-compat-endpoint`）。本文件回答決策 2：
> 「CLI provider 留作內部開發使用，並查如何讓 Railway 安裝並使用 claude」。
>
> 程式面：`app/services/brain.py`（provider 路由）＋ `app/services/brain_cli_registry.py`
> （各 CLI 的 argv／parser／model_flag 單一事實來源）。MCP 接入見 `MCP_BRIDGE.md`。

---

## 1. 為什麼要「在 Railway 裝 claude」

CLI 大腦的原理：後端 `brain._stream_cli` 會 `subprocess` 起一個 headless CLI
（預設 `claude -p "<prompt>" --allowedTools mcp__tender-ai-brain --output-format
stream-json --verbose`），讓 CLI 以**它自己的雲端快模型**跑 agentic 檢索（透過
tender-ai-brain MCP 查 DB／知識庫），再把 `stream-json` 事件解析成前端的
progress／delta。因此若要在雲端跑這條路徑，執行環境**必須有 `claude` 可執行檔**。

正式映像刻意**不含** Node/claude CLI（縮小攻擊面與體積），所以另備一個
`Dockerfile.cli-brain` 專供此用途。

## 2. 怎麼裝（Dockerfile.cli-brain）

`tender-ai-backend/Dockerfile.cli-brain` 在正式 Python 映像上多做三件事：

1. 裝 Node.js LTS（NodeSource 22.x；claude CLI 需 Node ≥ 18）。
2. `npm install -g @anthropic-ai/claude-code`（build 時固定版本，升級手動 bump）。
3. 其餘（uv sync、COPY、alembic migration、uvicorn 啟動）與正式映像一致。

## 3. 在 Railway 怎麼用

**建議做法：另開一個 internal service，與正式 service 隔離**（正式 service 續用根
`Dockerfile`／byok，不受影響）。

1. 在該 internal service 的建置設定指定：

   ```toml
   # railway.toml（該 service 專用）
   [build]
   dockerfile = "Dockerfile.cli-brain"
   ```

   或於 Railway UI 的 service settings 指定 Dockerfile 路徑。

2. **認證（runtime secret，只走 Railway 變數，勿入映像/版控）**
   - claude CLI 需登入憑證。headless 環境用其一：
     - `CLAUDE_CODE_OAUTH_TOKEN`（推薦；`claude setup-token` 於本機產生後貼到 Railway 變數），或
     - `ANTHROPIC_API_KEY`（走 API 計費）。
   - ⚠️ 這與後端 `settings.anthropic_api_key`（byok 用）是**不同用途**的金鑰，別混用同一格。

3. **MCP 注入**：CLI 需能連上 `tender-ai-brain` MCP（stdio）。兩種做法：
   - 在映像內 COPY 一份預先產好的 `~/.claude.json`（含 `mcpServers.tender-ai-brain`
     指向 `uv run python -m app.mcp_server`，見 `MCP_BRIDGE.md`），或
   - 於 entrypoint 由環境變數在 runtime 生成 `~/.claude.json`。
   - 前提：該 service 也要能連到 Postgres（`DATABASE_URL`），MCP server 才起得來。

4. **切換到 CLI 大腦**：provider 由全域單列設定（`assistant_brain_config`）決定，
   從 UI 的大腦設定切 `cli` + `cli_agent=claude`（可選 `cli_model`）。
   預設仍是 byok/ollama，不會自動走 CLI。

## 4. 已知限制與紅線

- **雲端無本機 Ollama**：語意類 MCP 工具（semantic_search 等）在雲端會退化（見
  `MCP_BRIDGE.md` 先決條件 3、記憶 `byok-openrouter-compat-endpoint`）。CLI 大腦仍可用
  純 DB 檢索工具。
- **祕密紅線**：CLI 生成路徑本身不碰 secret（安全邊界落在 MCP tool-output 層，只回
  A 層＋去識別化 C 層）；但 claude CLI 的**認證 token 屬 runtime secret**，務必只經
  Railway 變數注入，不寫進映像、不入版控（見 CLAUDE.md）。
- **成本／延遲**：agentic 多輪工具呼叫比 byok 單次串流貴且慢，故僅供內部開發，不作正式預設。
- **stream-json 相容性**：`brain._parse_claude_line` 依賴 `type=assistant`（含 tool_use）
  與 `type=result` 事件格式；升級 CLI 版本後需回歸驗證解析仍正確。

## 5. 本機 vs 雲端

| 環境                     | claude CLI                | 建議                                |
| ------------------------ | ------------------------- | ----------------------------------- |
| 本機開發                 | 直接用本機已裝的 claude   | 最省事，MCP 走本機 `~/.claude.json` |
| Railway internal service | 用 `Dockerfile.cli-brain` | 僅內部實驗；認證走 Railway 變數     |
| Railway 正式 service     | ❌ 不裝                   | 固定 byok（根 `Dockerfile`）        |

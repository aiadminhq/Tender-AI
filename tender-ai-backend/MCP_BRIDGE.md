# DB 大腦 MCP 介面（給外部 CLI 接入）

> 目的：本地 Ollama「生成」很慢。這個 MCP server 把 Tender AI 的**檢索大腦**
> （Postgres/pgvector + 既有 services）與**部分行為回寫**包成工具，讓
> Claude Code / Codex / Hermes / opencli 等 CLI 接上後，**用它們自己的雲端快模型**
> 做推理判斷，只把「查資料／寫行為」交給本服務——繞開慢的本地生成。
>
> 程式：[`app/mcp_server.py`](app/mcp_server.py)。傳輸：**stdio**。

---

## 先決條件

1. 本機已起 Postgres（含 pgvector）且 `DATABASE_URL` 等設定可用（同後端平常跑法）。
2. 已安裝相依：在 `tender-ai-backend/` 下 `uv sync`。
   - 若 `uv sync` 卡在 `cryptography` 從源碼編譯：本專案已把它鎖在 `<49`（有預編 wheel）。
     仍失敗時可改用 `uv pip install --only-binary=:all: 'mcp[cli]'`。
3. **語意類工具**（`semantic_search` / `recommend` / `search_knowledge` / `explain_tender`）
   需要本機 Ollama 在線做「單筆查詢嵌入」（`bge-m3`，這是短嵌入、非慢速 chat 生成）。
   Ollama 不在線時，這些工具回友善錯誤，不影響其他純 DB 工具。

## 啟動方式

CLI 端通常**不需要手動啟動**——MCP client 會依設定自行 spawn 這個程序。手動測試可跑：

```bash
cd tender-ai-backend
uv run python -m app.mcp_server      # stdio，等待 client 連入
```

## 操作帳號（行為回寫綁定誰）

以環境變數 `TENDER_MCP_USER` 指定操作帳號（email 或帳號名）：

- 設了且查得到 → 讀取會帶「該帳號自己的」收藏/狀態；寫入（save/status/star/note/event）落在該帳號。
- 沒設或查無 → 讀取走匿名；寫入落到預設使用者。

> 是否把行為**具名併入團隊共享知識庫**，仍由既有 consent-aware 流程
> （`whitelist_active && consent_shared`）在下游 job 決定，本介面不繞過、不提前共享。

---

## 各 CLI 設定

> 將 `<ABS>` 換成 `tender-ai-backend` 的絕對路徑。

### Claude Code

```bash
claude mcp add tender-ai-brain \
  --env TENDER_MCP_USER=alex@hqdesign.tw \
  -- uv --directory <ABS> run python -m app.mcp_server
```

或寫進專案 `.mcp.json`：

```json
{
  "mcpServers": {
    "tender-ai-brain": {
      "command": "uv",
      "args": ["--directory", "<ABS>", "run", "python", "-m", "app.mcp_server"],
      "env": { "TENDER_MCP_USER": "alex@hqdesign.tw" }
    }
  }
}
```

### Codex（`~/.codex/config.toml`）

```toml
[mcp_servers.tender-ai-brain]
command = "uv"
args = ["--directory", "<ABS>", "run", "python", "-m", "app.mcp_server"]
env = { TENDER_MCP_USER = "alex@hqdesign.tw" }
```

### Hermes / opencli / 其他支援 MCP 的 CLI

任何吃「stdio MCP server」設定的 client 都用同一組：

- **command**：`uv`
- **args**：`["--directory", "<ABS>", "run", "python", "-m", "app.mcp_server"]`
- **env**：`{ "TENDER_MCP_USER": "<你的帳號>" }`
- **transport**：stdio

（沒有 `uv` 時，改用該環境的 venv：`command` = `<ABS>/.venv/bin/python`，
`args` = `["-m", "app.mcp_server"]`，並設 `cwd` = `<ABS>`。）

---

## 工具一覽

| 工具                | 用途                                    | 需 Ollama      |
| ------------------- | --------------------------------------- | -------------- |
| `search_tenders`    | 關鍵字/條件篩選標案清單（含可行度分數） | 否             |
| `get_tender`        | 單案完整詳情（含本帳號自己的收藏/狀態） | 否             |
| `similar_tenders`   | 以既有向量找相似標案                    | 否             |
| `criteria_profile`  | 本帳號承標判準輪廓（去識別聚合）        | 否             |
| `semantic_search`   | 自然語言語意檢索標案                    | 是（查詢嵌入） |
| `recommend`         | 由相似已評估案例聚合承接傾向（P5）      | 是             |
| `search_knowledge`  | 公開領域知識庫檢索                      | 是             |
| `explain_tender`    | 單案推薦理由/評分解釋                   | 是             |
| `save_tender`       | 收藏/取消收藏                           | 否（寫入）     |
| `set_tender_status` | 追蹤狀態（觀望/備標中/已投/得標/放棄）  | 否（寫入）     |
| `rate_tender`       | 1–5 星評分                              | 否（寫入）     |
| `add_tender_note`   | 新增人工筆記                            | 否（寫入）     |
| `log_event`         | 互動埋點（view/open_detail/…）          | 否（寫入）     |

---

## ⚠️ Layer B 紅線（為什麼工具輸出長這樣）

工具輸出會被送進 CLI 自帶的**外部模型**，等同 `app/services/llm.py`
「不把 Layer B 行為明細送外部模型」的約束延伸到這裡：

- 檢索工具一律只回 **Layer A 公開標案資料** ＋ **去識別化 Layer C**（相似度/權重/聚合傾向）。
- 個人狀態（收藏/狀態/星等）**只回操作帳號自己的**那一份，不揭露他人具名行為。
- 向量/聚合結果**不含人名、email**。
- 行為回寫只綁操作帳號；具名併入團隊共享庫仍交由下游 consent-aware job 決定。

> 這是**暫時**介面：目的是在本地生成慢的期間，借 CLI 的快模型做推理。
> 仍受同一套資料治理約束——對非白名單對象永不揭露、不進任何公開 repo / GitHub Pages。

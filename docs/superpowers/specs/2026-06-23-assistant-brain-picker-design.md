# 小助手大腦可選（Assistant Brain Picker）設計

> 日期：2026-06-23 ｜ 分支：`claude/busy-sagan-gm197s` ｜ 狀態：定案、實作中（CLI 切片優先）

> **狀態（2026-06-25 補注）**：🟢 部分實作（2026-06-24）。三 provider 路由器已建；`cli`（Claude Code CLI，現為**預設大腦**）與 `ollama` 已通、設定頁可顯示／指派目前大腦；`byok`（自帶金鑰）延後。對應 commit `5213b0b`、`81a9e89`、`742f71a`。
> 本規格為設計當時記錄，內文不再回改；最新行為以程式碼與 `docs/governance/05-進度與白話術語.md` 進度表為準。

## 0. 目標與範圍

讓使用者在「設定」頁選擇 AI 助手視窗（浮窗 / 指揮中心整頁）背後的「大腦」由哪個
provider 服務：

- **`cli`**（優先交付）：把選定的本機 CLI（Claude Code / Codex / Hermes，皆已注入
  `tender-ai-brain` MCP）以 headless agentic 方式 spawn，讓它自主呼叫 MCP 工具做檢索＋推理。
- **`byok`**（次之）：以使用者自帶金鑰直連雲端 LLM（Anthropic 等）。
- **`ollama`**（既有）：本機 Ollama 換模型，即現行 `llm.stream_chat` 路徑。

**範圍邊界（YAGNI）**

- 開發期單機單操作者 → **全域單一設定**，不做 per-user / admin / 多租戶。
- 不做 Open Design 那套重偵測格（B 方案已否決）；採「精簡三 provider 路由器」(A)，
  以「切片交付」(C) 先出 CLI。
- 雲端 ephemeral 環境連不到 Postgres / Ollama / CLI → 本次交付 = 程式碼 + 離線單元測試；
  真正 spawn CLI 的 live 驗證留在本機。

## 1. 資料模型

新增單列設定表 `assistant_brain_config`（固定 `id=1`，get-or-create）。

| 欄位            | 型別                   | 說明                                                             |
| --------------- | ---------------------- | ---------------------------------------------------------------- |
| `id`            | `int` PK               | 固定 1                                                           |
| `provider`      | `String(16)`           | `cli` ｜ `byok` ｜ `ollama`；預設 `ollama`（無設定時即現行行為） |
| `ollama_model`  | `String(64)` nullable  | provider=ollama 時的模型；NULL → 用 `settings.chat_model`        |
| `cli_agent`     | `String(32)` nullable  | provider=cli 時的 CLI：`claude` ｜ `codex` ｜ `hermes`           |
| `byok_protocol` | `String(16)` nullable  | provider=byok 的協定：`anthropic`（v1 先支援）                   |
| `byok_base_url` | `String(256)` nullable | 可選自訂 endpoint                                                |
| `byok_model`    | `String(64)` nullable  | provider=byok 的模型                                             |
| `byok_key_set`  | `bool`                 | 金鑰是否已設定（**只存布林**；金鑰本體放 `.env`，永不入庫/版控） |
| `updated_at`    | `DateTime(tz)`         | server_default now()、onupdate now()                             |

**金鑰隔離**：BYOK 金鑰只進 `.env`（gitignored）對應的 `settings.anthropic_api_key`；
DB 僅存 `byok_key_set` 布林供 UI 顯示「已設定／未設定」。CLI 切片完全不碰任何 secret
（CLI 用自身既有登入），故可先行交付。

Migration：`down_revision = a8f2c1e7b9d4`（目前 head），`op.create_table` + seed 一列
`id=1, provider='ollama'`（或交給 service get-or-create，migration 不強制 seed）。

## 2. `brain.py` 介面（provider 路由器）

新增 `app/services/brain.py`，把「怎麼生成」從 `assistant.py` 抽出：

```python
@dataclass
class BrainChunk:
    kind: Literal["delta", "progress"]   # delta=答案增量(由 assistant.py 累積) / progress=暫態狀態
    text: str

class BrainError(RuntimeError): ...

async def stream(
    *, config, messages, prompt, history, focus_note
) -> AsyncIterator[BrainChunk]:
    ...
```

- **避免循環匯入**：`assistant.py` 負責組好 Layer-A grounding `messages`（系統提示＋候選清單＋
  知識庫片段）後傳入；ollama / byok 路徑直接用 `messages`；cli 路徑改用 `prompt`/`history`/
  `focus_note`（CLI 自己跑 MCP 檢索，忽略 `messages`）。
- **delta 語意**：沿用既有 — `llm.stream_chat` yield「增量」，`assistant.py` 累積成全文再以
  `AssistantChatDeltaOut(text=累積全文)` 送出（前端 replace）。故 brain 層 ollama 仍 yield 增量；
  CLI 路徑最終以一筆 delta = 完整結果文字（累積到單塊）+ 每個 tool call 的 progress 行。
- **provider 分派**：
  - `ollama` → 包 `llm.stream_chat(messages, model=config.ollama_model)`，逐塊 `BrainChunk("delta", chunk)`。
  - `byok` → httpx 直連雲端 API（v1 anthropic messages stream），逐塊 `BrainChunk("delta", chunk)`；
    金鑰取自 `settings`，**不落 Layer B**（messages 已是公開證據）。
  - `cli` → spawn headless CLI（見 §3），tool_use → `BrainChunk("progress", ...)`，
    最終結果 → `BrainChunk("delta", 全文)`。
- **失敗策略**：任一 provider 失敗 raise `BrainError`，`assistant.py` 比照現行 `LlmError`
  退回 `_format_answer` 模板（HTTP 仍 200，`used_llm=False`）。

## 3. Agentic 串流協定（CLI 路徑）

v1 先實作 Claude Code headless：

```
claude -p "<prompt>" --output-format stream-json --verbose
```

逐行解析 stream-json：

- `type=assistant` content blocks：`text` → 累積成答案；`tool_use` → 發一筆
  `BrainChunk("progress", "查詢中：<tool_name>")`。
- `type=result` → 取最終文字，發一筆 `BrainChunk("delta", 全文)`。
- `codex` / `hermes`：v1 先 raise `BrainError`（→ 退回模板）；命令字串可設定，預留接點。

**前端協定擴充（向後相容）**：新增 NDJSON 事件型別 `progress`。

- 後端 schema：`AssistantChatProgressOut(type=Literal["progress"]="progress", text: str)`。
- `assistant.py`：迴圈改為 `async for c in brain.stream(...)`；`c.kind=="progress"` → 直接
  `yield _json_line(AssistantChatProgressOut(text=c.text))`；`c.kind=="delta"` → 累積進 `acc`、
  比照現行門檻送 `AssistantChatDeltaOut(text="".join(acc))`。deadline / fallback / 留存邏輯不變。
- 前端 `lib/assistant.ts`：`handleLine` switch 增 `progress` → 新 handler `onProgress?(text)`；
  `meta`/`delta`/`done` 不動。`use-assistant-chat.ts`：`onProgress` 顯示暫態狀態行
  （下一筆 delta 到達即清除），不寫入 turn 文字。

## 4. 設定 UI

- 後端 API：新增 `app/api/v1/settings.py`，`GET /settings/brain`、`PUT /settings/brain`
  （`Depends(get_session)` + `await session.commit()`），於 `api/v1/__init__.py` include。
  PUT 不接受金鑰本體（金鑰走 `.env`）；只更新 provider / 各 model / cli*agent / byok*\* 非密欄位。
- 前端：`src/lib/brain.ts`（fetch GET/PUT，沿用 `API_BASE` + `authHeaders`）、
  `src/components/settings/brain-picker.tsx`（Card：provider 三選一 + 對應子欄位），
  掛進 `settings-page.tsx`；i18n `strings.ts` 補 zh/en 成對鍵。House style 沿用既有
  shadcn Card / Noto Sans TC / 16px 圓角。

## 5. Layer B 驗證點（兩處一致紅線）

1. **`assistant.py` prompt 組裝（ollama / byok 路徑）**：送入外部/本機模型的 prompt 只含
   Layer A 公開欄位＋公開領域知識；`llm.py` 註解鐵則不變（不落任何 Layer B 行為明細）。
2. **MCP tool-output 層（cli agentic 路徑）**：CLI 自主呼叫 `tender-ai-brain` MCP，安全邊界落在
   工具輸出層 — 只回 Layer A ＋去識別化 Layer C，個人狀態限操作帳號、不含姓名/email
   （見 `MCP_BRIDGE.md`）。assistant.py 在此路徑不組裝個資。

**已知限制（v1 可接受）**：CLI 模式下後端收集的 `sources` 來源卡可能與 CLI 自身 MCP 檢索結果
分歧；v1 仍顯示後端 sources，未來再對齊。

## 6. 測試

離線單元測試（不連 Ollama/CLI/Postgres）：

- `brain.py`：ollama provider 以 monkeypatch 假 `llm.stream_chat` 驗證增量轉發；cli provider
  以假 stream-json 行驗證 tool_use→progress、result→delta 解析；失敗→`BrainError`。
- `brain_config` service：get-or-create 單列、PUT 更新欄位。
- settings API：GET 預設 ollama、PUT 後 GET 反映變更、金鑰本體不入回應。
- 前端 `assistant.test.ts`：`progress` 事件路由到 `onProgress`，不污染 `onText`。

## 7. 交付順序

1. `AssistantBrainConfig` model + 註冊 `models/__init__.py`
2. Alembic migration（down_revision=a8f2c1e7b9d4）
3. `brain.py`（ollama + cli + byok provider、BrainChunk、BrainError）
4. `brain_config.py` service（get-or-create 單列）
5. `AssistantChatProgressOut` schema
6. wire `assistant.py:stream_chat_events`
7. settings GET/PUT API + 註冊 router
8. 前端 lib/brain.ts、settings/brain-picker.tsx、settings-page.tsx、i18n、assistant.ts onProgress、use-assistant-chat progress
9. 離線測試
10. 回饋 PRD.md + plans

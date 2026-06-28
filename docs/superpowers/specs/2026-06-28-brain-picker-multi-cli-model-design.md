# 大腦 picker 擴充：多 CLI 代理＋每代理模型＋對話內快速切換＋測試（design）

> 日期：2026-06-28
> 範圍：擴充既有 brain-picker（`assistant_brain_config` id=1 單列、provider 路由），
> 讓使用者能 ①選不同 CLI 代理（含 opencode/antigravity）②每代理選不同模型
> ③在對話視窗內就地切大腦 ④選完按「測試」驗證可用。
> 狀態：✅ 設計已核准（使用者：「自動判斷開發順序把 ABCDE 完成」）；本檔為實作前留檔。
> 互補：`2026-06-23-assistant-brain-picker-design.md`（provider 路由原設計）、
> `2026-06-28-assistant-backend-integration-contract.md`（後台串接縫合面）。

## 0. 動機

現況 brain-picker 只能在 claude/codex/hermes 三個寫死的 CLI 間切，且不能指定模型。
需求：

- CLI 代理改為**註冊表驅動**，新增 opencode/antigravity（如 open-design MCP 那樣可選本機 CLI）。
- 每個 CLI 代理可帶**模型參數**（如 codex 選不同模型、claude 選不同模型）。
- 對話視窗 composer 左下放**就地 picker**，不必進設定頁即可切大腦。
- 設定頁選完後可按**「測試」**送一個極短 prompt 驗證該大腦真的能跑、回報耗時與樣本。

## 1. 不變的紅線（沿用既有規範）

- **祕密只進 `.env`**：BYOK 金鑰本體永不入庫/版控/回 API；`byok_key_set` 僅為由 `.env` 推導的唯讀布林。
  CLI 路徑完全不碰 secret。
- **測試端點不洩漏 Layer B**：用固定、無意義的極短 prompt（如「請只回覆：OK」），
  輸出**截斷上限 ~200 字**，**永不回傳祕密**；短 timeout（CLI ~30s／cloud ~15s）。
- **HTTP 恆 200 哲學**：大腦失敗時 `brain.stream` 拋 `BrainError`→ assistant 退模板；
  但**測試端點**是顯式診斷工具，回 `{ok:false, error}`（仍 HTTP 200，錯誤訊息已淨化、不含祕密）。
- **雲端連不到本機 CLI/Ollama**：opencode/antigravity 的 argv 模板為 best-effort，
  標記 `needs_local_verify`，UI 顯示「需本機驗證」徽章；live 端對端須在本機跑。
- **單機單操作者**：`assistant_brain_config` 維持單列 id=1、get-or-create。

## 2. 資料層（Section A）

`AssistantBrainConfig` 新增一欄：

- `cli_model: Mapped[str | None] = mapped_column(String(64), nullable=True)`
  ——provider=cli 時，傳給該 CLI 代理的模型名稱；NULL → 用代理預設模型 / 不帶 model flag。

Alembic migration：`down_revision = 'f3b8d1a6c920'`，`op.add_column` 加 `cli_model`（nullable）。

Schema（`app/schemas/settings.py`）：

- `BrainConfigOut`／`BrainConfigUpdate` 都加 `cli_model: str | None`。
- `cli_agent` 由封閉 `Literal` 改為**註冊表驅動 field_validator**：值須 ∈ registry keys
  （claude/codex/hermes/opencode/antigravity），未知值（如 "skynet"）仍 → **422**。

`brain_config.py`：`_MUTABLE_FIELDS` 加 `"cli_model"`（None 表清除）。

## 3. CLI 註冊表＋brain.py 改接（Section B）

新檔 `app/services/brain_cli_registry.py`：

```python
@dataclass(frozen=True)
class CliSpec:
    key: str                 # claude / codex / hermes / opencode / antigravity
    label_i18n: str          # 前端 i18n key
    argv: list[str]          # 含 {prompt} 佔位
    parser: str              # "claude" | "codex" | "hermes" | "text"
    model_flag: str | None   # 注入模型的 flag（如 "--model"）；None=該 CLI 不支援指定模型
    default_model: str | None
    models: list[str]        # UI 候選模型（可空 = 自由填）
    needs_local_verify: bool # opencode/antigravity=True（模板未在本機驗證）
```

- claude/codex/hermes：沿用既有 argv 與 parser（不改既測邏輯）。
- opencode/antigravity：best-effort argv + `parser="text"`（複用 hermes 純文字逐行 delta），
  `needs_local_verify=True`。
- `model_flag` 注入策略：**僅當 `cli_model` 非空**時，把 `[model_flag, cli_model]` **append 到 argv 尾端**
  （避免 claude `-p` 的位置參數歧義；無 model 時行為與現況完全一致 → 非破壞性）。

`brain.py`：

- `_cli_argv(agent, prompt, model=None)`：保留 2 參數呼叫相容；改讀 registry；未知 agent 仍 `raise BrainError`。
- `_stream_cli`：讀 `config.cli_agent` 與 `config.cli_model`，用 registry 組 argv＋注入 model flag；
  parser 依 registry 的 `parser` 欄位 dispatch（新增 "text" → 複用 `_parse_hermes_line`）。

## 4. agents／test 端點（Section C）

- `GET /api/v1/settings/brain/agents`：回註冊表（key/label/models/default_model/needs_local_verify），
  供前端動態建 picker。
- `POST /api/v1/settings/brain/test`：以**候選（未存）設定**做煙測。
  - body：`BrainTestRequest`（provider 必填，cli*agent/cli_model/ollama_model/byok*\* 選填；不含祕密）。
  - 用 `SimpleNamespace` 組候選 config（BYOK 金鑰仍從 `.env` 取，body 不帶），呼叫 `brain.stream`
    跑固定極短 prompt，蒐集 delta 串接、截斷 ~200 字。
  - 回 `BrainTestResult`：`{ok, provider, model, elapsed_ms, sample, error?}`，**HTTP 200**、不含祕密。
  - 新檔 `app/services/brain_test.py::smoke_test(candidate)`。

## 5. 設定頁 picker＋測試鈕（Section D）

- `lib/brain.ts`：加 `cliModel`（camel）全鏈、`BrainAgentSpec`、`fetchBrainAgents()`、`testBrainConfig()`。
- 共用 hook `src/hooks/use-brain-config.ts`：module-level store + `useSyncExternalStore` + `applyBrainUpdate`，
  讓設定頁與對話內 picker 共享同一份狀態（一處改、兩處同步）。
- `brain-picker.tsx`：CLI 代理清單改 registry 驅動；選 CLI 後出現**該代理的模型 picker**
  （registry.models 有值用 Select，否則自由 Input）；加「測試」鈕＋結果 chip
  （測試中／OK＋耗時＋樣本／失敗＋淨化錯誤）；opencode/antigravity 顯示「需本機驗證」徽章。

## 6. 對話內快速 picker（Section E）

- 新檔 `src/components/assistant/brain-quick-picker.tsx`：composer 左下的精簡 pill ＋ 極簡下拉
  （無 Popover primitive，用 native `<select>` 或最小自訂下拉）。
- 候選＝CLI 代理們＋ollama＋byok；選取呼叫 `applyBrainUpdate({provider, cliAgent, cliModel:null})`
  （切代理時清模型回預設）。
- 掛在 `assistant-ui-thread.tsx` 的 `Composer` 左下（shortcuts row 旁）。

## 7. i18n＋測試（Section F，貫穿）

- i18n zh/en 成對：cli_model 欄位、測試鈕＋三態、opencode/antigravity 標籤、對話內 picker 標籤、需本機驗證徽章。
- 後端測試：`test_brain.py` 加 registry argv／model_flag 注入／text parser（opencode/antigravity）；
  `test_settings_api.py` 加 cli_model 欄位、agents 端點、test 端點（monkeypatch `brain.stream`）。
  既綠測試（如 "skynet"→422、未知 agent BrainError、各 parser）須維持綠。
- 前端：brain.ts／hook 的單元測試。

## 8. 開發順序

A（資料層，可本機測）→ B（registry＋brain）→ C（端點）→ D（設定頁）→ E（對話內）→ F（i18n／測試／驗證／commit）。
F 的 i18n 與測試貫穿各段補上。完成後 auto-commit（僅本 session 檔案）；push/PR 須另取得同意。

# 標案助手後台串接契約（給「重新開發版 assistant」鋪路）

> 日期：2026-06-28
> 範圍：**只定義後台串接介面（the seam）**，不規劃 UX、不改動既有串流協定。
> 狀態：✅ 既有契約已 live 驗證；🟡 為新 UI 標出可選的契約擴充點（提案，未實作）。
> 互補文件：UX/flow 規劃見 `2026-06-27-assistant-ui-tender-assistant-ux-design.md`；
> 大腦 provider 路由見 `2026-06-23-assistant-brain-picker-design.md`。

## 0. 為什麼有這份文件

同事正在重新開發 assistant 的 UI/UX（可能以 codex 為大腦）。本文件的目的是：
**讓新 UI 不必碰後端、不必重寫對話狀態機，直接插進現有、已驗證可用的串接面。**

截圖中的浮窗版（`assistant-modal.tsx`）已 live 驗證可正確串接後台——
2026-06-28 對 `POST /api/v1/assistant/chat` 煙測，`meta` 事件回傳真實 DB 來源
（semantic 命中標案 4070/4190/3724…＋知識庫「標案分級與類別優先序」），證明
grounding/retrieval 確實在查 live 資料庫。新 UI 沿用同一條線即可。

## 1. 整條串接線（資料流）

```
新 UI 元件
  └─(useAssistantBridge)→ AssistantBridge            ← 唯一建議接點（穩定介面）
        └─ AssistantRuntime (assistant-runtime-provider.tsx)
              └─ useAssistantChat (use-assistant-chat.ts)   ← 對話狀態機（可直接重用）
                    └─ streamAssistantChat (lib/assistant.ts) ← NDJSON client（型別權威）
                          └─ POST /api/v1/assistant/chat       ← 後端契約
                                └─ brain.stream() (services/brain.py) ← provider 路由
                                      ├─ ollama（預設）
                                      ├─ cli（claude / codex / hermes）
                                      └─ byok（Anthropic）
```

**三種接入深度，依新 UI 對控制權的需求擇一：**

| 接法                  | 用什麼                                       | 拿到什麼                                                     | 適合                                                 |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| **A. 用橋接（建議）** | `useAssistantBridge()`                       | send / threads / suggestions / progress / resolvePreference… | 新 UI 想要「換殼不換腦」，最省事、最不會破壞既有行為 |
| **B. 用 hook**        | `useAssistantChat(scope, focusTenderId)`     | 完整對話狀態（turns/streaming/progress…）＋所有動作          | 新 UI 想自管渲染但沿用狀態機                         |
| **C. 用 client**      | `streamAssistantChat(messages, handlers, …)` | 原始 NDJSON 事件回呼                                         | 新 UI 想完全自管狀態（例如非 React）                 |

> 多數情況選 **A**。`AssistantBridge` 就是為「外掛 UI」設計的乾淨縫合面，
> 已被浮窗（`assistant-modal.tsx`）與整頁指揮中心共用，scope 區隔埋點即可。

## 2. 後端契約（權威：`app/schemas/assistant.py` + `lib/assistant.ts`）

### 2.1 請求 `POST /api/v1/assistant/chat`

```jsonc
{
  "messages": [
    { "role": "user", "content": [{ "type": "text", "text": "..." }] },
  ],
  "thread_id": "可選；續接同串，缺則後端產生並於 meta 回傳",
  "context": {
    "focus_tender_id": "可選；情境感知",
    "scope": "可選；留存分類/埋點區隔",
  },
}
```

- 認證：帶 `Authorization: Bearer <token>` → 依登入帳號做 per-user 歷史隔離；
  不帶 → demo default owner（煙測即走此路）。
- HTTP **恆 200**：大腦失敗時後端退模板，仍回完整事件序（不丟 5xx 給 UI）。

### 2.2 回應：NDJSON 事件序（逐行 JSON，`\n` 分隔）

```
meta → (progress)* → delta* → done
```

| 事件       | 欄位                                                                      | 語意                                           | ⚠️ 新 UI 必讀                                                        |
| ---------- | ------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `meta`     | `scope` / `thread_id` / `prompt` / `sources[]` / `preference_suggestion?` | 證據來源＋串 id，**在大腦生成前就送出**        | `sources` 是 grounding 證據卡資料源                                  |
| `progress` | `text`                                                                    | agentic 暫態狀態（「查詢中：search_tenders」） | **僅 CLI 大腦會送**；暫態、**不寫入對話文字**，下一筆 delta 到達即清 |
| `delta`    | `text`                                                                    | 答案文字                                       | **`text` 是「累積全文」，前端 replace 不是 append**                  |
| `done`     | —                                                                         | 結束                                           | 觸發歷史清單刷新                                                     |

`sources[]` 每筆（對齊 `AssistantSource`）：
`kind`(tender/semantic/similar/knowledge)、`tender_id`、`title`、`source`、`url`、
`score`、`excerpt`、`doc_id`、`heading`。知識庫類 `tender_id=null`、改帶 `doc_id/heading`。

### 2.3 歷史留存

- `GET /assistant/threads?q=` → 串摘要清單；`GET /assistant/threads/{id}` → 含完整訊息＋來源。
- Layer B 紅線：留存只含對話文字與**公開 A 層**來源卡，owner 一律 default、**未具名、對外永不揭露**。

## 3. codex 大腦：後端已就緒到哪

**結論：codex 作為大腦，後端串接已完成、有測試覆蓋，新 UI 不需為此改後端。**

- provider 路由 `brain.py` 已實作三家 headless CLI 的專屬 parser（claude / **codex** / hermes），
  codex 走 `codex exec --json --skip-git-repo-check {prompt}`，JSONL 事件解析：
  - `item.completed/agent_message` → 取最後一則為最終答案（取代累積，蓋過 preamble）。
  - `mcp_tool_call` / `command_execution` → 轉 `progress`（「查詢中：<tool>」）。
  - `error` / `turn.failed` → `BrainError` → 後端退模板。
- 切換方式：`assistant_brain_config`（id=1）設 `provider=cli, cli_agent=codex`（目前是 `cli/claude`）。
  亦可走 brain-picker UI（見對應 spec）。**祕密/金鑰只進 `.env`，不入庫/版控。**
- 測試：`tests/test_brain.py` 含 codex parser 與 `_stream_cli` 假 subprocess 流程，全綠。
- ⚠️ 環境限制：codex live 端對端需可登入且未達 ChatGPT usage limit 的環境；
  雲端用完即丟、連不到本機 CLI/Ollama，相關驗證須在本機跑（不是 code 缺陷）。

## 4. 🟡 為「更進階的新 UI」標出的契約擴充點（提案，**未實作**）

新 UI 若要做 multi-step 工具時間軸、決策模式、適配度指標，現有契約有三個落差。
**這些都會動到串流協定／schema，依專案規矩需先取得同意再動，本文件僅標記、不實作。**

1. **結構化工具步驟**（vs 目前單一 `progress` 字串）
   現況：`progress` 是一行暫態文字，到 delta 即清、不留存，畫不出「步驟卡時間軸」。
   提案：新增結構化 `step` 事件（`{tool, status, detail, ts}`）並可選擇留存，
   讓新 UI 渲染 ToolTimeline。**需擴充 NDJSON 協定 → 要同意。**

2. **決策模式路由**（找案／比較／判斷）
   現況：後端不分模式，單一 grounding+生成。
   提案：`context.mode` 入參 + 對應檢索策略；屬行為/學習路徑，**碰 Layer B 需走需求單**。

3. **適配度／決策時間等指標**
   現況：`meta.sources[].score` 有分數，但無「承接適配度」「決策時間」等聚合指標。
   提案：界定指標定義與資料來源後再開 schema 欄位。

> 注意：前端 `assistant-studio-page.tsx` 是**純 mock 設計展示**（自帶「Mock data」標籤、
> 不影響 `/assistant`），它示範的 ToolTimeline/SourceDeck/指標正對應上述 1–3 落差——
> 是「想要的樣子」，不是「已支援的契約」。新 UI 要落地這些，需先補上對應後端擴充。

## 5. 給新 UI 開發者的最短上手路徑

1. 用 **接法 A**：在 UI 樹外包 `<AssistantRuntime scope="...">`，內部以 `useAssistantBridge()` 取 send/threads/suggestions/progress。
2. 渲染答案：訂閱 assistant-ui external store（runtime-provider 已接好），記得 **delta 是 replace 全文**。
3. 顯示來源卡：讀 `message.metadata.custom.sources`（型別 `AssistantCustomMeta`）。
4. 偏好確認 chip：`bridge.resolvePreference(pref, "confirm"|"dismiss")`，**確認才入庫、具名、可退**。
5. 要 codex 大腦：改 DB brain config，不必改前端。
6. 要 §4 的進階功能：先提需求/取得同意，再擴協定——別在 UI 端假裝後端已支援。

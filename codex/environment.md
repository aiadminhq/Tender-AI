# Codex 雲端環境設定參數（填表用）

> 對象：OpenAI Codex（ChatGPT）→ **Codex → Environments → Create/Edit environment**。
> 目標：讓 Codex 雲端環境的行為**跟 Claude Code on the Web 一樣**——
> 只綁本 repo、用完即丟、對外網路在 agent 執行階段關閉。
> 逐欄照抄下表即可。

---

## 1. General（基本）

| 欄位 | 填入值 |
| --- | --- |
| **Name** | `tender-ai` |
| **Description** | Tender AI monorepo（FastAPI + pgvector 後端 / React 前端）｜與 Claude Code 同邊界 |
| **GitHub organization** | `aiadminhq` |
| **Repository** | `aiadminhq/tender-ai` |
| **Branch（預設）** | `dev` |

---

## 2. Container image（容器映像）

| 欄位 | 填入值 |
| --- | --- |
| **Base image** | `openai/codex-universal`（預設通用映像即可） |
| **Python** | `3.12`（後端 `requires-python >=3.12,<3.13`） |
| **Node** | `20`（或映像預設 LTS；前端 Vite 8 / React 19 需 ≥18） |
| **Package managers** | `uv`（後端）、`pnpm`（前端，corepack 啟用） |

> 通用映像通常已內建 Python / Node / pnpm / uv；若缺，setup script 會自行安裝。

---

## 3. Setup script（設定腳本）

指向 repo 內腳本，或直接貼下列內容：

```bash
bash codex/setup.sh
```

> 腳本做的事：`uv sync`（後端相依）＋ `pnpm install --frozen-lockfile`（前端相依）。
> 此階段**允許對外網路**（裝套件用）。

---

## 4. Environment variables（環境變數，非機密）

| Key | Value | 說明 |
| --- | --- | --- |
| `ASSISTANT_USE_LLM` | `false` | 無 Ollama 環境退回模板回答（跟 CI 一致） |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | 前端開發來源 |
| `PYTHONUNBUFFERED` | `1` | 日誌即時輸出 |

> DB／Ollama 相關變數**留空即可**：後端有本機預設值，DB 整合測試在無 Postgres 時自動 skip。

---

## 5. Secrets（機密，放 Codex Secrets，勿入版控）

| Key | 何時需要 |
| --- | --- |
| `ANTHROPIC_API_KEY` | 只有要跑「高品質推理/摘要」時才填；一般離線開發可留空 |
| `APP_API_KEY` | 只有要驗證後端 API 保護時才填；離線開發可留空 |

> ⚠️ 這兩個都是敏感金鑰，只放 Codex 的 Secrets 欄，**永不寫進 repo / setup script / 對話紀錄**。

---

## 6. Agent internet access（agent 執行階段網路）— 跟 Claude Code 一樣

| 欄位 | 設定 |
| --- | --- |
| **Internet access** | **Off（關閉）** |
| 理由 | 與 Claude Code 邊界一致：雲端連不到 PCC 招標網與本機 Ollama；真的抓網頁／算向量請在能連線的環境做 |

> 若某次任務確實需要對外（例：拉額外套件），再臨時開 **On** 並設**網域白名單**＋限制 HTTP 方法，用完關回 Off。

---

## 7. 對照：Codex ↔ Claude Code

| 概念 | Claude Code on the Web | Codex 雲端 |
| --- | --- | --- |
| 專案須知檔 | `CLAUDE.md` | `AGENTS.md`（本 repo 已備，內容同源） |
| 開機安裝相依 | SessionStart hook | Setup script（`codex/setup.sh`） |
| repo 權限範圍 | 只綁 `aiadminhq/tender-ai` | Repository 選 `aiadminhq/tender-ai` |
| 容器生命週期 | ephemeral，沒 push 就不存在 | 同上 |
| 對外網路 | 受環境網路政策限制 | Agent internet access = Off |
| 指定分支 | `claude/<主題>` | 同一分支慣例 |

---

最後更新：2026-07-10

# AGENTS.md — 給 Codex / OpenAI agent 的專案須知

> Codex 會自動讀取本檔（等同 Claude 讀 `CLAUDE.md`）。
> **本檔與 `CLAUDE.md` 內容一致、規範同源**；權威細節見 `docs/governance/`。

---

## 專案是什麼

**Tender AI**：幫人篩選政府標案、並會「越用越聰明」的系統。Monorepo：
- `tender-ai-backend/`：資料與 AI 大腦（Python 3.12 / FastAPI / PostgreSQL+pgvector / Ollama），套件管理用 **uv**。
- `tender-ai-frontend/`：人看的畫面（React 19 / TypeScript / Vite 8 / Tailwind v4），套件管理用 **pnpm**，i18n 繁中預設。

---

## ⚠️ 最重要的一條：Layer B 是「合作範圍內共享」的知識庫

- **Layer B**（收藏、評分、想法、行為）在使用**白名單公司帳號**（原則 @hqdesign.tw、由管理者開通）
  且**已取得本人同意**下，會被量化成向量、進入**合作範圍內共享**的知識庫，並**依登入帳號具名**標示貢獻者。
- **紅線**：對非合作範圍對象**永不揭露、永不外流**；行為資料不進公開版控／對外視圖；對外發佈一律**去識別化**。

| 層 | 白話 | 揭露邊界 |
| --- | --- | --- |
| Layer A | 公開的標案資料 | 可公開、可從原始 HTML 重建 |
| Layer B | 同事的行為與想法 | 白名單內共享＋具名、對外永不揭露（需同意） |
| Layer C | 學出來的知識（向量/權重/理由） | 衍生物可重算；對外須去識別化 |

---

## 開發規矩（最低限度）

- **分支**：在指定的 `claude/<主題>` 分支開發（本任務：`claude/codex-cloud-deployment-form-um3w96`）；未經同意不推到別的分支、不開 PR。
- **Commit**：Conventional Commits ＋ 範圍標籤（`be`/`fe`/`data`/`infra`/`docs`）。
- **雲端環境**：用完即丟，沒 push 就不存在；**連不到 PCC 招標網與本機 Ollama**，相關工作需在能連線的環境驗證。
- **覆蓋前先看**：要改/刪既有檔案先讀內容；與描述不符或非你所建，停下回報而非覆蓋。
- **碰到 Layer B**：在需求單與 PR 寫清楚 ①同意基礎 ②共享範圍 ③對外隔離方式。

---

## 常用指令（離線可跑）

```bash
# 後端（無 Postgres 時 DB 整合測試自動 skip）
cd tender-ai-backend && uv run pytest

# 前端
cd tender-ai-frontend && pnpm run build && pnpm test && pnpm run lint
```

---

## 文件導覽

| 想知道 | 看哪裡 |
| --- | --- |
| 心智模型、資料三層、功能代號 | `docs/governance/00-總覽與心智模型.md` |
| 雲端怎麼下需求 | `docs/governance/01-雲端開發與需求.md` |
| 本地↔雲端同步 | `docs/governance/02-本地雲端同步.md` |
| 命名與目錄、領域知識放哪 | `docs/governance/03-命名與目錄規範.md` |
| 訓練資料 / 共享知識庫規範 | `docs/governance/04-訓練資料規範.md` |
| Codex 雲端環境設定參數 | `codex/environment.md` |

---

最後更新：2026-07-10

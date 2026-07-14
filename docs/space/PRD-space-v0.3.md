# Tender AI｜Space 彙整版 PRD v0.3

> 本檔為 Perplexity Space 專用彙整版：把 PRD 藍圖、技術棧確定版、開發/部署現況濃縮成單一文件，
> 供 Space 內 AI 回答時有完整語境。上傳方式：Perplexity Space → 檔案 → 以本檔取代舊 `PRD.md`。
> 產生日期：2026-07-13（全分支整合 session）。來源之細節見 repo `PRD.md`／`docs/governance/`。

## 一句話

Tender AI：幫惠強室內裝修篩選政府標案、並會「越用越聰明」的共享知識庫系統——
取代舊 tender-bot 靜態日報，讓同事的判斷（Layer B）在白名單內具名共享、餵養 AI 排序與推薦。

## 資料三層（治理紅線）

| 層 | 內容 | 邊界 |
|---|---|---|
| Layer A | 公開標案資料（PCC/北醫等） | 可公開 |
| Layer B | 同事行為與想法（收藏/評分/評論/判斷） | @hqdesign.tw 白名單內具名共享；對外永不揭露；兩段式同意（whitelist_active && consent_shared） |
| Layer C | 學出來的知識（向量/權重/理由） | 衍生可重算；對外須去識別化 |

負向關鍵字權重僅限人工（唯一例外：使用者本人在 UI 的「不可行」判斷即時學習路徑）。

## 技術棧（確定版）

- 前端：Vite 8 + React 19 + TypeScript + Tailwind v4 + shadcn/ui（Knowvio 設計語彙、繁中預設 i18n）
- 後端：FastAPI + SQLAlchemy 2.0 async + psycopg3 + PostgreSQL 17 + pgvector（Supabase）
- 認證：app 自簽 HMAC token（`POST /api/v1/auth/login`，Bearer；白名單＋密碼 pbkdf2_sha256）
- 部署：**前後端同站 Vercel**——前端靜態 + 後端掛 `/api/*` Python function（ASGI）；同源免 CORS
- 資料庫：Supabase 專案 `ajltwjkegmbzethwgbje`（ap-southeast-1）；後端經受限角色 `tender_api`（BYPASSRLS service-role 模式）直連 pooler
- AI：語意搜尋（bge-m3 向量，雲端無 Ollama 時 503 優雅降級）；小助手 BYOK（Anthropic/OpenRouter）

## 資料現況（2026-07-13）

tenders 2,266｜tender_vectors 2,254｜users 11（9 白名單含密碼）｜evaluations 27｜events 1,576｜
knowledge_chunks 1,836｜daily_tender 快照最新 2026-07-12｜33 表全數 RLS enabled（僅 6 張 Layer A 表開 anon 唯讀 policy）

## 2026-07-13 全分支整合結論（本次 session）

盤點 9 條分支後發現：main 在 dev 分叉後累積 172 commits，已自行實作 dev 系分支的幾乎所有功能。
整合以「main 為基底、重複擇優、只搬淨值」收斂為單一整合分支（→ PR → main）：

| 分支 | 處置 |
|---|---|
| busy-sagan（#14）/ ux-case-filing（#7）/ codex-cloud（#11） | docs 併入 |
| dev（9 commits） | 只取 ingest 動態 source_id 修正；其餘被 main 取代 |
| hq-site-log 登入分支（#15） | 取 Vercel 全棧部署構想（修正未實測 config）＋ daily_tender 快照修復；登入/JWT/migration skip（main 版本較優且 migration 會造成 alembic 雙頭） |
| design-system（#12）/ kanban-notes | skip——main 的 Knowvio 語彙與 N2 元件較新較完整 |
| deploy-infra-cherrypick（#10） | 早已 merge |

同步修復：日報匯入漏寫 daily_tender 快照（「高潛力」KPI 恆 0 的根因）＋硬編 source_id；
前端 8 個模組 API_BASE 統一同源預設 `/api/v1`（原本 7 個模組正式 build 仍打 localhost）。

Supabase 側（已直接落地）：design_feedback_items 啟用 RLS（advisor ERROR 清除）；
tender_api 角色 BYPASSRLS＋密碼重置。

## 部署模型與生效條件

- repo root `vercel.json`：前端 build → `tender-ai-frontend/dist`；rewrites `/api/(.*)` → `/api/index`（FastAPI ASGI）、其餘 SPA fallback。
- Vercel 專案需設定：Root Directory＝repo root（原為 `tender-ai-frontend`）；環境變數 `DATABASE_URL`（tender_api@pooler）與 `AUTH_SECRET`。
- 未切換前 merge 安全：維持現行純前端（mock）行為；切換＋設變數後 redeploy 即為真實資料全棧。
- 已知限制：Vercel 上無 Ollama → 語意搜尋 503 降級；小助手需另設 API key；歷史 category 約 79% NULL 為學習天花板。

## 角色與帳號

白名單 9 位 @hqdesign.tw 成員（admin：christian.wu／aaron.chang）。登入後具名寫入 Layer B；
未登入/後端不可達時前端有「示範模式」降級（mock 資料、不具名、不留存）。

## 文件索引（repo）

PRD.md（藍圖）｜DESIGN.md｜docs/governance/00-07（治理/部署 runbook）｜docs/superpowers/specs/（功能規格）｜
HANDOFF.md 與 docs/handoff/（交接）｜whats-new-overview.md（對 stakeholder 的新舊對照）

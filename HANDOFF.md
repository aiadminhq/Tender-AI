# Tender AI 部署 Handoff（2026-07-01）

## 0. TL;DR 現況

- **PR #8**（`claude/vercel-supabase-deploy-zdjhpa`）已關閉不合併——落後 main 15 commits，架構已過時（舊 Claude/OpenRouter provider，main 現在是完整的 ollama/cli/byok 大腦系統）。
- **PR #10**（`claude/deploy-infra-cherrypick` → main）是現在唯一該延續的分支，開著、未合併。目前包含：
  1. Railway Dockerfile/railway.toml/.dockerignore
  2. 前後端 `.env.example`
  3. `.mcp.json`（Supabase MCP 專案設定，釘住新加坡專案）+ 官方 Supabase agent skills
  4. **`tender-drawer.tsx` build 修復**（剛推，見下）
- **🔴 重大發現：Vercel Production Branch 設錯了**——目前指向已關閉的 `claude/vercel-supabase-deploy-zdjhpa`，不是 `main`。這是「線上一直看到舊版」的真正原因（比 DB 是空的更根本）。**需要手動去 Vercel Dashboard 改**（見 §3）。
- **🔴 main 本身目前 build 失敗**（TS6133 unused variable，在 `tender-drawer.tsx`）。**已修好並 push 到 PR #10**（commit `b99fc26`），本機 `pnpm build` 驗證通過。PR #10 merge 進 main 後才會真正解除。
- Supabase 現況：新加坡專案 `ajltwjkegmbzethwgbje`（ACTIVE，24 張表已 migrate，但 **tenders=0 筆**）是正式在用的；首爾閒置專案 `bqatadxmhzelhbjmxwxs` 使用者說已刪除。
- 白名單種子帳號 SQL **已產生、已驗證雜湊格式正確**，見 §5，尚未執行（等 Supabase MCP 可用）。
- Railway MCP／Supabase project-scoped MCP 都已用 `claude mcp add` 加入設定，但**這個 session 內一直沒有真正生效**（工具清單裡沒出現），懷疑需要真正重啟 CLI process，而非僅重連。

---

## 1. 立刻要做：修 Vercel Production Branch

1. 開 https://vercel.com/aiadminhqs-projects/tender-ai/settings/git
2. **Production Branch** 從 `claude/vercel-supabase-deploy-zdjhpa` 改成 **`main`**
3. 存檔後，下次 push 到 main 才會正確標記為 production 部署。

（Vercel MCP 沒有「改 Production Branch」的工具，只能手動在 Dashboard 做。）

---

## 2. 合併 PR #10

https://github.com/aiadminhq/Tender-AI/pull/10

包含 build 修復（commit `b99fc26`），合併前建議先看 Vercel 對這個 PR 分支最新一次部署是否轉綠（推了修復後應該會成功）。合併後 main 會恢復可部署。

---

## 3. Railway：部署 FastAPI 後端

### 3.1 建立 Service

- Railway Dashboard → New Project → Deploy from GitHub repo → `aiadminhq/Tender-AI`
- Root Directory: `tender-ai-backend`
- 會自動偵測 `tender-ai-backend/Dockerfile` + `railway.toml`（已在 PR #10 裡）

### 3.2 環境變數（依 `docs/governance/07-發佈與部署.md` 團隊已定案的決策 ③a BYOK Anthropic 協定）

```
DATABASE_URL=postgresql+psycopg://postgres.ajltwjkegmbzethwgbje:<密碼>@aws-0-<region>.pooler.supabase.com:5432/postgres
AUTH_SECRET=<openssl rand -base64 48 或 python -c "import secrets;print(secrets.token_urlsafe(48))">
ANTHROPIC_API_KEY=<OpenRouter key——確定的正式架構，非暫代方案，見下方說明>
APP_API_KEY=<可選，粗閘；若設，前端 VITE_API_KEY 要同值>
CORS_ORIGINS=https://<Vercel production 網址，改好 Production Branch 後的正式網域>
OLLAMA_URL=（Railway 上沒有 Ollama，留預設即可，不會被用到——見下方大腦 provider 說明）
ASSISTANT_USE_LLM=true
```

**重要（確定架構，非暫代）**：本專案的大腦 provider 走 **OpenRouter**（非官方 Anthropic key）去選用 `claude-opus-4-8` 等模型——這是使用者確認過的正式決策。`ANTHROPIC_API_KEY` 這個變數名稱是沿用 BYOK Anthropic 協定的慣例，實際填入的是 OpenRouter key；byok 設定改指向 OpenRouter 的 Anthropic 相容端點即可運作，不需要、也不打算換成官方 `sk-ant-` key。實際切換大腦 provider 是**執行期 API 呼叫，不是環境變數**（見 §6）。

`AUTH_SECRET` 是**必填、無安全預設值**——沒設的話整個登入系統會直接拒絕簽發/驗證 token（`AuthNotConfigured` 例外）。這個是我之前完全沒設過的欄位，务必補上。

### 3.3 取得 Railway MCP／CLI

我在 session 裡跑過：

```
claude mcp add railway-mcp-server -- npx -y @railway/mcp-server
```

但工具一直沒出現在清單裡。新 session 起來後，先跑：

```
railway whoami   # 確認 CLI 已登入
```

若沒登入：`railway login`（會開瀏覽器）。若要用 MCP，確認新 session 的工具清單裡有 `mcp__railway...__*`，沒有的話可能要重新裝一次或檢查 npx 快取。

---

## 4. Vercel：前端環境變數

Dashboard → tender-ai project → Settings → Environment Variables（**不要**寫進 `vercel.json`，PR #8 已因此洩露過一次 API key 到 git 歷史）：

```
VITE_API_BASE=https://<Railway 服務網址>/api/v1
VITE_API_KEY=<與後端 APP_API_KEY 相同，若後端設了>
VITE_USE_API=true
VITE_TRACK=true
```

前端目前的 `tender-ai-frontend/vercel.json`（main 上）已經是乾淨版本（`framework: vite`, `pnpm build`），沒有內嵌任何 env，這是對的，不用動。

---

## 5. Supabase：種子白名單帳號（已核准，等 MCP 可用就執行）

### 5.1 確認現況

- 正式使用專案：**`ajltwjkegmbzethwgbje`**（新加坡，ACTIVE_HEALTHY）
- 已驗證：24 張表（migration 已跑）、`tenders` 表 0 筆資料（需之後跑 backfill，見 §7）
- 首爾閒置專案 `bqatadxmhzelhbjmxwxs`：使用者表示已手動刪除，若還在請刪掉避免混淆/計費。

### 5.2 種子 SQL（已產生、已驗證 pbkdf2_sha256 雜湊 roundtrip 正確）

檔案：`/tmp/claude-0/-home-user-Tender-AI/a73c1eb4-f0c8-5d01-8949-3abf3caa94ab/scratchpad/seed_members.sql`

內容摘要：9 位 `@hqdesign.tw` 帳號（Christian Wu / Aaron Chang = admin，其餘 member），密碼統一 `admin`（雜湊落地，明文未存），`whitelist_active=true`, `consent_shared=true`。用 `ON CONFLICT (email) DO UPDATE` 寫法，**冪等**：已存在的帳號密碼不會被覆蓋（只在原本是 NULL 時才寫入）。

**若新 session 拿到 Supabase MCP**：直接把該 SQL 檔內容丟給 `execute_sql`（project_ref=ajltwjkegmbzethwgbje）即可，等同於跑 `uv run python -m app.jobs.seed_members` 的效果。

**若想改用官方腳本跑**（本機、需 DATABASE_URL 連得到 Supabase）：

```bash
cd tender-ai-backend
DATABASE_URL=postgresql+psycopg://postgres.ajltwjkegmbzethwgbje:<密碼>@... \
  uv run python -m app.jobs.seed_members
```

兩者效果等價，腳本版更貼近「單一事實來源」，能連線的話優先用腳本版。

---

## 6. 大腦 Provider 切換（登入後、admin 執行期設定，不是環境變數）

種子帳號建好、後端 Railway 有 `ANTHROPIC_API_KEY` 後：

1. 用 `christian.wu@hqdesign.tw` / `admin` 登入 `POST /api/v1/auth/login`，拿到 Bearer token
2. `PUT /api/v1/settings/brain`（帶 `Authorization: Bearer <token>`），指向 **OpenRouter**（確定架構，見 §3.2）：
   ```json
   {
     "provider": "byok",
     "byok_protocol": "anthropic",
     "byok_base_url": "https://openrouter.ai/api",
     "byok_model": "anthropic/claude-opus-4-8"
   }
   ```
   注意 `byok_base_url` **不可**寫成 `.../api/v1`（會變成 `/v1/v1/messages` 404），模型名要帶 `anthropic/` 前綴（OpenRouter 命名慣例）。
3. 不做這步的後果：預設 `provider="cli"`，Railway 容器裡沒有 `claude` 執行檔，會 `FileNotFoundError` → **優雅退回罐頭模板**（HTTP 200，不會當機，但小助手不會真的生成回答）。

---

## 7. Supabase 資料是空的（tenders=0）

`ajltwjkegmbzethwgbh` 24 張表都建好了但沒資料。灌資料的 job（`app/jobs/backfill.py`）讀取 `../tender-reports/reports/tender-*.html`（repo 外、本機才有），**這個雲端容器連不到來源、也沒有那些檔案**，必須在能存取那些報表檔案的本機/正式環境跑：

```bash
cd tender-ai-backend
uv run python -m app.jobs.backfill          # Layer A：解析報表 → tenders
ollama pull bge-m3   # 需本機 Ollama
uv run python -m app.jobs.embed_tenders     # Layer C：向量化（語意搜尋/相似案/助手證據）
uv run python -m app.jobs.ingest_knowledge  # 知識庫
```

不跑這步的話，前端會一直退回內建的 mock 假資料（`app-data.tsx` 邏輯：API 回空清單 → 保留 mock，不是「舊版」而是「沒資料」）。

---

## 8. 端到端驗證清單

- [x] Vercel Dashboard：Production Branch = `main`
- [x] PR #10 已合併（含 build 修復）
- [x] Vercel 最新 production 部署狀態 = Ready（不是 Error）
- [x] Railway `/health` → `{"status":"ok"}`
- [x] Railway 環境變數：`DATABASE_URL`、`AUTH_SECRET`、`ANTHROPIC_API_KEY`、`CORS_ORIGINS` 都設了（`ANTHROPIC_API_KEY` 內容為 OpenRouter key——確定架構，非等官方 key 的暫代方案；byok 指向 OpenRouter Anthropic 相容端點）
- [x] Supabase 白名單帳號已種子（2026-07-02 全量同步後 `count(*) FROM users` = 10：9 白名單＋1 個 `legacy.hqadmin` 佔位帳號承接舊本機資料，白名單外、不參與共享）
- [x] 前端登入頁能用 `christian.wu@hqdesign.tw` / `admin` 登入成功
- [x] admin 設定頁把大腦 provider 切成 `byok`（`byok_base_url=https://openrouter.ai/api`、`byok_model=anthropic/claude-opus-4-8`，PUT 後 GET 驗證 `byok_key_set=true`）
- [x] 小助手問一題，確認是真實生成（非罐頭模板）——2026-07-02 以「道路」實測：5 個真實標案來源＋7397 字含預算/可行度/截止急迫性的生成
- [x] `SELECT count(*) FROM tenders;` = 2036（2026-07-02 本機→Supabase 全量同步：tenders 2036、vectors 2036、knowledge_chunks 1836、Layer B 行為資料全數上雲），前端為即時資料

---

## 9. 給新 session 的第一句話建議

> 「延續 Tender-AI 部署工作，讀 `/tmp/claude-0/.../scratchpad/HANDOFF.md`（或直接貼這份文件內容），繼續處理 §1–§8。目前卡在 Railway/Supabase MCP 工具沒生效，先確認新 session 裡這兩個 MCP 是否真的出現在工具清單。」

若新 session 是全新對話（沒有這份檔案路徑），把這份文件內容整份貼給它即可，或請我用 SendUserFile 傳一份給你存著。

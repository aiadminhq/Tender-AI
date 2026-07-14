# Tender AI — 雲端交接與剩餘工作

> 建立日期：2026-06-19 ｜ repo：`aiadminhq/Tender-AI`（PRIVATE，monorepo）
> 分支流程：**dev → staging → prod**，永不直接動 `main`／正式站台。

## 0. repo 現況

- 已上雲：`aiadminhq/Tender-AI`（private），分支 `main`（穩定）/`dev`（開發）。
- 結構：`tender-ai-frontend/`（Vite8+React19+TS6+Tailwind v4，pnpm）、`tender-ai-backend/`（FastAPI+SQLAlchemy2.0+pgvector，uv）、設計／規劃文件。
- 已排除版控：`node_modules`、`.venv`、`.env*`、Layer B 私有資料（行為／評價／註記／決策向量）、`tender-reports/` 報表站台、本機 agent 狀態目錄。
- 前端原有 SDD 細粒度 git 歷史已折疊為單一初始 commit；原 `.git` 備份於 `~/tender-ai-frontend-git-backup-20260619`。

## 1. 已完成（盤點佐證，毋須重做）

- **前後端 P3 串接**：13 端點除 `/feasibility`（前端本地算）外皆已接線；rate/share 已**端到端**接線（`api.ts` `postRate`/`postShare` → `tender-drawer.tsx` 樂觀更新）。
- **SL5 主動推播**：push 三端點前端已接（鈴鐺 + 面板）。
- **semantic search**：後端**程式碼已完整**（`app/api/v1/search.py` → `services/search.py:semantic_search` → `services/embedding.py:embed_query` → pgvector cosine）。
- review 小問題複檢：useEffect 依賴陣列無誤配；`adaptSavedSearch` 已有 `?? {}` null fallback。**皆非待辦。**

## 2. 剩餘工作（交辦範圍）

### A. 程式碼小修（low risk）

- [ ] `tender-ai-frontend/src/lib/api.test.ts` 的 `makeItem()` fixture 缺 `feasibility_score` 欄位（`TenderListItem` 介面 `api.ts:47` 要求 `number | null`）。補 `feasibility_score: null,`。

### B. 主要開發量：前端 UI/UX 改造計畫（已規劃，待執行）

計畫檔：`~/.codex/plans/stateless-strolling-scott.md`（8 需求，Wave 1→2→3）。

- Wave 1（單一 agent 序列，地基）：i18n key、storage、app-context sidebar、`Dialog` primitive、`FilterState` 擴充、app-data 資料層 + 關鍵字 store actions。驗收 `pnpm run build`。
- Wave 2（四 agent 平行，檔案互不重疊）：Layout/Shell（折疊 sidebar + `/settings`）、全域篩選 UI、標案置中彈窗、規則進階工作區。
- Wave 3：大卡片放大、工作區一致性收斂 + `/settings` 整合。
- 註：原計畫寫「前端非 git repo 不能用 worktree」——**現已是 monorepo，可用 worktree 隔離**。

### C. 契約落差（需產品決策，先對齊再接線）

1. `tier`：後端 4 級 `priority/high/mid/low`，前端 `Tier` 僅 3 級 → priority 會被降級顯示。
2. `source`：前端型別多餘的 `TPC/NPC`，後端只產 `PCC/TMU`。
3. `user_state.status`：後端列舉 `觀望/備標中/已投/得標/放棄`，前端 Kanban 用自訂 mock 狀態 → 接線前須對映。

### D. Infra／Ops（非程式碼）

- [ ] semantic search 要實際可跑需在執行環境 `ollama pull bge-m3`（1024 維）；CI 已用 monkeypatch 跳過。
- [ ] **既有 tech debt**：`tender-ai-backend/tests/test_ingest_daily_reports.py` 硬編絕對路徑且依賴 gitignored 的 `tender-reports/`，在 CI/雲端會失敗——需改為 fixture 或標記 skip。

## 3. claude.ai Remote Control（待你授權）

- 已嘗試建立 trigger，卡在 `job_config.ccr.environment_id`：claude.ai 端尚未把 `aiadminhq/Tender-AI` 連結為 Code 環境（需在 claude.ai UI 完成 GitHub OAuth 授權，屬本人操作）。
- 完成連結後提供 environment_id，即可補建 trigger 把上述任務交雲端執行。

## 4. 安全提醒（重要）

- 你先前在對話中貼出的兩個 GitHub PAT 已暴露於對話紀錄，**流程完成後務必到 GitHub 撤銷／輪替**（Settings → Developer settings → Personal access tokens）。
- 本機 git 認證已用 `gh` credential helper（作用帳號 `aiadminhq`），毋須在 URL 帶 token。

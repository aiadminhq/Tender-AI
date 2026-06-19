# Hand-off → 雲端 Claude Code：UI/UX v2 接續開發（N2 看板互動）

> 對象：雲端 Claude Code（用完即丟的環境，連不到 PCC 招標網與本機 Ollama）
> 交付者：本地 Claude（2026-06-19，下班關機前快照）
> 專案：Tender AI（monorepo，`aiadminhq/Tender-AI`，**private**）
> 分支：**`codex/card-swipe`**（本次已 push，含 upstream tracking）

---

## 0. 一句話

前端「N1 標案詳情就地展開＋快速預覽彈窗」已完成並驗證；本次同時把整體 **UI/UX v2 設計草稿**（5 畫面＋流程＋設計系統）落地成可瀏覽檔案。**你的下一步是 N2：招標看板的「標註」＋「轉傳」互動。** 純前端工作，雲端環境即可完成（不需 PCC/Ollama）。

---

## 1. 如何接手（branch / checkout）

```bash
git fetch origin
git checkout codex/card-swipe   # 本次進度都在這支
cd tender-ai-frontend
pnpm install        # node_modules 不入版控
pnpm dev            # vite，預設 5173；用 Preview MCP 驗證
pnpm exec tsc -b    # 型別檢查（交付前必跑，目前 exit 0 乾淨）
```

- 遠端：`https://github.com/aiadminhq/Tender-AI.git`
- **不要**推到 `main`/`dev`/正式站；在 `codex/card-swipe` 上續做即可（要開新分支或 PR 須先取得人類同意）。

---

## 2. 本次提交了什麼（snapshot）

| 範圍               | 內容                                                                                                | 檔案                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feat(fe)` N1+滑卡 | 今日焦點清單就地展開（同卡 L2）＋「快速預覽」彈窗入口＋「查看完整詳情」次要連結；滑卡頁卡片就地展開 | `components/tenders/focus-row.tsx`、`focus-list.tsx`、`focus-sort-bar.tsx`、`focus-deadline.tsx`（新）、`pages/dashboard-page.tsx`、`pages/swipe-page.tsx` |
| `feat(fe)` 小助手  | 小助手右下浮動入口／浮窗骨架＋行為埋點                                                              | `components/assistant/assistant-launcher.tsx`、`assistant-window.tsx`（新）、`lib/storage.ts`、`index.html`                                                |
| i18n               | zh／en 成對新增文案                                                                                 | `i18n/strings.ts`                                                                                                                                          |
| `docs` 設計        | **v2 設計計畫**＋**v2 設計草稿（可瀏覽 HTML）**＋本 hand-off                                        | `plans/uiux-v2-plan.md`、`plans/uiux-v2-draft.html`、`hand-off-cloud-uiux-260619.md`                                                                       |
| `chore` 技能       | `visual-plan` 設計技能（雲端 session 自動載入）                                                     | `.claude/skills/visual-plan/`                                                                                                                              |

**v2 設計草稿先看這個**：開 `plans/uiux-v2-draft.html`（自包含、可切明暗、焦點列可實際點開）。它的色票/圓角/陰影直接對齊 `tender-ai-frontend/src/index.css`，是落地後的真實樣貌，不是憑空 mockup。

---

## 3. 目前狀態與 v2 動工順序

設計計畫把工作切成 N1→N2→**N4**→N3（**N4 排在 N3 前**，因為 N4 會做出 N3 要重用的 Switch/Tabs/Select primitives）。

- ✅ **N1 標案詳情彈窗**：完成。今日焦點列改為同卡兩段式展開，主行動＝快速預覽彈窗（`TenderDrawer`），次要＝完整詳情頁。只動 `focus-*`，未污染 `/tenders` 的共用 `TenderRow`。
- 🟡 **N2 看板標註＋轉傳**：**你的下一步**（規格見 §4）。
- ⬜ **N4 設定頁**：`pages/settings-page.tsx` 目前空殼；需先做出 `Switch/Select/Tabs` primitives，再接後端 `/push/*` 與 `/assistant/chat`。
- ⬜ **N3 洞察分析**：`pages/insights-page.tsx` 空殼；全部手刻 inline SVG（donut／水平長條／before-after／趨勢），前端先做 `insights.ts` 聚合，第二步才接 `/reasoning/profile`。

---

## 4. N2 規格（你的下一個工作包）

**目標**：招標看板（看板模式）每張卡可「標註」與「轉傳給同事」。純前端狀態＋localStorage＋行為埋點，**先不接 AI/向量**。

涉及的真實檔案（已核對存在）：

- `src/types/domain.ts`：`KanbanCard` 在第 155 行。
  - 新增 `interface KanbanNote { id; cardId; authorId; text; createdAt }`。
  - `KanbanCard` 加 `notes?: KanbanNote[]`。
- `src/store/app-data.tsx`（狀態源）：新增 `addCardNote` / `removeCardNote` / `forwardCard`。
  - 各自更新前端狀態 → 寫 localStorage → `trackEvent`（埋點，事件歸到登入帳號 `user_id`）。
  - 三件事都要做：①寫進 context interface ②放進 value object ③加進 dependency array。
- `src/store/app-context.tsx`：context 型別同步擴充。
- `src/components/kanban/kanban-card.tsx`：卡片加「筆記 icon＋數量 badge」與「轉傳」入口。
- 新元件：`card-note-popover.tsx` ＋ `card-forward-menu.tsx`。
  - **不得用 Radix**；自寫。用 `fixed` 定位／portal，避免被 kanban column 的 `overflow` 裁切。
- `src/i18n/strings.ts`：zh／en 成對新增文案。

**驗證**：Preview MCP 點測（新增筆記、刪除、轉傳選人、跨欄不被裁切）＋ `pnpm exec tsc -b` ＋ `impeccable`（product 模式）稽核。

**PR / commit 需寫清楚 Layer B 三件事**（標註是行為資料）：①同意基礎 ②共享範圍（白名單 @hqdesign.tw 內具名共享）③對外隔離方式（不進公開版控／對外去識別化）。

---

## 5. 鐵則 / 治理（不可違反，House style 不得被技能覆蓋）

- **字體**：繁中僅 `Noto Sans TC`；英文 `Inter`／`SF Pro Text`；數字/程式碼 `JetBrains Mono`／`SF Mono`。**家族固定**，大小/字重可調（v2 字級表見草稿）。
- **視覺**：統一直線、零手寫/抖動；app 用 10px 圓角尺度；Bento 卡片；僅微陰影 `0 1px 2px rgba(0,0,0,.06)`，禁濃重投影；暗色為主。
- **技術限制**：**不得用 Radix**；**不得新增圖表庫／動畫庫**（圖表一律手刻 inline SVG）；Tailwind v4 `@theme`（無 config 檔）；primitives 自寫。
- **i18n**：新增文案 zh／en 成對、繁中為預設；**切語言不可重置** filters/favorites/ratings/dialog state。
- **Layer B 紅線**：行為資料（收藏/評分/想法/標註）僅在白名單 @hqdesign.tw 內具名共享；對白名單外/未授權第三方**永不揭露、永不外流**；**不進公開版控／GitHub Pages 對外視圖**；對外發佈或匯出一律去識別化。
- **commit**：Conventional Commits ＋ 範圍標籤（`be`/`fe`/`data`/`docs`/`infra`）；結尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`；git 身分 `aiadminhq`。
- **分支**：在 `codex/card-swipe` 續做；未經人類同意不推別分支、不開 PR。
- **覆蓋前先看**：要改/刪既有檔案先讀內容；與描述不符或非你所建，**停下回報**而非覆蓋。
- **每個工作包動工前先取得人類同意**（治理規範）。本次人類已同意「接續開發」；N2 為既定下一步，但實作前若有重大設計分歧仍應回報。

---

## 6. 必讀檔案（接手前）

- `CLAUDE.md`（根）— 專案最高層約定、Layer B 共享邊界、設計技能組。
- `plans/uiux-v2-plan.md` — v2 完整計畫（§0 全域約束、動工順序、各 N 規格、附錄現有 primitives 與缺口）。
- `plans/uiux-v2-draft.html` — v2 視覺草稿（5 畫面＋流程＋設計系統，可瀏覽）。
- `tender-ai-frontend/src/index.css` — 真實設計 token（**勿覆寫**）。
- `docs/governance/` — 治理規範全文（資料三層、命名、訓練資料規範）。

現有 UI primitives：`button / input / badge / card / dialog / sheet / avatar / separator / tier-badge / feasibility-meter / maximizable-card`。
**缺口（N4 要補）**：`switch / toggle / select / tabs / radio-group / slider`。

---

## 7. 環境注意 / 不在此 commit 內

- 雲端環境**連不到 PCC 招標網與本機 Ollama**；N2 為純前端，不受影響。N3 第二步的 `/reasoning/profile`、N4 的 `/push/*`、`/assistant/chat` 需後端，請在能連線的環境驗證或先做前端聚合/空殼。
- **本地限定、未入此次 commit**：
  - `Dashboar UI REF/`（4.4MB 設計參考圖庫）— 已加入 `.gitignore`；視覺方向已被 v2 草稿吸收，雲端做 N2 不需要它。
  - `tender-ai-frontend/.claude/launch.json`（本機 Preview MCP 設定）— 已 gitignore，機器相關。
- 另有 `hand-off-codex-260619.md`（小助手線交接給 Codex 的文件）一併入版控，與本文件並存。

---

最後更新：2026-06-19（下班關機前快照）

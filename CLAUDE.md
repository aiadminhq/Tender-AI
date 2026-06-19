# CLAUDE.md — 給所有 agent / session 的專案須知

> 本檔會被每個 Claude/agent session 自動讀取（本地與雲端皆然）。
> 這是「所有 agent 都必須先知道」的最高層級約定。完整規範見 `docs/governance/`。

---

## 專案是什麼

**Tender AI**：幫人篩選政府標案、並會「越用越聰明」的系統。Monorepo：
- `tender-ai-backend/`：資料與 AI 大腦（Python / FastAPI / PostgreSQL+pgvector / Ollama）。
- `tender-ai-frontend/`：人看的畫面（React / TypeScript / Vite，i18n 繁中預設、可切英文）。

---

## ⚠️ 最重要的一條：Layer B 是「合作範圍內共享」的知識庫

本專案的**核心目的**，就是讓不太熟 AI 的同事，透過共享知識庫與 AI 一起受惠。因此：

- **Layer B**（收藏、評分、想法、行為）在使用**白名單公司帳號**且**已取得本人同意**的前提下，
  會被**量化成向量、進入大家共享的知識庫**。
- **合作範圍＝白名單帳號**：原則上必須是 **@hqdesign.tw** 網域、且由管理者**開通在白名單內**的帳號。
  未來若發展順利，才可能開放邀請外界註冊登入；屆時外部使用者也須經邀請／授權**納入白名單**，才算合作範圍內。
- 共享對象 ＝ 白名單內的惠強同事 ＋ 專案 AI/agent。合作範圍內**看得到彼此的貢獻、可互相學習**，
  並**依登入帳號名稱具名標示貢獻者**（具名，非匿名）。
- **紅線**：對「**非合作範圍的對象**」（白名單外／未授權第三方）**永不揭露、永不外流**；
  行為資料不進公開版控／GitHub Pages 對外視圖；對外發佈或匯出一律**去識別化**。

> 不要把 Layer B 當成「每人私有、永不共享」——那是錯的舊描述。
> 正確邊界是「**合作範圍內共享、對外永不揭露**」。

### 資料三層速記

| 層 | 白話 | 揭露邊界 |
| --- | --- | --- |
| Layer A | 公開的標案資料 | 可公開、可從原始 HTML 重建 |
| Layer B | 同事的行為與想法 | **白名單(@hqdesign.tw)內共享＋依登入帳號具名、對外永不揭露**（需同意） |
| Layer C | 學出來的知識（向量/權重/理由） | 衍生物可重算；對外須去識別化 |

---

## 開發規矩（最低限度，細節見 docs/governance）

- **分支**：在指定的 `claude/<主題>` 分支開發（目前 `claude/busy-sagan-gm197s`）；未經同意不推到別的分支、不開 PR。
- **Commit**：Conventional Commits ＋ 範圍標籤（`be`/`fe`/`data`/`infra`/`docs`）。
- **雲端環境**：用完即丟，沒 push 就不存在；連不到 PCC 招標網與本機 Ollama，相關工作需在能連線的環境驗證。
- **覆蓋前先看**：要改/刪既有檔案先讀內容；與描述不符或非你所建，停下回報而非覆蓋。
- **碰到 Layer B**：在需求單與 PR 寫清楚 ①同意基礎 ②共享範圍 ③對外隔離方式。

---

## 前端設計／品味技能（UI/UX，自動組合使用）

> 本專案已在 `.claude/skills/` 安裝一組設計/品味技能，雲端與本地 session 都會自動載入。
> **凡涉及前端介面（頁面、元件、版面、樣式、動效、可及性、文案）的工作，務必主動組合調用以下技能**，不要憑直覺手刻出 slop。

| 技能 | 角色 | 何時用 |
| --- | --- | --- |
| `impeccable` | 反 slop 主審＋優化（product / brand 雙模式、44+ 確定性檢測） | 任何 UI 產出後把關打磨；本專案以 **product 模式**為主（儀表板/App UI），行銷/落地頁才用 brand |
| `ui-ux-pro-max` | 設計資料庫（風格/色盤/字體配對/版型）＋ shadcn/ui 整合 | 開新頁/新元件前選風格、色票、版型（本專案已用 shadcn） |
| `design-taste-frontend` | 注入設計品味（layout/typography/motion/spacing/density、變化性） | 需提升品味、消除模板感時 |
| `redesign-existing-projects` | 既有專案重設計流程 | 優化現有頁面（本專案多數情境） |
| `minimalist-ui` | 極簡編輯風（暖色單色、字級對比、扁平 Bento、無重陰影） | 與本專案設計語言一致的預設方向 |

**建議組合（依情境自動串）**
- **優化既有頁面**：`redesign-existing-projects` 盤點 → `ui-ux-pro-max` 取參考/tokens → `minimalist-ui`／`design-taste-frontend` 定品味 → 實作 → `impeccable` 稽核打磨。
- **全新頁面/元件**：`ui-ux-pro-max` 選型 → 品味技能定調 → 實作 → `impeccable` 稽核。
- **只做檢查/驗收**：`impeccable` 跑反模式偵測。

**House style（技能不得覆蓋本專案既有規範）**
- 繁中字體僅 `Noto Sans TC`；英文 `Inter`／`SF Pro Text`；數字/程式碼 `JetBrains Mono`／`SF Mono`。
- 極簡直線、零手寫/抖動；統一 16px 圓角；Bento 卡片分區；僅允許些微陰影（`0 1px 2px rgba(0,0,0,.06)`），禁濃重投影。
- i18n：新增文案 zh／en 成對，繁中為預設。
- 改前端先參考 `plans/tender-ai-integrated-roadmap/plan.mdx` 與 `docs/superpowers/`。

> 安裝來源記錄於 `skills-lock.json`；`.agents/` 為 CLI 暫存（不入版控），可用 `npx skills experimental_install` 還原。

---

## 文件導覽

| 想知道 | 看哪裡 |
| --- | --- |
| 心智模型、資料三層、功能代號 | `docs/governance/00-總覽與心智模型.md` |
| 雲端怎麼下需求 | `docs/governance/01-雲端開發與需求.md` |
| 本地↔雲端同步 | `docs/governance/02-本地雲端同步.md` |
| 命名與目錄、領域知識放哪 | `docs/governance/03-命名與目錄規範.md` |
| 訓練資料 / 共享知識庫規範 | `docs/governance/04-訓練資料規範.md` |
| 白話術語、進度 | `docs/governance/05-進度與白話術語.md` |
| 產品願景 / 設計 | `PRD.md` / `DESIGN.md` |

---

最後更新：2026-06-19

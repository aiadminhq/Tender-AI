---
title: "tender-bot-design-handoff-260617"
type: reference
category: development
tags: [tender-bot, design-handoff, ui-ux, nextjs, design-system, filtering, rag]
status: draft
created: 2026-06-17
author: claude-cowork
---

# tender-bot 前端重建｜Design Handoff（給 claude design）

> 本文件為 UI/UX 診斷 + 重建設計交付包。診斷方法採 impeccable `critique`（Nielsen 10 heuristics、cognitive load、persona）＋ `audit`（a11y／performance／theming／responsive／anti-pattern 五維評分）＋ taste `redesign-skill`（audit-first 升級清單）。
> 交付對象：claude design（負責產出視覺與畫面）。本文件只定義「問題、需求、規格、tokens、藍圖」，不含實作程式碼。

---

## 1. 專案脈絡

`tender-bot` 目前是**靜態產出管線**：Python 爬蟲（`tender_daily.py`，跑在 GitHub Actions）每日台灣 08:00 爬 PCC 政府電子採購網，產出兩種靜態 HTML——

- **每日報表頁** `tender-YYYYMMDD.html`：當日標案的暗色資料表。
- **首頁儀表板** `index.html`：累計記錄表 + stat 卡 + filter chips + ⭐ 最優先卡片牆（client-side JS 注入）。

本次目標：將其重建為**動態網頁應用**，並借這次重建徹底優化 UI/UX 與**篩選機制**。

### 已鎖定決策（前期確認）

| 面向 | 決策 |
|---|---|
| 框架／部署 | Next.js（App Router）+ Cloudflare（Pages/Workers、D1、Vectorize） |
| 資料層 | scraper 直寫 D1（HTTP API，token 放 GitHub Secrets）；保留靜態 HTML 降級備援 |
| 爬蟲核心 | **不重寫**（`tables[4]`／`SkipSSLAdapter`／PCC 連線為已測邏輯），僅新增 D1 寫入 |
| 視覺 | **雙主題（light／dark 可切）**，交付兩套 design tokens |
| 後台 admin | 關鍵字／規則／門檻可視化編輯、手動重跑 + log、標記／加星／備註、匯出 Excel/PDF |
| 關鍵字管理 | **分「重點關鍵字」（納入／加權）與「避免關鍵字」（排除）兩區** |
| Auth | 小團隊／單一公司（Cloudflare Access 或 email 白名單） |
| RAG | 混合：Workers AI 做 embeddings + Vectorize 檢索 + Anthropic 做摘要；範圍＝公開標案語意搜尋 + 招標文件自動摘要 |

---

## 2. 現況盤點（兩個 surface）

### 2.1 每日報表頁（`tender-YYYYMMDD.html`）

結構（由上而下）：header（標題＋一行極長篩選條件副標）→ 5 張 stat 卡 → ⭐ 期間最優先 block → 「今日行動優先序」notice → 資料表（潛力／標案名稱·機關／預算金額／截止日期／招標方式／連結）→ footer。

- **互動性：零**。無搜尋、無篩選、無排序——純靜態表格。排序固定由伺服器端依剩餘天數決定。
- 潛力分級徽章：🟢 高（≤14 天）／🟡 中（15–30）／🔴 低（≥31）；🔥 緊急只給被豁免的 ≤7 天最優先案。

### 2.2 首頁儀表板（`index.html`）

- 5 張 stat 卡：⭐ 最優先累計／累計報表數／🟢 高／🟡 中／🔥 緊急累計。
- filter chips：**只有兩個**——🔥 有緊急、⭐ 有最優先（`<span onclick>`，非 `<button>`）。
- 搜尋框：對日期／摘要做關鍵字過濾。
- ⭐ 最優先卡片牆：JS 依當前 `PRIORITY_RULES` 過濾、依截止日排序、取前 12 筆。
- 記錄表：日期／總件數／高／中／低／⭐ 最優先／報表連結。

### 2.3 現有 design tokens（從 CSS 抽出，**目前全為 hard-coded hex，無變數系統**）

| 角色 | 現值（dark） |
|---|---|
| 頁面底 / 文字 | `#0f1117` / `#e2e8f0` |
| 次級文字 | `#94a3b8`、`#cbd5e1`、`#64748b`（最弱，對比偏低） |
| 卡面 / 表頭 | `#161b27` / `#111827` |
| 框線 | `#1e2d45` |
| 主色（藍） | `#60a5fa` / `#93c5fd` / `#3b82f6`；header 漸層 `#0d1f3c→#1a2744` |
| 最優先（金） | `#fbbf24` / `#fde68a` / `#b8860b`；block 漸層 `#2a1f08→#3b2a0a` |
| 高潛力（綠） | `#4ade80` / `#22c55e` |
| 中潛力（黃） | `#facc15` / `#ca8a04` |
| 低/緊急（紅） | `#f87171` / `#ef4444` / `#7f1d1d` |
| 第二資料源（北醫） | 藍 `#7dd3fc`、紫 `#c4b5fd` |
| 圓角 | 卡 8–10px、徽章 3–4px |
| 字型 | `'Segoe UI','Microsoft JhengHei',sans-serif`（系統預設，無自訂） |

---

## 3. UI/UX 問題清單（診斷結果）

### 3.1 critique 評分 — Nielsen 10 Heuristics

| # | Heuristic | 分數 | 關鍵問題 |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | 篩選無「結果筆數」回饋；報表頁無任何狀態；無「資料更新時間」 |
| 2 | Match System / Real World | 3 | 領域用語佳（潛力／最優先／截止），emoji 助掃讀 |
| 3 | User Control & Freedom | 1 | 報表頁零篩選/排序/搜尋；無 clear-all；使用者無法自訂條件 |
| 4 | Consistency & Standards | 2 | 分級定義在 server + 兩個 client 各寫一份（漂移風險，已於異動規劃自認）；chip 與 link 樣式不一 |
| 5 | Error Prevention | 2 | 篩選可靜默產生 0 列，無防呆 |
| 6 | Recognition Rather Than Recall | 2 | 篩選條件擠在副標長字串，須閱讀記憶；規則以文字呈現非互動控制 |
| 7 | Flexibility & Efficiency | 1 | 無鍵盤操作、無存檔篩選、無多條件組合、無排序、無匯出 |
| 8 | Aesthetic & Minimalist | 3 | 暗色乾淨，但 stat 列＋長副標＋notice＋block 大量堆在表格之上，首屏負荷高 |
| 9 | Error Recovery | 2 | 0 結果無復原提示 |
| 10 | Help & Documentation | 1 | 規則為密集文字；無 onboarding／圖例／說明 |
| **合計** | | **19 / 40** | **Acceptable — 需大幅改善** |

### 3.2 audit 評分 — 五維技術品質

| # | 維度 | 分數 | 關鍵發現 |
|---|---|---|---|
| 1 | Accessibility | 1 | chips 用 `<span onclick>`（無 focus／無 `aria-pressed`）；`#64748b` 小字對比偏低；表格無 `scope`/`caption`；無 skip-link；emoji 承載語意 |
| 2 | Performance | 3 | 靜態輕量、無重資產；佳 |
| 3 | Theming | 1 | 顏色全 hard-coded、無 CSS variables/tokens；僅單一暗色——**雙主題前必須先 tokenize** |
| 4 | Responsive | 2 | 有 viewport + 1 breakpoint + 表格 overflow-x；但 `min-width:860px` 逼出橫向捲動、觸控目標 <44px、chip 偏小 |
| 5 | Anti-Patterns | 3 | 不算 AI slop；少數 tell（系統預設字型、藍→navy 線性漸層、全平面無質感、數字用比例字非 tabular） |
| **合計** | | **10 / 20** | **Acceptable — 需大幅改善** |

### 3.3 Anti-Pattern Verdict

不是典型「一看就是 AI 做的」。結構由領域驅動、配色克制，因此不顯模板感。但隨著要升級為正式 app，現況**視覺偏通用、技術底子不足**。可見 tell：① 系統預設字型 stack；② 藍→深藍線性漸層；③ 表面全平面無紋理/層次；④ 預算與天數用比例字（資料密集介面應 `tabular-nums`）。

### 3.4 分級問題清單（P0–P3）

> P0 阻斷 / P1 重大（含 WCAG AA 違反）/ P2 次要 / P3 打磨。每項標註對應畫面與建議修法。

**P0 — 阻斷**

1. **報表頁（使用者每天真正打開的那頁）完全沒有篩選/排序/搜尋。** 篩選只存在於首頁、且只有 2 個 chip。→ 這正是本案核心需求。修：報表頁與列表頁皆需完整的可組合 filter bar（見 §5）。
2. **無 theming 系統（顏色全 hard-coded）。** 雙主題需求在 tokenize 前無法達成。修：先建立 CSS variables / design tokens 兩套（§6），所有顏色改引用 token。

**P1 — 重大**

3. **篩選/分級邏輯重複且會漂移**（server Python + 兩個 client surface 各一份）。修：單一事實來源（前端共用 filter state + 一份 `classify_tier` 等價邏輯），定義集中。
4. **a11y 違反 WCAG AA**：互動元素非語意（`<span onclick>`）、對比不足、觸控目標 <44px、表格無語意標記。修：改 `<button aria-pressed>`、提高弱文字對比、觸控目標 ≥44px、表格加 `<caption>`/`scope`、加 skip-link 與可見 focus ring。
5. **篩選為「只納入」且使用者無法於 runtime 控制**；無「避免關鍵字」概念。修：filter bar 提供重點關鍵字（納入/加權）與避免關鍵字（排除）兩區（§5），對應 admin 設定。

**P2 — 次要**

6. **首屏資訊密度過高**：長副標字串 + 堆疊區塊把資料壓到下方。修：副標的篩選條件改為可視 filter chips/控制；區塊可收合。
7. **篩選無結果筆數回饋、0 結果無 empty-state 指引。** 修：filter bar 即時顯示「N 筆符合」；0 結果給「放寬條件」CTA。
8. **排序固定（僅伺服器端依天數）。** 修：列表支援使用者排序（截止日／預算／潛力／命中關鍵字數）。

**P3 — 打磨**

9. 系統預設字型 → 換具特色且支援繁中與 `tabular-nums` 的字型（數字欄位用等寬數字）。
10. 全平面表面 → 加極淡質感/層次；漸層改用更克制的處理。

### 3.5 篩選機制專章（核心需求）

現況限制總結：① 只在首頁、② 只有 🔥/⭐ 兩個維度、③ 不可組合、④ 不可排序、⑤ 無關鍵字層級（重點/避免）、⑥ 無狀態保存、⑦ 無筆數回饋、⑧ server/client 定義漂移。重建後的篩選器規格見 §5——這是本案最高優先的 UX 改造點。

---

## 4. 目標資訊架構與畫面藍圖（6 畫面）

1. **首頁儀表板**：今日重點（⭐ 最優先 + 高潛力即將截止）+ 趨勢摘要 + 快速進入今日報表；全域 filter bar 入口。
2. **標案列表頁**（取代每日報表頁）：完整 filter bar（§5）+ 可排序資料表/卡片切換 + 即時筆數 + empty-state；支援跨日期區間，非單日靜態。
3. **標案詳情頁**：單一標案全欄位 + 來源連結 + RAG「相似歷史標案」+「招標文件摘要」+ 標記/加星/備註。
4. **RAG 語意搜尋頁**：自然語言查詢 + 語意結果 + 摘要卡。
5. **後台 admin**：關鍵字雙區編輯（重點/避免）、`PRIORITY_RULES`/`MAX_BUDGET`/`EXCLUDE_WITHIN_DAYS` 可視化、手動重跑 + 執行 log、標記/加星/備註管理、匯出（Excel/PDF）。
6. **登入頁**：小團隊單公司，簡單 auth。

---

## 5. 篩選器規格（filter bar）

claude design 需把篩選設計為**一條可組合、可保存、有回饋**的 filter bar，列表頁與儀表板共用：

**篩選維度（可同時套用，AND 組合）**

- 潛力分級：⭐ 最優先 / 🟢 高(≤14) / 🟡 中(15–30) / 🔴 低(≥31)（multi-select）。
- 截止窗：自訂天數區間（如 8–14、15–30），含「排除 7 天內（最優先除外）」開關。
- 預算區間：滑桿或雙輸入（萬為單位，上限 8,000 萬）。
- 標的分類：工程 / 財物 / 勞務（multi-select）。
- 城市：台北 / 新北（multi-select）。
- 資料源：PCC / 北醫聯合採購。
- **重點關鍵字**（納入/加權）：可多選/輸入；命中者加權置前。
- **避免關鍵字**（排除）：命中標案名稱者隱藏（新功能，現況無）。

**互動要求**

- 控制項為語意化 `<button aria-pressed>` / 原生表單元素，全鍵盤可操作、可見 focus ring、觸控目標 ≥44px。
- 即時顯示「N 筆符合」；提供 clear-all。
- 0 結果顯示 empty-state + 「放寬條件」建議。
- 篩選狀態保存（localStorage / URL query，便於分享連結）。
- 排序控制：截止日 / 預算 / 潛力 / 命中關鍵字數，升降序。
- 重點/避免關鍵字兩區 UI 需與 admin 設定畫面視覺一致（同一組 token 與元件）。

---

## 6. 雙主題 design tokens（交付兩套）

以現有暗色為基礎升級，並補一套明亮 B2B 套；claude design 確認後落為 CSS variables。語意命名（非顏色名），確保切換主題只換 token 值。

| 語意 token | dark（沿用升級） | light（新增建議） |
|---|---|---|
| `--bg` | `#0f1117` | `#f7f8fa` |
| `--surface` | `#161b27` | `#ffffff` |
| `--surface-2` | `#111827` | `#eef1f5` |
| `--border` | `#1e2d45` | `#dfe3ea` |
| `--text` | `#e2e8f0` | `#1a2230` |
| `--text-muted` | `#94a3b8`（弱文字對比需提升） | `#566072` |
| `--primary` | `#60a5fa` | `#2563eb` |
| `--priority`（最優先金） | `#fbbf24` | `#b8860b` |
| `--tier-high`（綠） | `#4ade80` | `#16a34a` |
| `--tier-mid`（黃） | `#facc15` | `#ca8a04` |
| `--tier-low`（紅） | `#f87171` | `#dc2626` |
| `--accent-2`（北醫藍） | `#7dd3fc` | `#0284c7` |
| `--radius-card` | `10px` | `10px` |
| `--radius-chip` | `4px` | `4px` |
| `--font-sans` | 待選（支援繁中、具特色） | 同左 |
| `--num`（數字） | `tabular-nums`（預算/天數） | 同左 |

備註：所有對比需達 WCAG AA（內文 4.5:1、大字 3:1）；`--text-muted` 與 `--bg` 的組合須重新校正（現況 `#64748b` 偏低）。

---

## 7. 元件清單（component inventory）

需重設計並 tokenize 的元件：① stat 卡；② 潛力分級徽章（⭐/🟢/🟡/🔴 + 🔥）；③ 標的分類標籤（工程/財物/勞務）；④ ⭐ 最優先卡片（pri-card）；⑤ 第二資料源區塊（tmu-block）；⑥ filter chip / filter bar（§5）；⑦ 搜尋框；⑧ 排序控制；⑨ 資料表列（含 hover/zebra/截止天數膠囊）；⑩ empty-state；⑪ 主題切換器（非預設 sun/moon switch，建議整進設定或下拉）；⑫ admin 表單（關鍵字雙區、規則編輯、log 檢視）。

---

## 8. 內容／文案準則（taste 清單摘錄）

句首大寫改 sentence case；移除成功訊息驚嘆號；錯誤訊息直述（「連線失敗，請重試」）；數字用真實非整數；避免 AI 套語（Elevate / Seamless / 賦能 …）；篩選條件改互動控制而非長字串副標。

---

## 9. 給 claude design 的交付清單

請依本文件產出：① light/dark 兩套 design tokens（CSS variables）；② 6 畫面的高保真設計（§4）；③ filter bar 互動規格落地（§5，含重點/避免關鍵字雙區）；④ §7 元件庫；⑤ a11y 標註（focus 順序、aria、對比、觸控目標）；⑥ RWD 斷點（mobile/tablet/desktop，表格在窄屏改卡片）。

實作交接給工程時，沿用「不重寫 scraper」鐵則；前端走 Next.js + Cloudflare（D1/Vectorize），資料以 scraper 直寫 D1 為來源。

---

### 附：相關檔案清單（供 claude design / 工程參考）

| 檔案 | 用途 |
|---|---|
| `tender-bot/tests/golden/report_20260617.html` | 現有報表頁完整樣張（含全部 CSS） |
| `tender-bot/staging-seed-index.html` | 首頁精簡種子（記錄表 + records 結構） |
| `tender-bot/tender_daily.py`（`build_html`/`update_index`/`_patch_index_for_priority_list`/`_build_priority_block`） | 現有 UI 生成與 filter chip / 最優先卡片邏輯 |
| `tender-bot/異動規劃-篩選與分級調整.md` | 篩選/分級既有規格（重點/避免關鍵字、7 天排除、分級） |
| `tender-bot/CLAUDE.md` | 技術架構、PRIORITY_RULES、環境分層、約束 |

# Tender AI — UI/UX v2 開發計畫(N1–N4)

> **給接手 agent**:本文件假設你對本 codebase 零脈絡。每個工作包(N1–N4)都列出「現況 → 目標 → 要碰的檔案 → 介面 → 步驟 → 驗收 → Layer B 注意」。**先設計再實作,每個工作包動工前先取得人類同意**(本專案規矩)。
>
> **最後更新**:2026-06-19
> **分支**:在 `codex/card-swipe` 上開發(或人類指定的 `claude/<主題>` 分支);未經同意不推到別的分支、不開 PR。
> **不在範圍**:速配配對(swipe)/收藏頁——人類指示往後推,本輪不碰;後端 scraper / 向量訓練不碰。
>
> **⚠️ 進度更新(2026-06-23)**:N1✅、N2✅ 已完成(見文末 §D-2)。**下文 N4 對「空殼」的敘述已過時**,實況如下,閱讀時請以此為準(N4/N3 的版型與 primitive 規劃仍可參考):
>
> - `assistant-page.tsx`(`/assistant`)**已非空殼**——已改建為小助手「整頁指揮中心」(左對話 `AssistantUIThread`＋右情境 `AssistantContextPanel`),採官方 **`@assistant-ui/react`**,與右下角 FAB 非阻擋浮窗共用 runtime;**非**本文 N4 原案的「聊天頁＋資料範圍設定」。
> - `push-page.tsx`(`/push`)**已接線**(`fetchPushDigest`/`runPush`/`markPushRead`),且推播/小助手/帳號安全等設定已落在 `settings-page`。
> - `insights-page.tsx`(`/insights`)**仍為部分 mock**,N3 洞察視覺化未完整落地。
> - Switch/Select/Tabs 等 primitive 視實作進度為準(部分已補)。

---

## 0. 全域約束(每個工作包都適用)

- **House style(技能不得覆蓋)**:繁中字體僅 `Noto Sans TC`;英文 `Inter`/`SF Pro Text`;數字/程式碼 `JetBrains Mono`/`SF Mono`。極簡直線、零手寫/抖動;統一 **16px 圓角**;Bento 卡片分區;**僅允許些微陰影** `0 1px 2px rgba(0,0,0,.06)`,禁濃重投影。
- **技術棧**:React + TypeScript + Vite + Tailwind v4(CSS `@theme`,**無 tailwind.config**)。UI primitive **全自寫**(**無 Radix**,shadcn 風格)。圖表**自寫 inline SVG**(專案未裝任何圖表庫,勿新增 recharts/visx/chart.js)。
- **i18n**:文案 zh/en **成對**新增,繁中為預設。字串集中在 `src/i18n/strings.ts` 的 `STRINGS`;一般 key 用 `t("key")`;function key(如 `remainingDays(n)`)直接 `STRINGS[lang].fnKey(n)`,**不可用 `t()`**。`useApp()` 回傳 `{ t, lang }`。
- **狀態來源**:`src/store/app-data.tsx`(資料/收藏/看板/規則)、`src/store/app-context.tsx`(登入者,預設 `USERS[0]`,placeholder 帳號 HQadmin)。
- **設計技能**:涉及 UI 一律組合 `impeccable`(**product 模式**)/`ui-ux-pro-max`/`minimalist-ui`/`design-taste-frontend`/`redesign-existing-projects`;產出後跑 `impeccable` product 反 slop 稽核。
- **驗證**:用 Preview MCP(vite dev + HMR);改完跑 `tsc`/build;`preview_console_logs` 無紅字;`preview_screenshot` 佐證視覺。
- **Commit**:Conventional Commits + 範圍標籤(`fe`/`be`/`data`/`infra`/`docs`);訊息結尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。commit/PR 身分 = aiadminhq。
- **Layer B 治理**:收藏/評分/想法/行為=Layer B,**白名單(@hqdesign.tw)內共享、具名、對外永不揭露、需同意、僅本機 DB**。凡碰 Layer B,PR 要寫 ①同意基礎 ②共享範圍 ③對外隔離方式。本輪 N2/N3 的行為資料**先走前端 state + 既有 `trackEvent`**,不急著入向量。
- **覆蓋前先讀**:改/刪既有檔案先讀內容;與描述不符或非你所建,停下回報而非覆蓋。

### 建議動工順序與理由

1. **N1**(最快,先釐清)→ 2. **N2 看板標註/轉傳**(人類點名優先,無後端阻塞)→ 3. **N4 設定頁**(後端已就緒;順手補出 Switch/Tabs/Select 等 primitive)→ 4. **N3 洞察分析**(最重;先前端彙總,N3 篩選控制可複用 N4 補的 primitive)。

> 把 N4 排在 N3 前,是因為 N4 會把缺的 UI primitive 補齊,N3 圖表的篩選控制能直接複用,避免重工。

---

## N1 — 標案清單彈窗(釐清 + 對齊/打磨)

**性質**:小工作量。彈窗**已存在**,非從零做。

### 現況

- `src/components/tenders/tender-drawer.tsx`(~384 行)**已是置中完整資訊彈窗**:`open={!!tender}`,Esc/點背景可關。含標題+收藏、`LabelTags`、`FeasibilityBadge`、排除警示、左欄(截止倒數 banner、可行性 meter、下一步、事實格、關鍵字命中、原文連結 + 完整詳情頁鈕→`/tenders/:id`)、右欄(accept/skip、`RatingStars`、轉傳 link/email via `postShare`、公開/私有切換、筆記、新增筆記)。已用 `trackEvent`。
- `/tenders` 列表:`tenders-page.tsx` → `tender-table.tsx` → `tender-row.tsx`,點列 `onOpen(id)` 應開此彈窗。
- 首頁今日焦點:`focus-list.tsx` 點列預設**就地展開**(同卡 accordion,`focus-row.tsx`),面板裡「快速預覽」鈕才開 `TenderDrawer`。

### 實機驗證結論(2026-06-19,Preview MCP)

> 已用 Preview MCP 實機點擊兩處,把先前三個假設收斂成定論:

1. **`/tenders` 點列——正常,非 bug。** 點任一列 → `onOpen(id)` → `tender-table` selectedId → `TenderDrawer` 開啟,`role="dialog"`、含承接/略過/可行性/評價、body 鎖捲動。✅ 已完成。
2. **首頁今日焦點點列——兩段式,這才是「看起來沒完成」的點。** 點列只是就地手風琴展開(`aria-expanded` false→true,無彈窗),要再點面板裡的「快速預覽」才彈窗。⚠️ 與「點列即彈窗」的期望不符。
3. 彈窗**內容/排版本身完整**,不需大改;若要再收口走 `impeccable` product 打磨即可。

### 人類拍板(2026-06-19)

採 **B 維持兩段式但更明顯**:保留就地展開(L2)→ 彈窗(L3)的兩段式互動模型不動,但把「快速預覽」升為主要 CTA、讓展開面板更好讀,守住原三層下鑽設計。(否決 A 直接彈窗 / C 混合——不更動點擊模型。)

### 步驟

- [x] 取得人類拍板:**B**。
- [x] 對症實作(**只動 `focus-row.tsx`**,未改點擊模型):動作區改為 `border-t border-hairline pt-3` 分隔;「快速預覽」升為 `variant="primary"` + `flex-1 justify-center` + `<Eye>` 圖示(寬版深色主按鈕,開 `TenderDrawer`);「查看完整詳情 →」降為 `variant="ghost"` 次要連結(導去 `/tenders/:id`)。
- [x] 驗證:Preview MCP 首頁展開列→點「快速預覽」→ `role="dialog"` 彈窗開啟(內容完整:機關/公告日/預算/截止/可行性/承接略過/評價/轉傳/可見性/註記)、Esc 關閉、body 鎖捲動正常、無 console 紅字;`tsc` 通過。

### 驗收

- [x] 首頁今日焦點展開列能可靠開出完整資訊彈窗,「快速預覽」為顯眼主行動,關閉行為正常,無 console 紅字。**N1 完成。**

### N1-b 補充缺口(彈窗「內容」層,非互動模型;選做、非阻塞)

> 互動模型(兩段式)已收口並驗收;但 `tender-drawer.tsx` 的彈窗**內容**仍有真實缺口,列為 N1-b,接手可擇期補:

- **問題定位**:`tender-drawer.tsx:234-237` **渲染 4 個空的 `PlaceholderBlock`**(`deliveryLocation` / `qualification` / `attachments` / `similarCases`)。彈窗**只吃 `tender` prop(列表級資料)+ store**,**從未呼叫** `fetchTenderDetail` / `fetchSimilarTenders`(兩者 `api.ts` 已實作),故四格永遠空白。
- **可立即補(無後端阻塞)**:`similarCases` —— `fetchSimilarTenders(id)` 已就緒。彈窗開啟時 lazy 載入,以 `Fact`/`TierBadge`/`FeasibilityMeter` 列出相似案;切換標案或關閉時用 `AbortController` 取消 in-flight。
- **待後端補欄位**:`deliveryLocation` / `qualification` / `attachments` —— 後端 `TenderListItem` 與 `fetchTenderDetail` 回傳的 `TenderDetail` 皆**尚無**這些欄位。需先請後端補欄位再接線;在那之前**保留 `PlaceholderBlock`「待補」佔位**(禁止硬塞假資料)。
- **介面(若實作 N1-b)**:

```ts
// tender-drawer.tsx:切換標案的 render 期重置區塊內 setSimilar([]);
// 再以 effect/開啟事件觸發,abort 隨切換/關閉
fetchSimilarTenders(id: string, limit = 6, signal?: AbortSignal): Promise<SimilarTender[]>; // {tender, score}[]
```

- **驗收(N1-b)**:開彈窗→相似案區塊載入並可點擊;快速切換不殘留上一筆;Esc/關閉取消 in-flight 無 console 紅字;其餘三格維持「待補」佔位直到後端補欄位。

---

## N2 — 招標看板:標註 + 轉傳(**優先**)

**性質**:中。需擴型別 + store 方法 + 2 個 UI;無新後端依賴(先走前端 state + 既有 event)。

### 現況

- `src/pages/kanban-page.tsx` → `kanban-board.tsx`(硬寫 4 欄 `TaskStatus = todo|doing|review|done`,讀 `cards` + `moveCard`)→ `kanban-column.tsx` / `kanban-card.tsx`(拖拉、鍵盤 ←→、顯示 tier/title/deadline/負責人頭像、blocked 徽)。
- `KanbanCard` 型別(`src/types/domain.ts:155-166`):`id, tenderId?, title, status, assignee?, tier?, deadline?, blocked?, blockReason?` —— **無 notes / 轉傳欄位**。
- `accept(tenderId)`(`app-data.tsx:537-565`)建卡(status todo、assignee=當前使用者),`moveCard`(607-622)。卡片層**無** share/note;tender 層有 `postShare`(`api.ts:361-363`)。
- 使用者清單:`src/data/users.ts`(5 個 mock user)。登入者:`app-context.tsx`。

### 目標

- **標註**:卡片可加具名註記(作者=登入帳號、時間、內容),卡面顯示註記 icon + 計數。
- **轉傳**:卡片可「轉傳給…」白名單內同事(指派/通知),或沿用 tender 層 `postShare` 發 email/連結。

### 要碰的檔案

- 修改:`src/types/domain.ts`(擴 `KanbanCard`,新增 `KanbanNote`)。
- 修改:`src/store/app-data.tsx`(新增 store 方法)。
- 修改:`src/components/kanban/kanban-card.tsx`(註記 icon + 計數、轉傳入口)。
- 新增:`src/components/kanban/card-note-popover.tsx`(註記檢視/編輯)。
- 新增:`src/components/kanban/card-forward-menu.tsx`(選白名單同事轉傳)。
- 修改:`src/i18n/strings.ts`(zh/en 成對)。
- (選)`src/lib/events.ts` / 既有 `trackEvent` 埋點。

### 介面(供其他任務依賴)

```ts
// domain.ts
export interface KanbanNote {
  id: string;
  author: string;     // 登入帳號名稱(具名,Layer B)
  createdAt: string;  // ISO
  body: string;
}
export interface KanbanCard {
  // ...既有欄位...
  notes?: KanbanNote[];
}

// app-data.tsx 新增方法(掛進 context value)
addCardNote(cardId: string, body: string): void;     // author=當前登入者
removeCardNote(cardId: string, noteId: string): void;
forwardCard(cardId: string, toUserId: string): void; // 指派/通知白名單同事
```

### 步驟

- [x] 擴 `KanbanCard` + 新增 `KanbanNote` 型別(`{id, author, createdAt, body}`;`KanbanCard.notes?`)。
- [x] `app-data.tsx` 實作 `addCardNote/removeCardNote/forwardCard`(前端 state;`person.id` 具名;`pushActivity` + `trackEvent`;`forwardCard` 用 `userById(toUserId)?.name` 顯示轉傳對象)。
- [x] `kanban-card.tsx` 加註記 icon + 計數、轉傳入口(House style:直線、16px 圓角、些微陰影);用按鈕 `getBoundingClientRect()` + 右緣防溢出算 fixed 定位。
- [x] `card-note-popover.tsx` / `card-forward-menu.tsx`(無 Radix,自寫;`position:fixed` 不被 `overflow` 裁切;`document.mousedown` 點外關閉;作者本人才出現刪除鈕)。
- [x] i18n zh/en 成對(`cardNotes/addCardNote/noteAuthor/removeNote/forwardCard/forwardTo/selectTeamMember/add/cancel/noData`)。`events.ts` `EventType` 補 `card_note_added/removed/forwarded`(後端 enum 待同步,fire-and-forget 靜默吞錯,不影響 UI)。
- [x] 驗證(2026-06-21,Preview MCP @5173):轉傳選單列出成員、轉傳後首卡指派 CW→DW 且選單關閉;註記新增顯示具名「Christian Wu」+日期+計數徽章「1」、輸入框清空;刪除回空狀態、徽章歸零;定位精準(top 308/left 395 對齊按鈕);`tsc -p tsconfig.app.json` 0 錯、全程 console 0 紅字。`impeccable` 稽核待跑。

### 驗收

- 卡片可新增/刪除具名註記,卡面顯示計數;可轉傳給白名單同事;i18n 中英皆全;無 console 紅字。

### Layer B 注意

- 註記內容、轉傳對象=**行為資料(具名)**。本輪只落**本機/前端 state + `trackEvent`**,**不寫入向量/共享知識庫**。PR 描述寫 ①同意基礎 ②共享範圍(白名單內具名)③對外隔離(不入公開版控/Pages)。

---

## N4 — 設定頁優化(主動推播 / 小助手 / 規則)

**性質**:中大。畫面從零搭 + 補 4–5 個基礎 primitive;但**後端已就緒**,接線即可。

### 現況

- `src/pages/rules-page.tsx` **已完整**(`RulesPanel` 三卡:聚焦/避免/硬排除 + `KeywordEditor` + `RulesWorkspace` dialog)——**當設定頁設計範本**。規則 state 在 `app-data.tsx`(`focus/avoid/hardExclude` + add/remove/addKeywords/moveKeyword/replaceKeywords/clearKeywords,localStorage `rules:*`)。
- `src/pages/push-page.tsx`(/push)、`src/pages/assistant-page.tsx`(/assistant):**空殼**。
- **後端已就緒、前端未接線**:`/push/run`、`/push/digest`、`/push/read`、`/assistant/chat`。
- **缺的 UI primitive**:目前**無** Switch/Toggle/Select/Tabs/RadioGroup/Slider —— 這幾頁需要,**自寫**(無 Radix)。這是 N4 隱藏前置工,也供 N3 複用。

### 要碰的檔案

- 新增 primitive:`src/components/ui/switch.tsx`、`select.tsx`、`tabs.tsx`(視需要 `radio-group.tsx`、`slider.tsx`)。
- 修改/重寫:`src/pages/push-page.tsx`、`src/pages/assistant-page.tsx`。
- 新增:`src/lib/api.ts` 接 `fetchPushDigest`、`postPushRun`、`postPushRead`、`postAssistantChat`(對應後端端點)。
- 修改:`src/i18n/strings.ts`(zh/en 成對)。

### 步驟

- [ ] **先補 primitive**:Switch/Select/Tabs(House style,自寫,鍵盤可及、aria 正確)。先各寫一個最小可用 + a11y。
- [ ] **主動推播頁**:設定面板——頻率/時段、觸發條件(可行性門檻、關鍵字、地區)、digest 預覽(接 `/push/digest`)、已讀(`/push/read`)。版型抄 rules 三卡。
- [ ] **小助手頁**:聊天介面接 `/assistant/chat`;加「能看哪些資料/語氣/預設提問」設定區。
- [ ] **規則頁**:已完成,只統一視覺語言(與前兩頁同套卡片/開關/分節)。
- [ ] i18n zh/en 成對。
- [ ] 驗證:Preview MCP 三頁不再空殼、設定可操作、digest/chat 接線可動(若雲端連不到後端,在能連線環境驗證);`tsc`/build 通過;`impeccable` product 稽核。

### 驗收

- push/assistant 兩頁有實際可設定的控制項與後端接線;三頁視覺語言一致;新 primitive 鍵盤/aria 正確;i18n 全;無 console 紅字。

### Layer B 注意

- 小助手能讀的資料範圍若涉及 Layer B,設定預設**最小揭露**;對外隔離同上。

---

## N3 — 洞察分析視覺化(接 Layer A/B)

**性質**:中大。圖自寫 SVG(有範本可抄);**先做前端彙總**(不必等後端);Layer B 解釋層接 `/reasoning/profile` 第二步上。

### 現況

- `src/pages/insights-page.tsx`:**空殼**(只有 `PageHeader`)。
- **無圖表庫**;範本:`src/components/dashboard/category-chart.tsx`(donut SVG)、`trend-chart.tsx`(line+area SVG)、`kpi-row.tsx`、`activity-stream.tsx`。
- store 有 `filteredTenders`(Layer A)、`metrics`、`trend7d`、`activity`、`usingLiveData`。
- **後端無 `/stats`/`/analytics` 彙總端點**(彙總散在 `DailyRun`/`CriteriaProfile`,未開 API)。
- **已就緒未接線**:`/reasoning/profile`(學出的權重/理由,Layer B/C 解釋層)。

### 目標(對應人類舉例)

- **類型分佈、地區佔比** → Pie/Donut(複用 `category-chart` 樣式)。
- **篩選前後總額變化** → 單一大數字 + before/after 對比長條。
- **工程類數值偏高** → 橫向長條(類別×金額)+ 用 `/reasoning/profile` 標權重來源(解釋「為何偏高」)。
- **趨勢** → 複用 `trend-chart`。

### 要碰的檔案

- 重寫:`src/pages/insights-page.tsx`。
- 新增:`src/components/insights/`(各圖元件,自寫 SVG;沿用 dashboard 圖樣)。
- 新增:`src/lib/insights.ts`(純函式:對 `filteredTenders` 做彙總——by 類別、by 地區、篩選前後總額)。
- (第二步)`src/lib/api.ts` 接 `fetchReasoningProfile`(`/reasoning/profile`)。
- 修改:`src/i18n/strings.ts`(zh/en 成對)。

### 步驟

- [ ] **第一步(前端彙總,無後端依賴)**:`insights.ts` 寫 by-類別 / by-地區 / 篩選前後總額 的純函式(可加單元測試)。
- [ ] 自寫 SVG 圖元件(Pie/Donut、橫向長條、before/after 對比、趨勢)。沿用既有 SVG 範本與 House style(直線、零抖動、16px 圓角)。
- [ ] 組 `insights-page`:篩選控制**複用 N4 補的 Switch/Select/Tabs**;隨篩選即時更新彙總。
- [ ] **第二步(解釋層)**:接 `/reasoning/profile`,在工程類長條旁標權重來源。
- [ ] i18n zh/en 成對。
- [ ] (選/排後端)若需精準歷史彙總(跨日、DailyRun),請後端開 `/stats` 端點——另排後端工,**不阻塞前端第一步**。
- [ ] 驗證:Preview MCP 改篩選→圖即時更新、總額前後差正確;`tsc`/build 通過;`impeccable` product 稽核。

### 驗收

- insights 頁不再空殼;至少 Pie/Donut + 橫向長條 + 篩選前後總額對比 + 趨勢;篩選即時連動;i18n 全;無 console 紅字。

### Layer B 注意

- `/reasoning/profile` 屬學出來的權重/理由(Layer B/C),畫面具名顯示貢獻者僅限白名單內;**對外發佈/匯出一律去識別化**,行為資料不進公開版控/Pages。

---

## 附錄:現有可複用資產速查

- **展示元件**:`src/components/tenders/detail-bits.tsx`(`Fact / MeterRow / SectionLabel / LabelTags / FeasibilityBadge / DaysLeftBanner / PlaceholderBlock / RatingStars`)。
- **既有 UI primitive**:Button、Input、Badge、Card、Dialog、Sheet、Avatar、Separator、TierBadge、FeasibilityMeter、MaximizableCard。**缺**:Switch/Toggle/Select/Tabs/RadioGroup/Slider(N4 要補)。
- **圖表範本**:`category-chart.tsx`(donut)、`trend-chart.tsx`(line+area)。
- **format/工具**:`src/lib/format.ts`(`formatDate / formatDateLong / formatBudget / daysLeft`)、`src/lib/utils.ts`(`cn`)。
- **API 層**:`src/lib/api.ts`(已接 fetchTenders/Detail/SimilarTenders/Reasoning、postSave/Accept/Note/Rate/Share、fetchSavedSearches/postSavedSearch);`src/lib/events.ts`(`trackEvent`→`/events`)。
- **後端端點(已實作)**:tenders、reasoning(含 `/reasoning/profile`)、search(`/search/semantic`、`/search/similar/{id}`)、behavior(save/accept/rate/note/share/events/saved-searches)、learning(`/evolution/run`、`/evolution/status`)、push(`/push/run`、`/push/digest`、`/push/read`)、assistant(`/assistant/chat`)。**無** `/stats`/`/analytics` 彙總端點。

---

## 附錄 B:操作流程與情境地圖(跨 N1–N4)

> 把「標案從出現到被處理」的完整動線攤平,讓接手 agent 知道每個面板/頁面**長在哪條流程上**、彼此怎麼接。三層下鑽模型 = **L1 清單列 → L2 就地展開 → L3 完整彈窗 → (L4) 完整詳情頁**。

### 主動線:發現 → 比對 → 決策 → 追蹤 → 學習

| 階段 | 使用者意圖                 | 入口畫面                                     | 關鍵互動                                 | 產生的行為(事件)                      |
| ---- | -------------------------- | -------------------------------------------- | ---------------------------------------- | ------------------------------------- |
| 發現 | 今天有什麼新標案           | Dashboard 今日焦點(`focus-list`)             | 排序(可行性/金額/截止)、掃讀精簡列       | `view`                                |
| 初比 | 哪幾筆值得細看             | 今日焦點 **L2 就地展開**(`focus-row`)        | 同卡手風琴展開、可多列並排比對           | `expand`                              |
| 細讀 | 這筆細節/可行性            | **L3 `TenderDrawer`**(快速預覽鈕)            | 事實格、可行性、關鍵字命中、(N1-b)相似案 | `open_detail`                         |
| 決策 | 接 / 不接 / 收藏 / 評分    | L3 彈窗右欄                                  | accept→建看板卡;skip;star;rate;轉傳      | `accept`/`skip`/`save`/`rate`/`share` |
| 深讀 | 看招標全文                 | **L4 `/tenders/:id`** 或原文連結             | 完整詳情頁;外開 PCC 原文                 | `click_link`                          |
| 追蹤 | 接了的案子進度             | **看板 `/kanban`**(N2)                       | 拖拉換欄、加具名註記、轉傳同事           | `add_note`/`forward`/`move_card`      |
| 設定 | 我要被怎麼推播/問助手      | **設定群 `/push` `/assistant` `/rules`**(N4) | 開關/門檻/digest/聊天                    | `push_config`/`assistant_chat`        |
| 回看 | 篩選成效/類型分佈/為何偏好 | **洞察 `/insights`**(N3)                     | 圖表+篩選連動+權重來源解釋               | `insights_filter`                     |

### 次要動線 / 旁支情境

- **`/tenders` 全列表**:與今日焦點**不同**——點列**直接開 L3 彈窗**(無 L2 就地展開),供「我要翻全部、不只今天」的情境。N1 已驗證正常。
- **排除案(excluded)**:命中硬排除規則的標案在列表/彈窗以 `opacity-60` + 排除原因 banner 呈現(`isExcluded`/`excludeReasonOf`),仍可開啟細讀但視覺降權。
- **空狀態**:列表空 → `emptyTitle`/`emptyHint`;看板欄空、註記空、相似案空、洞察無資料,各需對應空狀態文案(見附錄 C 缺口表)。
- **規則回饋迴路**:在 `/rules`(N4)改聚焦/避免/硬排除關鍵字 → 直接影響 `filteredTenders` 與 excluded 判定 → 反映回今日焦點與洞察。這是「越用越聰明」的前端可見入口。

### 情境邊界(避免越權實作)

- 速配 swipe(`/swipe`)/收藏頁:**本輪不接行為**,動線地圖標示其存在但不串接 Layer C。
- Layer B 行為(註記/轉傳/評分/可見性):本輪一律**前端 state + `trackEvent`**,不入向量。

---

## 附錄 C:元件清單與規格(現有 + 待補,依工作包)

> 「越完整越好」:逐一列出每個面板/頁面要用到的元件、現況(有/缺)、規格要點。**缺**的即為實作清單。

### C-1 已具備、可直接複用(勿重造)

| 元件                                                                                                            | 路徑                                 | 用途                                   |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------- |
| Button / Input / Badge / Card                                                                                   | `components/ui/*`                    | 基礎                                   |
| Dialog / Sheet                                                                                                  | `components/ui/{dialog,sheet}.tsx`   | L3 彈窗殼、側欄(自寫,Esc/鎖捲動已內建) |
| Avatar / Separator / TierBadge / FeasibilityMeter                                                               | `components/ui/*`                    | 頭像、分隔、級別徽、可行性條           |
| MaximizableCard                                                                                                 | `components/ui/*`                    | Dashboard 區塊外殼(今日焦點用)         |
| Fact / MeterRow / SectionLabel / LabelTags / FeasibilityBadge / DaysLeftBanner / PlaceholderBlock / RatingStars | `components/tenders/detail-bits.tsx` | 詳情/彈窗展示積木                      |
| FocusList / FocusRow / FocusSortBar / FocusDeadline                                                             | `components/tenders/focus-*.tsx`     | 今日焦點(N1 已完成)                    |
| category-chart(donut) / trend-chart(line+area)                                                                  | `components/dashboard/*`             | N3 圖表抄樣板                          |

### C-2 N1-b 需補(彈窗內容)

| 元件/接線          | 規格                                                                                                | 阻塞                                             |
| ------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 相似案區塊         | 在 `tender-drawer` 內 lazy `fetchSimilarTenders`,`Fact`+`TierBadge`+score 列出;AbortController 取消 | 無(可立即做)                                     |
| 交付地點/資格/附件 | 接 `fetchTenderDetail` 對應欄位                                                                     | **後端需先補欄位**;在那前維持 `PlaceholderBlock` |

### C-3 N2 看板需補

| 元件                                    | 路徑                             | 規格要點                                                                      |
| --------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| `KanbanNote` 型別 + `KanbanCard.notes?` | `types/domain.ts`                | author(具名)/createdAt/body                                                   |
| store 方法                              | `app-data.tsx`                   | `addCardNote`/`removeCardNote`/`forwardCard`;localStorage 持久化;`trackEvent` |
| 註記計數徽 + 入口                       | `kanban-card.tsx`(已 `M` 改動中) | 卡面 icon+count,16px 圓角、些微陰影                                           |
| `card-note-popover.tsx`                 | 新增(已存在 `??`)                | 檢視/新增/刪註記;**fixed/portal 避免被 `overflow:hidden` 裁切**               |
| `card-forward-menu.tsx`                 | 新增(已存在 `??`)                | 選白名單同事;自寫(無 Radix);鍵盤可及                                          |

### C-4 N4 設定群需補(**含基礎 primitive,N3 共用**)

| 元件                    | 路徑                             | 規格要點                                                                                              |
| ----------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Switch / Toggle**     | `components/ui/switch.tsx`(缺)   | 自寫,`role="switch"`、`aria-checked`、鍵盤 Space/Enter                                                |
| **Select**              | `components/ui/select.tsx`(缺)   | 自寫,鍵盤上下/Enter/Esc、`aria-expanded`、fixed/portal                                                |
| **Tabs**                | `components/ui/tabs.tsx`(缺)     | 自寫,`role="tablist"`、方向鍵切換、`aria-selected`                                                    |
| (選)RadioGroup / Slider | `components/ui/*`(缺)            | 門檻/時段用;a11y 同上                                                                                 |
| push 設定面板           | `pages/push-page.tsx`(空殼)      | 頻率/時段/門檻/關鍵字/地區 + digest 預覽(`/push/digest`)+ 已讀(`/push/read`);版型抄 `rules-page` 三卡 |
| assistant 聊天          | `pages/assistant-page.tsx`(空殼) | 聊天接 `/assistant/chat` + 可看資料範圍/語氣/預設提問設定                                             |
| api 接線                | `lib/api.ts`(缺)                 | `fetchPushDigest`/`postPushRun`/`postPushRead`/`postAssistantChat`                                    |

### C-5 N3 洞察需補

| 元件                | 路徑                               | 規格要點                                             |
| ------------------- | ---------------------------------- | ---------------------------------------------------- |
| 彙總純函式          | `lib/insights.ts`(缺)              | by-類別 / by-地區 / 篩選前後總額;可單元測試          |
| Pie/Donut           | `components/insights/*`(缺)        | 抄 `category-chart` 樣式                             |
| 橫向長條(類別×金額) | 同上                               | 旁標 `/reasoning/profile` 權重來源                   |
| before/after 對比   | 同上                               | 單一大數字 + 對比長條                                |
| 趨勢                | 複用 `trend-chart`                 | —                                                    |
| 篩選控制            | **複用 C-4 的 Switch/Select/Tabs** | 即時連動彙總                                         |
| api 接線            | `lib/api.ts`                       | `fetchReasoningProfile`(`/reasoning/profile`,已就緒) |

---

## 附錄 D:開發順序、進度管理與驗證

### D-1 再次確認建置順序:N1 → N2 → N4 → N3 ✅

順序維持不變(與 §0「建議動工順序」一致),理由再申明:

1. **N1 先**:最小工作量、已大致完成(僅留 N1-b 內容缺口,非阻塞),先把互動模型釘死,作為 L1–L4 動線的地基。
2. **N2 次**:人類**點名優先**;無新後端依賴(前端 state + `trackEvent`),可獨立交付,先把「接了的案子怎麼追蹤」這條動線補上。
3. **N4 第三**:後端**已就緒**(push/assistant 端點),且會把缺的 **Switch/Select/Tabs primitive 一次補齊**。
4. **N3 最後**:最重;其篩選控制**直接複用 N4 補的 primitive**,避免重工;前端彙總可先行,解釋層(`/reasoning/profile`)第二步再上。

> **關鍵相依**:N4 → N3 的 primitive 複用是把 N4 排在 N3 前的唯一硬理由。若臨時要先做 N3,須把 Switch/Select/Tabs 前置補齊,等同把 N4 的隱藏前置工提前。

### D-2 進度管理

- **單一事實來源**:本檔每個工作包的 `- [ ]` checkbox 即進度;完成改 `- [x]` 並補「驗證結論」。
- **每包動工前**:取得人類同意(本專案規矩)→ 在 `codex/card-swipe`(或指定 `claude/<主題>`)分支開發,未經同意不推別分支、不開 PR。
- **每包完成**:`tsc`/build 綠 + Preview MCP 驗收 + `impeccable` product 稽核三者皆過,才算 done。
- **Layer B 包(N2/N3)**:PR 描述必含 ①同意基礎 ②共享範圍 ③對外隔離方式,缺一不可合併。
- **目前狀態**:N1 完成(N1-b 待排);**N2 完成**(2026-06-21 Preview MCP 驗收通過:轉傳指派生效、註記新增/刪除具名+計數;`tsc -p tsconfig.app.json` 綠;`impeccable` 稽核待補);**N4 進行中**(下一步:先補 Switch/Select/Tabs primitive);N3 未動工。

### D-3 驗證方案(每包共用清單)

1. `preview_console_logs`:無紅字、無 `TextKey` 缺對、無 import 錯誤。
2. **功能**:照該包「驗收」逐項以 `preview_click`/`preview_fill`/`preview_snapshot` 實機點過。
3. **i18n**:切英文一輪確認無漏字(繁中為預設、新增 key zh/en 成對)。
4. **a11y**(N2 popover / N4 primitive 必跑):鍵盤可達、`aria-*` 正確、popover 不被 `overflow:hidden` 裁切。
5. **視覺**:`preview_screenshot` 佐證;`preview_resize` 驗 RWD 與密度(今日焦點需較 `/tenders` 緊湊)。
6. **型別/建置**:`tsc` 與 build 通過。
7. **反 slop**:`impeccable`(**product 模式**)對新元件稽核打磨。
8. **連線限制**:雲端環境連不到後端/Ollama;凡接 `/push`、`/assistant`、`/reasoning/profile` 的接線,須在**能連線環境**做最終驗收(雲端只驗 UI 結構與降級行為)。

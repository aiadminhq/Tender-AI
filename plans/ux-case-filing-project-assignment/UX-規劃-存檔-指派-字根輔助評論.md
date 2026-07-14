---
title: "UX 規劃｜標案存檔 × 指派專案 × 字根拆解輔助評論"
type: design-spec
category: ux
tags: [tender-ai, ux, ui, layer-b, save, assign, project, keyword, jieba, annotation]
status: draft
created: 2026-06-26
author: claude
branch: claude/ux-case-filing-project-assignment-yck9rj
---

# UX 規劃｜標案存檔 × 指派專案 × 字根拆解輔助評論

> 一句話：**讓操作人員「順手存案 → 指派給人/專案 → 一邊寫評論一邊被 AI 引導」，
> 而且每一個動作都餵養 Layer B → Layer C 的學習迴圈，讓系統越用越懂惠強團隊。**

本文用既有 codebase 的真實元件與資料模型推導 UX，不另創名詞、沿用功能代號（SL1–SL6）。

---

## 0. 設計地基（先對齊邊界）

### 0.1 與資料三層的關係

| 動作 | 落在哪一層 | 既有支撐 |
| --- | --- | --- |
| 存檔 / 收藏 / 評分 / 狀態 | **Layer B** | `TenderUserState{saved, status, star}` |
| 評論（自由文字） | **Layer B** | `Annotation{note}` |
| 可行性評估（結構化） | **Layer B** | `Evaluation{feasible, criteria, rationale}` |
| 指派 / 專案 | **Layer B（新增）** | 需新增 `Project` / `ProjectTender`，沿用 `User` |
| 字根拆解、關鍵詞權重 | **Layer C** | `text_index.tokenize_cn`（jieba 離線）、`KeywordWeight{term,polarity,weight,support}` |
| 學習迴圈 | **Layer C** | `jobs/learn_keywords.py`、`/evolution/run` |

### 0.2 隱私鐵則（每個畫面都要兌現）

- 所有 Layer B 行為**只在白名單（@hqdesign.tw）合作範圍內共享**，且**依登入帳號具名**標示貢獻者。
- **對非合作範圍對象永不揭露**：不進公開版控、不上 GitHub Pages 對外視圖；對外匯出一律去識別化。
- UI 上要讓使用者**看得到「誰存了/誰評了/誰指派了」**（具名協作正是本專案核心目的），
  但**不得出現任何「公開到外網」的入口**。分享（`Share`）只記錄管道，不等於對外公開。

> 三項功能都碰 Layer B，PR 需寫明：①同意基礎 ②共享範圍（白名單）③對外隔離方式。

### 0.3 既有技術慣例（新功能必須沿用）

- **狀態**：React Context（`AppContext` 偏好 / `AppDataContext` 資料）+ `localStorage`（前綴 `tender:`）。
- **後端寫入**：fire-and-forget POST（離線優先，本地先生效、再回寫）。
- **樣式**：Tailwind 4 + CSS variables 主題 token；UI 元件在 `components/ui/*`。
- **i18n**：`i18n/strings.ts`，`t("key")`，繁中預設、可切英文，key 為 camelCase。
- **斷詞**：後端 jieba（離線 bundled dict，不連網），≥2 字、過濾標點。

---

## 1. 角色與情境（Jobs-to-be-Done）

| 角色 | 想完成的事 | 痛點（現況） |
| --- | --- | --- |
| **承辦操作員** | 看到好標案能「先收起來、之後處理」，並交給對的人 | 只有星號收藏，存了之後散落、找不回、不知道接下來該幹嘛 |
| **專案負責人** | 把一批標案歸成一個投標專案、指派負責人、追蹤進度 | 看板 assignee 是唯讀，無「指派」工作流、無專案分組 |
| **不熟 AI 的同事** | 寫評論時知道「該寫什麼、為什麼這案可行」 | 對著空白輸入框，不知從何下手，評論品質參差 |
| **AI / 學習迴圈** | 從具名行為學出關鍵詞權重與決策向量 | 自由文字評論難結構化，學習訊號弱 |

**核心洞察**：把「存檔→指派→評論」串成一條連續動線，並在評論這一步用「字根拆解」把
*寫評論* 從「面對空白」變成「點選引導」，同時把點選結果變成高品質的學習訊號。

---

## 2. 三條主流程（資訊架構與動線）

```
                 ┌─────────────────── 標案清單 / 詳情 / Drawer ───────────────────┐
                 │                                                                 │
   發現好案 ──▶  ① 存檔 (Save)  ──▶  ② 指派專案 (Assign)  ──▶  ③ 評論+評估 (Annotate)
                 │   收藏/分類          歸入專案 + 指人          字根小助手引導         │
                 │   TenderUserState    Project/ProjectTender    Annotation/Evaluation │
                 └──────────────────────────────┬──────────────────────────────────┘
                                                 │  事件埋點 + 斷詞
                                                 ▼
                                       Layer C：KeywordWeight / DecisionVector
                                                 │
                                                 ▼
                                       SL6 學習迴圈（/evolution/run）
                                                 │
                                                 ▼
                              下次的 SL2 可行性分數 / SL3 推理 / SL1 助理 更準
```

**動線設計原則**：每一步都「可獨立完成、也可一氣呵成」。存檔後用**輕量提示**引導下一步
（「要不要指派？」），但**不強制**——避免打斷快速瀏覽節奏。

---

## 3. 功能 A：標案存檔（Case Filing）

### 3.1 現況盤點

- 既有：`tender-row.tsx` 星號收藏（`starred` Set）、`tender-drawer.tsx` 評分+可見性、
  `tender-detail-page.tsx` 收藏按鈕；後端 `POST /tenders/{id}/save`。
- 缺口：**存了之後沒有歸宿**——沒有「我的收藏」彙整頁、無分類/集合、無「下一步」引導。

### 3.2 存檔的三個層次（漸進，不一次到位）

1. **快速收藏（既有，保留）**：列表/詳情一鍵星號 → `TenderUserState.saved = true`。
2. **歸檔到集合（新增）**：存檔時可選一個或多個**集合（Collection）**，例如「本週待評」「南部工程」。
   - 集合是**個人輕量標籤**，預設私有於操作者，但在白名單內可被同事看到（具名）。
3. **升級為專案（功能 B）**：集合或多筆收藏可「轉成投標專案」並指派——銜接功能 B。

> 設計取捨：先做「快速收藏 + 集合」，**Collection 用前端 localStorage + 後端輕量表**即可，
> 不必一開始就上重型專案模型。專案（功能 B）才需要正式後端建模。

### 3.3 互動規格

**(a) 列表列（tender-row）的快速存檔**
- 既有星號保留；新增 hover/長按出現「⋯ 更多」→ 選單：`加入集合` / `指派` / `略過`。
- 已存檔的列：星號實心 + 顯示所屬集合的小圓點（最多 2 個，超過顯示 `+N`）。

**(b) 詳情頁存檔列（detail action bar）**
- 頂部 sticky 動作列：`收藏` `加入集合 ▾` `指派 ▾` `分享`。
- 點 `加入集合 ▾` 開 `Dialog`：多選既有集合 + 「＋ 新集合」即時建立（inline）。

**(c) 新頁面「我的收藏 / 集合」**
- 入口：sidebar 新增一項 `收藏`（`navSaved`）。
- 版面：左側集合清單（含「全部收藏」「未分類」），右側用既有 `TenderTable`（bare 模式）列出。
- 空狀態：插畫 + 「在標案清單按 ★ 即可收藏」引導。
- 每個集合卡顯示：名稱、筆數、貢獻者頭像（具名）、「轉成專案」按鈕。

### 3.4 微互動與回饋
- 收藏成功：星號補間動畫 + 底部 `Toast`「已收藏，加入集合？」（3 秒，可點）。
- 樂觀更新：本地立即生效，後端 fire-and-forget；失敗時 Toast 改為「未同步，稍後重試」。

---

## 4. 功能 B：指派專案（Project Assignment）

### 4.1 概念模型（新增）

```
User (白名單帳號)
  └─ Project（投標專案：一組為了同一個投標目標的標案）
        ├─ name / description / status(進行中/已投/得標/封存)
        ├─ owner_id（負責人）
        └─ ProjectTender（專案 ↔ 標案 多對多）
              ├─ tender_id
              ├─ assignee_id（這筆標案的承辦人，可不同於 owner）
              ├─ stage（評估中 / 備標 / 已投 / 放棄）← 對齊既有看板欄
              └─ assigned_at / assigned_by
```

> 與既有 `TenderUserState.status`（個人狀態）的分工：
> `status` 是「我個人對這案的處理狀態」；`ProjectTender.stage` 是「這案在某專案內的協作階段」。
> 看板（kanban）顯示的應是**專案內的 stage**，而非個人 status。

### 4.2 指派動線

**情境 1：單筆指派（從詳情/列表）**
1. 點 `指派 ▾` → 開 `指派面板（Sheet）`。
2. 面板內容：
   - **選專案**：下拉既有專案 +「＋ 建立新專案」。
   - **選承辦人（assignee）**：白名單成員 `Avatar` 多選/單選。
   - **選階段（stage）**：對齊看板欄（評估中/備標/已投/放棄）。
   - 可選：截止日提醒、備註。
3. 確認 → 寫 `ProjectTender` + 推 `Event{type:"assign"}` + 樂觀更新看板。

**情境 2：批次指派（從收藏/集合）**
- 在「我的收藏」勾選多筆 → 底部浮出批次工具列 → `加入專案並指派`。
- 一次把整個集合「轉成專案」：建立 Project + 把選取標案全部建 `ProjectTender`。

**情境 3：在看板上指派/改派（升級既有 kanban）**
- 既有 `kanban-card` 的 assignee 由唯讀改為**可點擊**：點頭像 → `指派 popover`（換人）。
- 拖卡換欄 = 改 `ProjectTender.stage`（既有拖拉行為延伸）。
- 看板頂部加「專案切換器」：每個專案一個看板視圖（或「全部專案」總覽）。

### 4.3 指派的協作可見性（Layer B 具名）
- 卡片/列上顯示 `assignee` 頭像 + tooltip「由 {assigned_by} 於 {time} 指派給 {assignee}」。
- 「我被指派的」過濾器：sidebar `收藏`/看板頂部提供「指派給我」快速篩選（`assignee == 登入者`）。
- 主動推播（SL5）串接：被指派時推一則通知（沿用既有 `push` 模組）。

### 4.4 UI 規格要點
- 指派面板用既有 `Sheet`（側滑，行動裝置友善），桌機可改 `Dialog`。
- 成員選擇器復用 `components/ui/avatar.tsx`（顏色基於 `User.color`）。
- 階段標籤復用看板欄色票；專案 status 用 `Badge` 變體。

---

## 5. 功能 C：字根拆解輔助評論（核心差異化）

> 這是把「寫評論」從**面對空白**變成**點選引導**的關鍵。
> 用後端 jieba 斷詞 + `KeywordWeight` 把標案名拆成「字根/關鍵詞」，標示哪些是
> 正向訊號、哪些是負向訊號，邊寫邊引導，並把使用者的選擇回灌成學習訊號。

### 5.1 為什麼要「拆字根」

- 不熟 AI 的同事面對空白輸入框會卡住。**把標案名拆成可點的詞**，等於給了「填空題」。
- 每個詞旁標示系統目前的看法（正/負/中性 + 信心），使用者「同意/不同意」一鍵表態——
  這比自由文字更容易產生**結構化、可學習**的訊號（直接餵 `Evaluation.criteria` 與 `KeywordWeight`）。
- 兼顧 SL3「可解釋」：使用者看得到「系統為什麼覺得這案可行」，再決定要不要採信。

### 5.2 「字根小助手」面板（Annotation Assistant）

放在詳情頁**評論區上方**（或 Drawer 內），結構由上而下：

```
┌─ 字根小助手 ──────────────────────────────────────────────┐
│  這個標案的關鍵詞（點一下表態，幫 AI 學得更準）            │
│                                                           │
│  標案名拆解：                                              │
│   [最有利標 ▲正向·高信心]  [道路工程 ▲正向]  [財物 ▼負向]   │
│   [○○縣政府 ·中性]        [統包 ?新詞]                     │
│        ↑ 點詞 → 浮出：👍同意正向 / 👎其實負向 / ⊘無關      │
│                                                           │
│  ── 引導提示（依可行/不可行給不同問句）──                  │
│   ◉ 我覺得這案：  ( 可行 )  ( 待議 )  ( 不可行 )            │
│                                                           │
│   選「可行」後出現：                                       │
│    ▸ 我們做得來嗎？（資源/工期）   [一句話…]                │
│    ▸ 為什麼這案適合我們？          [一句話…]                │
│    ▸ 最大風險是什麼？              [一句話…]                │
│                                                           │
│  ── 評論預覽（自動組好，可改）──                           │
│   「可行。看好點：道路工程、最有利標。風險：工期偏緊。」     │
│                                  [ 採用此評論 ]  [ 自己寫 ] │
└───────────────────────────────────────────────────────────┘
```

### 5.3 互動流程（逐步）

1. **進詳情即拆解**：載入詳情時呼叫 `POST /tenders/{id}/analyze`（或隨詳情一起回），
   後端用 jieba 斷 `name + org + category`，每個詞比對 `KeywordWeight` 得到 `polarity/weight/support`。
2. **詞 chip 渲染**：
   - 正向 = `--tier-high` 綠系、負向 = `--danger` 紅系、中性 = `ink-muted`、
     新詞（無權重）= 虛線框 `?` 並標「新詞」。
   - chip 上小三角/信心點表示 `support`（樣本數越多越實心）。
3. **一鍵表態**：點 chip → popover：`👍同意` / `👎相反` / `⊘無關`。
   - 表態即時寫入 `Evaluation.criteria`（結構化），並推 `Event{type:"keyword_vote"}`。
4. **可行性選擇**：`可行 / 待議 / 不可行` → 對齊 `Evaluation.feasible`，並切換引導問句組。
5. **引導問句（Guided Prompts）**：依 feasible 給 2–3 個一句話小題（資源/契合/風險），
   來源可由 `SavedSearch`/知識庫（SL4）動態挑選常見問句。
6. **自動組稿**：把選取的正向詞 + 風險詞 + 問句答案，組成一段**可編輯**的評論草稿。
7. **採用/自己寫**：`採用此評論` → `POST /tenders/{id}/note`（`Annotation`）；
   同時 `Evaluation`（feasible + criteria + rationale）落庫 → 進 `DecisionVector`（Layer C）。

### 5.4 與學習迴圈的閉環

- 使用者的「同意/相反」表態 = 對 `KeywordWeight` 的**人類監督訊號**，
  比純頻率統計（`learn_keywords` 的 TF 比較）更精準，可作為加權樣本。
- 評論落庫 → 嵌入 `decision_vectors`（rationale+criteria）→ 下次 SL2/SL3 更準。
- 在面板底部加一行**可解釋回饋**：「你的表態已記錄，會讓相似標案排序更準」（具名、合作範圍內）。

### 5.5 漸進增強（避免一次做太大）
- **MVP**：標案名斷詞 chip（唯讀色票）+ 可行性三選 + 引導問句 + 自動組稿。
- **v2**：chip 一鍵表態回寫 `KeywordWeight`；新詞建議加入規則（`keyword-editor` 串接）。
- **v3**：助手讀知識庫（SL4）動態生成問句、相似評論參考（DecisionVector 檢索）。

---

## 6. UI 規格（元件、狀態、響應式、無障礙）

### 6.1 復用既有元件（不重造輪子）

| 用途 | 復用元件 | 路徑 |
| --- | --- | --- |
| 動作按鈕 | `Button`（pill, variant） | `components/ui/button.tsx` |
| 集合/階段標籤 | `Badge` / `TierBadge` | `components/ui/badge.tsx` |
| 指派面板 | `Sheet`（行動）/ `Dialog`（桌機） | `components/ui/sheet.tsx` |
| 成員頭像 | `Avatar` | `components/ui/avatar.tsx` |
| 收藏彙整 | `TenderTable`（bare） | `components/tenders/tender-table.tsx` |
| 評論輸入 | `Input` + `Button` | `tender-detail-page.tsx` 既有 form |
| 字根 chip | 新 `KeywordChip`（沿用 keyword-editor chip 樣式） | 新增於 `components/tenders/` |

### 6.2 新增元件清單

- `components/tenders/save-menu.tsx`：收藏/加入集合下拉。
- `components/collections/collection-list.tsx` + `collection-card.tsx`：集合管理。
- `components/projects/assign-sheet.tsx`：指派面板。
- `components/projects/assignee-picker.tsx`：成員選擇器。
- `components/tenders/annotation-assistant.tsx`：字根小助手（核心）。
- `components/tenders/keyword-chip.tsx`：單一字根 chip（含 polarity/信心/表態 popover）。
- `pages/saved-page.tsx`：我的收藏頁。
- 看板：升級 `kanban-card.tsx` assignee 可點、`kanban-board.tsx` 加專案切換器。

### 6.3 設計 token 對應（沿用設計系統）

- 正向詞 chip：`--tier-high`（#22c55e）；負向：`--danger`（#ff5577）；中性：`--ink-muted`。
- 最優先/強調：`--priority`（violet）僅用於專案層級的「最優先」標記。
- 可行性條：唯一允許漸層 `--feasibility`（綠→藍）。
- 圓角沿用 `--radius` 系列；卡片 `surface-1`、面板 `surface-2`（lift 表層級）。
- CJK 字級收斂（最大 24–28px、資料 13–15px）、**無 serif**、CJK 不套負字距。

### 6.4 必備狀態（每個新畫面都要設計）

- **載入**：詳情三路獨立載入慣例延伸——字根分析失敗不擋評論輸入（降級為純文字框）。
- **空狀態**：收藏空、專案空、無關鍵詞（冷啟動無權重時 chip 全中性 + 提示「資料還在學」）。
- **錯誤/離線**：fire-and-forget 失敗 → Toast「未同步」，本地保留待重送。
- **冷啟動**：`KeywordWeight` 還沒學出來時，chip 不亂標正負，誠實顯示「中性·資料累積中」。

### 6.5 響應式（沿用 Tailwind 自訂斷點 sm640/md810/lg1200）

- 行動：指派與字根助手走 `Sheet`（底部上滑）；列表用 `tender-row` 卡片模式。
- 桌機：詳情頁右欄常駐字根助手；收藏頁左集合右表格雙欄。

### 6.6 無障礙
- chip 表態 popover 可鍵盤操作（Tab/Enter）、`aria-label` 標示 polarity。
- 色彩不單獨承載語意：正/負向同時用 ▲/▼ icon + 文字，不只靠紅綠（色盲友善）。
- 所有動作按鈕沿用既有 `aria-label` 慣例（見既有 comment form）。

---

## 7. 後端增修（Backend Deltas）

> 沿用既有 router 慣例（`/api/v1`、Pydantic `from_attributes`、`X-API-Key`、`user_id` 省略落預設）。

### 7.1 新增資料模型（`models/behavior.py` 或新 `models/project.py`）

```python
class Collection(Base):                 # 輕量個人集合
    id; user_id(FK users); name; created_at

class CollectionTender(Base):
    collection_id(FK); tender_id(FK); added_at        # 複合 PK

class Project(Base):                     # 投標專案
    id; owner_id(FK users); name; description; status; created_at; updated_at

class ProjectTender(Base):
    project_id(FK); tender_id(FK)                      # 複合 PK
    assignee_id(FK users, nullable); stage; assigned_by; assigned_at
```

### 7.2 新增 / 擴充端點

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| GET/POST | `/collections`、`/collections/{id}/tenders` | 集合 CRUD 與成員 |
| GET/POST | `/projects`、`/projects/{id}` | 專案 CRUD |
| POST | `/projects/{id}/tenders` | 指派標案到專案（含 assignee/stage） |
| PATCH | `/project-tenders/{pid}/{tid}` | 改派 / 改階段（看板拖拉） |
| POST | `/tenders/{id}/analyze` | **字根拆解**：回 `[{term, polarity, weight, support}]` |
| POST | `/tenders/{id}/evaluate` | 結構化評估（feasible + criteria + rationale）→ DecisionVector |
| POST | `/events` | 既有：新增 `type ∈ {assign, keyword_vote, evaluate}` |

`/tenders/{id}/analyze` 實作：`text_index.tokenize_cn(name+org+category)` →
對每個 term 查 `keyword_weights` → 帶回 polarity/weight/support（查無 = 中性/新詞）。
**離線可跑**（jieba bundled、查 DB），不依賴 Ollama 連線。

### 7.3 學習迴圈串接
- `keyword_vote` 事件作為**人類監督樣本**喂給 `jobs/learn_keywords.py`（加權）。
- `/tenders/{id}/evaluate` 落 `Evaluation` + 觸發 `decision_vectors` 嵌入（沿用 embedding 服務）。

---

## 8. i18n 新增 key（`i18n/strings.ts`，zh/en）

```ts
navSaved: { zh:"收藏", en:"Saved" }
addToCollection: { zh:"加入集合", en:"Add to collection" }
newCollection: { zh:"新集合", en:"New collection" }
assign: { zh:"指派", en:"Assign" }
assignTo: { zh:"指派給", en:"Assign to" }
project: { zh:"專案", en:"Project" }
newProject: { zh:"建立新專案", en:"New project" }
stage: { zh:"階段", en:"Stage" }
assignedToMe: { zh:"指派給我", en:"Assigned to me" }
keywordAssistant: { zh:"字根小助手", en:"Keyword Assistant" }
tapKeywordHint: { zh:"點一下表態，幫 AI 學得更準", en:"Tap to weigh in — helps the AI learn" }
feasYes/feasMaybe/feasNo: { zh:"可行/待議/不可行", en:"Feasible/Maybe/Not feasible" }
agreePositive/agreeNegative/notRelevant: { zh:"同意正向/其實負向/無關", en:... }
useThisNote: { zh:"採用此評論", en:"Use this note" }
writeMyself: { zh:"自己寫", en:"Write my own" }
newTerm: { zh:"新詞", en:"New term" }
learningInProgress: { zh:"資料累積中", en:"Still learning" }
```

---

## 9. 埋點與學習訊號（Events）

| Event type | 觸發 | payload | 學習用途 |
| --- | --- | --- | --- |
| `save` | 收藏 | `{collection_id?}` | 偏好訊號 |
| `assign` | 指派 | `{project_id, assignee_id, stage}` | 協作/負載分析 |
| `keyword_vote` | chip 表態 | `{term, vote: agree/disagree/irrelevant}` | **監督式關鍵詞權重** |
| `evaluate` | 提交評估 | `{feasible, criteria, terms[]}` | DecisionVector / SL2 |
| `open_detail`/`dwell` | 既有 | — | 興趣強度 |

---

## 10. 分階段落地（Rollout）

| 階段 | 範圍 | 對應 |
| --- | --- | --- |
| **P-1 存檔基礎** | 快速收藏彙整頁 + 集合（前端 localStorage + 後端輕表） | 功能 A MVP |
| **P-2 指派專案** | Project/ProjectTender 模型 + 指派面板 + 看板可點 assignee | 功能 B |
| **P-3 字根助手 MVP** | `/analyze` 端點 + chip（唯讀色票）+ 可行性三選 + 自動組稿 | 功能 C v1 |
| **P-4 學習閉環** | chip 一鍵表態回寫 + evaluate→DecisionVector + 學習加權 | 功能 C v2、SL6 |
| **P-5 智慧引導** | 知識庫（SL4）動態問句 + 相似評論參考 | 功能 C v3、SL1/SL4 |

---

## 11. 開放問題（需 christian 拍板）

1. **集合 vs 專案的界線**：集合是否一律「個人輕量」、專案才「團隊正式」？還是合併成一個概念？
   （本文預設分開：集合輕、專案重。）
2. **指派的權限**：誰能指派誰？是否任何白名單成員都能互相指派，或僅 owner 可指派？
3. **看板的視角**：看板顯示「專案內 stage」還是「個人 status」？（本文建議：看板＝專案 stage。）
4. **字根表態的權重**：人類「同意/相反」相對 TF 統計的權重比例？是否需要多人投票才改權重（避免單人偏誤）？
5. **冷啟動策略**：`KeywordWeight` 尚淺時，字根助手要不要先靠 `category` 硬規則（工程=正向）撐場？

---

## 附錄：詳情頁線框（整合三功能）

```
┌─ 標案詳情 ───────────────────────────────────────── [收藏★] [加入集合▾] [指派▾] [分享] ┐
│  最有利標 ○○縣道路改善工程   工程 · 截止 7/12 · 預算 3,200萬                            │
│  可行性 ▓▓▓▓▓▓▓░░ 72   分級🟢高   來源 PCC                                            │
├───────────────────────────────────┬───────────────────────────────────────────────┤
│  事實 / 相似標案 / SL3 推理        │  字根小助手                                       │
│  ...                               │   關鍵詞：[最有利標▲][道路工程▲][財物▼][○○縣·]   │
│                                    │   我覺得：(可行) (待議) (不可行)                  │
│                                    │   ▸ 做得來嗎？ [____]                            │
│                                    │   ▸ 為何適合？ [____]                            │
│                                    │   評論預覽：「可行。看好：道路工程、最有利標…」    │
│                                    │             [採用此評論] [自己寫]                 │
│  ── 註記（具名）──                 ├───────────────────────────────────────────────┤
│  Aaron · 2小時前：工期偏緊但可接   │  指派：負責人 (Aaron) · 階段 [備標▾] · 專案 縣道 │
└───────────────────────────────────┴───────────────────────────────────────────────┘
```

---

最後更新：2026-06-26

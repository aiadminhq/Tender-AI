# Stitch 設計工作流（Tender AI 版）

> 目的：用「文案／文字描述」當輸入，透過 Google Stitch 取得**功能頁面設計與靈感**，
> 並能（選擇性）落地回 React/shadcn 程式碼。本文把已安裝的 14 個 stitch skill 編排成一條可重複的流程。
>
> 對象：Tender AI 前端（Vite 8 + React 19 + TS + Tailwind v4 + shadcn）。
> 最高原則：**本專案 House style／`DESIGN.md`／i18n 規範優先於任何 skill 的預設品味**（見 §7）。

---

## 0. 前置：把 Stitch MCP 接上（必做，否則整條 workflow 跑不動）

這些 skill 本身只是「指揮手冊」，真正生成靠 **Stitch MCP server** 的工具
（`list_projects`／`create_project`／`generate_screen_from_text`／`edit_screens`／`generate_variants`…）。
目前 session 看不到這些工具＝MCP 沒對本專案生效。

**檢查**

```bash
claude mcp list            # 看 stitch / google-stitch 是否 connected
# 或在對話內輸入 /mcp 查看連線狀態
```

**兩種認證（擇一）**

| 模式                          | server                           | 認證來源                                                          | 適用               |
| ----------------------------- | -------------------------------- | ----------------------------------------------------------------- | ------------------ |
| API Key（建議，本專案已採用） | `@google/stitch-mcp --api-key …` | `STITCH_API_KEY`（已寫入專案 `.env`）                             | 不會過期、最省事   |
| OAuth                         | `stitch-mcp-auto`                | `gcloud auth application-default login` ＋ `GOOGLE_CLOUD_PROJECT` | 已有 gcloud 環境者 |

**接到本專案的做法（API Key 模式）**——在 `~/.claude.json` 的**本專案** `mcpServers` 加一筆
（`~/.claude.json` 是本機檔、不進版控，可放金鑰；若改用版控的 `.mcp.json`，**金鑰只能用 `${STITCH_API_KEY}` 引用、嚴禁明文**）：

```jsonc
// ~/.claude.json → projects["…/tender-bot/Tender AI"].mcpServers
"stitch": {
  "type": "stdio",
  "command": "npx",
  "args": ["@google/stitch-mcp", "--api-key", "<從 .env 取，勿明文進版控>", "--scope", "user"]
}
```

> 改完 `~/.claude.json` 後**重啟 Claude Code session** 才會載入新工具。
> 重啟後再 `/mcp` 確認 `stitch` 為 connected、且工具清單出現 `generate_screen_from_text` 等。

⚠️ **金鑰衛生**：稍早除錯時那把 Stitch key 曾外洩於輸出，建議到 Stitch 後台**輪替**一把新的，再更新 `.env` 與 `~/.claude.json`。

---

## 1. 一次性設定：建立 `.stitch/DESIGN.md`（on-brand 護欄）

Stitch 用 `DESIGN.md` 當「視覺單一真實來源」。本專案**已有** 544 行 `DESIGN.md`，
所以這步是「轉譯既有設計語言成 Stitch 語意格式」，不是另立新風格。

```
你：把本專案根目錄的 DESIGN.md 轉成 Stitch 用的 .stitch/DESIGN.md，
    保留 Tender AI 既有 tokens（Noto Sans TC／Inter、16px 圓角、僅些微陰影、
    暖色極簡），用 taste-design 的語意格式輸出，但不要覆蓋我的字體與圓角規範。
```

- 主用 skill：**`taste-design`** 或 **`design-md`**（兩者都產 `DESIGN.md`）。
- 產物：`.stitch/DESIGN.md`（後續每次生成都會引用其中的設計系統區塊）。
- 之後若要把這套主題套進 Stitch 專案：**`manage-design-system`** → `manage_design_systems` 上傳並套用。

> 衝突排除：`taste-design` 預設「禁用 Inter／禁 16px 以外圓角／要 asymmetric」等，
> 與本專案 House style 牴觸處**一律以 Tender AI 規範為準**（見 §7）。

---

## 2. 主迴圈：文字／文案 → 頁面設計與靈感

這是你最想要的那條：**丟一段描述或文案，拿回一個功能頁面設計**。

```
（你的粗略想法）
   │
   ├─ 2a. enhance-prompt   ── 把模糊想法 → 結構化、Stitch 最佳化 prompt
   │                          （補平台/頁型/分區/UI 術語；注入 .stitch/DESIGN.md）
   │
   ├─ 2b. generate-design  ── generate_screen_from_text 生成畫面
   │      （模式：Text → New Screen）
   │
   ├─ 2c. 下載產物         ── HTML + 截圖 存到 .stitch/designs/<slug>.{html,png}
   │
   └─ 2d. review / 微調    ── 看 outputComponents 的「文字說明＋建議」，
                              不滿意走 edit_screens 局部修，不要整頁重生
```

**每步對應**

| 步  | skill             | MCP 工具                                                       | 輸入 → 產物                                     |
| --- | ----------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| 2a  | `enhance-prompt`  | （純文字，免 MCP）                                             | 粗想法 → `next-prompt.md` 或可貼上的強化 prompt |
| 2b  | `generate-design` | `list_projects`／`create_project`／`generate_screen_from_text` | 強化 prompt → Stitch 畫面                       |
| 2c  | `generate-design` | （`curl` 下載 outputComponents URL）                           | → `.stitch/designs/<slug>.html` + `.png`        |
| 2d  | `generate-design` | `edit_screens`                                                 | 「把 X 區的 Y 改成 Z」→ 更新畫面                |

**寫 prompt 的鐵則（來自 generate-design）**

- 只描述**版面、內容、結構**；**不要**寫 hex 色碼／字體／圓角（那些交給 `.stitch/DESIGN.md`，重複會打架）。
- 用專業 UI 術語：navigation bar / hero section / card grid / data table / sidebar…
- 用分區編號 template：

```markdown
[這頁的目的與使用者意圖]

**PLATFORM:** Web, Desktop-first

**PAGE STRUCTURE:**

1. **Header:** …
2. **Primary Content:** …
3. **Side Panel / Filters:** …
4. **Footer:** …
```

---

## 3. 探索變體：一次看多個方向找靈感

已有一個畫面後，要「同主題不同版型／密度」的靈感：

```
你：用這個 dashboard 畫面生 3 個變體，聚焦 LAYOUT 與 TEXT_CONTENT，創意幅度 EXPLORE。
```

- skill：`generate-design`（Generate Variants flow）→ `generate_variants`
- 旋鈕：`variantCount`(1–5)、`creativeRange`(`REFINE`/`EXPLORE`/`REIMAGINE`)、
  `aspects`(`LAYOUT`/`COLOR_SCHEME`/`IMAGES`/`TEXT_FONT`/`TEXT_CONTENT`)
- 用途：純啟發時開 `REIMAGINE`；要可用稿時用 `REFINE`/`EXPLORE`。

---

## 4. 反向：從「現有東西」汲取靈感

不只從零生成，也能把既有素材丟進 Stitch 再長出變化：

| 你有的東西             | skill                                              | 流程                                                            |
| ---------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| 一張截圖／競品圖／手繪 | `upload-to-stitch` → `generate-design`(Image flow) | 上傳成 screen → `edit_screens` 重構成正規元件                   |
| 本專案現有頁面程式碼   | `code-to-design`                                   | 抽 HTML → 套設計系統 → 上傳成 Stitch 專案，回看 Stitch 怎麼重組 |
| 跑起來的本機頁面       | `extract-static-html`                              | 把 `http://localhost:5173/...` 凍成自含 HTML 再上傳             |
| 想沉澱風格規格         | `extract-design-md`                                | 掃 `/src` → 產 `.stitch/DESIGN.md`                              |

> 例：`把 tenders-page 跑起來，extract-static-html 凍存後上傳 Stitch，請它重排成更好讀的列表＋篩選側欄。`

---

## 5. （選配）把設計落地回程式碼

拿到滿意的 Stitch 畫面後，可轉成本專案技術棧。**僅供起手稿，最終須過 House style 與 `impeccable` 稽核**。

| 目標       | skill              | 備註                                              |
| ---------- | ------------------ | ------------------------------------------------- |
| React 元件 | `react-components` | 走 AST 驗證、對齊 design tokens                   |
| shadcn/ui  | `shadcn-ui`        | **本專案首選**（已用 shadcn）；元件發掘/安裝/客製 |
| 走查影片   | `remotion`         | 把多頁專案做成導覽影片                            |

> 產出的 className/字體/色票要改寫成本專案 token（§7）；i18n 文案 zh/en 成對補上。

---

## 6. （進階）多頁自走：stitch-loop

要一次長出多頁、且自動接力時用。靠 `.stitch/` 下的 baton 檔接力：

```
.stitch/
├── metadata.json    # Stitch 專案/畫面 ID（要持久化）
├── DESIGN.md        # §1 產的設計系統
├── SITE.md          # 站點願景 + sitemap + roadmap
├── next-prompt.md   # baton：下一頁的任務（含 DESIGN 區塊）
└── designs/         # Stitch 產出暫存 *.html / *.png
```

- 每輪：讀 `next-prompt.md` → 生成 → 整合 → **更新 `next-prompt.md`（不更新＝迴圈斷掉）**。
- 視覺驗證：本機 `chrome-devtools` MCP 已就緒，可開 dev server 截圖比對 Stitch 稿。
- Tender AI 用法：把 roadmap 的待建頁面排進 `SITE.md` §5，讓 loop 逐頁產靈感稿。

---

## 7. 安全與邊界（不可違反）

- **House style 優先**：skill 的預設品味（如 taste-design 禁 Inter／要 asymmetric／2.5rem 圓角）
  與本專案規範衝突時，**以 Tender AI 為準**——繁中 `Noto Sans TC`、英文 `Inter`/`SF Pro`、
  等寬 `JetBrains Mono`；統一 **16px 圓角**；僅 `0 1px 2px rgba(0,0,0,.06)` 些微陰影；暖色極簡。
- **i18n**：Stitch 多半生英文稿——產出僅供版面靈感，**正式文案 zh/en 成對、繁中為預設**。
- **不捏造數據**（與 taste-design 同調，也是本專案紅線）：標案數字、可行度、統計一律用真實資料或 `[佔位]`，不得生成假指標。
- **Layer B 紅線**：餵給 Stitch 的描述/截圖**不得含**同事行為、評分、收藏等 Layer B 資料；
  只用 Layer A 公開標案欄位或假資料。對外揭露一律去識別化。
- **金鑰**：只進 `.env`（gitignored）；版控檔（`.mcp.json` 等）只能 `${STITCH_API_KEY}` 引用，禁明文。
- **分支**：在 `claude/<主題>` 分支作業，未經同意不 push/PR。

---

## 8. Tender AI 具體起手範例（可直接套 §2）

> 皆只寫「結構/內容」，視覺交給 `.stitch/DESIGN.md`。

**A. 標案總覽 Dashboard（`dashboard-page`）**

```markdown
給政府標案承辦看的每日總覽，重點是「今天值得看哪幾筆」與「學習進度」。
**PLATFORM:** Web, Desktop-first
**PAGE STRUCTURE:**

1. Header: 產品名 + 全域搜尋 + 帳號
2. 今日推播區: 高潛力標案卡片列（標題/機關/截止日/可行度徽章），最多 8 筆
3. 概況區: 待評估數、本週新進、學習樣本數（用 [佔位] 不要捏造）
4. 快速入口: 進「滑卡篩選」「看板」「洞察」的入口
```

**B. 標案詳情（`tender-detail-page`）**

```markdown
單一標案的判讀頁，協助使用者三分判斷（可行/不可行/重點關注）。
**PLATFORM:** Web, Desktop-first
**PAGE STRUCTURE:**

1. Header: 返回 + 標案標題 + 機關 + 截止倒數
2. 主內容: 招標摘要、預算、類別、關鍵條件清單
3. 右側決策面板: 三分判斷按鈕（✓/✗/⭐）+ 筆記輸入 + 「為什麼推薦」理由
4. 相似案區: 相似標案橫向卡片列
```

**C. 滑卡快篩（`swipe-page`，行動優先）**

```markdown
像交友 App 那樣快速篩標案的手勢頁。
**PLATFORM:** Mobile, Mobile-first
**PAGE STRUCTURE:**

1. 頂部: 進度（第幾/共幾）+ 篩選條件 chips
2. 卡片堆疊: 當前標案卡（標題/機關/預算/截止/可行度）
3. 動作列: 左滑略過、右滑收藏、上滑重點關注；底部三顆對應按鈕
```

**D. 洞察／學習成果（`insights-page`）**

```markdown
呈現系統「越用越聰明」的學習成果與團隊共享貢獻（具名）。
**PLATFORM:** Web, Desktop-first
**PAGE STRUCTURE:**

1. Header: 標題 + 時間區間切換
2. 正向關鍵字區: 已學到的承標判準關鍵字（權重高→低）
3. 貢獻者區: 白名單同事的具名貢獻摘要（僅 Layer A/去識別化）
4. 趨勢區: 命中率/評估量走勢（無真資料則 [佔位]）
```

---

## 9. 一頁速查（TL;DR）

```
0. 修 MCP 連線（/mcp 確認 stitch connected）→ 重啟 session
1. taste-design/design-md：DESIGN.md → .stitch/DESIGN.md（沿用 House style）
2. enhance-prompt → generate-design(Text) → 下載 → edit_screens 微調   ← 主迴圈
3. generate_variants 找方向（REIMAGINE 純啟發／REFINE 要可用稿）
4. upload-to-stitch / code-to-design / extract-* 從既有素材反向長靈感
5. shadcn-ui / react-components 落地（過 House style + impeccable 稽核）
6. stitch-loop 多頁自走（chrome-devtools 視覺驗證）
紅線：House style 優先、i18n 成對、不捏數據、Layer B 不外流、金鑰只進 .env
```

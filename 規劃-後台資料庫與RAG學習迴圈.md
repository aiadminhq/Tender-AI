---
title: "tender-bot-backend-rag-learning-plan-260617"
type: research
category: development
tags: [tender-bot, database, d1, rag, vectorize, learning-loop, feasibility, nextjs]
status: draft
created: 2026-06-17
author: claude-cowork
---

# tender-bot｜後台資料庫 + RAG 知識庫 + 行為學習迴圈 規劃

> 目標：把 `aiadminhq/tender-reports`（每日標案靜態報表）的內容轉為 (1) **結構化後台資料庫**、(2) **AI RAG 知識庫**，並透過**前台操作捕捉 David 的使用行為**（儲存／轉發／評價／搜尋提示詞／關鍵字判斷／可行性評估標準），形成一個**會學習 David 判斷力**的迴圈，逐步提升篩選、排序與可行性建議的精準度。
> 銜接：本文件的「重點／避免關鍵字」與「可行性評估標準」直接餵入 `design-handoff-claude-design.md` §5 的 filter bar 與排序設計。

---

## 0. 來源資料盤點（已 clone 並分析）

`tender-reports` repo（已下載至專案資料夾 `tender-reports/`）含 32 份每日報表（2026-05-15 ~ 06-17）+ `index.html` + README。兩種資料形態：

- **每日彙總**（`index.html` 的 `records[]`）：`date, total, high, mid, low, urgent, priority, budget(萬), summary, filename, priority_items[]`。
- **逐案資料**（每份 `reports/tender-YYYYMMDD.html` 的表格列，每日約 22 筆）：潛力分級、標的分類（工程／財物／勞務）、標案名稱、採購機關、預算（萬）、截止日（民國）、剩餘天數、招標方式、PCC 連結（`pk`）。

> 關鍵落差：**逐案明細目前只存在於 HTML，未進任何資料庫**；彙總層有 summary 但無逐案結構。因此後台 DB 需要 (a) 回填歷史 32 份報表的逐案資料、(b) 之後由 scraper 直接寫入逐案列。

---

## 1. 三層資料模型（Cloudflare D1 + Vectorize）

分三層，職責清楚、隱私邊界明確：

- **Layer A — 標案 Corpus**（公開可重生，等同現行報表資料）
- **Layer B — 行為／回饋**（同事的使用訊號，**白名單(@hqdesign.tw)合作範圍內共享＋依登入帳號具名；絕不發佈到公開 repo、對外不揭露**）
- **Layer C — 知識／RAG**（向量索引 + 學習出的權重與摘要）

### 1.1 Layer A：標案 Corpus（D1）

```sql
CREATE TABLE sources (
  id        INTEGER PRIMARY KEY,
  name      TEXT,              -- 'PCC' | 'TMU'
  base_url  TEXT
);

CREATE TABLE tenders (
  id            INTEGER PRIMARY KEY,
  source_id     INTEGER REFERENCES sources(id),
  case_pk       TEXT,          -- PCC 的 pk（去重鍵）
  name          TEXT,
  org           TEXT,          -- 採購機關
  category      TEXT,          -- 工程 | 財物 | 勞務
  budget_wan    INTEGER,       -- 預算（萬）
  deadline_roc  TEXT,          -- 115/06/25
  deadline_iso  TEXT,          -- 2026-06-25
  tender_method TEXT,          -- 公開招標…
  city          TEXT,          -- 台北 | 新北
  link          TEXT,
  first_seen    TEXT,          -- 首次出現日期
  last_seen     TEXT,
  UNIQUE(source_id, case_pk)
);

CREATE TABLE daily_runs (
  run_date     TEXT,
  source_id    INTEGER,
  total INTEGER, high INTEGER, mid INTEGER, low INTEGER,
  urgent INTEGER, priority INTEGER, budget_sum_wan INTEGER,
  summary      TEXT,
  report_file  TEXT,
  PRIMARY KEY(run_date, source_id)
);

CREATE TABLE daily_tender (   -- 某案在某日報表出現（同案可跨日重現）
  run_date  TEXT,
  tender_id INTEGER REFERENCES tenders(id),
  tier      TEXT,             -- 當日分級（快照）
  days_left INTEGER,          -- 當日剩餘天數（快照）
  PRIMARY KEY(run_date, tender_id)
);
```

### 1.2 Layer B：行為／回饋（D1，白名單合作範圍內共享、對外私有）

捕捉「David 怎麼用」——這是學習的燃料。分**外顯訊號**（明確表態）與**內隱訊號**（操作軌跡）。

```sql
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, role TEXT);

-- 內隱：原始操作軌跡（telemetry）
CREATE TABLE events (
  id        INTEGER PRIMARY KEY,
  user_id   INTEGER,
  ts        TEXT,
  type      TEXT,        -- view | open_detail | click_link | dwell | apply_filter | search | sort
  tender_id INTEGER,     -- 可空
  payload   TEXT         -- JSON：filter 條件、search query、停留秒數…
);

-- 外顯：對個案的狀態（儲存／轉發／進度）
CREATE TABLE tender_user_state (
  user_id   INTEGER,
  tender_id INTEGER,
  saved     INTEGER DEFAULT 0,   -- ⭐ 儲存／收藏
  status    TEXT,                -- 觀望 | 備標中 | 已投 | 得標 | 放棄
  star      INTEGER,             -- 1–5 主觀評分
  updated_at TEXT,
  PRIMARY KEY(user_id, tender_id)
);

-- 外顯：自由註記（「為什麼可行」）
CREATE TABLE annotations (
  id INTEGER PRIMARY KEY, user_id INTEGER, tender_id INTEGER,
  note TEXT, created_at TEXT
);

-- 外顯：結構化可行性評估（rubric）— 學習可行性標準的核心
CREATE TABLE evaluations (
  id INTEGER PRIMARY KEY, user_id INTEGER, tender_id INTEGER,
  feasible  TEXT,         -- 可行 | 不可行 | 待議
  criteria  TEXT,         -- JSON：{budget_fit, deadline_fit, category_fit,
                          --        agency_relation, scope_match, competition, margin}
  rationale TEXT,         -- 一句理由
  created_at TEXT
);

-- 外顯：轉發／分享
CREATE TABLE shares (
  id INTEGER PRIMARY KEY, user_id INTEGER, tender_id INTEGER,
  channel TEXT, ts TEXT   -- email | line | export…
);

-- 外顯：搜尋提示詞與篩選預設（重複使用＝強偏好訊號）
CREATE TABLE saved_searches (
  id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT,
  query_text TEXT,        -- 自然語言提示詞
  filter_json TEXT,       -- 對應 filter bar 條件
  use_count INTEGER DEFAULT 0, created_at TEXT
);
```

### 1.3 Layer C：知識／RAG（Vectorize + D1）

```sql
-- 學習出的關鍵字權重（餵 admin 的「重點／避免關鍵字」建議）
CREATE TABLE keyword_weights (
  term      TEXT PRIMARY KEY,
  polarity  TEXT,    -- positive（重點）| negative（避免）
  weight    REAL,    -- 由行為推導
  support   INTEGER, -- 樣本數（信心）
  updated_at TEXT
);

-- 招標文件摘要（RAG「文件自動摘要」）
CREATE TABLE doc_summaries (
  tender_id INTEGER PRIMARY KEY,
  summary TEXT, key_terms TEXT, source_doc_url TEXT, created_at TEXT
);
```

向量索引（Cloudflare Vectorize，embeddings 用 Workers AI）：

- `tender_vectors`：每筆標案（name + org + category）→ 向量；metadata：tender_id, category, city, budget_band。供**語意搜尋**。
- `decision_vectors`：David 的每筆 evaluation（個案 + criteria + rationale）→ 向量；metadata：tender_id, feasible。供**「相似可行案」與可行性助手**。

> 隱私鐵則（合作範圍模型）：Layer B、`decision_vectors`、annotations 在**白名單(@hqdesign.tw)合作範圍內共享、依登入帳號具名**，存於自架 D1 + Vectorize（對外私有），**永不寫進公開 `tender-reports` repo**；對外揭露的向量 metadata 須去識別化、不放人名／email。

---

## 2. 前台操作 → 行為訊號對照（David 的使用學習）

每個前台動作都對應一筆可學習訊號：

| David 在前台做的事 | 捕捉到哪 | 訊號意義 |
|---|---|---|
| 開啟某案詳情、停留閱讀 | `events`(open_detail/dwell) | 內隱興趣 |
| 點 PCC 原始連結 | `events`(click_link) | 高度興趣 |
| ⭐ 儲存／收藏 | `tender_user_state.saved` | 外顯正向 |
| 轉發／分享給同事 | `shares` | 強外顯正向 |
| 標進度（備標中/已投/得標/放棄） | `tender_user_state.status` | 結果標籤（最終 ground truth） |
| 1–5 星評分 | `tender_user_state.star` | 主觀價值 |
| 評可行/不可行 + 勾選標準 | `evaluations` | **可行性 ground truth + 標準** |
| 寫「為什麼可行」註記 | `annotations` | 理由語料（進 RAG） |
| 用某段提示詞搜尋 | `events`(search) / `saved_searches` | 偏好查詢意圖 |
| 套用某組篩選並停留挑案 | `events`(apply_filter) | 偏好條件組合 |
| 反覆使用同一搜尋/篩選 | `saved_searches.use_count` | 穩定偏好 |

---

## 3. 可行性學習迴圈（如何「越用越懂 David」）

```
前台操作 ──► Layer B 訊號 ──► 推導 ──► 模型/權重 ──► 回饋前台（排序+建議）──► 新操作…
```

1. **關鍵字學習**：比較「被儲存／評可行／轉發」的標案 vs「開了沒動作／評不可行」的標案，做詞頻對比，產出 `keyword_weights`——正向詞→**重點關鍵字**候選，負向詞→**避免關鍵字**候選。於 admin 以「建議新增」呈現，David 一鍵採用（人在迴圈中，避免自動誤學）。
2. **可行性標準學習**：`evaluations.criteria` 累積後，找出哪些標準組合最常對應「可行」（如 預算 500–800 萬 + 室內裝修 + 台北 + 無競標關係人）→ 形成可行性特徵權重。
3. **可行性分數 + 理由**：新標案進來時，結合 (a) 關鍵字權重、(b) 標準特徵、(c) 與 `decision_vectors` 中「可行」案的相似度，算出**可行性分數**並附理由：「與你 06-08 評為可行的『某活動中心室內裝修』相似：室內裝修＋台北＋預算 600 萬」。
4. **學習式排序**：每日清單除了現行「依截止日」，新增「**依 David 可行性分數**」排序選項——把 David 的判斷力沉澱成預設視圖。
5. **冷啟動**：模型未成熟前，分數僅作「建議標記」不取代人判斷；外顯訊號（評價/儲存）權重 > 內隱（點擊/停留）。

---

## 4. RAG 知識庫的使用情境

1. **語意搜尋**（公開標案）：自然語言 → embed → `tender_vectors` → 結果。例：「找台北、室內裝修、600 萬上下、還有兩週以上的案」。
2. **相似可行案**：開新案 → 比對 `decision_vectors`(feasible=可行) → 「你過去覺得類似的這幾件可行，理由是…」。
3. **可行性助手**：擷取相似標案 + David 的 evaluations/criteria → 用 **Anthropic** 生成可行性建議與理由（embeddings 用 Workers AI，摘要/推理用 Anthropic，符合既定混合方案）。
4. **招標文件自動摘要**：抓/上傳招標文件 → Anthropic 摘要（資格、保證金、工期、評選方式）→ 存 `doc_summaries` 並 embed。
5. **關鍵字建議**：彙整 `keyword_weights` → admin 的重點/避免關鍵字推薦。

---

## 5. 回填與資料流

- **歷史回填（一次性）**：寫 parser 解析 `tender-reports/reports/*.html`（32 份）→ 寫入 `tenders` / `daily_runs` / `daily_tender`。逐案欄位皆可由表格擷取（已驗證可解析）。
- **日常（going forward）**：`tender_daily.py` 在產 HTML 的同時，**新增**經 D1 HTTP API 寫入逐案列（沿用「不重寫 scraper 核心」鐵則，僅加輸出 sink）；靜態 HTML 續存為降級備援。
- **embeddings 批次**：新案寫入後觸發 Workers AI 批次 embed → `tender_vectors`；David 每筆 evaluation 即時 embed → `decision_vectors`。

---

## 6. 分階段實作順序

| 階段 | 內容 | 產出 |
|---|---|---|
| **P1 資料層 + 回填** | 建 Layer A schema（D1）；parser 回填 32 份歷史報表；scraper 新增 D1 寫入 | 可查詢的標案 corpus |
| **P2 前台行為捕捉** | 建 Layer B；前台埋點（儲存/轉發/評價/評分/註記/搜尋/篩選）；admin 標記管理 | David 訊號開始累積 |
| **P3 RAG 索引 + 語意搜尋** | Vectorize `tender_vectors`；語意搜尋頁；文件摘要 pipeline | 語意搜尋 + 摘要可用 |
| **P4 學習迴圈 v1** | 由行為推導 `keyword_weights` → admin 重點/避免關鍵字建議 | 篩選器自我進化 |
| **P5 可行性助手 + 學習式排序** | `decision_vectors` + Anthropic 可行性建議；可行性分數排序 | 沉澱 David 判斷力 |

> 訊號累積需要時間：P2 越早上線越好（即使前端其他頁仍在設計），讓 David 的操作從第一天就被記錄，P4/P5 的學習才有燃料。

---

## 7. 與既有規劃／約束的銜接

- 餵入 `design-handoff-claude-design.md` §5：重點/避免關鍵字兩區、可行性排序、評估 rubric UI。
- 沿用鎖定技術棧：Next.js + Cloudflare（D1 / Vectorize / Workers AI）、Anthropic 做摘要與推理。
- 沿用 `CLAUDE.md` 鐵則：scraper 核心不重寫、金鑰放 GitHub Secrets、報表發佈 idempotent。
- 隱私：行為/評價/註記在白名單合作範圍內共享、對外私有，永不進公開 repo。

---

## 8. 待確認（下一輪）

1. 可行性評估 rubric 的標準欄位由 David 拍板（預算/工期/分類/機關關係/競爭/利潤…哪些必填）。
2. 「轉發」channel 範圍（email / LINE / 匯出檔）。
3. 學習式排序要不要設為預設視圖，或僅作為可選排序。
4. 歷史回填要追溯到哪一天（目前 repo 最早 2026-05-15）。

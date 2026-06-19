# Tender AI — 前端整合 Hand-off

> 對象:`tender-ai-frontend/`(React 19 + Vite + TS)接手者。
> 目的:把目前畫面用的 **mock 資料**(`src/data/*.ts`)換成 **後端真實 API**。
> 後端:`tender-ai-backend/`(FastAPI),進度 **P1+P2+P3 完成**(查詢 API + 行為寫入 API + 語意檢索);語意搜尋 `/search/semantic`、相似案 `/search/similar/{id}` 已上線(見 §5.5)。可行性分數等(P5)尚未開放(見 §8)。
>
> 本文是「**前端接後端**」指南,與 `claude-code-handoff-backend.md`(那份是「**怎麼蓋後端**」的規格)不同,別搞混。

---

## 0. TL;DR(最短路徑)

1. 後端跑起來:`cd tender-ai-backend && uv run uvicorn app.main:app --reload`(預設 `http://localhost:8000`)。
2. 前端設定 API base:在 `tender-ai-frontend/.env.local` 放 `VITE_API_BASE=http://localhost:8000/api/v1`。
3. CORS 已開(後端預設允許 `http://localhost:5173`、`127.0.0.1:5173`);換埠要同步改後端 `CORS_ORIGINS`。
4. Auth 預設**關閉**(後端 `APP_API_KEY` 空字串時放行),開發期不用帶任何標頭。
5. 照 §3 的 adapter 把 `TenderListItem` → 前端 `Tender`;照 §4 把 `FilterState` → query 參數;照 §6 把使用者動作 → 寫入端點。
6. **重點轉換**:`budget_wan × 10000 = TWD`、`category` 中→英、`id` 轉字串、`tier` 的 `priority` 併入 `high`。
7. **後端還沒有的欄位**:`feasibility / supplierCoverage / score / tags / excluded / nextStep`——前端目前靠規則自算或先留白,見 §3.3。

---

## 1. 連線基礎

| 項目           | 值                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL(開發) | `http://localhost:8000`                                                                                                                   |
| API 前綴       | `/api/v1`(所有業務端點都在此之下)                                                                                                         |
| 健康檢查       | `GET /health` → `{"status":"ok"}`(不在 `/api/v1` 下)                                                                                      |
| 內容型別       | 一律 `application/json`;日期序列化為 ISO 字串(`date`→`"2026-06-20"`,`datetime`→`"2026-06-20T08:47:00"`)                                   |
| 認證           | `X-API-Key` 標頭。**後端 `APP_API_KEY` 為空時不檢查**(開發/CI 預設關閉)。正式環境設了金鑰後,每個請求都要帶 `X-API-Key: <金鑰>`,否則 401。 |
| CORS           | 後端已掛 `CORSMiddleware`,允許來源由 `CORS_ORIGINS`(逗號分隔)控制,預設本機 Vite 埠。                                                      |

### 前端環境變數(建議)

```bash
# tender-ai-frontend/.env.local
VITE_API_BASE=http://localhost:8000/api/v1
# 正式環境若後端開了金鑰才需要：
# VITE_API_KEY=
```

> Vite 只暴露 `VITE_` 前綴的變數到 `import.meta.env`。

---

## 2. 端點總覽

| 方法 | 路徑                   | 用途                           | 回應型別                 |
| ---- | ---------------------- | ------------------------------ | ------------------------ |
| GET  | `/tenders`             | 標案列表(篩選/排序/分頁)       | `TenderListResponse`     |
| GET  | `/tenders/{id}`        | 標案詳情(含歷史快照、個人狀態) | `TenderDetail`           |
| POST | `/tenders/{id}/save`   | 收藏/取消收藏                  | `StateOut`               |
| POST | `/tenders/{id}/accept` | 設定處理狀態(備標中…)          | `StateOut`               |
| POST | `/tenders/{id}/rate`   | 評分(1–5 星,品質評價)          | `StateOut`               |
| POST | `/tenders/{id}/note`   | 新增註記                       | `AnnotationOut`          |
| POST | `/tenders/{id}/share`  | 記錄分享                       | `ShareOut`               |
| POST | `/events`              | 行為遙測(view/搜尋/篩選…)      | `EventOut`               |
| GET  | `/saved-searches`      | 列出已存搜尋(`?user_id=`)      | `SavedSearchOut[]`       |
| POST | `/saved-searches`      | 建立已存搜尋                   | `SavedSearchOut`         |
| GET  | `/search/semantic`     | 語意搜尋(自然語言→相近標案)    | `SemanticSearchResponse` |
| GET  | `/search/similar/{id}` | 相似標案(以某案找最像的其他案) | `SemanticHit[]`          |

> 路徑前都要加 `/api/v1`。例:`GET http://localhost:8000/api/v1/tenders?tier=high`。

---

## 3. 標案資料對映(最重要)

### 3.1 後端 `TenderListItem` 欄位

`GET /tenders` 的 `items[]` 與 `GET /tenders/{id}` 共用這組欄位:

```ts
interface TenderListItem {
  id: number; // 後端整數主鍵
  source: string; // "PCC" | "TMU"
  case_pk: string; // 採購網案號
  name: string; // 標案名稱
  org: string | null; // 招標機關
  category: string | null; // "工程" | "財物" | "勞務"
  budget_wan: number | null; // 預算（單位：萬元！）
  deadline_roc: string | null; // 民國日期字串，如 "115/06/20"
  deadline_iso: string | null; // ISO 日期，如 "2026-06-20"
  tender_method: string | null; // 招標方式
  city: string | null;
  link: string | null; // 採購網原始連結
  tier: string | null; // "priority" | "high" | "mid" | "low" | null（取自最新快照）
  days_left: number | null; // 距截止天數（取自最新快照，非「今天」即時算）
  first_seen: string | null; // 首次出現在日報的日期（ISO）
  last_seen: string | null; // 最近一次出現（ISO）
}
```

### 3.2 對映到前端 `Tender`(`src/types/domain.ts`)

| 前端 `Tender` 欄位                       | 來源           | 轉換                                                             |
| ---------------------------------------- | -------------- | ---------------------------------------------------------------- |
| `id: string`                             | `id`           | `String(id)`                                                     |
| `title`                                  | `name`         | 直給                                                             |
| `org`                                    | `org`          | `org ?? ""`                                                      |
| `source: SourceKey`                      | `source`       | 直給(後端僅 `PCC`/`TMU`,是前端 `SourceKey` 的子集)               |
| `budget`(TWD)                            | `budget_wan`   | **`(budget_wan ?? 0) * 10000`**                                  |
| `deadline`(ISO)                          | `deadline_iso` | `deadline_iso ?? ""`                                             |
| `publishedAt`(ISO)                       | `first_seen`   | 後端**無**公告日;以 `first_seen`(首次入報日)近似                 |
| `tier: "high"\|"mid"\|"low"`             | `tier`         | `priority`→`high`;`null`→`low`(見下)                             |
| `category: "works"\|"goods"\|"services"` | `category`     | 中→英:`工程→works`、`財物→goods`、`勞務→services`;`null`→`works` |

> **`tier` 注意**:後端有第四級 `priority`(最高優先),前端 `Tier` 只有三級。最省事的做法是 `priority` 併入 `high`(adapter 已這樣做)。若要忠實呈現「優先」徽章,建議把 `Tier` 擴成 `"priority"|"high"|"mid"|"low"` 並在 `tier-badge.tsx`/`tierLabel` 補一級。

### 3.3 後端「目前沒有」的前端欄位(缺口與對策)

這些是 mock 有、API 尚未提供的欄位。**不要**期待後端回傳,改用下列策略:

| 前端欄位                     | 狀態                    | 對策                                                                                                                                        |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `score: number`              | 後端無                  | 前端原本用 score 排序/上色。改用後端排序(`sort=feas/tier/days/budget`,見 §4);若 UI 仍需數值,可由 `tier` 暫時推導(`high=10/mid=20/low=35`)。 |
| `feasibility: number`(0–100) | **P5 才有**(可行性助手) | 暫時隱藏「可行性」量表,或用 `tier` 給佔位值。等 P5 開 `/tenders/{id}` 帶可行性分數。                                                        |
| `supplierCoverage: number`   | 無規劃                  | 暫時隱藏該指標,或標「—」。                                                                                                                  |
| `tags: string[]`             | 後端無                  | **前端自算**:用現有 `focusKeywords`(`src/store/app-data.tsx`)比對 `name`/`org`。adapter 提供 `deriveTags()`。                               |
| `excluded` / `excludeReason` | 後端無                  | 維持**前端規則判定**(`app-data.tsx` 的 `isExcluded`/`excludeReasonOf` 已實作);或改用後端 `avoid` 參數做伺服器端過濾(見 §4)。                |
| `nextStep`                   | 後端無                  | 可用最新一筆 `note`(annotation)替代,或先留空。                                                                                              |
| `owner`                      | 無對應                  | 後端有「個人狀態」(收藏/狀態/星)但無「指派負責人」概念;看板 `assignee` 維持前端狀態。                                                       |

> 資料原則（合作範圍模型）:行為/評價/註記在白名單(@hqdesign.tw)合作範圍內共享、依登入帳號具名,只進自架 DB、不會出現在公開 repo 或日報,對外不揭露。前端照常呼叫寫入 API 即可。詳見 `CLAUDE.md`。

### 3.4 Adapter 範例(建議新增 `src/lib/api-adapters.ts`)

```ts
import type { Tender, Tier, Category, SourceKey } from "@/types/domain";

interface ApiTender {
  id: number;
  source: string;
  case_pk: string;
  name: string;
  org: string | null;
  category: string | null;
  budget_wan: number | null;
  deadline_roc: string | null;
  deadline_iso: string | null;
  tender_method: string | null;
  city: string | null;
  link: string | null;
  tier: string | null;
  days_left: number | null;
  first_seen: string | null;
  last_seen: string | null;
}

const TIER_MAP: Record<string, Tier> = {
  priority: "high",
  high: "high",
  mid: "mid",
  low: "low",
};
const CAT_MAP: Record<string, Category> = {
  工程: "works",
  財物: "goods",
  勞務: "services",
};
const TIER_SCORE: Record<Tier, number> = { high: 10, mid: 20, low: 35 };

/** 用重點關鍵字從標題/機關推導 tags（後端不提供 tags） */
export function deriveTags(
  name: string,
  org: string,
  focus: string[],
): string[] {
  const hay = `${name} ${org}`;
  return focus.filter((k) => k && hay.includes(k));
}

export function toTender(a: ApiTender, focus: string[] = []): Tender {
  const tier: Tier = (a.tier && TIER_MAP[a.tier]) || "low";
  return {
    id: String(a.id),
    title: a.name,
    org: a.org ?? "",
    source: (a.source as SourceKey) ?? "PCC",
    budget: (a.budget_wan ?? 0) * 10_000, // 萬元 → TWD
    deadline: a.deadline_iso ?? "",
    publishedAt: a.first_seen ?? "", // 近似：首次入報日
    tier,
    score: TIER_SCORE[tier], // 佔位（後端無 score）
    feasibility: 0, // 佔位（P5 才有）
    supplierCoverage: 0, // 佔位（無規劃）
    category: (a.category && CAT_MAP[a.category]) || "works",
    tags: deriveTags(a.name, a.org ?? "", focus),
    // excluded / excludeReason / nextStep / owner：維持前端規則/狀態
  };
}
```

---

## 4. `GET /tenders` — 列表(篩選 / 排序 / 分頁)

### 4.1 Query 參數

| 參數                        | 型別                             | 語義                                             |
| --------------------------- | -------------------------------- | ------------------------------------------------ |
| `tier`                      | string[](可重複)                 | 篩 tier(對最新快照),如 `?tier=high&tier=mid`     |
| `cat`                       | string[]                         | 篩類別(`工程`/`財物`/`勞務`)                     |
| `city`                      | string[]                         | 篩縣市                                           |
| `src`                       | string[]                         | 篩來源(`PCC`/`TMU`)                              |
| `deadline`                  | int                              | `days_left <= 此值`(快照無 days 的會被排除)      |
| `budget_min` / `budget_max` | int                              | 預算範圍(**單位:萬元**,與 `budget_wan` 同)       |
| `focus`                     | string[]                         | OR 命中:任一關鍵字出現在「名稱+機關+類別」即入選 |
| `avoid`                     | string[]                         | NOT 命中:含任一關鍵字者**排除**                  |
| `q`                         | string                           | 全文搜尋;以空白/逗號/頓號斷詞,**多詞 AND**       |
| `sort`                      | `feas`\|`days`\|`budget`\|`tier` | 排序鍵(預設 `feas`)                              |
| `page`                      | int ≥1                           | 第幾頁(預設 1)                                   |
| `page_size`                 | int 1–200                        | 每頁筆數(預設 50)                                |

**排序語義**(空值一律殿後):

- `feas`(預設):`tier_rank` 升冪 → `days_left` 升冪。`tier_rank`:priority=0、high=1、mid=2、low=3、其他=99。
- `days`:`days_left` 升冪(最急在前)。
- `budget`:`budget_wan` 降冪(最大在前)。
- `tier`:同 `tier_rank` 升冪。

### 4.2 前端 `FilterState` → query 參數

| `FilterState`        | 對應參數                         | 備註                                                                    |
| -------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `query`              | `q`                              | 直給                                                                    |
| `sources`            | `src`(重複)                      | 直給                                                                    |
| `tiers`              | `tier`(重複)                     | 前端只送 high/mid/low                                                   |
| `maxBudget`(TWD)     | `budget_max`                     | **`Math.floor(maxBudget / 10000)`**(TWD→萬元)                           |
| `focusOnly: true`    | `focus`=目前 `focusKeywords`     | 開啟時把重點關鍵字陣列帶上                                              |
| `hideExcluded: true` | `avoid`=目前 `hardExclude`(可選) | 或維持前端判定;兩者擇一即可                                             |
| `sort`               | `sort`                           | 映射:`score→feas`、`deadline→days`、`budget→budget`、`feasibility→feas` |

> 後端另有 `cat`/`city`/`deadline`/`budget_min` 等 mock 沒用到的篩選維度,可逐步在 filter-bar 補上。

### 4.3 回應 `TenderListResponse`

```ts
interface TenderListResponse {
  items: TenderListItem[];
  count: number; // 篩選後總筆數（分頁前）
  page: number;
  page_size: number;
}
```

> 前端目前是「一次載入全部再前端篩」。接 API 後建議改成「把 `filter`/`sort`/`page` 丟給後端,直接用回傳結果」,並用 `count` 算總頁數。

---

## 5. `GET /tenders/{id}` — 詳情

回傳 `TenderListItem` 全欄位,外加:

```ts
interface SnapshotItem {
  run_date: string;
  tier: string | null;
  days_left: number | null;
}
interface UserStateOut {
  saved: boolean;
  status: string | null;
  star: number | null;
}

interface TenderDetail extends TenderListItem {
  snapshots: SnapshotItem[]; // 歷史每日快照，依 run_date 由新到舊
  user_state: UserStateOut | null; // 帶 ?user_id= 才有；否則 null
}
```

- `?user_id=<int>`:帶入才回該使用者的收藏/狀態/星;省略則 `user_state` 為 `null`。
- `snapshots`:可拿來畫「分級隨時間變化」的趨勢(tender-drawer 可用)。
- 查無此 id → **404** `{"detail": "..."}`。

---

## 5.5 語意檢索 `/search/*`(P3,已上線)

以 pgvector 對標案的「名稱＋機關＋類別」嵌入向量(bge-m3,1024 維)做 cosine 近鄰查詢。兩支端點都回 `SemanticHit`——即 `TenderListItem` 全欄位再加兩個分數欄:

```ts
interface SemanticHit extends TenderListItem {
  distance: number; // cosine 距離,0 = 完全相同,越小越近
  score: number; // 1 - distance,clamp 至 [0,1],越大越相似(可直接當相似度)
}
```

### 5.5.1 `GET /search/semantic` — 語意搜尋

```
GET /search/semantic?q=醫院資訊系統建置&limit=20
```

| 參數    | 型別   | 說明                                  |
| ------- | ------ | ------------------------------------- |
| `q`     | string | **必填**,自然語言查詢字串(空字串→422) |
| `limit` | int    | 回傳上限,`1–100`,預設 `20`            |

回應 `SemanticSearchResponse`:

```ts
interface SemanticSearchResponse {
  items: SemanticHit[]; // 依 score 由高到低(distance 由小到大)
  count: number; // = items.length
  query: string; // 原樣回傳查詢字串
}
```

- 與 `GET /tenders` 不同:這裡是**語意相近**而非關鍵字 AND;適合語意式搜尋框、「找像這樣的案子」。
- 尚未被嵌入的標案不會出現在結果(以 INNER JOIN 過濾);實務上每日回填後全庫皆有向量。
- 分數僅反映文字語意相近度,**不等於可行性**;可行性分數要等 P5。

### 5.5.2 `GET /search/similar/{tender_id}` — 相似標案

```
GET /search/similar/123?limit=10
```

| 參數    | 型別 | 說明                       |
| ------- | ---- | -------------------------- |
| `limit` | int  | 回傳上限,`1–100`,預設 `10` |

- 回 `SemanticHit[]`,依 `score` 由高到低,**已排除自己**。
- 標的 id 不存在 → **404**;標的存在但尚未被嵌入 → 回 **`[]`**(非錯誤)。
- 適合詳情頁(tender-drawer)底部「相似標案」區塊。

> Adapter 提示:`SemanticHit` 是 `TenderListItem` 超集,可直接餵 §3.4 的 `adaptTender()`;額外的 `score` 可覆蓋 §3.3 用 `tier` 推導的佔位 score,讓「相似度」有真實數值可呈現。

---

## 6. Layer B 寫入 — 使用者動作

> 共通:body 都接受可選 `user_id`(int)。**省略 → 自動落到後端「預設使用者」**(單租戶開發最省事)。
> 注意:前端 `person.id` 是字串(如 `u-christian`),**不是**後端 int user id,**別**直接當 `user_id` 送。多人帳號要等後端先建 user 並回 int id。

### 前端動作 → 端點對照

| 前端動作(`app-data.tsx`) | 端點                              | body                                       | 說明                                                            |
| ------------------------ | --------------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| `toggleStar(id)`         | `POST /tenders/{id}/save`         | `{ "saved": true\|false }`                 | 前端「星號」=收藏布林。送目標狀態值。                           |
| `accept(id)`             | `POST /tenders/{id}/accept`       | `{ "status": "備標中" }`                   | 設處理狀態;看板卡片仍前端建立。                                 |
| `skip(id)`               | `POST /events` 或 `accept` `放棄` | `{ "type":"open_detail", "tender_id":id }` | 後端無專屬 skip;建議記 event 或設狀態 `放棄`,前端維持隱藏集合。 |
| `addComment(id, text)`   | `POST /tenders/{id}/note`         | `{ "note": text }`                         | 前端 `Comment` ↔ 後端 `Annotation`。                            |
| (新)品質評分             | `POST /tenders/{id}/rate`         | `{ "star": 1..5 }`                         | 與「收藏」不同:這是 1–5 星品質評價。                            |
| (新)分享                 | `POST /tenders/{id}/share`        | `{ "channel": "line" }`                    | 記錄分享渠道。                                                  |

### 列舉值(送錯回 422)

```
TenderStatus（accept.status）：觀望 | 備標中 | 已投 | 得標 | 放棄      （預設 備標中）
EventType   （events.type）  ：view | open_detail | click_link | dwell | apply_filter | search | sort
star（rate）：整數 1–5
Feasible    ：可行 | 不可行 | 待議   （評價用，目前尚未有對外端點）
```

### 行為遙測 `POST /events`(餵 P4 學習迴圈)

```ts
// 標案層級
POST /events { "type": "view", "tender_id": 123 }
// 非標案層級（tender_id 可省略）
POST /events { "type": "apply_filter", "payload": { "tier": ["high"] } }
```

> 建議在「開詳情、點原始連結、套用篩選、搜尋、改排序」時各送一筆 event。`payload` 是任意 JSON,會原樣存。這是 P4「行為→關鍵字權重」的資料來源,愈早開始累積愈好。

### 已存搜尋 `saved-searches`

```ts
GET  /saved-searches?user_id=1          // → SavedSearchOut[]（省略 user_id 落到預設使用者；尚無使用者時回 []）
POST /saved-searches {                   // → SavedSearchOut
  "name": "台北高優先",
  "query_text": "資訊系統",
  "filter_json": { "tier": ["high"], "city": ["台北市"] }
}
```

### 寫入回應型別

```ts
interface StateOut {
  user_id: number;
  tender_id: number;
  saved: boolean;
  status: string | null;
  star: number | null;
  updated_at: string;
}
interface AnnotationOut {
  id: number;
  user_id: number;
  tender_id: number;
  note: string;
  created_at: string;
}
interface ShareOut {
  id: number;
  user_id: number;
  tender_id: number;
  channel: string | null;
  ts: string;
}
interface EventOut {
  id: number;
  user_id: number;
  type: string;
  tender_id: number | null;
  payload: object | null;
  ts: string;
}
interface SavedSearchOut {
  id: number;
  user_id: number;
  name: string;
  query_text: string | null;
  filter_json: object | null;
  use_count: number;
  created_at: string;
}
```

---

## 7. 錯誤模型

| 狀態碼 | 何時                                                                                     | body                                                              |
| ------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `404`  | 查無標案 / 查無使用者                                                                    | `{ "detail": "<訊息>" }`                                          |
| `422`  | 參數/列舉/範圍/必填驗證失敗(壞 `sort`、`star` 超界、`page_size` 超界、缺 `name`/`note`…) | `{ "detail": [ { "loc": [...], "msg": "...", "type": "..." } ] }` |
| `401`  | 後端設了 `APP_API_KEY` 但請求未帶/帶錯 `X-API-Key`                                       | `{ "detail": "invalid or missing X-API-Key" }`                    |

前端統一處理建議:非 2xx 時讀 `detail`;若 `detail` 是陣列(422)取第一筆 `msg` 顯示。

---

## 8. 後端尚未開放(roadmap,別等)

| 能力                                         | 階段 | 影響的前端                         |
| -------------------------------------------- | ---- | ---------------------------------- |
| 行為 → 關鍵字權重(自動調 focus/avoid)        | P4   | 規則頁的「建議關鍵字」             |
| 可行性分數 + 理由(`feasibility`)、供應商覆蓋 | P5   | 可行性量表、`score` 排序的真實依據 |

> ✅ **P3 語意搜尋已上線**(原列於此,現移至 §5.5):`/search/semantic`、`/search/similar/{id}` 可直接接「相似標案」與語意式搜尋框。

在這些開放前,§3.3 的佔位/前端自算策略可讓畫面先跑起來,日後再替換成真資料。

---

## 9. 建議的接線層(可直接抄)

`src/lib/api.ts`:

```ts
const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000/api/v1";
const KEY = import.meta.env.VITE_API_KEY as string | undefined;

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(KEY ? { "X-API-Key": KEY } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = Array.isArray(body.detail)
        ? (body.detail[0]?.msg ?? msg)
        : (body.detail ?? msg);
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export interface ListParams {
  tier?: string[];
  cat?: string[];
  city?: string[];
  src?: string[];
  deadline?: number;
  budget_min?: number;
  budget_max?: number;
  focus?: string[];
  avoid?: string[];
  q?: string;
  sort?: "feas" | "days" | "budget" | "tier";
  page?: number;
  page_size?: number;
}

function qs(params: ListParams): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  listTenders: (p: ListParams = {}) =>
    http<{ items: any[]; count: number; page: number; page_size: number }>(
      `/tenders${qs(p)}`,
    ),
  getTender: (id: number | string, userId?: number) =>
    http<any>(`/tenders/${id}${userId != null ? `?user_id=${userId}` : ""}`),
  save: (id: number | string, saved: boolean) =>
    http(`/tenders/${id}/save`, {
      method: "POST",
      body: JSON.stringify({ saved }),
    }),
  accept: (id: number | string, status = "備標中") =>
    http(`/tenders/${id}/accept`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  rate: (id: number | string, star: number) =>
    http(`/tenders/${id}/rate`, {
      method: "POST",
      body: JSON.stringify({ star }),
    }),
  note: (id: number | string, note: string) =>
    http(`/tenders/${id}/note`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  share: (id: number | string, channel: string) =>
    http(`/tenders/${id}/share`, {
      method: "POST",
      body: JSON.stringify({ channel }),
    }),
  event: (type: string, tenderId?: number, payload?: object) =>
    http(`/events`, {
      method: "POST",
      body: JSON.stringify({ type, tender_id: tenderId, payload }),
    }),
  listSavedSearches: (userId?: number) =>
    http<any[]>(`/saved-searches${userId != null ? `?user_id=${userId}` : ""}`),
  createSavedSearch: (body: {
    name: string;
    query_text?: string;
    filter_json?: object;
  }) =>
    http<any>(`/saved-searches`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
```

### 漸進式接線順序(建議)

1. **讀**:把 `app-data.tsx` 的 `TENDERS` 來源換成 `api.listTenders()` + `toTender()`;先保留前端篩選,確認畫面正常。
2. **搬篩選到後端**:`FilterState` → `ListParams`(§4.2),用回傳的 `items`/`count`,移除前端重複過濾。
3. **詳情**:tender-drawer 改打 `api.getTender(id, userId)`,用 `snapshots` 畫趨勢。
4. **寫入**:`toggleStar/accept/addComment` 接 `api.save/accept/note`;成功後再更新本地狀態(樂觀更新可選)。
5. **遙測**:在開詳情/點連結/套篩選/搜尋/排序處補 `api.event(...)`。
6. **收尾**:刪掉 `src/data/*.ts` 的 mock(或保留作 Storybook/離線 fallback)。

---

## 10. 注意事項

- **預算單位**:後端一律「萬元」(`budget_wan`、`budget_min/max`),前端 `Tender.budget` 是 TWD,差 10000 倍,進出都要換算。
- **id 型別**:後端 int、前端 string;adapter 統一 `String(id)`,送回後端時數字字串可直接用。
- **日期**:`deadline`/`first_seen` 等是 ISO 日期字串,可直接餵 `formatDate`/`daysLeft`(`src/lib/format.ts`)。`days_left` 後端已算好(取自快照),與前端 `daysLeft(deadline)` 可能差 1~2 天(基準日不同),擇一使用、別混用。
- **隱私（合作範圍模型）**:行為/評價/註記在白名單合作範圍內共享、依登入帳號具名,只進自架 DB、不入公開 repo,對外不揭露;前端照常呼叫即可。
- **單租戶開發（暫行）**:目前尚未建登入,暫時所有寫入省略 `user_id`(落預設使用者)。**目標模型**:上線白名單登入(原則 @hqdesign.tw)後帶 `user_id` 並依登入帳號具名;屆時後端需提供「建立/查詢使用者」端點回 int id(目前尚未開放)。詳見 `CLAUDE.md`。

---

_對映關係以 `tender-ai-backend/app/schemas/`、`app/api/v1/`、`app/services/query.py` 為準;若後端 schema 有變,以程式碼為唯一真實來源。_

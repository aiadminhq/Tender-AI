# 08 ｜ 本地端／雲端後台串接 Lessons Learned

> 記錄 Tender AI 在本機、Vercel、Supabase 之間串接時實際踩過的問題與驗證邏輯。處理「畫面資料不完整、API 回 HTML／401、部署後讀到舊資料」時，先讀本檔。

最後更新：2026-07-15

## 1. 正確的部署拓撲

目前 production 是 Vercel 同源全棧，不是「Vercel 前端＋舊 Railway API」：

```text
GitHub aiadminhq/Tender-AI main
  ├─ tender-ai-frontend/      → Vite build → tender-ai-frontend/dist
  └─ api/index.py             → import tender-ai-backend/app/main.py

瀏覽器 → https://tender-ai-vert-six.vercel.app/api/v1/*
       → vercel.json rewrite /api/* → /api/index
       → FastAPI → Supabase Postgres pooler
```

關鍵設定：

- Vercel Project Root Directory 必須是 repo 根目錄，不是 `tender-ai-frontend`。
- `vercel.json` 的 build、output、`/api/*` rewrite 必須一起存在。
- Production 前端必須使用同源 `/api/v1`；不要讓舊 `VITE_API_BASE` 導回舊服務。
- `api/index.py` 是 Python function 入口；修改 FastAPI 路由後必須重新部署。

## 2. Supabase CLI 與 DATABASE_URL

- `supabase/config.toml` 的 `project_id` 必須是 project ref：`ajltwjkegmbzethwgbje`。
- project name（例如 `tender-ai`）不是 project ref。
- 先用 `supabase projects list` 確認 ref、組織與 region，再做 migration 或 link。
- `supabase link`／`supabase migration list` 需要資料庫密碼；CLI 已登入不代表已完成 database link。
- Vercel `DATABASE_URL` 必須使用 `postgresql+psycopg://` 格式與 Supabase pooler 帳號。
- 只有出現 `Tenant or user not found` 時，才比較 `aws-1-ap-southeast-1` 與 `aws-0-ap-southeast-1` host。

## 3. 環境變數同步規則

| 變數            | 用途                     | 規則                                                   |
| --------------- | ------------------------ | ------------------------------------------------------ |
| `DATABASE_URL`  | 後端 Supabase 連線       | production／preview／development 各 scope 都要明確存在 |
| `APP_API_KEY`   | FastAPI `X-API-Key` 驗證 | 必須與前端 build 使用的 `VITE_API_KEY` 相同            |
| `VITE_API_KEY`  | 前端發送 `X-API-Key`     | 改完必須重新 build/deploy                              |
| `AUTH_SECRET`   | 登入 token 簽章          | production 與 preview scope 都要有                     |
| `VITE_API_BASE` | 開發 API base            | production 由程式強制同源 `/api/v1`                    |

注意：Vercel env 是分 scope 的；不要把 token、DATABASE*URL、API key 印到終端、log、commit 或文件。修改 `VITE*\*` 後一定要重新部署，因為它們會編譯進 bundle。

## 4. 「只有 199 筆」的診斷順序

1. `GET /api/v1/health`：確認回 JSON，不是 SPA HTML。
2. 帶正確 `X-API-Key` 呼叫 `/api/v1/tenders?page_size=3`：確認 `count` 與 `items`。
3. 呼叫 `page_size=200`：確認後端上限與 `next_cursor`。
4. 檢查前端是否沿 `next_cursor` 逐頁載入到 `null`。
5. 檢查 Network 實際 host：production 應為同源 Vercel，不應是舊 Railway／localhost。
6. 最後才檢查 filter、mock fallback、快取與 UI 虛擬列表。

「只有 199 筆」是一個**有多重成因的症狀家族**，目前已記錄兩個不同根因，排查時兩者都要排除：

- **根因 A（2026-07-14，已解決）**：舊 Vercel Root Directory／舊 API 路徑與 runtime API key 不一致。資料庫實際可查到約 2266 筆，並非 Supabase 只有 199 筆。
- **根因 B（2026-07-15，已診斷、修復待實作）**：Supabase 串接其實正常（`health` 200、`/tenders` 401 需 key、UI 顯示 199 > mock 12 筆代表已吃到 live data）。真正問題在**前端資料載入策略**——初次載入只抓第一頁 cursor（約 199 筆）就當成全部，**忽略 API 回傳的 `count`**，也不沿 `next_cursor` 續抓；儀表板頁又沒有「載入更多」按鈕。詳見 §7。

> 診斷重點：先用 §4 的順序確認「Supabase／API 是否真的有問題」。若 health/tenders/count 都正常、只是 UI 少筆，多半是根因 B（前端載入策略），不是後端或 Supabase。

## 5. 每次部署後的最小 smoke test

```bash
curl -i https://tender-ai-vert-six.vercel.app/api/v1/health
curl -i -H "X-API-Key: $APP_API_KEY" \
  'https://tender-ai-vert-six.vercel.app/api/v1/tenders?page_size=3'
curl -i -H "X-API-Key: $APP_API_KEY" \
  -X POST 'https://tender-ai-vert-six.vercel.app/api/v1/auth/login' \
  -H 'Content-Type: application/json' \
  --data '{"email":"wrong@hqdesign.tw","password":"wrong"}'
curl -i https://tender-ai-vert-six.vercel.app/
```

驗收條件：health 是 `200 application/json`；tenders 是含 `count/items/next_cursor` 的 JSON；錯誤登入是 `401` 或 `403` JSON，不是 HTML／500；根路徑是 SPA `index.html`。

## 6. 禁止的修復方式

- 不要為了讓畫面出現資料而切回 mock data。
- 不要只調高前端 page size 來掩蓋 cursor 沒有續抓。
- 不要在未確認 API 回傳 DB 錯誤前更換 Supabase host。
- 不要刪除或重建所有 Vercel env；只 patch 指定 key 與指定 scope。
- 不要把 production 前端重新指向舊 Railway API。

## 7. 前端只載第一頁 cursor → 「199 筆＋今日焦點空白」（2026-07-15，修復待實作）

**症狀（同一張儀表板截圖）**

- ① 主頁「今日焦點」區塊一大塊空白。
- ② 側欄「標案清單 199／高潛力 199」、「標案類型分佈」甜甜圈總數 199 且 100% 工程、0% 財物、0% 勞務。

**根因：兩個症狀是同一條因果鏈，且都在前端，不在 Supabase／後端。**

1. `store/app-data.tsx` 初次載入的 effect 只呼叫 `fetchTenderPage(null, …)` 抓**第一頁**（約 199 筆），把它當成全部：`setTenders(page.tenders)` 後就停，只存 `nextCursorRef`，**沒有沿 `next_cursor` 續抓**，也**沒有使用 API 回傳的 `page.count`**（後端其實有回真實總數）。
2. `loadMore` 是手動（「載入更多」按鈕）觸發的，而**儀表板頁 `dashboard-page.tsx` 沒有這顆按鈕**（按鈕只在 `tender-table.tsx`）。所以進儀表板永遠只有第一頁。
3. 第一頁依 feasibility 排序 → 幾乎都是高分「工程」案、且多數截止日已過（今天 2026-07-15，資料偏舊）。於是：
   - 「高潛力 199＝199」「類型 100% 工程」＝只統計到這第一頁（甜甜圈的分類另受 `toCategory()` 由標名反推影響，約 79% `category` 為 NULL，屬 `backfill_category.py` 的另一議題）。
   - `dashboard-page.tsx` 的 `focus` 過濾「截止日 ≥ 今天」把整頁過期案濾光 → `FocusList` 收到空陣列 → `focus-list.tsx` 的 `sorted.map()` 什麼都不 render → **空白區塊**。

**佐證（已排除到 §4 第 4 步）**：`health` 200；`/tenders` 401（端點活著、需 key）；schema 有 `count`＋`next_cursor`；mock `data/tenders.ts` 只有 12 筆，UI 顯示 199 > 12 → 確定吃到 live data，非 mock fallback。

**修復計畫（尚未動 code，待 owner 拍板載入策略）**

- **P0**：帶 key 驗證 `curl -s -H "X-API-Key: $APP_API_KEY" '.../api/v1/tenders?page_size=3' | jq '.count'`，確認真實 `count` 與截止日分佈。
- **P1（核心）**：讓儀表板載入完整資料集。`lib/api.ts` 已有現成的 `fetchTenders()` 迴圈（沿 `next_cursor` 抓到 `null`），初次載入改用它即可（約 2266 筆／約 12 次請求，需配 loading skeleton）。**待決策**：進站自動抓全量 vs. 新增後端聚合 endpoint 分頁載入。
- **P2**：`dashboard-page.tsx` 的「今日焦點」加空集合 fallback——當「可投標」集合為空時，改顯示「即將截止／最高可行性」前 8 筆，避免整塊空白。
- **P3**：統計標籤（清單／高潛力筆數）改用後端 `count`，不要用「已載入頁數」當總數。

**紅線**：修復只碰前端載入策略與 focus fallback，**不動後端／DB**；並嚴守 §6（不切 mock、不靠調高 page size 掩蓋、不換 host、不重建 env、不指回 Railway）。

**相關檔**：`tender-ai-frontend/src/store/app-data.tsx`（初次載入 effect／`metrics`）、`tender-ai-frontend/src/pages/dashboard-page.tsx:32`（focus 過濾）、`tender-ai-frontend/src/components/tenders/focus-list.tsx`、`tender-ai-frontend/src/lib/api.ts`（`fetchTenders()` 迴圈、`PAGE_SIZE=200`）。進行中交接見 `docs/handoffs/2026-07-15-supabase-199-blank-dashboard.md`。

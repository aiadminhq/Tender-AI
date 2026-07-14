# 08 ｜ 本地端／雲端後台串接 Lessons Learned

> 記錄 Tender AI 在本機、Vercel、Supabase 之間串接時實際踩過的問題與驗證邏輯。處理「畫面資料不完整、API 回 HTML／401、部署後讀到舊資料」時，先讀本檔。

最後更新：2026-07-14

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

| 變數 | 用途 | 規則 |
| --- | --- | --- |
| `DATABASE_URL` | 後端 Supabase 連線 | production／preview／development 各 scope 都要明確存在 |
| `APP_API_KEY` | FastAPI `X-API-Key` 驗證 | 必須與前端 build 使用的 `VITE_API_KEY` 相同 |
| `VITE_API_KEY` | 前端發送 `X-API-Key` | 改完必須重新 build/deploy |
| `AUTH_SECRET` | 登入 token 簽章 | production 與 preview scope 都要有 |
| `VITE_API_BASE` | 開發 API base | production 由程式強制同源 `/api/v1` |

注意：Vercel env 是分 scope 的；不要把 token、DATABASE_URL、API key 印到終端、log、commit 或文件。修改 `VITE_*` 後一定要重新部署，因為它們會編譯進 bundle。

## 4. 「只有 199 筆」的診斷順序

1. `GET /api/v1/health`：確認回 JSON，不是 SPA HTML。
2. 帶正確 `X-API-Key` 呼叫 `/api/v1/tenders?page_size=3`：確認 `count` 與 `items`。
3. 呼叫 `page_size=200`：確認後端上限與 `next_cursor`。
4. 檢查前端是否沿 `next_cursor` 逐頁載入到 `null`。
5. 檢查 Network 實際 host：production 應為同源 Vercel，不應是舊 Railway／localhost。
6. 最後才檢查 filter、mock fallback、快取與 UI 虛擬列表。

本次根因是舊 Vercel Root Directory／舊 API 路徑與 runtime API key 不一致；資料庫實際可查到 2266 筆，並非 Supabase 只有 199 筆。

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

# 方案 B：CDP attach 詳情抓取

> 接管使用者「已開著、已登入／已手動過 CAPTCHA」的 Chrome（透過 remote-debugging-port
> 的 CDP），重用其 cookies/session 抓 PCC 詳情頁，與既有 enrich 流程相容。
>
> 程式：`app/jobs/scrape_detail_cdp.py`｜測試：`tests/test_scrape_detail_cdp.py`（離線）

---

## 1. 問題與動機

PCC 在**詳情端點**掛圖形驗證碼（撲克牌配對）反大量查詢。既有的方案 A——
`app/adapters/_pcc_http.py` 的自管 session（`requests` + `SkipSSLAdapter`）——一旦撞
CAPTCHA 只能由 enrich job 優雅中止整批（`is_captcha_page` → stage=`captcha` → deferred）。

**方案 B 的取捨**：不嘗試破解驗證碼，而是**借用使用者本機已經人工過關的瀏覽器 session**。
使用者在自己的 Chrome 裡手動過一次 CAPTCHA，後續的程式化抓取沿用該分頁的 cookies，
PCC 視為同一個已驗證使用者，不再每筆都跳驗證碼。

---

## 2. 設計

```
┌──────────────────┐   /json (httpx)         ┌────────────────────────┐
│ scrape_detail_cdp │ ──────────────────────▶ │ 使用者的 Chrome         │
│  CDPClient        │   ws Page.navigate       │ --remote-debugging-port │
│                   │   ws Runtime.evaluate    │ =9222（已過 CAPTCHA）   │
└──────────────────┘ ◀────── outerHTML ────── └────────────────────────┘
        │ build_fetch_result()
        ▼
   FetchResult（形狀 == PCCAdapter.fetch_detail）
        │
        ▼ 既有純函式（重用、未改）
   parse_pcc_detail / is_captcha_page / extract_source_revision_key
        │
        ▼ 既有持久層（重用、未改）
   enrich_details.run_enrich → snapshot → revision → 現值投影
```

### 關鍵元件

| 元件                   | 職責                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CDPClient`            | 極簡 CDP 客戶端：HTTP `GET /json` 探索分頁 → 對其 `webSocketDebuggerUrl` 開單一 ws → `Page.navigate` + `Runtime.evaluate("document.documentElement.outerHTML")`。 |
| `build_fetch_result()` | 純函式，把 CDP 取回的 HTML 組成與 `PCCAdapter.fetch_detail` **完全同形狀**的 `FetchResult`（含 `extract_source_revision_key`）。                                  |
| `CDPDetailScraper`     | async context manager；`fetch_detail(case_pk)` / `fetch_many([...])`。detail_url **仍由 `PCCAdapter.detail_url` 組**（不重造 base64 token）。                     |
| `run_cdp_enrich()`     | 與 enrich job 串接：**預抓**所有目標 HTML 進快取 → 以同步 shim adapter monkeypatch `enrich_details.get_adapter` → 重用整個 snapshot/revision 持久層。             |

### 為什麼用「預抓 + shim」而非直接改 enrich job

`enrich_details.run_enrich` 內部以**同步** `adapter.fetch_detail` 呼叫；CDP 是 async。
為了**完全不改、不複製**已測的持久層（去重、CAPTCHA 分流、失敗退避帳本、現值投影），
本模組先用單一 CDP 連線把目標清單的 HTML 全抓進記憶體快取，再讓一個同步 shim adapter
查快取回 `FetchResult`，monkeypatch 進 enrich job。如此 `captcha` / `unchanged` /
`new` / `parse_fail` 等分流邏輯**原封不動**沿用方案 A 的程式碼。

---

## 3. 如何啟動帶 debugging port 的 Chrome（使用者一次性手動步驟）

1. **完全關閉** Chrome。
2. 以 debugging port 啟動（**建議用獨立 profile 目錄**，見安全章）：

   **macOS**

   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --remote-debugging-port=9222 \
     --user-data-dir="$HOME/.tenderai-chrome"
   ```

   **Windows**

   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
     --remote-debugging-port=9222 `
     --user-data-dir="$env:USERPROFILE\.tenderai-chrome"
   ```

3. 在這個 Chrome 視窗開 PCC 任一詳情頁，**手動過一次 CAPTCHA**（必要時登入）。
   驗證通過後 session cookie 會留在此 profile。
4. 確認可連：瀏覽器開 `http://127.0.0.1:9222/json` 應看到 JSON 分頁清單。
5. 跑 job：
   ```bash
   uv run python -m app.jobs.scrape_detail_cdp
   uv run python -m app.jobs.scrape_detail_cdp --all --limit 50
   ```

---

## 4. 環境變數與 CLI

| 設定                      | 預設                    | 說明                                                |
| ------------------------- | ----------------------- | --------------------------------------------------- |
| `PCC_CDP_URL`             | `http://127.0.0.1:9222` | Chrome CDP 探索端點（HTTP `/json`）。               |
| `--cdp-url`               | （同上 env）            | CLI 覆寫探索端點。                                  |
| `--all`                   | off                     | 跑所有 PCC 標的（預設只 new ∪ stale ∪ retriable）。 |
| `--limit` / `--ttl-hours` | – / 24                  | 目標上限 / stale TTL。                              |
| `--rate-limit`            | 1.0                     | 逐筆抓取間隔秒數（節流，在預抓階段套用）。          |
| `--trigger`               | manual                  | `manual` / `daily`，寫入 `crawl_run`。              |

CLI 介面、統計輸出格式刻意對齊 `enrich_details.py`。

---

## 5. 與方案 A 的差異 / 取捨

| 面向             | 方案 A（`_pcc_http`，自管 session）   | 方案 B（CDP attach 既有 Chrome）                                     |
| ---------------- | ------------------------------------- | -------------------------------------------------------------------- |
| 連線堆疊         | `requests` + `SkipSSLAdapter`（自管） | 使用者瀏覽器的網路堆疊（CDP 控制）                                   |
| CAPTCHA          | 撞到只能中止 → deferred               | **借用人工已過關的 session**，多數情況不再跳                         |
| 依賴             | requests（已有）                      | `websockets`（已安裝 16.0）＋ `httpx`（已有）；**不引入 playwright** |
| 前置             | 無                                    | 需使用者手動開帶 port 的 Chrome 並過一次 CAPTCHA                     |
| 適用             | 無人值守排程（CAPTCHA 少時）          | 有人在機、需突破 CAPTCHA 的補抓                                      |
| session 生命週期 | 每跑自建、用完即丟                    | 沿用瀏覽器分頁；CAPTCHA 過期需回瀏覽器重過                           |
| 解析 / 持久層    | `detail_parser` + `enrich_details`    | **完全相同**（重用，未改）                                           |

> 兩案**共用**：`PCCAdapter.detail_url`（token）、`detail_parser` 全部純函式、
> `enrich_details` 持久層。差別只在 transport。

### attach 現有 session vs 自管 profile 的取捨

- **attach 使用者日常主 profile**：最省事（已登入、已有 cookie），但 debugging port
  等於把整個瀏覽器（含所有登入態）暴露給 localhost，風險最高。
- **自管獨立 profile（`--user-data-dir`，本文件採用）**：隔離日常瀏覽資料，僅該 profile
  持有 PCC session；風險面縮到最小，建議預設採此法。

---

## 6. 安全注意（debugging port 風險）

- `--remote-debugging-port=9222` 對 `127.0.0.1` 開放**完整瀏覽器控制權**：任何本機程序
  都能讀該 profile 的 cookie、以該身分發請求。**務必只綁 localhost、用完即關**。
- **勿用日常主 profile**：用 `--user-data-dir` 開獨立 profile，隔離日常登入態。
- 不要把 port 透過 SSH 轉發或 `0.0.0.0` 對外暴露。
- 本模組**只讀取頁面 HTML**（`Runtime.evaluate` 取 outerHTML），不寫入、不竄改頁面、
  不導出 cookie。抓回內容為 **Layer A 公開標案資料**；不碰 Layer B。
- CAPTCHA 政策對齊既有：**不破解、不繞過**；過期就回瀏覽器人工重過。

---

## 7. 測試（離線、不連網/Chrome/DB）

`tests/test_scrape_detail_cdp.py`，以 fake `CDPClient` 注入 fixture HTML：

1. 正常詳情頁（`pcc_detail_full.html`）→ `FetchResult` 可被 `parse_pcc_detail` 解析、
   `source_revision_key == "01"`、連線/關閉生命週期正確。
2. CAPTCHA 頁（`pcc_detail_captcha.html`）→ `FetchResult` 成立（200/html）、
   `is_captcha_page` 命中、`parse_pcc_detail` 回 `None`。
3. CDP 連線失敗 → 清楚 `CDPError`（訊息含啟動指引）。
4. `build_fetch_result` 形狀對齊 `PCCAdapter.fetch_detail`；invalid 頁無 revision key。
5. 批次 `fetch_many` 重用單一連線（兩案兩次導航）。

跑法：`uv run pytest tests/test_scrape_detail_cdp.py -q`（7 passed，0.7s，無外部相依）。

---

## 8. 未在本機驗證的項目（待真機驗證）

- **真實 Chrome CDP 握手**：`CDPClient` 對真 `/json` 與 `webSocketDebuggerUrl` 的實際
  連線、`Page.navigate` + `Runtime.evaluate` 序列（測試以 fake client 取代）。
- **CAPTCHA 確實被 session 繞過**：需在過關後的真實分頁連抓多筆，確認 PCC 不再跳驗證碼、
  抓回的是有效詳情頁而非攔截頁。
- **導航等待策略**：目前用固定 `_NAV_SETTLE_S = 1.5s` 緩衝；真機若遇慢頁/重導向可能需改
  監聽 `Page.loadEventFired` 或輪詢 readyState。
- **多分頁/分頁選擇**：`_pick_page` 取第一個非 devtools 的 page；多分頁情境下是否需指定
  特定分頁（如以 url 過濾）待真機調整。
- **連線斷線重連**：長批次中 ws 中斷時的重連／續抓尚未實作（目前個別失敗記 `fetch_fail`，
  由 enrich 退避重試涵蓋）。
- **`run_cdp_enrich` 端到端**：需可連 DB + Chrome 的環境驗證 snapshot/revision 落地。

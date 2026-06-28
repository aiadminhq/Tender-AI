# 方案 A:Playwright persistent-context 詳情抓取

> 為 PCC 政府電子採購網詳情頁(持久 CAPTCHA)提供一條「人工過 CAPTCHA 一次、之後批次抓取」的路徑,與既有 enrich 流程相容。Layer A(公開標案)。

## 1. 方案概述

PCC 詳情端點掛了反大量查詢的圖形驗證碼(撲克牌配對)。既有 HTTP 路徑(`PCCAdapter.fetch_detail` → `_pcc_http.governed_get`)撞到 CAPTCHA 只能由 enrich job 歸為 `captcha`、優雅中止整批退避,無法繼續抓。

本方案改走**真瀏覽器**:用 Playwright 的 **persistent context**(`launch_persistent_context`,指向使用者本機 Chrome profile 目錄)開詳情頁。

- 偵測到 CAPTCHA(重用 `detail_parser.is_captcha_page`)→ **停下、提示人工**在那個有頭瀏覽器視窗手動解一次。
- 解完後**同一 context** 帶著通過的 cookie/session,可**連續批次抓多筆**,不必每筆重解。
- 拿到的 raw HTML 仍交給既有純函式 `parse_pcc_detail` / `extract_source_revision_key` 解析,回傳形狀與 `app.adapters.base.FetchResult` 完全一致 → enrich 持久化層(snapshot/revision)無需改動。

核心類別 `PlaywrightDetailScraper`:

- `async with` 進出 → 自建/關閉 persistent context。
- `await fetch_detail(case_pk) -> FetchResult`(與 HTTP adapter 同形)。
- `async for case_pk, fr in scraper.iterate(case_pks)` 批次介面(共用同一已通過 context)。
- CLI entrypoint `run_scrape` / `main`(argparse,對齊 `enrich_details.py`:`--source PCC --limit … --all --ttl-hours`)。

## 2. 新增/重用檔案

| 檔案                                                                   | 角色                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `app/jobs/scrape_detail_playwright.py`(新)                             | Playwright 抓取器 + CLI                                                |
| `tests/test_scrape_detail_playwright.py`(新)                           | 離線測試(不連網、不開瀏覽器、不裝 playwright)                          |
| `app/adapters/pcc.py`(重用)                                            | `detail_url()`、registry                                               |
| `app/services/detail_parser.py`(重用,**未改**)                         | `is_captcha_page` / `parse_pcc_detail` / `extract_source_revision_key` |
| `app/adapters/base.py`(重用)                                           | `FetchResult` 契約                                                     |
| `tests/fixtures/pcc_detail_full.html`、`pcc_detail_captcha.html`(重用) | 測試 fixture                                                           |

**未重寫** scraper / `tables[4]` / `SkipSSLAdapter` / `_pcc_http` / `detail_parser`。

## 3. 相依

- Python 套件:`playwright`
- 瀏覽器執行檔:`playwright install chromium`(或用 env 指向本機 Chrome/Edge channel)

```bash
uv pip install playwright
uv run playwright install chromium
```

> Playwright 為 **lazy import**(`_import_async_playwright`,僅在自建 context 時呼叫)。未安裝時丟 `PlaywrightNotInstalled` 並附安裝指引。**CI/測試完全不需安裝**——測試走注入假 page 路徑,不觸發 import。

## 4. 環境變數

| 變數                      | 預設                                        | 說明                                                                          |
| ------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| `PCC_CHROME_PROFILE_DIR`  | `~/.cache/tender-ai/pcc-playwright-profile` | persistent context 使用者資料目錄。指向常用 Chrome profile 可重用既有通過狀態 |
| `PCC_PLAYWRIGHT_HEADLESS` | `0`(有頭)                                   | 人工解 CAPTCHA 需看得到視窗;設 `1` 開無頭(僅在 profile 已通過時適用)          |
| `PCC_PLAYWRIGHT_CHANNEL`  | `chrome`                                    | `chrome` / `msedge` / 空(用 bundled chromium)                                 |

## 5. 人工介入點

1. 批次開始,scraper 開有頭瀏覽器、導到第一筆 detail_url。
2. 若 `is_captcha_page` 命中 → 預設 `on_captcha`(`_wait_for_human`)在 stderr 提示人工,並**每 3 秒輪詢** `page.content()`,直到頁面不再是 CAPTCHA 頁(上限 300 秒,逾時 raise)。
3. 人工在瀏覽器**手動完成撲克牌配對**並送出。
4. 通過後同一 context 續抓剩餘各筆,通常**整批只需解一次**。

> 本方案**不破解、不繞過、不自動填答** CAPTCHA;只辨識並停下等人工。`on_captcha` 為注入點,可換成桌面通知 / 阻塞輸入等。

## 6. 與 enrich 整合方式

- **形狀相容**:`fetch_detail` 回傳的 `FetchResult` 與 `PCCAdapter.fetch_detail` 同欄位(`status_code=200`、`content_type=text/html`、`raw_content`、`source_revision_key`)。
- **持久化共用**:HTML 走既有 `parse_pcc_detail`,可直接餵 enrich job 的 snapshot→revision 流程。
- CLI 目前的 `run_scrape` 刻意**只抓取+印出**(供人工確認過 CAPTCHA 後能批次取得 HTML);若要直接入庫,後續可:
  - (建議)在 `enrich_details._process_one` 加一個 `fetcher` 注入點,正常走 HTTP、需要時切換為本 scraper 的 `fetch_detail`;或
  - 由本模組 import enrich 的持久化 helper 串接。
- 目標選擇**重用** `enrich_details._select_targets`(new ∪ stale ∪ retriable),不另造一套選案邏輯。

## 7. 測試如何跑

```bash
cd tender-ai-backend
uv run pytest tests/test_scrape_detail_playwright.py -q   # 7 passed,離線
```

涵蓋:(a) 正常詳情 → FetchResult 正確且可被 `parse_pcc_detail` 解析;(b) CAPTCHA 偵測 → `on_captcha` 等待/重試分支、人工「解完」後重讀拿正常頁;CAPTCHA 未解則如實回報仍被擋;批次 iterate 只解一次共用 context;未進 context 直接 fetch 報清楚錯;lazy import 未安裝 playwright 的錯誤路徑;未知來源拒絕。以 `FakePage`(只實作 async `goto`/`content`)注入,**不連網、不開瀏覽器、不裝 playwright**。

## 8. 優缺點

**優點**

- 真正解掉持久 CAPTCHA:人工一次、之後批次,符合「Layer A 公開資料、低頻蒐集」需求。
- 與既有解析/持久層零耦合改動;`FetchResult` 同形,可漸進整合。
- persistent profile 可長期保留通過狀態,降低重解頻率。

**缺點 / 取捨**

- 需有頭瀏覽器 + 人工在場,**不能在 CI / 雲端用完即丟環境跑**(本即 enrich 的既有限制)。
- Playwright 無原生 HTTP status;本實作以「成功取得頁面內容」視為 200,真實非 200 會以 goto/content 例外體現(交呼叫端歸 fetch 失敗)。
- 未自動處理 session 過期再次跳 CAPTCHA 的長批次中段重解(`_wait_for_human` 會再次等待,但批次長時可能多次打斷)。
- 與既有 `_pcc_http` 的 SSL/retry 治理是**兩套 transport**;若 PCC 行為變動需各自維護。

## 9. 未在本機驗證的部分

- **未實際安裝 playwright、未開真瀏覽器、未連 PCC**(雲端環境連不到 PCC 與本機資源;測試一律離線)。以下需在能連線的本機環境驗證:
  - `launch_persistent_context` 對指定 Chrome profile 的實際行為(profile 鎖定/既有分頁)。
  - 真實 CAPTCHA 頁是否確被 `is_captcha_page` 命中(目前用縮樣 fixture;真實頁約 43KB)。
  - 人工解完後同一 context 的 cookie/session 是否確實對後續多筆生效、通過可維持多久。
  - `wait_until='networkidle'` 在 PCC 詳情頁的合適性(必要時改 `domcontentloaded`)。
  - 入庫整合(目前 CLI 只抓取+印出,尚未串 snapshot/revision 落地)。

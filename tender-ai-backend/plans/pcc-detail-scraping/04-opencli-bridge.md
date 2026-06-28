# 方案D — OpenCLI Browser Bridge（主力路徑）

> 由主 agent 親自驅動：`doctor → explore → record → cascade`。
> 工具：`@jackwener/opencli@1.8.4`（daemon + Chrome 擴充 Browser Bridge）。
> 真實入口：`/Users/christianwu/.hermes/node/bin/opencli`（PATH 上的 `opencli` 是壞掉的 codex shim，會把 bin 解到 `/dist/...`，勿用）。

## 1. doctor（連線診斷）

```
[OK] Daemon: running on port 19825 (v1.8.4)
[OK] Extension: connected
[OK] Connectivity: connected
```

- 初次 `doctor` 顯示 Extension 未連線 → `opencli daemon restart` 後自動回連。
- 已下載最新擴充 v1.0.20 至 `/Users/christianwu/opencli/opencli-extension-v1.0.20`（Load unpacked 指向此資料夾），使用者已於 Chrome 安裝。
- **多 profile 注意**：同時連了 `axq5zgff`(v1.0.20) 與 `default`(v1.0.0)；子命令需指定 `--profile axq5zgff` 或 `OPENCLI_PROFILE=axq5zgff`，否則報 "Multiple Browser Bridge profiles are connected"。

## 2. explore（`analyze` 分類站台）

對 `https://web.pcc.gov.tw/tps/QueryTender/query/searchTenderDetail` 跑 `analyze`：

| 項目            | 結果                                                                               |
| --------------- | ---------------------------------------------------------------------------------- |
| pattern         | **C — 純 HTML scrape**（無 JSON XHR、無 SSR state：APOLLO/INITIAL/NEXT/NUXT 皆無） |
| anti-bot 廠商   | **未偵測到**（無商用 anti-bot 簽章）                                               |
| api_candidates  | 0（無可逆向的真資料 API）                                                          |
| nearest_adapter | 通用 `web`                                                                         |
| 建議下一步      | 對 render 後頁面用 `opencli browser extract` 抓 SSR HTML                           |

**結論**：PCC 沒掛 Cloudflare/Akamai 類商用反爬；真正的閘門是**詳情頁自家的圖形 CAPTCHA**。
→ 既有 `_pcc_http`(SkipSSLAdapter) Node-side cookie fetch 對「未過 CAPTCHA」的詳情頁仍會被擋；
突破點一律是「在**已過 CAPTCHA 的瀏覽器 session**裡取 render 後 HTML」，正好對應方案 A/B/D。

## 3. record（可重放 recipe）

詳情頁需有效 `case_pk`（`pkPmsMain = base64(case_pk)`，見 `app/adapters/pcc.py:detail_url`）。
人工在 Chrome 過一次 CAPTCHA 後，OpenCLI 取頁的最小序列：

```bash
OPENCLI=/Users/christianwu/.hermes/node/bin/opencli
export OPENCLI_PROFILE=axq5zgff

# 1) 綁定使用者目前已登入/已過 CAPTCHA 的分頁
$OPENCLI browser pcc bind

# 2) 開詳情頁（token 由後端 detail_url() 產生）
$OPENCLI browser pcc open "https://web.pcc.gov.tw/tps/QueryTender/query/searchTenderDetail?pkPmsMain=<base64(case_pk)>"

# 3) 等關鍵欄位出現，確認非 CAPTCHA 頁
$OPENCLI browser pcc wait text "招標機關"

# 4) 取 render 後完整 HTML（交回後端 parse_pcc_detail）
$OPENCLI browser pcc eval "document.documentElement.outerHTML"   # 或 extract 取 markdown
```

`eval outerHTML` 取得的 HTML 直接餵 `app/services/detail_parser.parse_pcc_detail()`，
revision key 走 `extract_source_revision_key()`，與 enrich job 落 snapshot/revision 的形狀一致。

## 4. cascade（串接 + 驗證）

- **批次**：對一批 case_pk 重複 §3 步驟 2–4，共用同一 bind session（CAPTCHA 只需人工解一次），
  逐筆把 HTML 交後端入庫——等同方案 A/B 的批次語意，差別在「驅動瀏覽器的是 OpenCLI 而非 Playwright/CDP client」。
- **`opencli browser verify <name>`**：可用 `~/.opencli/sites/<site>/verify/<cmd>.json` fixture 對 adapter 輸出做回歸驗證；
  若要把 PCC 詳情固化成 OpenCLI adapter，用 `opencli browser init pcc-detail` 生 scaffold 再補解析。

## 5. 三條瀏覽器路徑的取捨

| 路徑                                | 驅動                    | 何時選                                                                     |
| ----------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| 方案A Playwright persistent context | 自管 Chrome profile     | 要全自動排程、可接受獨立 profile；CAPTCHA 由腳本停下等人工                 |
| 方案B CDP attach                    | 接管使用者已開的 Chrome | 使用者本來就開著 PCC、已過 CAPTCHA，臨時批次抓                             |
| **方案D OpenCLI bridge**            | OpenCLI daemon + 擴充   | 互動式探索/取樣、想沿用 155 adapter 生態與 `analyze/extract/verify` 工具鏈 |

三者**入庫路徑共用**：render 後 HTML → `parse_pcc_detail` → snapshot/revision，未重寫任何已測 scraper。

## 6. cascade 端到端驗證（2026-06-23，本機實跑、真實資料）✅

用使用者提供的進階查詢 URL（台北市 / 2026-05-23~06-23 / tenderRange=3 / 上限 50M）實跑：

1. `open` 列表頁 → **無 CAPTCHA**；`eval` 抽出 `a[href*="tpam?pk="]` → 50 筆真實 case_pk
   （例 `NzEyNTM0NDA=` = base64("71253440")）。
2. 直接組詳情 URL `…searchTenderDetail?pkPmsMain=NzEyNTM0NDA=`，`open` → **`hasCaptcha:false`、`hasOrg:true`**
   （暖機瀏覽器 session 直接渲染詳情，未觸發圖形碼）。
3. `eval document.documentElement.outerHTML` → 取回 **169 KB** render 後 HTML。
4. 餵後端 `parse_pcc_detail()` → **完整解析**：

   | 欄位                | 值                                                 |
   | ------------------- | -------------------------------------------------- |
   | 機關 / 標案         | 國立臺灣科技大學 ／ 115學年度學生平安保險          |
   | 預算金額            | 10,320,000 元                                      |
   | 決標方式            | 最低標                                             |
   | 標的分類            | 勞務類 812 保險                                    |
   | 資格碼              | H501011                                            |
   | 附件                | 1（投標須知下載，含 `downloadNoticeDocument` URL） |
   | source_revision_key | 02                                                 |
   | is_captcha_page     | **False**                                          |

**結論**：擋住 Node-side `_pcc_http` fetch 的詳情頁 CAPTCHA，被「真實暖機瀏覽器 session」繞過；
OpenCLI `open → eval outerHTML → 後端 parse_pcc_detail` 這條 cascade 已證實可端到端取得結構化詳情。
方案 A（Playwright persistent context）/ B（CDP attach）共用同一入庫尾段，差別僅在驅動瀏覽器的 client。

## 7. 待驗證 / 待決

- CAPTCHA-free 是否穩定：上述為單筆且 session 已暖機；需驗證「冷啟動第一筆」與「連續多筆」是否某個門檻後跳圖形碼，以及需多久重解一次。
- 附件下載：`downloadNoticeDocument` URL 是否同樣可在瀏覽器 session 直接下載（接 §方案C 轉檔）。
- 是否值得用 `opencli browser init` 把 PCC 詳情固化成正式 adapter（vs 留在後端 job）。

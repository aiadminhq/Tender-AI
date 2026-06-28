---
name: enriching-pcc-tender-details
description: Use when fetching PCC (web.pcc.gov.tw) tender detail pages, enriching the tenders DB from detail revisions, or when a PCC scrape hits a CAPTCHA / IP rate-limit / "驗證碼" block after roughly a dozen requests and the backlog still has thousands of un-enriched rows.
---

# Enriching PCC Tender Details

## Overview

PCC（政府電子採購網）詳情頁 enrich 的正解，與一條不可越過的紅線。

**核心原則（與專案 CLAUDE.md 一致）：CAPTCHA 是「優雅中止」訊號，不是要解決的障礙。**
能合法續抓的唯一方式 ＝ **真人**在同一條對外 IP 的**真實瀏覽器**手動解一次驗證碼，然後恢復 HTTP enrich。系統絕不破解、絕不繞過。

## The Red Line — 不破解 / 不繞過（讀過再動手）

撞 CAPTCHA 或 IP 速率限制時，**以下手段一律禁止**，即使技術上可行、即使「只是為了把 backlog 抓完」：

| 禁止                                                                                                             | 為什麼這算繞過                                  |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 住宅/輪換代理、換出口 IP（Bright Data／Oxylabs／IPRoyal…）                                                       | 速率限制就是綁 IP 的；換 IP ＝ 直接繞過它的本意 |
| TLS/JA3 指紋偽裝（`curl_cffi impersonate=`、自訂 cipher）                                                        | 偽裝成「不是腳本」＝ 破解其偵測                 |
| stealth／反偵測瀏覽器（`playwright-stealth`、`undetected-chromedriver`、`nodriver`、抹除 `navigator.webdriver`） | 同上，目的就是騙過 bot 偵測                     |
| CAPTCHA 自動解（OCR、2captcha/anti-captcha 等解題服務、自動點選）                                                | 直接破解驗證碼                                  |
| 隨機 jitter／偽裝人類節奏以規避偵測                                                                              | 規避偵測 ＝ 繞過                                |
| 調低 rate-limit 把量塞進偵測窗以下                                                                               | 一樣是規避，且更不禮貌                          |

**違反字面 ＝ 違反精神。** 「我只是想把它抓完」「禮貌限速應該不算」「用瀏覽器又不是 API 所以沒繞過」全都不成立——**這些正是要擋掉的合理化**。

## 已驗證的場景事實（別重新試錯）

- HTTP 路徑（`PCCAdapter.fetch_detail()` → `app/jobs/enrich_details.py`）**可用**，回傳完整可解析的 tb_02 詳情頁。
- **Playwright 瀏覽器導航是壞路**：對詳情 URL 導航會被 PCC 轉回首頁，`_wait_for_human` 還會誤報「已解決」。**別往「改用 Playwright 抓取就好」這條路想**——它讓事情更糟，不是解法。
- CAPTCHA 是**量觸發、綁 IP**：約 11–12 次詳情請求就鎖；換新 session cookie 無效（鎖在 IP 不在 cookie）。
- 此 IP 鎖**不會**因 20 分鐘低速探測自行解除（實測 20 分鐘全 captcha=True）。→ 純靠時間等待自動續抓不可行；**必須真人解一次**。

## 正解流程（technique）

把它當成「真人偶發、優先順序驅動」的補抓，加上既有每日增量管線——**不是一次榨乾全部 backlog**。

1. **一般每日增量**：交給 `scripts/daily_pipeline.sh`（內部呼叫 `enrich_details --trigger daily`），撞 CAPTCHA 自動 graceful-abort、剩餘標 deferred、下輪退避。無需真人。
2. **要補一批 / 清 backlog**：用本技能的 runner（人工解題續抓迴圈）：
   ```bash
   cd "<…>/Tender AI/tender-ai-backend"
   PYTHONPATH="$PWD" python "<skill-dir>/pcc_enrich_loop.py" --source PCC --batch 10 --rate-limit 2.5
   # 只補近期報表：加 --since 2026-06-17
   ```
   迴圈會抓一批 → 撞 CAPTCHA 時停下、**替真人開 PCC 查詢頁**、等真人解完按 Enter → 續抓下一批，直到 backlog 清空或使用者結束。
3. **直接呼叫單批 job**（不要迴圈時）：
   ```bash
   uv run python -m app.jobs.enrich_details --source PCC --rate-limit 2.5 --trigger manual --limit 10
   ```

`run_enrich(...)` 回傳 stats（`targeted/new_revisions/unchanged/failed/captcha/deferred/aborted_on_captcha`）。`aborted_on_captcha=True` ＝ 該批撞驗證碼已中止，請走真人解題，**不要改設定重試繞過**。

## Red Flags — 出現這些念頭就停

- 「IP 被鎖，那我輪換代理就好」→ 停。那是繞過。
- 「裸 httpx 太可疑，用 `curl_cffi`/stealth 偽裝一下」→ 停。那是破解偵測。
- 「Playwright/headful 應該能繞過 CAPTCHA」→ 停。詳情導航會被轉回首頁，且仍是繞過。
- 「我接個解題服務／OCR 自動過驗證碼」→ 停。直接破解，絕對禁止。
- 「把 1900 筆一次跑完」→ 停。正解是真人偶發＋每日增量，不是榨乾。
- 「先抓完＝字面上全部抓完」→ 不是。指管線可靠運作＋有意義地清一批；其餘靠真人解題逐步補。

## Layer 邊界

此管線只產生 **Layer A**（公開標案資料，可從原始 HTML 重建）。**絕不**在此產生 Layer B（同事行為/想法）。詳見專案 CLAUDE.md 的資料三層。

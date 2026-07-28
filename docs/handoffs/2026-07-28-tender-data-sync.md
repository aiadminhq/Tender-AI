# 任務交接：標案資料補齊至 2026-07-28（日報已完成、爬蟲待人工解驗證碼）

此檔供人工貼入下一個 session 接手；不含任何自動執行指令。

狀態：**日報入庫已完成並驗證（本地＋Supabase 皆到 2026-07-28）；PCC 爬蟲卡在人工驗證碼，等 owner 解。**
本檔經 PR 併入 `main`；資料檔（日報 HTML）依 `.gitignore` 設計不入版控，僅存在於本機。

## PURPOSE

owner 原始需求：「幫我為 Tender AI 抓取現在目前後台數據庫最新 到今日最新的標案資訊」，
一支 sub-agent 拉 GitHub 日報入庫（本地＋Supabase），另一支用爬蟲抓網頁；
**明確約束：「當遇到人工驗證我來驗證」** —— agent 不得繞過／自動破解驗證碼。

## 已完成（已親自複查，非採信 agent 回報）

### 1. 日報入庫

- 下載缺口 20 份日報 HTML（`tender-20260709.html` ～ `tender-20260728.html`），20/20 成功
- 落地於 `tender-reports/reports/`（現共 73 檔）。該目錄被 `.gitignore:20` 排除（「報表站台屬 tender-bot 產物，非本 repo 源碼」），**設計上就不入版控**，換機器需重新從 `aiadminhq/tender-reports` 拉
- 以 `app/jobs/ingest_daily_reports.py` 對本地與 Supabase 各跑一次（該 job 為冪等，重跑安全）
- Supabase 走同一支 job 覆寫 `DATABASE_URL` 直連（憑證取自 launchd runner 的後端 `.env`）

### 2. PCC 爬蟲（部分完成）

- 進入點確認為 `app/jobs/research_enrich.py`（discovery → 建列 → 明細 → 附件 → revision）
- 新增 9 筆 tenders、8 筆 revisions，其中 5 筆完整補齊明細
- 第 6 筆撞驗證碼中止，未繞過。解析與網路失敗數 0

## 驗證數字（2026-07-28）

|                                       | 本地 DB              | Supabase (`ajltwjkegmbzethwgbje`) |
| ------------------------------------- | -------------------- | --------------------------------- |
| `daily_tender` 最新 `run_date`        | 2026-07-28           | 2026-07-28                        |
| `daily_tender` 列數                   | 7,765（+2,884）      | 7,875（+2,884）                   |
| `tenders`                             | 2,358（+113）        | 2,370（+104）                     |
| 仍在投標期（`deadline_iso >= today`） | **61**（原本只有 1） | 57                                |
| `(待補)` 佔位列                       | 134                  | 130                               |

差異說明（皆為預期，非錯誤）：

- 兩端差 4 筆 open／4 筆佔位＝爬蟲那 9 筆只寫進本地，未同步 Supabase（不在該 agent 任務範圍）
- 7/09–7/12 另有既有 110 列落差（Supabase 多），是當時雲端 pipeline 直接抓取、涵蓋比日報 HTML 廣所致，**非本次造成**；7/13 起兩端逐日筆數完全一致
- 表名是 `daily_tender`（單數），不是 `daily_tenders`

## BLOCKER：需 owner 手動解 PCC 驗證碼

PCC 的反大量查詢驗證碼是**流量觸發、綁對外 IP**（換 cookie 無效、不會自動解除），約 11–12 次明細請求觸發。
爬蟲走純 HTTP（`requests` + `SkipSSLAdapter`）無瀏覽器，**無法截圖給 owner 看**，必須 owner 自己開瀏覽器解。

處理方式：用平常的 Chrome（需與本機同一條對外 IP）開
`https://web.pcc.gov.tw/prkms/tender/common/basic/indexTenderBasic`，隨便查一筆進詳情頁解掉即可。

4 筆延後的標案 URL 與續跑指令記錄在（**session-specific，過期會消失，需要就重查 DB**）：
`<scratchpad>/pcc-captcha-state-20260728.md`

## 待決策

**爬蟲範圍**：sub-agent 刻意只跑 07-28 當天，沒跑全期間 discovery。
原因：`research_enrich --limit` 只截斷「明細處理」、**不截斷 discovery 建列**，
跑 20 天會製造上百筆補不滿的 `(待補)` 佔位列（現存 134 筆就是 2026-06-23 那次驗證碼中斷的殘留）。

- **(A) 建議**：發現交給日報、爬蟲只做明細補抓（`enrich_details --since 2026-07-09`）
- **(B)** 照原指示跑全期間 discovery，接受佔位列污染

注意 `enrich_details.py` 只對既有列做 TTL 重抓，**不回填 Tender 主欄位**，因此無法清掉 `(待補)`；
若要修佔位列，得走 `research_enrich` 或先讓 `enrich_details` 支援主欄位回填。

## 已回報但未修的缺陷

1. **`content_hash` 去重失效**：PCC 詳情頁含動態內容，每次抓 hash 都變 → 重跑會產生冗餘 revision，並白耗稀缺的 IP 配額。需在 hash 前做 normalize。
2. **`research_enrich --limit` 語義不符**：只限制明細處理，不限制 discovery 建列（見上）。
3. **失效憑證需清理**：
   - `tender-ai-backend/supabase/.temp/pooler-url` 指向**另一個 project ref**（`ylhuvkboznadheknxjpv`）且無密碼
   - 後端 `.env` 內 `VERCEL_TOKEN` 已失效、專案未 link
   - 若日後要靠排程自動同步 Supabase，這兩處必須先修

## 版控狀態

- `tender-reports/reports/tender-202607{09..28}.html`（20 檔）—— 依 `.gitignore` 設計不入版控，只在本機
- 本檔 —— 經 PR 併入 `main`
- 工作區另有多筆**先前 session 遺留**的未提交修改（`i18n/strings.ts`、`annotation-layer.tsx`、`vite.config.ts`、
  `vite-plugin-design-feedback.ts` 已刪除等），**與本次任務無關**，本次刻意未動；接手者處理版控時勿一併掃入
- 本地 `main` 落後 `origin/main` 12 筆、且有 4 筆已被遠端以不同 SHA 收錄的重複 commit（rebase 殘影）；
  建議接手前先 `git fetch && git reset --hard origin/main`（**先確認上述未提交修改是否還需要**）

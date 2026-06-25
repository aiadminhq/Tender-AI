---
description: 執行每日標案管線（同步報表 → Layer A 建檔 → Layer C 向量化），回報各層統計
---

# /tender-daily — 每日標案管線

每日（10:00）自動接手 `aiadminhq/tender-reports` 公開 repo 發布的標案索引，
把後台資料庫尚未收錄的標案抓回、建檔，並轉成 Layer C 向量。

## 執行步驟

1. 確認在專案根目錄（含 `tender-ai-backend/`）。
2. 執行管線腳本，完整輸出導向日誌：

   ```bash
   bash "tender-ai-backend/scripts/daily_pipeline.sh"
   ```

3. 腳本結束後，讀取當日摘要：

   ```bash
   cat "tender-ai-backend/data/pipeline-logs/daily-$(date +%Y%m%d).summary.json"
   ```

## 回報要求（第三人稱專業語氣、繁體中文）

依摘要 JSON 與日誌，扼要回報：

- **連線預檢**：PostgreSQL / Ollama / PCC 各自是否可連線。
- **Layer A**：`ingest_daily_reports` 新建索引筆數；`enrich_details` 抓取 PCC 詳情建檔結果；`backfill_category` 回填情形。
- **Layer C**：`embed_tenders` 新灌向量筆數。
- **被跳過的步驟**：列出原因（如「PCC 連不到 → 詳情抓取跳過，索引仍建立」）。

## 判斷與處置

- **連線受阻屬預期、非錯誤**：依專案規範，沙箱環境連不到 PCC／Ollama／本機 DB；腳本對連不到的步驟採 fail-soft 跳過。此時如實標註「待能連線環境補跑」即可，不需中止。
- **核心步驟回傳失敗（exit 2）**：開啟當日日誌 `tender-ai-backend/data/pipeline-logs/daily-YYYYMMDD.log` 定位錯誤，摘要根因並提出建議，不要自行更動 `reasoning.py`／`learn_keywords.py`／embedding job（見專案 CLAUDE.md）。
- **資料層紅線**：本管線只產生 Layer A（標案 corpus）與 Layer C（向量）。Layer B（行為/回饋）由前端互動累積，**不在此處寫入**。

## 參數（環境變數，可選）

- `ENRICH_LIMIT`：單次 enrich 上限（除錯用）。
- `ENRICH_RATE_LIMIT`：每筆抓取間隔秒數（預設 1.0，禮貌爬取）。
- `TENDER_AI_ROOT`：專案根路徑覆寫。

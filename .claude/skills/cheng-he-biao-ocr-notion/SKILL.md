---
name: cheng-he-biao-ocr-notion
description: Use when a user provides a photo/scan/PDF of a 惠強「發包開標議價結果呈核表」(contract-approval procurement form) and wants it OCR'd and injected into the Notion 呈核表 database. Handles shadow-removal preprocessing, Mistral OCR, deterministic field conversion/validation, and two-table Notion injection (main row + vendor comparison rows) with a mandatory human-review gate.
---

# 發包開標議價結果呈核表 OCR → Notion 注入

把手機拍攝／掃描的「發包開標議價結果呈核表」紙本，辨識、驗算、注入 Notion 資料庫，
並對手寫欄位強制人工複核。**目標是省去手動 key-in，不是取代人的判斷。**

## 何時用

使用者給一張（或多張）呈核表照片/PDF，要求辨識並寫進 Notion。
非呈核表的一般合約掃描請改用 `anthropic-skills:ocr-contract-scan`。

## ⚠️ 動工前必知（紅線）

- **雲端上傳**：Mistral OCR 是雲端 API，會上傳影像。敏感件先問使用者是否接受；不接受改本地 Tesseract。
- **金鑰**：只從專案 `.env` 讀 `MISTRAL_API_KEY`，**絕不**印在輸出/日誌/commit/記憶。`.env` 須 gitignored。
- **強制人工複核 gate**：手寫欄位（工地名稱、工程項目、開標時間、決議金額、廠商資訊、各簽名）
  辨識準確度有限。凡 `needs_review` 非空，`處理狀態` 一律「待人工複核」，
  **必須完成人工複核才能進呈核／對帳流程**——agent 不得改寫 status 繞過此閘。
- **覆蓋前先看**：既有 Notion 列先 fetch 確認，避免重複建列或蓋掉他人資料。

## 流程

### 1. 前處理（去陰影／增對比）

```bash
python scripts/preprocess.py <輸入照片> <輸出前綴>
```

產出 `_gray.png`（**OCR 主來源**）、`_bw.png`（對照存證）、`_shadowfree.png`。
實測：中文密集手寫欄位，灰階版 OCR 準確率高於純黑白版（adaptive threshold 會斷筆）。

### 2. Mistral OCR

```bash
python scripts/run_ocr.py <前綴>_gray.png ocr_results_mistral
```

產出逐頁 markdown + json（含版面座標）。建議灰階、黑白兩版都跑以交叉核對。

### 3. agent 填結構化 JSON

讀 OCR markdown，依 `references/field-spec.md` 的 JSON 樣板填一份結構化檔。
逐一套用六項轉換前先**照原文填**（金額可帶逗號、日期可填民國、決議金額可填中文大寫），
轉換交給下一步的腳本；你只負責：

- 沒把握的欄位在 `_confidence` 標 < 0.85；
- 已知手寫簽名等塞進 `needs_review`；
- 多家比價廠商就在 `vendors[]` 列多筆。

### 4. 確定性轉換 + 驗證 + 組 payload

```bash
python scripts/build_payload.py <結構化.json> > payload.json
```

腳本負責千分位、民國年→西元、中文大寫→阿拉伯、金額交叉驗證、統編驗證、信心門檻、
複核 gate，並輸出 `{ main, vendors[], status, needs_review, warnings }`。
**先看 `warnings` 與 `needs_review`**，異常先回報使用者再注入。

### 5. 注入 Notion（先建廠商、再建主表、最後互連）

用 `notion-create-pages`（parent 用 `data_source_id`；properties 值只能 string/number/null，
本 payload 已符合：checkbox=`__YES__`/`__NO__`、multi_select=JSON 陣列字串、
日期=`date:開標時間:start` 鍵）。

1. **建廠商列**：parent `data_source_id=34aae1a0-ce15-4fda-b2d1-994021720f24`，properties 用 `vendors[i]`。記回傳 page id。
2. **建主表列**：parent `data_source_id=07084bda-a368-4095-8efc-f953bbe9c07c`，properties 用 `main`。
3. **互連 relation**：用 `notion-update-page`（command `update_properties`）在主表列的「廠商比價明細」填廠商 page id，
   或在廠商列的「所屬呈核案件」填主表 page id（雙向會自動補另一邊）。

### 6. 驗證

用 `notion-fetch` 撈回兩列，確認：欄位值正確、雙向 relation 連上、`處理狀態` 與 needs_review 一致。
把注入結果（含 needs_review 清單）回報使用者。

## 固定 ID（勿臆測，見 references/field-spec.md）

| 資料表       | data_source_id                         |
| ------------ | -------------------------------------- |
| 呈核表主表   | `07084bda-a368-4095-8efc-f953bbe9c07c` |
| 廠商比價明細 | `34aae1a0-ce15-4fda-b2d1-994021720f24` |

## 已驗證的場景事實

- 2026-07-15 已用真實案件（中保科技總公司 7F/永豐昕企業）完整跑通並注入 Notion，雙向 relation 確認。
- `build_payload.py --demo` 印出空白 JSON 樣板可當起點。
- 交叉驗證容差 ±1 元（5% 稅額四捨五入）。

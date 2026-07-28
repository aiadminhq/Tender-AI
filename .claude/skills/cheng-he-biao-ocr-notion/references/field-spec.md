# 欄位規格 — 發包開標議價結果呈核表 → Notion

> 權威來源：Notion 說明子頁面「欄位中英文對照表」與線上資料庫 schema（2026-07-15 對帳一致）。
> agent 填 JSON 樣板時對照本檔；`build_payload.py` 依此對映到 Notion 欄位名。

## 資料庫 ID（固定，勿臆測）

| 資料表       | data_source_id                         | Title 欄 |
| ------------ | -------------------------------------- | -------- |
| 呈核表主表   | `07084bda-a368-4095-8efc-f953bbe9c07c` | 工地名稱 |
| 廠商比價明細 | `34aae1a0-ce15-4fda-b2d1-994021720f24` | 廠商名稱 |

資料庫頁面：`https://app.notion.com/p/6bbfef7984124677846ab90ea732a36e`
兩表以雙向 relation 連結（主表「廠商比價明細」↔ 廠商表「所屬呈核案件」）。

## JSON 樣板（agent 從 OCR markdown 填寫）

```json
{
  "doc_type": "發包開標議價結果呈核表",
  "header": {
    "site_name": "",
    "project_item": "",
    "bid_location": "",
    "bid_datetime": ""
  },
  "vendors": [
    {
      "vendor_name": "",
      "vendor_owner": "",
      "vendor_address": "",
      "vendor_phone": "",
      "vendor_tax_id": "",
      "bid_price_untaxed": null
    }
  ],
  "amounts": {
    "sales_tax": null,
    "total_amount": null,
    "budget_amount": null,
    "contract_amount": "",
    "final_amount_taxed": null,
    "saving_percent": null,
    "over_budget_percent": null,
    "overdue_penalty": null
  },
  "award": {
    "awarded_vendor": "",
    "construction_period": "",
    "payment_terms": ""
  },
  "resolution": {
    "resolution_vendor": "",
    "resolution_amount_taxed": null,
    "resolution_period": "",
    "resolution_payment": "",
    "resolution_attachment": "",
    "approval_note": "",
    "cc_department": []
  },
  "signatures": {
    "sign_chairman": false,
    "sign_vice_chairman": false,
    "sign_gm": false,
    "sign_eng_vp": false,
    "sign_eng_manager": false,
    "sign_eng_staff": false,
    "sign_proc_vp": false,
    "sign_proc_accountant": false,
    "sign_proc_staff": false
  },
  "_confidence": { "<field_key>": 0.0 },
  "needs_review": []
}
```

- `_confidence`：只填「你沒把握」的欄位（0~1）。< 0.85 會自動列入複核。
- `needs_review`：手寫簽名等你已知需人核對的項目，先塞這裡。
- 未出現在表上的欄位留 `null` / `""` / `false`，腳本不會送空值（checkbox 除外，一律送 `__NO__`）。

## field_key → Notion 欄位對照

### 主表（`07084bda`）

| field_key               | Notion 欄位             | 型別                | 備註                           |
| ----------------------- | ----------------------- | ------------------- | ------------------------------ |
| site_name               | 工地名稱                | Title               | 手寫，易誤讀                   |
| doc_type                | 表單類型                | Select              | 固定「發包開標議價結果呈核表」 |
| project_item            | 工程項目                | Text                |                                |
| bid_location            | 開標地點                | Select              |                                |
| bid_datetime            | 開標時間                | Date                | 民國→西元，見規則①ￇ            |
| sales_tax               | 營業稅5%                | Number              |                                |
| total_amount            | 合計                    | Number              |                                |
| budget_amount           | 預算金額                | Number              |                                |
| contract_amount         | 合約金額                | Text                | 常為「實作實算」               |
| final_amount_taxed      | （含稅）總金額結算      | Number              |                                |
| saving_percent          | 節省%                   | Number              |                                |
| over_budget_percent     | 與預算金額比較（超出%） | Number              |                                |
| overdue_penalty         | 逾期罰款                | Number              | 單位元/日                      |
| awarded_vendor          | 承包商（得標）          | Text                |                                |
| construction_period     | 工程期限                | Text                |                                |
| payment_terms           | 付款辦法                | Text                |                                |
| resolution_vendor       | 決議議價對象            | Text                |                                |
| resolution_amount_taxed | 決議承包金額（含稅）    | Number              | 中文大寫→阿拉伯，見規則③       |
| resolution_period       | 議價結果－工程期限      | Text                |                                |
| resolution_payment      | 議價結果－付款方式      | Text                |                                |
| resolution_attachment   | 工程附件                | Text                |                                |
| approval_note           | 核示事項                | Text                |                                |
| cc_department           | 敬會                    | Multi-select        | JSON 陣列字串                  |
| sign_chairman           | 董事長簽核              | Checkbox            | `__YES__`/`__NO__`             |
| sign_vice_chairman      | 副董事長簽核            | Checkbox            |                                |
| sign_gm                 | 總經理簽核              | Checkbox            |                                |
| sign_eng_vp             | 工程部－副總簽核        | Checkbox            |                                |
| sign_eng_manager        | 工程部－經理簽核        | Checkbox            |                                |
| sign_eng_staff          | 工程部－經辦人簽核      | Checkbox            |                                |
| sign_proc_vp            | 採購發包部－副總簽核    | Checkbox            |                                |
| sign_proc_accountant    | 採購發包部－會計簽核    | Checkbox            |                                |
| sign_proc_staff         | 採購發包部－經辦人簽核  | Checkbox            | 常為手寫簽名                   |
| needs_review            | 待複核欄位清單          | Text                | 換行條列                       |
| source_image            | 原始影像                | File                | 手動上傳，腳本不填             |
| status                  | 處理狀態                | Status              | 待辨識/待人工複核/已確認可呈核 |
| vendor_relation         | 廠商比價明細            | Relation → 34aae1a0 | 建立列後回填                   |

### 廠商表（`34aae1a0`）

| field_key            | Notion 欄位        | 型別                |
| -------------------- | ------------------ | ------------------- |
| vendor_name          | 廠商名稱           | Title               |
| vendor_owner         | 負責人             | Text                |
| vendor_address       | 地址               | Text                |
| vendor_phone         | 電話               | Phone               |
| vendor_tax_id        | 統一編號           | Text                |
| bid_price_untaxed    | 標（議）價（未稅） | Number              |
| parent_case_relation | 所屬呈核案件       | Relation → 07084bda |

## 六項轉換／驗證規則（`build_payload.py` 已實作）

1. **民國年→西元**：民國 + 1911。時間午時→AM/PM 轉 ISO 8601（`YYYY-MM-DDThh:mm:00`）。無時間只回日期。
2. **千分位**：金額欄去逗號轉整數（`66,667` → `66667`）。
3. **中文大寫→阿拉伯**：`resolution_amount_taxed` 支援 壹貳參…拾佰仟萬億；轉換後**必列入 needs_review** 供人確認。
4. **金額交叉驗證**：`營業稅 = 未稅×5%`、`合計 = 未稅+稅`、`含稅結算 == 決議金額`。缺值自動補算並記 warning；不符則記 warning + needs_review。容差 ±1 元（四捨五入）。
5. **統一編號**：`^\d{8}$`，否則列入 needs_review。
6. **信心門檻**：`_confidence[field] < 0.85` → needs_review。

## ⚠️ 強制人工複核 gate（不可繞過）

手寫來源欄位（工地名稱、工程項目、開標時間、決議金額、廠商資訊、各簽名）辨識準確度有限。
**`needs_review` 非空 → 處理狀態必為「待人工複核」**，這些案件**必須完成人工複核才能進入呈核／對帳流程**。
`build_payload.py` 強制此 gate，agent 不得手動改寫 status 略過。

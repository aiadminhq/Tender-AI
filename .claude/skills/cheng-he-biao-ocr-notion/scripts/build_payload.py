#!/usr/bin/env python3
"""結構化 JSON → Notion 注入 payload（確定性轉換 + 驗證 + 複核 gate）。

輸入：agent 依 references/field-spec.md 的 JSON 樣板從 OCR markdown 填出的
      結構化檔（見 --help 的範例）。可另帶：
        "_confidence": { "<field_key>": 0.0~1.0 }   # 各欄辨識信心
        "needs_review": ["人工已標記的項目", ...]      # agent 先塞的複核項

本腳本負責「不該交給 LLM 隨機發揮」的部分：
  1. 千分位處理：金額欄去逗號轉數值。
  2. 民國年→西元：bid_datetime 轉 ISO 8601（午時→AM/PM）。
  3. 中文大寫數字→阿拉伯數字：resolution_amount_taxed。
  4. 金額交叉驗證：稅=未稅×5%、合計=未稅+稅、含稅結算=決議金額。
  5. 統一編號驗證：^\\d{8}$。
  6. 複核 gate：信心<0.85 或驗證不符或手寫欄 → 併入 needs_review；
     needs_review 非空 → status=待人工複核，禁止直接進呈核/對帳流程。

輸出（stdout，JSON）：
  { "main": {...Notion 主表 payload...},
    "vendors": [ {...Notion 廠商 payload...}, ... ],
    "status": "待人工複核" | "已確認可呈核",
    "needs_review": [...],
    "warnings": [...] }

用法：python build_payload.py <結構化.json>   > payload.json
      python build_payload.py --demo             # 印出輸入樣板
"""
import json
import re
import sys

CONF_THRESHOLD = 0.85

# field_key（英文） → 資料庫中文欄位名（與線上 schema 完全一致）
MAIN_MAP = {
    "site_name": "工地名稱",
    "doc_type": "表單類型",
    "project_item": "工程項目",
    "bid_location": "開標地點",
    # bid_datetime 走 date:開標時間:* 展開格式，單獨處理
    "sales_tax": "營業稅5%",
    "total_amount": "合計",
    "budget_amount": "預算金額",
    "contract_amount": "合約金額",
    "final_amount_taxed": "（含稅）總金額結算",
    "saving_percent": "節省%",
    "over_budget_percent": "與預算金額比較（超出%）",
    "overdue_penalty": "逾期罰款",
    "awarded_vendor": "承包商（得標）",
    "construction_period": "工程期限",
    "payment_terms": "付款辦法",
    "resolution_vendor": "決議議價對象",
    "resolution_amount_taxed": "決議承包金額（含稅）",
    "resolution_period": "議價結果－工程期限",
    "resolution_payment": "議價結果－付款方式",
    "resolution_attachment": "工程附件",
    "approval_note": "核示事項",
}
SIGN_MAP = {
    "sign_chairman": "董事長簽核",
    "sign_vice_chairman": "副董事長簽核",
    "sign_gm": "總經理簽核",
    "sign_eng_vp": "工程部－副總簽核",
    "sign_eng_manager": "工程部－經理簽核",
    "sign_eng_staff": "工程部－經辦人簽核",
    "sign_proc_vp": "採購發包部－副總簽核",
    "sign_proc_accountant": "採購發包部－會計簽核",
    "sign_proc_staff": "採購發包部－經辦人簽核",
}
VENDOR_MAP = {
    "vendor_name": "廠商名稱",
    "vendor_owner": "負責人",
    "vendor_address": "地址",
    "vendor_phone": "電話",
    "vendor_tax_id": "統一編號",
    "bid_price_untaxed": "標（議）價（未稅）",
}
NUMERIC_FIELDS = {
    "sales_tax", "total_amount", "budget_amount", "final_amount_taxed",
    "saving_percent", "over_budget_percent", "overdue_penalty",
    "resolution_amount_taxed", "bid_price_untaxed",
}
# 手寫來源、辨識難度高，值非空但信心不明時預設併入複核
HANDWRITTEN_FIELDS = {
    "site_name", "project_item", "bid_datetime",
    "vendor_name", "vendor_owner", "vendor_address",
    "resolution_vendor", "resolution_amount_taxed",
}

_CN_DIGIT = {
    "零": 0, "〇": 0, "一": 1, "壹": 1, "二": 2, "貳": 2, "兩": 2,
    "三": 3, "參": 3, "叁": 3, "叄": 3, "四": 4, "肆": 4, "五": 5, "伍": 5,
    "六": 6, "陸": 6, "七": 7, "柒": 7, "八": 8, "捌": 8, "九": 9, "玖": 9,
}
_CN_UNIT = {"十": 10, "拾": 10, "百": 100, "佰": 100, "千": 1000, "仟": 1000}
_CN_BIG = {"萬": 10000, "万": 10000, "億": 100000000, "亿": 100000000}


def cn2num(s: str):
    """中文（含大寫）數字字串 → int；無法解析回 None。純阿拉伯直接回。"""
    s = s.strip()
    if re.fullmatch(r"[\d,]+", s):
        return int(s.replace(",", ""))
    total, section, number = 0, 0, 0
    for ch in s:
        if ch in _CN_DIGIT:
            number = _CN_DIGIT[ch]
        elif ch in _CN_UNIT:
            section += (number or 1) * _CN_UNIT[ch]
            number = 0
        elif ch in _CN_BIG:
            section = (section + number) * _CN_BIG[ch]
            total += section
            section = number = 0
        else:
            continue  # 略過「元整」「$」等雜字
    result = total + section + number
    return result if result else None


def to_number(v):
    """去千分位/雜字後轉數值；失敗回 None。"""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return v
    s = str(v).strip().replace(",", "")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return None
    num = float(m.group())
    return int(num) if num.is_integer() else num


def minguo_to_iso(v):
    """民國「115/08/26」或「115年8月26日 上午10時」→ (iso, is_datetime)。
    無法解析回 (None, 0)。"""
    if not v:
        return None, 0
    s = str(v)
    m = re.search(r"(\d{2,3})[/年.\-]\s*(\d{1,2})[/月.\-]\s*(\d{1,2})", s)
    if not m:
        return None, 0
    year = int(m.group(1)) + 1911
    month, day = int(m.group(2)), int(m.group(3))
    tm = re.search(r"(\d{1,2})\s*[:時]\s*(\d{0,2})", s)
    if tm:
        hour = int(tm.group(1))
        minute = int(tm.group(2)) if tm.group(2) else 0
        if ("下午" in s or "PM" in s.upper()) and hour < 12:
            hour += 12
        if ("上午" in s or "AM" in s.upper()) and hour == 12:
            hour = 0
        return f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:00", 1
    return f"{year:04d}-{month:02d}-{day:02d}", 0


DEMO = {
    "doc_type": "發包開標議價結果呈核表",
    "header": {"site_name": "", "project_item": "", "bid_location": "惠強辦公室", "bid_datetime": ""},
    "vendors": [{"vendor_name": "", "vendor_owner": "", "vendor_address": "",
                 "vendor_phone": "", "vendor_tax_id": "", "bid_price_untaxed": None}],
    "amounts": {"sales_tax": None, "total_amount": None, "budget_amount": None,
                "contract_amount": "實作實算", "final_amount_taxed": None,
                "saving_percent": None, "over_budget_percent": None, "overdue_penalty": None},
    "award": {"awarded_vendor": "", "construction_period": "配合現場施工完成", "payment_terms": ""},
    "resolution": {"resolution_vendor": "", "resolution_amount_taxed": None,
                   "resolution_period": "配合現場施工完成", "resolution_payment": "",
                   "resolution_attachment": "詳附估價單", "approval_note": "擬請層峰核示，准予合約用印",
                   "cc_department": ["財務部"]},
    "signatures": {k: False for k in SIGN_MAP},
    "_confidence": {},
    "needs_review": [],
}


def flat(doc):
    """把巢狀樣板攤平成 {field_key: value}。"""
    out = {"doc_type": doc.get("doc_type")}
    for sect in ("header", "amounts", "award", "resolution", "signatures"):
        out.update(doc.get(sect, {}))
    return out


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "--demo":
        print(json.dumps(DEMO, ensure_ascii=False, indent=2))
        return

    doc = json.loads(open(sys.argv[1], encoding="utf-8").read())
    conf = doc.get("_confidence", {})
    review = list(doc.get("needs_review", []))
    warnings = []
    f = flat(doc)

    def flag(field, msg):
        if msg not in review:
            review.append(msg)

    # 信心門檻
    for k, c in conf.items():
        if isinstance(c, (int, float)) and c < CONF_THRESHOLD:
            flag(k, f"{k} 辨識信心 {c:.2f} < {CONF_THRESHOLD}，需人工複核")

    # 數值化（千分位）
    nums = {}
    for k in NUMERIC_FIELDS:
        v = f.get(k)
        if v not in (None, ""):
            nums[k] = to_number(v)

    # 中文大寫 → 決議金額
    ra = f.get("resolution_amount_taxed")
    if isinstance(ra, str) and ra and not re.fullmatch(r"[\d,]+", ra.strip()):
        conv = cn2num(ra)
        if conv is not None:
            nums["resolution_amount_taxed"] = conv
            warnings.append(f"決議金額中文大寫「{ra}」→ {conv}（請人工確認）")
            flag("resolution_amount_taxed", f"決議金額由中文大寫推導：{ra} → {conv}")

    # 交叉驗證
    untaxed = nums.get("bid_price_untaxed")
    if untaxed is not None:
        exp_tax = round(untaxed * 0.05)
        if nums.get("sales_tax") is None:
            nums["sales_tax"] = exp_tax
            warnings.append(f"營業稅缺值，自動補 {exp_tax}（未稅×5%）")
        elif abs(nums["sales_tax"] - exp_tax) > 1:
            warnings.append(f"營業稅 {nums['sales_tax']} ≠ 未稅×5% {exp_tax}，異常")
            flag("sales_tax", "營業稅與未稅×5% 不符")
        exp_total = untaxed + (nums.get("sales_tax") or 0)
        if nums.get("total_amount") is None:
            nums["total_amount"] = exp_total
            warnings.append(f"合計缺值，自動補 {exp_total}（未稅+稅）")
        elif abs(nums["total_amount"] - exp_total) > 1:
            warnings.append(f"合計 {nums['total_amount']} ≠ 未稅+稅 {exp_total}，異常")
            flag("total_amount", "合計與未稅+稅 不符")
    fin = nums.get("final_amount_taxed")
    res = nums.get("resolution_amount_taxed")
    if fin is not None and res is not None and abs(fin - res) > 1:
        warnings.append(f"含稅結算 {fin} ≠ 決議金額 {res}，異常")
        flag("final_amount_taxed", "含稅結算與決議金額不符")

    # 民國年 → 西元
    iso, is_dt = minguo_to_iso(f.get("bid_datetime"))
    if f.get("bid_datetime") and iso is None:
        flag("bid_datetime", f"開標時間「{f.get('bid_datetime')}」無法解析為日期")

    # 統一編號
    for i, v in enumerate(doc.get("vendors", [])):
        tid = str(v.get("vendor_tax_id") or "").strip()
        if tid and not re.fullmatch(r"\d{8}", tid):
            flag(f"vendors[{i}].vendor_tax_id", f"統一編號「{tid}」非 8 碼數字")

    # 手寫欄非空但無信心資料 → 保守併入複核（除非 agent 已明確標高信心）
    for k in HANDWRITTEN_FIELDS:
        val = f.get(k)
        if k.startswith("vendor") or k == "bid_datetime":
            continue
        if val not in (None, "") and k not in conf:
            flag(k, f"{k} 為手寫來源，建議人工複核")

    # ---- 組 Notion 主表 payload ----
    main_props = {}
    for k, col in MAIN_MAP.items():
        if k in NUMERIC_FIELDS:
            if nums.get(k) is not None:
                main_props[col] = nums[k]
        else:
            val = f.get(k)
            if val not in (None, ""):
                main_props[col] = val
    # 日期展開格式
    if iso:
        main_props["date:開標時間:start"] = iso
        main_props["date:開標時間:is_datetime"] = is_dt
    # checkbox
    for k, col in SIGN_MAP.items():
        main_props[col] = "__YES__" if f.get(k) else "__NO__"
    # multi-select 敬會（JSON 陣列字串）
    cc = doc.get("resolution", {}).get("cc_department") or []
    if cc:
        main_props["敬會"] = json.dumps(cc, ensure_ascii=False)
    # 複核清單（換行條列，人眼可讀）
    if review:
        main_props["待複核欄位清單"] = "\n".join(f"• {r}" for r in review)
    status = "待人工複核" if review else "已確認可呈核"
    main_props["處理狀態"] = status

    # ---- 組廠商 payload ----
    vendors_out = []
    for v in doc.get("vendors", []):
        vp = {}
        for k, col in VENDOR_MAP.items():
            val = v.get(k)
            if k == "bid_price_untaxed":
                n = to_number(val)
                if n is not None:
                    vp[col] = n
            elif val not in (None, ""):
                vp[col] = val
        if vp:
            vendors_out.append(vp)

    print(json.dumps({
        "main": main_props,
        "vendors": vendors_out,
        "status": status,
        "needs_review": review,
        "warnings": warnings,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

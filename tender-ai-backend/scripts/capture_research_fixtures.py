# -*- coding: utf-8 -*-
"""一次性 Gate fixture 抓取（read-only GET）：進階查詢列表 + 一筆詳情頁。

用既有受治理連線（app.adapters._pcc_http）抓取，存到 tests/fixtures/，
供 backend agent 離線解析。不寫 DB、不改既有邏輯。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.adapters._pcc_http import governed_get, pcc_session  # noqa: E402

FIX = Path(__file__).resolve().parents[1] / "tests" / "fixtures"

TAIPEI = (
    "https://web.pcc.gov.tw/prkms/tender/common/advanced/readTenderAdvanced"
    "?pageSize=50&firstSearch=true&searchType=advanced&isBinding=N&isLogIn=N"
    "&level_1=on&orgName=&orgId=&tenderName=&tenderId=&tenderType=TENDER_DECLARATION"
    "&tenderWay=TENDER_WAY_ALL_DECLARATION&dateType=isNow"
    "&tenderStartDate=2026%2F06%2F18&tenderEndDate=2026%2F06%2F18"
    "&spdtStartDate=&spdtEndDate=&opdtStartDate=&opdtEndDate="
    "&tenderYmStartY=&tenderYmStartM=&tenderYmEndY=&tenderYmEndM="
    "&radProctrgCate=&tenderRange=TENDER_RANGE_3&minBudget=&maxBudget=50%2C000%2C000"
    "&execLocation=EXECUTE_LOCATION_2&location=&priorityCate=&radReConstruct="
    "&policyAdvocacy=&isCpp="
)


def main() -> None:
    FIX.mkdir(parents=True, exist_ok=True)
    session = pcc_session()
    resp = governed_get(session, TAIPEI)
    out = FIX / "pcc_list_taipei.html"
    out.write_text(resp.text, encoding="utf-8")
    print(f"saved {out} ({len(resp.text)} bytes, status={resp.status_code})")


if __name__ == "__main__":
    main()

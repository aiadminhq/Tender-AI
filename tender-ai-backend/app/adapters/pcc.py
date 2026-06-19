# -*- coding: utf-8 -*-
"""PCC 政府電子採購網 adapter:進階查詢列表全抓 + 詳情頁 enrich。

詳情頁 URL 以「案件 PK 的 base64」當 ``pkPmsMain`` token(與 ``report_parser.decode_pcc_pk``
互逆)。``fetch_detail`` 取回原始 HTML,並在 fetch 階段廉價抽出新增公告傳輸次數
(``source_revision_key``),供 enrich job 變更偵測輔助。

**進階查詢全抓**(研究資料蒐集):以使用者提供的 ``readTenderAdvanced`` URL(各縣市
僅 ``execLocation`` 不同)取回列表,抽出每筆 ``tpam?pk=<token>`` —— 該 token 即
``base64(case_pk)``,與詳情 URL 同源,解碼後 = case_pk。**程式碼不再過濾**(地點/預算
已在 URL 內),只去重 pk;未來加縣市僅需在 ``EXEC_LOCATIONS`` 增一碼。
"""
from __future__ import annotations

import base64
import re
from datetime import datetime, timezone

from bs4 import BeautifulSoup

from app.adapters._pcc_http import governed_get, pcc_session
from app.adapters.base import FetchResult, SourceAdapter
from app.services.detail_parser import extract_source_revision_key
from app.services.report_parser import decode_pcc_pk


class PCCAdapter(SourceAdapter):
    source_name = "PCC"
    base_url = "https://web.pcc.gov.tw"
    supports_detail_enrich = True

    # 詳情頁查詢路徑;pkPmsMain = 案件 PK 的 base64 token
    _DETAIL_PATH = "/tps/QueryTender/query/searchTenderDetail?pkPmsMain="

    # 進階查詢路徑
    _ADVANCED_PATH = "/prkms/tender/common/advanced/readTenderAdvanced"

    # 縣市 → execLocation 代碼;加縣市只需在此增一筆(符合「≥4 站客製化」延伸)
    EXEC_LOCATIONS: dict[str, str] = {
        "台北市": "EXECUTE_LOCATION_2",
        "新北市": "EXECUTE_LOCATION_20000200",
    }

    # 進階查詢 query template:除 execLocation / 日期外,其餘為使用者提供之過濾條件字面值
    # (招標公告、預算上限 50,000,000、tenderRange=3…);**不可在程式碼再過濾**。
    _ADVANCED_QUERY = (
        "pageSize=50&firstSearch=true&searchType=advanced&isBinding=N&isLogIn=N"
        "&level_1=on&orgName=&orgId=&tenderName=&tenderId=&tenderType=TENDER_DECLARATION"
        "&tenderWay=TENDER_WAY_ALL_DECLARATION&dateType=isNow"
        "&tenderStartDate={start}&tenderEndDate={end}"
        "&spdtStartDate=&spdtEndDate=&opdtStartDate=&opdtEndDate="
        "&tenderYmStartY=&tenderYmStartM=&tenderYmEndY=&tenderYmEndM="
        "&radProctrgCate=&tenderRange=TENDER_RANGE_3&minBudget=&maxBudget=50%2C000%2C000"
        "&execLocation={loc}&location=&priorityCate=&radReConstruct="
        "&policyAdvocacy=&isCpp="
    )

    # 列表結果表的 detail 連結:/prkms/urlSelector/common/tpam?pk=<base64(case_pk)>
    _LIST_PK_RE = re.compile(r"/prkms/urlSelector/common/tpam\?pk=([^&\"'\s]+)")

    def detail_url(self, case_pk: str) -> str:
        token = base64.b64encode(str(case_pk).encode("ascii")).decode("ascii")
        return f"{self.base_url}{self._DETAIL_PATH}{token}"

    # ------------------------------------------------------------------ #
    # 進階查詢列表全抓
    # ------------------------------------------------------------------ #
    def advanced_list_url(self, exec_location: str, start: str, end: str) -> str:
        """組進階查詢 URL;``start``/``end`` 為 ``YYYY/MM/DD``(會 URL-encode 斜線)。"""
        s, e = start.replace("/", "%2F"), end.replace("/", "%2F")
        query = self._ADVANCED_QUERY.format(start=s, end=e, loc=exec_location)
        return f"{self.base_url}{self._ADVANCED_PATH}?{query}"

    @classmethod
    def parse_list_case_pks(cls, html: str | None) -> list[str]:
        """從進階查詢列表 HTML 抽 case_pk(解碼 tpam pk token,去重保序)。

        純函式、不連網。掃描結果表 ``#tpam`` 內的 ``tpam?pk=`` 連結;找不到該表時
        退而掃整頁(防御)。**不過濾**,只去重。
        """
        if not html:
            return []
        soup = BeautifulSoup(html, "lxml")
        scope = soup.select_one("table#tpam") or soup
        seen: list[str] = []
        for a in scope.find_all("a", href=True):
            m = cls._LIST_PK_RE.search(a["href"])
            if not m:
                continue
            case_pk = decode_pcc_pk(m.group(1))
            if case_pk not in seen:
                seen.append(case_pk)
        return seen

    def fetch_list_case_pks(self, exec_location: str, start: str, end: str) -> list[str]:
        """連網抓某縣市某日的進階查詢列表 → 回 case_pk 清單(去重保序,不過濾)。"""
        url = self.advanced_list_url(exec_location, start, end)
        session = pcc_session()
        resp = governed_get(session, url)
        return self.parse_list_case_pks(resp.text)

    def fetch_detail(self, case_pk: str) -> FetchResult:
        url = self.detail_url(case_pk)
        session = pcc_session()
        resp = governed_get(session, url)
        raw = resp.text
        return FetchResult(
            source_name=self.source_name,
            source_url=url,
            status_code=resp.status_code,
            content_type=resp.headers.get("Content-Type"),
            raw_content=raw,
            fetched_at=datetime.now(timezone.utc),
            source_revision_key=extract_source_revision_key(raw),
        )

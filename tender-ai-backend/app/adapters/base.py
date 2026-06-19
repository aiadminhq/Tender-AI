# -*- coding: utf-8 -*-
"""來源 adapter 抽象層：``FetchResult`` 契約 + ``SourceAdapter`` ABC。

把「抓取(transport)」與「解析(parser)」「持久化(job)」徹底分離：adapter 只負責
取回原始內容並回報 ``FetchResult``;解析交給 ``detail_parser``、持久化交給 enrich job。
capability 旗標 ``supports_detail_enrich`` 讓 job 能只挑支援詳情 enrich 的來源。
"""
from __future__ import annotations

from abc import ABC
from dataclasses import dataclass
from datetime import datetime


@dataclass
class FetchResult:
    """單次抓取結果(原始內容 + 抓取中繼資料);不含解析後欄位。

    ``source_revision_key`` 為來源側版本標記(PCC=新增公告傳輸次數),adapter 在
    fetch 階段廉價取得,供 job 變更偵測輔助(fallback 仍以 content_hash 為準)。
    """

    source_name: str
    source_url: str
    status_code: int
    content_type: str | None
    raw_content: str
    fetched_at: datetime
    source_revision_key: str | None = None


class SourceAdapter(ABC):
    """資料來源 adapter 介面。

    子類別以類別屬性宣告 ``source_name`` / ``base_url`` / ``supports_detail_enrich``;
    支援詳情 enrich 者覆寫 ``detail_url`` 與 ``fetch_detail``。
    """

    source_name: str = ""
    base_url: str = ""
    supports_detail_enrich: bool = False

    def detail_url(self, case_pk: str) -> str:
        """組出該案的詳情頁 URL;不支援者 raise。"""
        raise NotImplementedError(f"{self.source_name} 不支援詳情頁 URL")

    def fetch_detail(self, case_pk: str) -> FetchResult:
        """抓取該案詳情頁,回 ``FetchResult``;不支援者 raise。"""
        raise NotImplementedError(f"{self.source_name} 不支援詳情 enrich")

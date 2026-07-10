# -*- coding: utf-8 -*-
"""PCC adapter（Firecrawl 變體）。

繼承 :class:`PCCAdapter`，**只覆寫連網的兩個方法**（`fetch_list_case_pks` /
`fetch_detail`），transport 改走 Firecrawl scrape API（https://github.com/firecrawl/firecrawl，
雲端或 self-host 皆可）；解析（`parse_list_case_pks` / `detail_parser`）與持久層完全沿用。

紅線（與 enriching-pcc-tender-details 技能一致，不可越過）
--------------------------------------------------------
- ``proxy`` **固定 "basic"**：Firecrawl 預設 ``auto`` 會在被擋時自動升級 stealth proxy，
  那屬於「繞過偵測」，本專案禁止。**不得改成 auto/stealth。**
- **不解、不繞過 CAPTCHA**：撞到圖形驗證碼時本 adapter 原樣回傳頁面，由呼叫端以
  ``is_captcha_page`` 辨識後**優雅中止**（graceful abort），與既有 enrich job 同語義。
- ``skipTlsVerification=True`` 僅鏡射既有 ``SkipSSLAdapter``（PCC 憑證鏈不完整），
  不是反偵測手段。

進階查詢語義：與 :class:`PCCOpenCLIAdapter` 相同，改用 ``dateType=isDate``（依公告
日期區間、**西元年**），適合「抓某日的每日清單」；基底的 ``isNow`` 是等標期內查詢。

**絕不在 CI/pytest 連網**：測試一律 monkeypatch ``_scrape`` 回 fixture。
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone

import requests

from app.adapters.base import FetchResult
from app.adapters.pcc import PCCAdapter
from app.services.detail_parser import extract_source_revision_key

DEFAULT_API_URL = "https://api.firecrawl.dev"
DEFAULT_TIMEOUT_S = 90
MAX_RETRIES = 3
BACKOFF_BASE = 2.0  # 指數退避基數（秒）


class FirecrawlError(RuntimeError):
    """Firecrawl API 呼叫失敗（重試耗盡或回應無 rawHtml）。

    ``status_code`` 僅在 401/402/403（金鑰/額度/權限問題，見 ``_scrape``）時設定，
    供呼叫端判斷「是否該切換備援 transport」，不必解析錯誤訊息字串。
    """

    status_code: int | None = None


class PCCFirecrawlAdapter(PCCAdapter):
    """以 Firecrawl scrape API 取原始 HTML 的 PCC adapter。"""

    # 進階查詢：依公告日期區間（isDate）+ 西元年 + 一次取大頁（同 OpenCLI 變體）
    _ADVANCED_QUERY = (
        "pageSize=200&firstSearch=true&searchType=advanced&isBinding=N&isLogIn=N"
        "&level_1=on&orgName=&orgId=&tenderName=&tenderId=&tenderType=TENDER_DECLARATION"
        "&tenderWay=TENDER_WAY_ALL_DECLARATION&dateType=isDate"
        "&tenderStartDate={start}&tenderEndDate={end}"
        "&spdtStartDate=&spdtEndDate=&opdtStartDate=&opdtEndDate="
        "&tenderYmStartY=&tenderYmStartM=&tenderYmEndY=&tenderYmEndM=&radProctrgCate="
        "&tenderRange=TENDER_RANGE_3&minBudget=&maxBudget=50%2C000%2C000"
        "&execLocation={loc}&location=&priorityCate=&radReConstruct="
        "&policyAdvocacy=&isCpp="
    )

    def __init__(
        self,
        *,
        api_key: str | None = None,
        api_url: str | None = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> None:
        self._api_key = api_key or os.environ.get("FIRECRAWL_API_KEY", "")
        self._api_url = (api_url or os.environ.get("FIRECRAWL_API_URL") or DEFAULT_API_URL).rstrip("/")
        if not self._api_key and self._api_url == DEFAULT_API_URL:
            raise RuntimeError("缺 FIRECRAWL_API_KEY（雲端 API 必填；self-host 請設 FIRECRAWL_API_URL）")
        self._timeout = timeout_s

    # ------------------------------------------------------------------ #
    # Firecrawl transport（薄封裝 + 有限重試，鏡射 governed_get 節奏）
    # ------------------------------------------------------------------ #
    def _scrape_payload(self, url: str) -> dict:
        """組 /v2/scrape 請求 body（獨立成純函式以便離線測試鎖住紅線設定）。"""
        return {
            "url": url,
            "formats": ["rawHtml"],
            "onlyMainContent": False,
            # 紅線：固定 basic，不讓 Firecrawl 自動升級 stealth proxy（那是繞過偵測）
            "proxy": "basic",
            # 每日清單/詳情要新鮮內容，不吃 Firecrawl 快取
            "maxAge": 0,
            # 鏡射 SkipSSLAdapter：PCC 憑證鏈不完整
            "skipTlsVerification": True,
            "timeout": int(self._timeout * 1000),
        }

    def _scrape(self, url: str) -> tuple[str, int]:
        """呼叫 Firecrawl /v2/scrape 回 ``(raw_html, status_code)``；重試耗盡則 raise。

        status_code 取 PCC 端回應碼（``metadata.statusCode``），缺漏時以 200 計
        （Firecrawl success 必已取得內容）。
        """
        endpoint = f"{self._api_url}/v2/scrape"
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        last_exc: Exception | None = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = requests.post(
                    endpoint, json=self._scrape_payload(url),
                    headers=headers, timeout=self._timeout + 30,
                )
                resp.raise_for_status()
                body = resp.json()
                data = body.get("data") or {}
                raw = data.get("rawHtml") or data.get("html")
                if not body.get("success") or raw is None:
                    raise FirecrawlError(f"Firecrawl 回應無 rawHtml：{str(body)[:200]}")
                status = int((data.get("metadata") or {}).get("statusCode") or 200)
                return raw, status
            except requests.HTTPError as exc:
                # 401/402/403（金鑰無效/額度用罄/無權限）重試不會變好，立即拋出
                code = exc.response.status_code if exc.response is not None else None
                if code in (401, 402, 403):
                    detail = (exc.response.text or "")[:200] if exc.response is not None else ""
                    err = FirecrawlError(f"Firecrawl API {code}：{detail}")
                    err.status_code = code
                    raise err from exc
                last_exc = exc
                if attempt < MAX_RETRIES:
                    time.sleep(BACKOFF_BASE * (2 ** (attempt - 1)))
            except Exception as exc:  # noqa: BLE001 — 交由呼叫端分類為 crawl_failure
                last_exc = exc
                if attempt < MAX_RETRIES:
                    time.sleep(BACKOFF_BASE * (2 ** (attempt - 1)))
        assert last_exc is not None
        raise last_exc

    # ------------------------------------------------------------------ #
    # 覆寫：進階查詢列表全抓（Firecrawl 版；解析沿用基底純函式）
    # ------------------------------------------------------------------ #
    def fetch_list_case_pks(self, exec_location: str, start: str, end: str) -> list[str]:
        """抓某縣市「公告日期 start–end（西元 YYYY/MM/DD）」列表 → case_pk 清單。"""
        url = self.advanced_list_url(exec_location, start, end)
        raw, _ = self._scrape(url)
        return self.parse_list_case_pks(raw)

    # ------------------------------------------------------------------ #
    # 覆寫：詳情頁抓取（Firecrawl 版；CAPTCHA 原樣回傳，由呼叫端優雅中止）
    # ------------------------------------------------------------------ #
    def fetch_detail(self, case_pk: str) -> FetchResult:
        url = self.detail_url(case_pk)
        raw, status = self._scrape(url)
        return FetchResult(
            source_name=self.source_name,
            source_url=url,
            status_code=status,
            content_type="text/html; charset=utf-8",
            raw_content=raw,
            fetched_at=datetime.now(timezone.utc),
            source_revision_key=extract_source_revision_key(raw),
        )

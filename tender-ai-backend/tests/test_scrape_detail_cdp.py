# -*- coding: utf-8 -*-
"""方案 B(CDP attach)詳情抓取的離線測試。

全程**不連網、不連真 Chrome、不連 DB**:以 fake CDPClient 注入 fixture HTML,
驗證:
1) 正常詳情頁 → ``FetchResult`` 可被既有 ``parse_pcc_detail`` 正確解析。
2) CAPTCHA 頁 → ``FetchResult`` 仍成立(200/html),且 ``is_captcha_page`` 命中
   (對齊 enrich job 把 CAPTCHA 歸為可重試的分流前提)。
3) CDP 連線失敗 → 清楚的 ``CDPError``(訊息含啟動指引)。
4) detail_url token 仍由既有 ``PCCAdapter`` 組(不重造)。
5) 批次 ``fetch_many`` 重用單一連線、回每案 ``FetchResult``。

重用 tests/fixtures/ 既有 PCC 詳情 fixtures(與 detail_parser / adapters 測試同源)。
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.adapters.base import FetchResult
from app.adapters.pcc import PCCAdapter
from app.jobs.scrape_detail_cdp import (
    CDPDetailScraper,
    CDPError,
    build_fetch_result,
)
from app.services.detail_parser import is_captcha_page, parse_pcc_detail

FIX = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


# --------------------------------------------------------------------------- #
# Fake CDP client:不連網,fetch_html 回預設 fixture / 依 url 路由
# --------------------------------------------------------------------------- #
class _FakeCDPClient:
    """假 CDPClient:記錄連線/導航,fetch_html 回注入的 HTML。"""

    def __init__(self, html: str, *, fail_on_connect: bool = False):
        self._html = html
        self._fail_on_connect = fail_on_connect
        self.connected = False
        self.closed = False
        self.navigated_urls: list[str] = []

    async def connect(self) -> None:
        if self._fail_on_connect:
            raise CDPError("無法連到 Chrome CDP(127.0.0.1:9222/json):Connection refused。")
        self.connected = True

    async def fetch_html(self, url: str) -> str:
        self.navigated_urls.append(url)
        return self._html

    async def close(self) -> None:
        self.closed = True


def _scraper_with(html: str, **kw) -> CDPDetailScraper:
    client = _FakeCDPClient(html, **kw)
    return CDPDetailScraper(client_factory=lambda: client), client


# --------------------------------------------------------------------------- #
# 1) 正常詳情頁 → FetchResult 可解析
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_fetch_detail_full_parses():
    full = _load("pcc_detail_full.html")
    scraper, client = _scraper_with(full)

    async with scraper as s:
        fr = await s.fetch_detail("71248861", now=datetime(2026, 6, 22, tzinfo=timezone.utc))

    assert isinstance(fr, FetchResult)
    assert fr.source_name == "PCC"
    assert fr.status_code == 200
    assert "text/html" in fr.content_type
    assert fr.raw_content == full
    # source_revision_key 由既有 extract_source_revision_key 抽出(full fixture = "01")
    assert fr.source_revision_key == "01"
    # 連線/關閉生命週期正確
    assert client.connected is True
    assert client.closed is True
    # detail_url 由既有 PCCAdapter 組(base64 token)
    assert fr.source_url.endswith("NzEyNDg4NjE=")

    # 走既有純函式解析器 → 型別欄正確(證明與 enrich 流程相容)
    parsed = parse_pcc_detail(fr.raw_content)
    assert parsed is not None
    assert parsed.deposit_required is True


# --------------------------------------------------------------------------- #
# 2) CAPTCHA 頁 → FetchResult 成立且 is_captcha_page 命中
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_fetch_detail_captcha_detected():
    captcha = _load("pcc_detail_captcha.html")
    scraper, _ = _scraper_with(captcha)

    async with scraper as s:
        fr = await s.fetch_detail("71248861")

    assert fr.status_code == 200
    assert "text/html" in fr.content_type
    # CAPTCHA 頁無有效欄位 → 無 revision key
    assert fr.source_revision_key is None
    # 既有偵測命中 → enrich job 會歸為可重試 captcha 分流
    assert is_captcha_page(fr.raw_content) is True
    assert parse_pcc_detail(fr.raw_content) is None


# --------------------------------------------------------------------------- #
# 3) CDP 連線失敗 → 清楚 CDPError
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_connect_failure_raises_cdp_error():
    scraper, _ = _scraper_with("", fail_on_connect=True)
    with pytest.raises(CDPError) as ei:
        async with scraper:
            pass
    assert "CDP" in str(ei.value)


@pytest.mark.asyncio
async def test_fetch_before_connect_raises():
    scraper, _ = _scraper_with(_load("pcc_detail_full.html"))
    # 未進入 async context(未 connect)→ 清楚錯誤
    with pytest.raises(CDPError):
        await scraper.fetch_detail("71248861")


# --------------------------------------------------------------------------- #
# 4) build_fetch_result 純函式形狀(對齊 PCCAdapter.fetch_detail)
# --------------------------------------------------------------------------- #
def test_build_fetch_result_shape_matches_adapter():
    full = _load("pcc_detail_full.html")
    url = PCCAdapter().detail_url("71248861")
    fr = build_fetch_result(case_pk="71248861", url=url, html=full)
    assert isinstance(fr, FetchResult)
    assert fr.source_name == PCCAdapter.source_name
    assert fr.status_code == 200
    assert fr.source_url == url
    assert fr.source_revision_key == "01"
    assert isinstance(fr.fetched_at, datetime)


def test_build_fetch_result_invalid_page_no_revision_key():
    invalid = _load("pcc_detail_invalid.html")
    fr = build_fetch_result(case_pk="X", url="http://x", html=invalid)
    assert fr.source_revision_key is None
    assert parse_pcc_detail(fr.raw_content) is None


# --------------------------------------------------------------------------- #
# 5) 批次 fetch_many 重用單一連線
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_fetch_many_reuses_single_connection():
    full = _load("pcc_detail_full.html")
    client = _FakeCDPClient(full)
    scraper = CDPDetailScraper(client_factory=lambda: client)

    async with scraper as s:
        results = await s.fetch_many(["71248861", "71248862"], rate_limit_s=0.0)

    assert set(results) == {"71248861", "71248862"}
    assert all(isinstance(fr, FetchResult) for fr in results.values())
    # 同一連線抓兩案(兩次導航)
    assert len(client.navigated_urls) == 2
    assert client.connected is True and client.closed is True

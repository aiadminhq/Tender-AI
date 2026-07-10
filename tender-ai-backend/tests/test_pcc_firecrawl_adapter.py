# -*- coding: utf-8 -*-
"""PCCFirecrawlAdapter 離線測試：全程不連網，monkeypatch `_scrape` 回 fixture。"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.adapters.base import FetchResult
from app.adapters.pcc_firecrawl import PCCFirecrawlAdapter
from app.services.detail_parser import is_captcha_page

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture()
def adapter() -> PCCFirecrawlAdapter:
    # 顯式給 api_key，避免測試環境依賴 .env / 環境變數
    return PCCFirecrawlAdapter(api_key="test-key")


def test_init_requires_key_for_cloud(monkeypatch):
    monkeypatch.delenv("FIRECRAWL_API_KEY", raising=False)
    monkeypatch.delenv("FIRECRAWL_API_URL", raising=False)
    with pytest.raises(RuntimeError, match="FIRECRAWL_API_KEY"):
        PCCFirecrawlAdapter()
    # self-host（自訂 api_url）不強制 key
    PCCFirecrawlAdapter(api_url="http://localhost:3002")


def test_scrape_payload_locks_red_lines(adapter):
    """紅線鎖死：proxy=basic（不得 auto/stealth）、rawHtml、不吃快取。"""
    payload = adapter._scrape_payload("https://web.pcc.gov.tw/x")
    assert payload["proxy"] == "basic"
    assert payload["formats"] == ["rawHtml"]
    assert payload["maxAge"] == 0
    assert payload["skipTlsVerification"] is True
    assert payload["url"] == "https://web.pcc.gov.tw/x"


def test_advanced_query_uses_isdate(adapter):
    url = adapter.advanced_list_url("EXECUTE_LOCATION_2", "2026/07/03", "2026/07/03")
    assert "dateType=isDate" in url
    assert "tenderStartDate=2026%2F07%2F03" in url
    assert "pageSize=200" in url


def test_fetch_list_case_pks_reuses_base_parser(adapter, monkeypatch):
    html = (FIX / "pcc_list_taipei.html").read_text(encoding="utf-8")
    seen_urls: list[str] = []

    def fake_scrape(url: str) -> tuple[str, int]:
        seen_urls.append(url)
        return html, 200

    monkeypatch.setattr(adapter, "_scrape", fake_scrape)
    pks = adapter.fetch_list_case_pks("EXECUTE_LOCATION_2", "2026/07/03", "2026/07/03")
    assert pks == adapter.parse_list_case_pks(html)
    assert len(pks) == len(set(pks))  # 去重
    assert pks  # fixture 內確實有案
    assert "readTenderAdvanced" in seen_urls[0]


def test_fetch_detail_shape(adapter, monkeypatch):
    html = (FIX / "pcc_detail_full.html").read_text(encoding="utf-8")
    monkeypatch.setattr(adapter, "_scrape", lambda url: (html, 200))
    result = adapter.fetch_detail("52009999")
    assert isinstance(result, FetchResult)
    assert result.source_name == "PCC"
    assert result.status_code == 200
    assert result.raw_content == html
    assert "pkPmsMain=" in result.source_url
    assert result.fetched_at is not None


def test_fetch_detail_captcha_passthrough(adapter, monkeypatch):
    """撞 CAPTCHA：adapter 原樣回傳頁面，不重試、不繞過，由呼叫端優雅中止。"""
    html = (FIX / "pcc_detail_captcha.html").read_text(encoding="utf-8")
    calls = {"n": 0}

    def fake_scrape(url: str) -> tuple[str, int]:
        calls["n"] += 1
        return html, 200

    monkeypatch.setattr(adapter, "_scrape", fake_scrape)
    result = adapter.fetch_detail("52009999")
    assert is_captcha_page(result.raw_content)
    assert calls["n"] == 1  # 不因 captcha 加抓


def test_scrape_no_retry_on_payment_required(adapter, monkeypatch):
    """401/402/403 立即拋 FirecrawlError，不做退避重試。"""
    import requests as req

    import app.adapters.pcc_firecrawl as mod

    calls = {"n": 0}

    class FakeResp:
        status_code = 402
        text = '{"success":false,"error":"Insufficient credits"}'

        def raise_for_status(self):
            raise req.HTTPError("402 Client Error", response=self)

    def fake_post(*a, **kw):
        calls["n"] += 1
        return FakeResp()

    monkeypatch.setattr(mod.time, "sleep", lambda s: None)
    monkeypatch.setattr(mod.requests, "post", fake_post)
    with pytest.raises(mod.FirecrawlError, match="402") as exc_info:
        adapter._scrape("https://web.pcc.gov.tw/x")
    assert exc_info.value.status_code == 402
    assert calls["n"] == 1


def test_scrape_raises_on_missing_rawhtml(adapter, monkeypatch):
    """Firecrawl 回應缺 rawHtml → 重試耗盡後 raise（不做無聲降級）。"""
    import app.adapters.pcc_firecrawl as mod

    class FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"success": True, "data": {}}

    monkeypatch.setattr(mod.time, "sleep", lambda s: None)  # 免等退避
    monkeypatch.setattr(mod.requests, "post", lambda *a, **kw: FakeResp())
    with pytest.raises(mod.FirecrawlError, match="rawHtml"):
        adapter._scrape("https://web.pcc.gov.tw/x")

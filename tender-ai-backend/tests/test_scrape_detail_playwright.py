# -*- coding: utf-8 -*-
"""方案 A(Playwright persistent-context 詳情抓取)的離線測試。

鐵則:**不連網、不開真瀏覽器、不裝 playwright**。以一個 async 假 page(只實作
``goto`` / ``content``)注入 ``PlaywrightDetailScraper``;這條路徑下不會 lazy import
playwright,故 CI 無需安裝即可跑。

涵蓋
----
* (a) 正常詳情 → 正確 ``FetchResult`` 且可被 ``parse_pcc_detail`` 解析、source_revision_key 抽出。
* (b) CAPTCHA 頁 → ``is_captcha_page`` 偵測到 → 走 ``on_captcha`` 等待/重試分支,人工
  「解完」後同一 page 重讀拿到正常頁。
* 批次 ``iterate``:人工只解一次 CAPTCHA,後續多筆共用同一(已通過)context。
* lazy import:未注入 page 時(模擬無 playwright)給清楚錯誤,不在 import 期就炸。
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.adapters.base import FetchResult
from app.jobs.scrape_detail_playwright import (
    PlaywrightDetailScraper,
    PlaywrightNotInstalled,
)
from app.services.detail_parser import is_captcha_page, parse_pcc_detail

FIX = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


class FakePage:
    """async 假 page:記錄 goto 的 URL,content() 回目前 ``html``(可被外部換掉以模擬人工解)。

    只實作 scraper 用到的兩個 async 方法,完全不碰 playwright / 網路 / 瀏覽器。
    """

    def __init__(self, html: str) -> None:
        self.html = html
        self.goto_urls: list[str] = []
        self.content_calls = 0

    async def goto(self, url, **kwargs):  # 接受 wait_until/timeout 等 kwargs
        self.goto_urls.append(url)

    async def content(self) -> str:
        self.content_calls += 1
        return self.html


@pytest.mark.asyncio
async def test_normal_detail_produces_parseable_fetch_result():
    """(a) 正常詳情:FetchResult 形狀正確、URL 由 PCCAdapter 組、可被 parser 解析。"""
    full = _load("pcc_detail_full.html")
    page = FakePage(full)

    scraper = PlaywrightDetailScraper(source_name="PCC", page=page)
    async with scraper:
        fr = await scraper.fetch_detail("PCC-H")

    # FetchResult 與既有 adapter 契約同形
    assert isinstance(fr, FetchResult)
    assert fr.source_name == "PCC"
    assert fr.status_code == 200
    assert "text/html" in (fr.content_type or "")
    assert fr.raw_content == full
    # detail_url 由 PCCAdapter 組(base64 token),確認確實導到該頁
    assert page.goto_urls == ["https://web.pcc.gov.tw/tps/QueryTender/query/"
                              "searchTenderDetail?pkPmsMain=UENDLUg="]
    # source_revision_key 由 detail_parser 抽出(fixture 內含「新增公告傳輸次數」)
    assert fr.source_revision_key == "01"

    # raw HTML 可被既有純函式解析器解析(與 enrich 路徑共用)
    parsed = parse_pcc_detail(fr.raw_content)
    assert parsed is not None
    assert parsed.deposit_amount_twd == 150000
    assert parsed.category_code == "5179"


@pytest.mark.asyncio
async def test_captcha_page_detected_then_resolved_by_human():
    """(b) CAPTCHA 頁:偵測到 → 走 on_captcha 等待分支 → 人工「解完」後重讀拿正常頁。"""
    captcha = _load("pcc_detail_captcha.html")
    full = _load("pcc_detail_full.html")
    page = FakePage(captcha)
    assert is_captcha_page(page.html)  # 前提:fixture 確實命中 CAPTCHA 判定

    captcha_calls: list[tuple[str, str]] = []

    async def fake_on_captcha(case_pk, url):
        # 模擬「人工在瀏覽器解完」:把 page 內容換成正常詳情頁
        captcha_calls.append((case_pk, url))
        page.html = full

    scraper = PlaywrightDetailScraper(
        source_name="PCC", page=page, on_captcha=fake_on_captcha
    )
    async with scraper:
        fr = await scraper.fetch_detail("PCC-H")

    # on_captcha 被呼叫一次(偵測到 CAPTCHA),帶正確 case_pk
    assert len(captcha_calls) == 1
    assert captcha_calls[0][0] == "PCC-H"
    # 人工解完後重讀 → 最終是正常頁、可解析
    assert not is_captcha_page(fr.raw_content)
    assert fr.raw_content == full
    assert parse_pcc_detail(fr.raw_content) is not None
    # 至少兩次 content():一次偵測 CAPTCHA、一次解完後重讀
    assert page.content_calls >= 2


@pytest.mark.asyncio
async def test_captcha_persists_when_human_does_not_solve():
    """CAPTCHA 仍未解(on_captcha 不改頁)→ 最終 FetchResult 仍為 CAPTCHA 頁(不破解/不假裝成功)。"""
    captcha = _load("pcc_detail_captcha.html")
    page = FakePage(captcha)

    async def noop_on_captcha(case_pk, url):
        pass  # 模擬人工沒解

    scraper = PlaywrightDetailScraper(
        source_name="PCC", page=page, on_captcha=noop_on_captcha
    )
    async with scraper:
        fr = await scraper.fetch_detail("PCC-H")

    assert is_captcha_page(fr.raw_content)  # 如實回報仍被擋,交呼叫端歸 captcha/deferred


@pytest.mark.asyncio
async def test_iterate_batch_shares_one_solved_context():
    """批次 iterate:首筆 CAPTCHA、人工解一次,其餘多筆共用通過的 context、不再要求解。"""
    captcha = _load("pcc_detail_captcha.html")
    full = _load("pcc_detail_full.html")
    page = FakePage(captcha)

    captcha_calls: list[str] = []

    async def fake_on_captcha(case_pk, url):
        captcha_calls.append(case_pk)
        page.html = full  # 解完後整個 context 後續都拿正常頁

    scraper = PlaywrightDetailScraper(
        source_name="PCC", page=page, on_captcha=fake_on_captcha
    )
    results: dict[str, FetchResult] = {}
    async with scraper:
        async for case_pk, fr in scraper.iterate(["PCC-H", "PCC-M", "PCC-L"]):
            results[case_pk] = fr

    assert set(results) == {"PCC-H", "PCC-M", "PCC-L"}
    # 人工只在第一筆解一次 CAPTCHA
    assert captcha_calls == ["PCC-H"]
    # 三筆最終都拿到可解析的正常頁
    for fr in results.values():
        assert not is_captcha_page(fr.raw_content)
        assert parse_pcc_detail(fr.raw_content) is not None


@pytest.mark.asyncio
async def test_fetch_before_context_entered_raises():
    """未進入 context(無注入 page)直接 fetch → 清楚 RuntimeError,而非 NoneType 噴錯。"""
    scraper = PlaywrightDetailScraper(source_name="PCC", page=None)
    with pytest.raises(RuntimeError):
        await scraper.fetch_detail("PCC-H")


@pytest.mark.asyncio
async def test_launch_persistent_context_lazy_imports_playwright(monkeypatch):
    """未注入 page 時才會 lazy import playwright;未安裝 → PlaywrightNotInstalled。

    模擬「import playwright 失敗」:patch lazy import helper 直接丟。驗證錯誤訊息清楚,
    且**不在 module import 期**就要求 playwright。
    """
    import app.jobs.scrape_detail_playwright as mod

    def boom():
        raise PlaywrightNotInstalled("未安裝 playwright(測試模擬)")

    monkeypatch.setattr(mod, "_import_async_playwright", boom)

    scraper = mod.PlaywrightDetailScraper(source_name="PCC", page=None)
    with pytest.raises(PlaywrightNotInstalled):
        await scraper._launch_persistent_context()


def test_unknown_source_rejected():
    with pytest.raises(ValueError):
        PlaywrightDetailScraper(source_name="NOPE")

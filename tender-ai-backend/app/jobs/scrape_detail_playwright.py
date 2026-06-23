# -*- coding: utf-8 -*-
"""方案 A:Playwright persistent-context 詳情抓取器(人工過 CAPTCHA 一次、之後批次抓)。

PCC 詳情端點掛了反大量查詢的圖形驗證碼(撲克牌配對)。一般 HTTP 路徑(``PCCAdapter
.fetch_detail`` via ``_pcc_http``)撞到就只能停下退避。本模組改走「真瀏覽器」:用
Playwright 的 **persistent context**(指向使用者本機 Chrome profile 目錄,保留 cookie/
session),開詳情頁;若偵測到 CAPTCHA 就**停下等人工**在那個瀏覽器視窗手動解一次,解完
後**同一 context** 帶著通過的 session 可連續批次抓多筆,不必每筆重解。

定位
----
* 與既有 enrich 流程**相容但獨立**:回傳的 ``FetchResult`` 形狀與 ``app.adapters.base``
  完全一致,raw HTML 仍交給 ``parse_pcc_detail`` / ``extract_source_revision_key`` 解析,
  enrich job 持久化層(snapshot/revision)無需改動。
* **不重寫** scraper / SkipSSLAdapter / detail_parser —— detail URL 由 ``PCCAdapter
  .detail_url`` 組、CAPTCHA 判斷與 revision key 抽取重用 ``detail_parser``。
* 本檔處理 **Layer A**(公開標案),不碰 Layer B。

鐵則:Playwright 為 lazy import(函式內 / try-except),未安裝時給清楚錯誤訊息,讓測試
能 monkeypatch 假 page 而**不強制安裝 playwright、不開真瀏覽器、不連網**。

環境變數
--------
* ``PCC_CHROME_PROFILE_DIR``:persistent context 的使用者資料目錄(預設見
  ``_default_profile_dir``)。指向常用 Chrome profile 可重用既有登入/通過狀態。
* ``PCC_PLAYWRIGHT_HEADLESS``:``1`` 開無頭(預設 ``0`` 有頭 —— 人工解 CAPTCHA 需看得到)。
* ``PCC_PLAYWRIGHT_CHANNEL``:``chrome``(預設)/ ``msedge`` / 空(用 bundled chromium)。

執行(本機手動;對齊 enrich_details.py 風格):
    uv run python -m app.jobs.scrape_detail_playwright --source PCC --limit 50
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, Iterable

from app.adapters import get_adapter
from app.adapters.base import FetchResult
from app.services.detail_parser import extract_source_revision_key, is_captcha_page

# 偵測到 CAPTCHA 後輪詢「人工是否已解完」的間隔/上限(僅在有真瀏覽器時生效)。
_CAPTCHA_POLL_INTERVAL_S = 3.0
_CAPTCHA_POLL_TIMEOUT_S = 300.0
# 詳情頁載入等待(networkidle/逾時皆續行,以 page.content() 為準)。
_PAGE_LOAD_TIMEOUT_MS = 30_000


class PlaywrightNotInstalled(RuntimeError):
    """playwright 未安裝時的清楚錯誤(lazy import 失敗才丟,不影響測試 monkeypatch)。"""


def _import_async_playwright():
    """Lazy import ``async_playwright``;未安裝丟 ``PlaywrightNotInstalled``。"""
    try:
        from playwright.async_api import async_playwright  # type: ignore
    except ImportError as exc:  # pragma: no cover - 取決於環境是否安裝
        raise PlaywrightNotInstalled(
            "未安裝 playwright。請先:\n"
            "  uv pip install playwright\n"
            "  uv run playwright install chromium\n"
            "(本機手動過 CAPTCHA 需有頭瀏覽器;CI/測試不需安裝,走 monkeypatch。)"
        ) from exc
    return async_playwright


def _default_profile_dir() -> Path:
    """persistent context 使用者資料目錄;env ``PCC_CHROME_PROFILE_DIR`` 優先。"""
    env = os.environ.get("PCC_CHROME_PROFILE_DIR")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".cache" / "tender-ai" / "pcc-playwright-profile"


def _headless() -> bool:
    return os.environ.get("PCC_PLAYWRIGHT_HEADLESS", "0") == "1"


def _channel() -> str | None:
    ch = os.environ.get("PCC_PLAYWRIGHT_CHANNEL", "chrome")
    return ch or None


class PlaywrightDetailScraper:
    """以 Playwright persistent context 抓 PCC 詳情頁,回傳 ``FetchResult``。

    與 HTTP adapter 同形:``fetch_detail(case_pk) -> FetchResult``,再加批次 ``iterate``。
    偵測到 CAPTCHA 會呼叫 ``on_captcha`` 等人工在瀏覽器解,解完(同 context)續抓。

    測試注入點
    ----------
    * ``page``:傳入一個有 ``goto`` / ``content`` 的假 page(async),即可不開真瀏覽器、
      不連網地驗證 fetch/CAPTCHA 分支。傳入 page 時不會 lazy import playwright。
    * ``on_captcha``:async callable,被呼叫表示「請人工解 CAPTCHA」;測試可注入一個會
      改變假 page 回傳內容(模擬人工解完)的 callable,以驗證重試分支。
    """

    def __init__(
        self,
        *,
        source_name: str = "PCC",
        page=None,
        on_captcha=None,
        profile_dir: Path | None = None,
        headless: bool | None = None,
        channel: str | None = None,
        captcha_poll_interval_s: float = _CAPTCHA_POLL_INTERVAL_S,
        captcha_poll_timeout_s: float = _CAPTCHA_POLL_TIMEOUT_S,
    ) -> None:
        adapter = get_adapter(source_name)
        if adapter is None:
            raise ValueError(f"未知來源:{source_name}")
        self._adapter = adapter
        self.source_name = source_name

        # 注入的 page(測試 / 既有 context 共用);None 則在 __aenter__ 建真瀏覽器。
        self._page = page
        self._on_captcha = on_captcha or self._wait_for_human

        self._profile_dir = profile_dir or _default_profile_dir()
        self._headless = _headless() if headless is None else headless
        self._channel = _channel() if channel is None else channel
        self._poll_interval = captcha_poll_interval_s
        self._poll_timeout = captcha_poll_timeout_s

        # 真瀏覽器資源(僅 __aenter__ 自建時持有,結束時關閉)。
        self._pw = None
        self._context = None
        self._owns_browser = False

    # ------------------------------------------------------------------ #
    # context 生命週期(async context manager)
    # ------------------------------------------------------------------ #
    async def __aenter__(self) -> "PlaywrightDetailScraper":
        if self._page is None:
            await self._launch_persistent_context()
        return self

    async def __aexit__(self, *exc) -> None:
        await self.close()

    async def _launch_persistent_context(self) -> None:
        """開 persistent context(指向本機 profile),拿一個 page。"""
        async_playwright = _import_async_playwright()
        self._profile_dir.mkdir(parents=True, exist_ok=True)
        self._pw = await async_playwright().start()
        launch_kwargs = {
            "user_data_dir": str(self._profile_dir),
            "headless": self._headless,
        }
        if self._channel:
            launch_kwargs["channel"] = self._channel
        self._context = await self._pw.chromium.launch_persistent_context(
            **launch_kwargs
        )
        # persistent context 開啟時通常已帶一個分頁,沒有就開一個。
        pages = self._context.pages
        self._page = pages[0] if pages else await self._context.new_page()
        self._owns_browser = True

    async def close(self) -> None:
        if self._owns_browser:
            if self._context is not None:
                await self._context.close()
                self._context = None
            if self._pw is not None:
                await self._pw.stop()
                self._pw = None
            self._owns_browser = False

    # ------------------------------------------------------------------ #
    # CAPTCHA 人工介入(預設行為:有頭視窗 + 輪詢等人工解)
    # ------------------------------------------------------------------ #
    async def _wait_for_human(self, case_pk: str, url: str) -> None:
        """預設 on_captcha:提示人工在瀏覽器視窗解 CAPTCHA,輪詢到頁面不再是驗證碼頁。

        以同一 page 反覆讀 ``content()`` 判斷;逾時則 raise 讓呼叫端中止。測試會以注入的
        ``on_captcha`` 取代本方法,故此處的真實等待邏輯不在 CI 跑。
        """
        print(
            f"\n⚠ 撞到 CAPTCHA({self.source_name}/{case_pk})。\n"
            f"  請在已開啟的瀏覽器視窗手動完成圖形驗證碼:\n  {url}\n"
            f"  解完後本程式會自動偵測並續抓(最多等 {int(self._poll_timeout)} 秒)…",
            file=sys.stderr,
        )
        waited = 0.0
        while waited < self._poll_timeout:
            await asyncio.sleep(self._poll_interval)
            waited += self._poll_interval
            html = await self._page.content()
            if not is_captcha_page(html):
                print("  ✓ 偵測到 CAPTCHA 已解除,續抓。", file=sys.stderr)
                return
        raise TimeoutError(
            f"等待人工解 CAPTCHA 逾時({int(self._poll_timeout)}s):{self.source_name}/{case_pk}"
        )

    # ------------------------------------------------------------------ #
    # 單筆抓取
    # ------------------------------------------------------------------ #
    async def fetch_detail(self, case_pk: str) -> FetchResult:
        """抓單一案詳情頁 → ``FetchResult``(與 HTTP adapter 同形)。

        流程:goto detail_url → 取 content() → 若 ``is_captcha_page`` 則 ``on_captcha``
        等人工解,解完再取一次 content();最終以拿到的 HTML 組 ``FetchResult``。
        raw HTML 由呼叫端交 ``parse_pcc_detail`` 解析(本函式不解析)。
        """
        if self._page is None:
            raise RuntimeError(
                "scraper 尚未進入 context(請用 `async with PlaywrightDetailScraper(...)`)"
            )
        url = self._adapter.detail_url(case_pk)
        await self._goto(url)
        html = await self._page.content()

        if is_captcha_page(html):
            # 不破解/不繞過:交人工解,解完同 context 重讀。
            await self._on_captcha(case_pk, url)
            html = await self._page.content()

        return FetchResult(
            source_name=self.source_name,
            source_url=url,
            # Playwright 不直接給 HTTP status;成功取得頁面內容即視為 200(與 enrich
            # job 對 fetch 的 200 期望一致)。失敗會在 goto/content 階段以例外體現。
            status_code=200,
            content_type="text/html; charset=utf-8",
            raw_content=html,
            fetched_at=datetime.now(timezone.utc),
            source_revision_key=extract_source_revision_key(html),
        )

    async def _goto(self, url: str) -> None:
        """導頁;``wait_until='networkidle'`` 但逾時不致命(以 content() 為準)。"""
        try:
            await self._page.goto(
                url, wait_until="networkidle", timeout=_PAGE_LOAD_TIMEOUT_MS
            )
        except TypeError:
            # 注入的假 page 之 goto 可能不收 kwargs;退而僅傳 url。
            await self._page.goto(url)

    # ------------------------------------------------------------------ #
    # 批次抓取(同一 context,人工只需解一次)
    # ------------------------------------------------------------------ #
    async def iterate(
        self, case_pks: Iterable[str]
    ) -> AsyncIterator[tuple[str, FetchResult]]:
        """依序批次抓多筆,yield ``(case_pk, FetchResult)``;共用同一通過 CAPTCHA 的 context。"""
        for case_pk in case_pks:
            yield case_pk, await self.fetch_detail(case_pk)


# --------------------------------------------------------------------------- #
# CLI:挑目標(沿用 enrich 的 _select_targets)→ 用 persistent context 批次抓
# --------------------------------------------------------------------------- #
async def _select_case_pks(
    *, source: str, limit: int | None, only_missing: bool, ttl_hours: int
) -> list[str]:
    """重用 enrich job 的目標選擇,回傳 case_pk 清單(連 DB;CLI 用,測試不走此路徑)。"""
    from app.db.session import AsyncSessionLocal
    from app.jobs.enrich_details import _select_targets

    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as session:
        targets = await _select_targets(
            session,
            only_missing=only_missing,
            source=source,
            ttl_hours=ttl_hours,
            now=now,
            limit=limit,
        )
    return [case_pk for (_tid, case_pk, _src) in targets]


async def run_scrape(
    *,
    source: str = "PCC",
    limit: int | None = None,
    only_missing: bool = True,
    ttl_hours: int = 24,
    case_pks: list[str] | None = None,
) -> dict:
    """CLI 入口的 async 主體:挑目標 → persistent context 批次抓 → 印每筆結果(不落 DB)。

    本入口刻意**只抓取與印出**(供人工確認過 CAPTCHA 後可批次取得 HTML);實際入庫請接
    回 enrich 的持久化層或另行串接。回傳統計 dict。
    """
    pks = case_pks if case_pks is not None else await _select_case_pks(
        source=source, limit=limit, only_missing=only_missing, ttl_hours=ttl_hours
    )
    stats = {"source": source, "targeted": len(pks), "fetched": 0, "captcha_solved": 0}

    async with PlaywrightDetailScraper(source_name=source) as scraper:
        async for case_pk, fr in scraper.iterate(pks):
            stats["fetched"] += 1
            captcha = is_captcha_page(fr.raw_content)
            print(
                f"  [{stats['fetched']}/{stats['targeted']}] {source}/{case_pk}"
                f" → {len(fr.raw_content)} bytes"
                + ("(仍為 CAPTCHA 頁)" if captcha else ""),
                file=sys.stderr,
            )
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(
        description="PCC 詳情抓取(Playwright persistent context;人工過 CAPTCHA 一次後批次抓)"
    )
    ap.add_argument("--source", default="PCC", help="來源(目前僅 PCC 支援詳情)")
    ap.add_argument("--limit", type=int, default=None, help="目標上限")
    ap.add_argument(
        "--all", action="store_true",
        help="所有支援來源標的全跑(預設只 new ∪ stale ∪ retriable)",
    )
    ap.add_argument("--ttl-hours", type=int, default=24, help="stale TTL 小時(預設 24)")
    args = ap.parse_args()

    stats = asyncio.run(
        run_scrape(
            source=args.source,
            limit=args.limit,
            only_missing=not args.all,
            ttl_hours=args.ttl_hours,
        )
    )
    print(
        f"抓取完成｜來源 {stats['source']}｜目標 {stats['targeted']}｜取得 {stats['fetched']}",
    )


if __name__ == "__main__":
    main()

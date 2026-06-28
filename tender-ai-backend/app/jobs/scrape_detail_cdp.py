# -*- coding: utf-8 -*-
"""方案 B:CDP attach 詳情抓取——接管使用者「已開著、已過 CAPTCHA」的 Chrome。

動機
----
PCC 在詳情端點掛圖形驗證碼(撲克牌配對)反大量查詢;方案 A(自管 session 的
``app.adapters._pcc_http``)一旦撞 CAPTCHA 只能優雅中止。本方案改為**接管使用者
本機已執行、已登入/已手動過一次 CAPTCHA 的 Chrome**:透過 Chrome DevTools Protocol
(CDP,``--remote-debugging-port``)attach 既有分頁,**重用其 cookies/session** 直接
``Page.navigate`` 到詳情頁、取回 ``document.documentElement.outerHTML``。

與既有 enrich 流程相容
----------------------
取回的 HTML 一律走既有純函式解析器(``parse_pcc_detail`` / ``is_captcha_page`` /
``extract_source_revision_key``),組成與 ``PCCAdapter.fetch_detail`` **形狀完全相同**
的 ``FetchResult``;因此可直接餵給 ``enrich_details.run_enrich`` 的同一持久層
(snapshot → revision)而無需改動該 job——只要把它的 ``fetch_detail`` 換成本模組的
即可(見 ``run_cdp_enrich``)。

**鐵則對齊**
- 不重寫已測 scraper:detail_url token 仍由 ``PCCAdapter.detail_url`` 組;解析重用
  ``detail_parser``;**本模組不重複 ``_pcc_http`` 的 SSL/重試邏輯**(CDP 走的是
  使用者自己的瀏覽器網路堆疊,不經 requests)。
- Layer A 公開資料;不碰 Layer B。
- import 一律 lazy:``websockets`` / ``httpx`` 只在實際連線時才 import,讓本模組可被
  離線測試 import、且不在無 Chrome 環境炸掉。

如何啟動帶 debugging port 的 Chrome(使用者一次性手動步驟)
---------------------------------------------------------
1. **完全關閉** Chrome。
2. 以 debugging port 啟動(macOS 例;**用一個獨立 profile 目錄較安全**):

       /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\
         --remote-debugging-port=9222 \\
         --user-data-dir="$HOME/.tenderai-chrome"

3. 在這個 Chrome 視窗裡開 PCC 任一詳情頁,**手動過一次 CAPTCHA / 登入**(session
   cookie 會留在此 profile)。
4. 跑本 job:``uv run python -m app.jobs.scrape_detail_cdp``。

安全注意:remote-debugging-port 等於對 ``127.0.0.1:9222`` 開放完整瀏覽器控制權
(讀 cookie、發請求)。**只綁 localhost、用完即關、勿用日常主 profile**(見
``plans/pcc-detail-scraping/02-cdp-attach.md`` 安全章)。

執行(本機手動 / 不在 CI):
    uv run python -m app.jobs.scrape_detail_cdp                 # new ∪ stale ∪ retriable
    uv run python -m app.jobs.scrape_detail_cdp --all --limit 50
    PCC_CDP_URL=http://127.0.0.1:9333 uv run python -m app.jobs.scrape_detail_cdp
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

from app.adapters.base import FetchResult
from app.adapters.pcc import PCCAdapter
from app.services.detail_parser import extract_source_revision_key

# CDP HTTP 探索端點預設(對齊 Chrome --remote-debugging-port=9222)
DEFAULT_CDP_URL = "http://127.0.0.1:9222"

# 導航後等待頁面渲染穩定的秒數(PCC 詳情頁多為一次性 server render,給少量緩衝)
_NAV_SETTLE_S = 1.5

# 單筆操作逾時(連線/導航/取 HTML 各自的上限秒數)
_OP_TIMEOUT_S = 30.0


class CDPError(RuntimeError):
    """CDP 連線/操作失敗(連不到 Chrome、無可用分頁、導航逾時等),清楚對外拋出。"""


# --------------------------------------------------------------------------- #
# 純函式:把 CDP 取回的 HTML 組成與 PCCAdapter.fetch_detail 等價的 FetchResult
# --------------------------------------------------------------------------- #
def build_fetch_result(
    *,
    case_pk: str,
    url: str,
    html: str,
    now: datetime | None = None,
) -> FetchResult:
    """由 CDP 取回的 HTML 組 ``FetchResult``(形狀對齊 ``PCCAdapter.fetch_detail``)。

    純函式、不連網。``status_code``/``content_type`` 在 CDP 路徑無法廉價拿到逐筆 HTTP
    中繼資料,故以「成功取得 outerHTML」語意填 200 / ``text/html``,讓既有 enrich job
    的 200+HTML 驗證分支(及其後的 CAPTCHA / 解析分流)維持不變。
    """
    return FetchResult(
        source_name=PCCAdapter.source_name,
        source_url=url,
        status_code=200,
        content_type="text/html; charset=utf-8",
        raw_content=html,
        fetched_at=now or datetime.now(timezone.utc),
        source_revision_key=extract_source_revision_key(html),
    )


# --------------------------------------------------------------------------- #
# CDP transport:lazy import websockets / httpx;以 ws 直連分頁的 page session
# --------------------------------------------------------------------------- #
class CDPClient:
    """極簡 CDP 客戶端:HTTP 探索分頁 + 單一 ws 連線發 ``Page.navigate`` / ``Runtime.evaluate``。

    刻意不依賴 playwright(未列入專案依賴);只用 ``websockets``(已安裝)+ ``httpx``
    (已是依賴)的最小子集。所有外部 import 都延後到方法內,確保本模組可離線 import、
    並讓測試以 fake client 注入(不連真 Chrome)。
    """

    def __init__(self, cdp_url: str = DEFAULT_CDP_URL):
        self.cdp_url = cdp_url.rstrip("/")
        self._ws = None
        self._msg_id = 0

    async def _list_targets(self) -> list[dict]:
        """GET ``/json`` 取現有分頁清單;連不到 Chrome → CDPError。"""
        import httpx  # lazy

        try:
            async with httpx.AsyncClient(timeout=_OP_TIMEOUT_S) as http:
                resp = await http.get(f"{self.cdp_url}/json")
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:  # noqa: BLE001 — 連不到/格式錯 → 統一清楚錯誤
            raise CDPError(
                f"無法連到 Chrome CDP({self.cdp_url}/json):{exc}。"
                "請以 --remote-debugging-port=9222 啟動 Chrome,並先手動過一次 CAPTCHA。"
            ) from exc

    @staticmethod
    def _pick_page(targets: list[dict]) -> dict:
        """從分頁清單挑一個可用 ``page`` 目標(優先非 devtools/extension 的網頁分頁)。"""
        pages = [
            t for t in targets
            if t.get("type") == "page"
            and t.get("webSocketDebuggerUrl")
            and not str(t.get("url", "")).startswith("devtools://")
        ]
        if not pages:
            raise CDPError(
                "Chrome 已連上但找不到可用網頁分頁(page)。"
                "請在該 Chrome 視窗開啟任一分頁後再試。"
            )
        return pages[0]

    async def connect(self) -> None:
        """探索分頁並對其 ws endpoint 建立連線(重用使用者既有 session/cookies)。"""
        import websockets  # lazy

        targets = await self._list_targets()
        page = self._pick_page(targets)
        ws_url = page["webSocketDebuggerUrl"]
        try:
            self._ws = await asyncio.wait_for(
                websockets.connect(ws_url, max_size=None), timeout=_OP_TIMEOUT_S
            )
        except Exception as exc:  # noqa: BLE001
            raise CDPError(f"連接分頁 ws 失敗({ws_url}):{exc}") from exc

    async def _send(self, method: str, params: dict | None = None) -> dict:
        """送一筆 CDP 命令並等對應 id 的回應;非預期 event 略過。"""
        if self._ws is None:
            raise CDPError("CDP 尚未連線(請先呼叫 connect())。")
        self._msg_id += 1
        msg_id = self._msg_id
        await self._ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        # 等到 id 對上的回應(中途的 event 直接丟棄)
        while True:
            raw = await asyncio.wait_for(self._ws.recv(), timeout=_OP_TIMEOUT_S)
            data = json.loads(raw)
            if data.get("id") == msg_id:
                if "error" in data:
                    raise CDPError(f"CDP {method} 失敗:{data['error']}")
                return data.get("result", {})

    async def fetch_html(self, url: str) -> str:
        """導航到 url、等渲染、回 ``document.documentElement.outerHTML``。"""
        await self._send("Page.enable")
        await self._send("Page.navigate", {"url": url})
        # 簡化:固定緩衝等待(PCC 詳情頁為一次性 server render);避免依賴 loadEventFired 事件序。
        await asyncio.sleep(_NAV_SETTLE_S)
        result = await self._send(
            "Runtime.evaluate",
            {
                "expression": "document.documentElement.outerHTML",
                "returnByValue": True,
            },
        )
        value = (result.get("result") or {}).get("value")
        if not isinstance(value, str):
            raise CDPError(f"取頁面 HTML 失敗(非字串回傳):{result!r}")
        return value

    async def close(self) -> None:
        if self._ws is not None:
            try:
                await self._ws.close()
            finally:
                self._ws = None


# --------------------------------------------------------------------------- #
# 詳情抓取器:單筆 fetch_detail + 批次
# --------------------------------------------------------------------------- #
class CDPDetailScraper:
    """以 CDP attach 的方式抓 PCC 詳情頁;對外提供 ``fetch_detail`` / ``fetch_many``。

    detail_url 一律由既有 ``PCCAdapter.detail_url`` 組(不重造 token 邏輯);抓回後
    交純函式解析器組 ``FetchResult``。``client_factory`` 為測試注入點(預設真 CDPClient)。
    """

    def __init__(
        self,
        *,
        cdp_url: str | None = None,
        client_factory=None,
        nav_settle_s: float = _NAV_SETTLE_S,
    ):
        self.cdp_url = cdp_url or os.environ.get("PCC_CDP_URL", DEFAULT_CDP_URL)
        self._client_factory = client_factory or (lambda: CDPClient(self.cdp_url))
        self._adapter = PCCAdapter()
        self._client = None
        self.nav_settle_s = nav_settle_s

    async def __aenter__(self) -> "CDPDetailScraper":
        self._client = self._client_factory()
        await self._client.connect()
        return self

    async def __aexit__(self, *exc) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None

    async def fetch_detail(self, case_pk: str, *, now: datetime | None = None) -> FetchResult:
        """抓單一案詳情 → ``FetchResult``(形狀對齊 ``PCCAdapter.fetch_detail``)。

        需先進入 async context(``async with CDPDetailScraper() as s``)以建立 CDP 連線。
        """
        if self._client is None:
            raise CDPError("尚未連線:請以 `async with CDPDetailScraper() as s:` 使用。")
        url = self._adapter.detail_url(case_pk)
        html = await self._client.fetch_html(url)
        return build_fetch_result(case_pk=case_pk, url=url, html=html, now=now)

    async def fetch_many(
        self, case_pks: list[str], *, now: datetime | None = None, rate_limit_s: float = 1.0
    ) -> dict[str, FetchResult]:
        """批次抓多案(sequential + rate-limit);回 ``{case_pk: FetchResult}``。

        同一 CDP 連線重用(共用使用者 session);逐筆間隔 ``rate_limit_s`` 秒以禮貌節流。
        某筆失敗不中斷整批——以 CDPError 記在該 key 之外由呼叫端決定;此處讓例外向上拋
        交批次呼叫端(CLI)以 per-case try 包覆。
        """
        out: dict[str, FetchResult] = {}
        for idx, pk in enumerate(case_pks):
            if idx and rate_limit_s:
                await asyncio.sleep(rate_limit_s)
            out[pk] = await self.fetch_detail(pk, now=now)
        return out


# --------------------------------------------------------------------------- #
# 與 enrich job 串接:把 run_enrich 的 fetch_detail 換成 CDP scraper
# --------------------------------------------------------------------------- #
async def run_cdp_enrich(
    *,
    only_missing: bool = True,
    limit: int | None = None,
    ttl_hours: int = 24,
    trigger: str = "manual",
    rate_limit_s: float = 1.0,
    cdp_url: str | None = None,
    client_factory=None,
    now: datetime | None = None,
    session_factory=None,
) -> dict:
    """以 CDP attach 取代預設 transport,跑既有 ``enrich_details.run_enrich`` 持久層。

    作法:建立一個與 ``PCCAdapter`` 同形狀、但 ``fetch_detail`` 改走 CDP 的 shim adapter,
    monkeypatch 進 ``enrich_details`` 的 ``get_adapter``,藉此**完全重用** snapshot →
    revision → 現值投影 → 失敗帳本 → CAPTCHA 分流邏輯(不複製持久層)。

    注意:enrich job 內部以 **同步** ``adapter.fetch_detail`` 呼叫;故 shim 在已連線的
    CDP 上以 ``asyncio.run_coroutine_threadsafe`` 不可行(同一 loop)。改為在進入本協程前
    預抓(prefetch)所有目標 HTML 成快取,shim 同步查快取回 ``FetchResult``。
    """
    from app.jobs import enrich_details as ed

    now = now or datetime.now(timezone.utc)
    resolved_cdp = cdp_url or os.environ.get("PCC_CDP_URL", DEFAULT_CDP_URL)

    # 1) 先選目標(只 PCC;CDP 僅對 PCC 有意義),取 case_pk 清單
    factory = session_factory or _default_session_factory()
    async with factory() as session:
        targets = await ed._select_targets(
            session,
            only_missing=only_missing,
            source=PCCAdapter.source_name,
            ttl_hours=ttl_hours,
            now=now,
            limit=limit,
        )
    case_pks = [pk for (_tid, pk, _src) in targets]

    # 2) 用同一 CDP 連線把全部 HTML 預抓進快取(逐筆 rate-limit)
    cache: dict[str, FetchResult] = {}
    if case_pks:
        async with CDPDetailScraper(cdp_url=resolved_cdp, client_factory=client_factory) as scraper:
            for idx, pk in enumerate(case_pks):
                if idx and rate_limit_s:
                    await asyncio.sleep(rate_limit_s)
                try:
                    cache[pk] = await scraper.fetch_detail(pk, now=now)
                except Exception as exc:  # noqa: BLE001 — 個別失敗讓 enrich 記 fetch_fail
                    print(f"  ⚠ CDP 抓取 {pk} 失敗:{exc}", file=sys.stderr)

    # 3) shim adapter:同步 fetch_detail 查快取(查不到 → 視為 transport 失敗)
    base_adapter = PCCAdapter()

    class _CDPShimAdapter:
        source_name = PCCAdapter.source_name
        base_url = PCCAdapter.base_url
        supports_detail_enrich = True

        def detail_url(self, case_pk: str) -> str:
            return base_adapter.detail_url(case_pk)

        def fetch_detail(self, case_pk: str) -> FetchResult:
            fr = cache.get(case_pk)
            if fr is None:
                raise CDPError(f"CDP 預抓未取得 {case_pk}(連線/導航失敗)")
            return fr

    shim = _CDPShimAdapter()
    original_get_adapter = ed.get_adapter
    ed.get_adapter = lambda name: shim if name == PCCAdapter.source_name else original_get_adapter(name)
    try:
        # rate_limit 設 0:節流已在預抓階段做過,持久層不需再睡
        return await ed.run_enrich(
            only_missing=only_missing,
            limit=limit,
            source=PCCAdapter.source_name,
            ttl_hours=ttl_hours,
            trigger=trigger,
            rate_limit_s=0.0,
            now=now,
            session_factory=session_factory,
        )
    finally:
        ed.get_adapter = original_get_adapter


def _default_session_factory():
    """延後 import DB session(避免離線 import 本模組時拉起 DB 設定)。"""
    from app.db.session import AsyncSessionLocal

    return AsyncSessionLocal


def main() -> None:
    ap = argparse.ArgumentParser(
        description="PCC 詳情抓取(方案 B:CDP attach 既有 Chrome;勿在 CI 跑)"
    )
    ap.add_argument(
        "--all", action="store_true",
        help="所有 PCC 標的全跑(預設只 new ∪ stale ∪ retriable)",
    )
    ap.add_argument("--limit", type=int, default=None, help="目標上限")
    ap.add_argument("--ttl-hours", type=int, default=24, help="stale TTL 小時(預設 24)")
    ap.add_argument(
        "--trigger", default="manual", choices=["manual", "daily"],
        help="執行觸發來源(寫入 crawl_run)",
    )
    ap.add_argument(
        "--rate-limit", type=float, default=1.0, help="每筆抓取間隔秒數(預設 1.0)",
    )
    ap.add_argument(
        "--cdp-url", default=None,
        help=f"Chrome CDP 探索端點(預設 env PCC_CDP_URL 或 {DEFAULT_CDP_URL})",
    )
    args = ap.parse_args()

    stats = asyncio.run(
        run_cdp_enrich(
            only_missing=not args.all,
            limit=args.limit,
            ttl_hours=args.ttl_hours,
            trigger=args.trigger,
            rate_limit_s=args.rate_limit,
            cdp_url=args.cdp_url,
        )
    )
    print(
        f"CDP enrich 完成(run #{stats['run_id']}）｜目標 {stats['targeted']}"
        f"｜新版 {stats['new_revisions']}｜未變 {stats['unchanged']}"
        f"｜附件 {stats['attachments_archived']}｜室內命中 {stats['interior_hits']}"
        f"｜失敗 {stats['failed']}（含 CAPTCHA {stats['captcha']}）"
    )
    if stats["aborted_on_captcha"]:
        print(
            "⚠ 仍撞 CAPTCHA:表示該 Chrome session 的驗證已過期。"
            "請回該 Chrome 視窗重新手動過一次 CAPTCHA 後再跑。"
        )


if __name__ == "__main__":
    main()

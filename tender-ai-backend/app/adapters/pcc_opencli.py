# -*- coding: utf-8 -*-
"""PCC adapter（OpenCLI Browser Bridge 變體）。

繼承 :class:`PCCAdapter`，**只覆寫連網的兩個方法**（`fetch_list_case_pks` /
`fetch_detail`），改走「人工已過 CAPTCHA 的暖機瀏覽器 session」取 render 後 HTML，
解析/持久層完全沿用既有 enrich job —— 不重寫任何已測 scraper。

為何需要這條路徑
----------------
PCC 詳情頁掛了反大量查詢的圖形 CAPTCHA，server-side `_pcc_http`（Node-side cookie
fetch）對「未過驗證」的詳情頁會被擋（回 200+HTML 但 `tb_02=0`）。突破點是「在已過
CAPTCHA 的真實瀏覽器 session 內取 render 後 HTML」。本 adapter 透過 OpenCLI
（`@jackwener/opencli`，daemon + Chrome 擴充 Browser Bridge）驅動該 session。

進階查詢語義修正
----------------
基底 :class:`PCCAdapter` 的查詢模板用 ``dateType=isNow``（等標期內 / 現在仍開放），
做「公告日期區間」回填時會把已截止的案漏掉。本變體覆寫查詢為 ``dateType=isDate``
（依公告日期區間）且日期用**西元年**（PCC query 參數真實格式，UI 顯示民國年但送出西元年）；
``pageSize`` 拉大一次取回（台北/新北單縣市單月在百筆量級）。

使用前置
--------
1. OpenCLI daemon 已啟動、Chrome 擴充已連線（`opencli doctor` 應為 OK）。
2. 使用者已在 Chrome 開一分頁、人工過一次 PCC CAPTCHA，且 ``opencli browser <session>
   bind`` 已綁定該分頁（由 runner 負責，本 adapter 只 open/eval）。

**絕不在 CI/pytest 跑**：需真實瀏覽器與 PCC 連線；測試一律 monkeypatch fetch_* 回 fixture。
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

from app.adapters.base import FetchResult
from app.adapters.pcc import PCCAdapter
from app.services.detail_parser import extract_source_revision_key, is_captcha_page
from app.services.report_parser import decode_pcc_pk

# OpenCLI 真實入口（PATH 上的 `opencli` 可能是壞掉的 codex shim，優先用 hermes 絕對路徑）
_DEFAULT_OPENCLI = os.path.expanduser("~/.hermes/node/bin/opencli")
# 列表結果表 detail 連結 token：/prkms/urlSelector/common/tpam?pk=<base64(case_pk)>
_LIST_PK_RE = PCCAdapter._LIST_PK_RE
# 詳情頁過濾噪音（OpenCLI 擴充/插件雜訊一律走 stderr，eval 真值走 stdout）


class PCCOpenCLIAdapter(PCCAdapter):
    """以 OpenCLI Browser Bridge 取 render 後 HTML 的 PCC adapter。"""

    # 進階查詢：依公告日期區間（isDate）+ 西元年 + 一次取大頁
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
        session_name: str = "pcc",
        opencli_bin: str | None = None,
        profile: str | None = "axq5zgff",
        open_timeout_s: float = 30.0,
        eval_timeout_s: float = 30.0,
        captcha_wait_s: float = 180.0,
        captcha_poll_s: float = 3.0,
    ) -> None:
        self._session = session_name
        self._bin = opencli_bin or (
            _DEFAULT_OPENCLI if os.path.exists(_DEFAULT_OPENCLI) else shutil.which("opencli")
        )
        if not self._bin:
            raise RuntimeError("找不到 opencli 執行檔（~/.hermes/node/bin/opencli 或 PATH）")
        self._env = {**os.environ}
        if profile:
            self._env["OPENCLI_PROFILE"] = profile
        self._open_timeout = open_timeout_s
        self._eval_timeout = eval_timeout_s
        self._captcha_wait = captcha_wait_s
        self._captcha_poll = captcha_poll_s

    # ------------------------------------------------------------------ #
    # OpenCLI 子程序薄封裝（eval 真值走 stdout；擴充噪音走 stderr，直接忽略）
    # ------------------------------------------------------------------ #
    def _cli(self, *args: str, timeout: float) -> str:
        proc = subprocess.run(
            [self._bin, "browser", self._session, *args],
            capture_output=True, text=True, env=self._env, timeout=timeout,
        )
        return proc.stdout

    def _open(self, url: str) -> None:
        self._cli("open", url, timeout=self._open_timeout)

    def _eval(self, js: str) -> str:
        return self._cli("eval", js, timeout=self._eval_timeout)

    def bind(self) -> str:
        """綁定使用者目前已過 CAPTCHA 的分頁（runner 啟動時呼叫一次）。"""
        return self._cli("bind", timeout=self._open_timeout)

    # ------------------------------------------------------------------ #
    # 覆寫：進階查詢列表全抓（瀏覽器版）
    # ------------------------------------------------------------------ #
    def fetch_list_case_pks(self, exec_location: str, start: str, end: str) -> list[str]:
        """在暖機 session 開進階查詢列表 → eval 抽 ``tpam?pk`` token → 解碼為 case_pk。

        ``start``/``end`` 為**西元年** ``YYYY/MM/DD``（與 PCC query 參數一致）。
        """
        url = self.advanced_list_url(exec_location, start, end)
        self._open(url)
        # 取所有 detail 連結 href（換行分隔），純文字回 stdout
        out = self._eval(
            "[...document.querySelectorAll('a[href*=\\\"tpam?pk=\\\"]')]"
            ".map(a=>a.getAttribute('href')).join('\\n')"
        )
        seen: list[str] = []
        for line in out.splitlines():
            m = _LIST_PK_RE.search(line)
            if not m:
                continue
            case_pk = decode_pcc_pk(m.group(1))
            if case_pk and case_pk not in seen:
                seen.append(case_pk)
        return seen

    # ------------------------------------------------------------------ #
    # 覆寫：詳情頁抓取（瀏覽器版，回 render 後 outerHTML）
    # ------------------------------------------------------------------ #
    def _wait_human_captcha(self, case_pk: str, raw: str) -> str:
        """撞到圖形碼時**暫停、等真人在瀏覽器親手解一次**,解完續抓 render 後 HTML。

        本函式**不破解/不繞過**驗證碼,只輪詢頁面狀態:由使用者(已登入的真人)在綁定
        分頁完成挑戰後,頁面自動轉回詳情,本函式再取一次 ``outerHTML`` 回傳。逾時
        (``captcha_wait_s``)仍未解則回原始 captcha HTML,交由 enrich job 歸為可重試。
        """
        deadline = time.monotonic() + self._captcha_wait
        print(
            f"\n⏸  PCC/{case_pk} 撞到圖形驗證碼——請在瀏覽器分頁手動完成驗證"
            f"(最多等 {int(self._captcha_wait)}s,解完自動續抓)…",
            file=sys.stderr, flush=True,
        )
        url = self.detail_url(case_pk)
        while time.monotonic() < deadline:
            time.sleep(self._captcha_poll)
            cur = self._eval("document.documentElement.outerHTML")
            if not cur.strip() or is_captcha_page(cur):
                continue
            # 已非驗證碼頁;若不像詳情(無「招標機關」),重開該詳情 URL 再取一次。
            if "招標機關" not in cur:
                self._open(url)
                cur = self._eval("document.documentElement.outerHTML")
                if is_captcha_page(cur) or "招標機關" not in cur:
                    continue
            print(f"✓ PCC/{case_pk} 驗證已解,續抓。", file=sys.stderr, flush=True)
            return cur
        print(f"✗ PCC/{case_pk} 等待逾時,標記可重試。", file=sys.stderr, flush=True)
        return raw

    def fetch_detail(self, case_pk: str) -> FetchResult:
        url = self.detail_url(case_pk)
        self._open(url)
        raw = self._eval("document.documentElement.outerHTML")
        # 撞碼且設定了等待:暫停等真人解(不破解/不繞過),解完取乾淨 HTML。
        if self._captcha_wait > 0 and is_captcha_page(raw):
            raw = self._wait_human_captcha(case_pk, raw)
        return FetchResult(
            source_name=self.source_name,
            source_url=url,
            status_code=200 if raw.strip() else 502,
            content_type="text/html; charset=utf-8",
            raw_content=raw,
            fetched_at=datetime.now(timezone.utc),
            source_revision_key=extract_source_revision_key(raw),
        )

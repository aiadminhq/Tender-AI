# -*- coding: utf-8 -*-
"""PCC 受治理 HTTP transport:鏡射 ``tender_daily.py`` 的 SkipSSLAdapter / retry_get。

**鏡射對象**:``tender-bot/tender-bot/tender_daily.py`` 的 ``SkipSSLAdapter`` 與
``retry_get``。此處刻意「複製而非 import」,避免引入該腳本的 import-time 副作用
(logging 設定、路徑、本機排程相依)。**若上游 SSL bypass 或重試邏輯調整,需同步維護本檔。**

設計:**無 import-time 副作用**——session 於呼叫 ``pcc_session()`` 時才建立、mount;
``governed_get`` 只負責「取得回應 + 有限重試」,內容驗證(status/content-type/頁標記)
交給呼叫端(adapter / enrich job),以便分類為 ``crawl_failure``。
"""
from __future__ import annotations

import ssl
import time

import requests
from requests.adapters import HTTPAdapter

# 鏡射上游:瀏覽器 UA、逾時、重試上限
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
DEFAULT_TIMEOUT = 30
MAX_RETRIES = 3
BACKOFF_BASE = 1.0  # 指數退避基數(秒):第 n 次失敗後 sleep base * 2**(n-1)


class SkipSSLAdapter(HTTPAdapter):
    """鏡射上游:PCC 憑證鏈不完整,停用 SSL 驗證以完成連線(與既有日報爬蟲一致)。"""

    def init_poolmanager(self, *args, **kwargs):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        kwargs["ssl_context"] = ctx
        return super().init_poolmanager(*args, **kwargs)


def pcc_session() -> requests.Session:
    """建立掛上 ``SkipSSLAdapter`` 與瀏覽器 UA 的 Session(呼叫時建立,無 import 副作用)。"""
    session = requests.Session()
    session.headers.update({"User-Agent": BROWSER_UA})
    session.mount("https://", SkipSSLAdapter())
    return session


def governed_get(
    session: requests.Session,
    url: str,
    *,
    timeout: int = DEFAULT_TIMEOUT,
    max_retries: int = MAX_RETRIES,
    backoff_base: float = BACKOFF_BASE,
) -> requests.Response:
    """受治理 GET:逾時 + 有限重試 + 指數退避;末次仍失敗則 raise(鏡射 ``retry_get``)。

    非 2xx 透過 ``raise_for_status`` 視為失敗並重試;成功回 ``Response``,其餘驗證留呼叫端。
    """
    last_exc: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            resp = session.get(url, timeout=timeout)
            resp.raise_for_status()
            return resp
        except Exception as exc:  # noqa: BLE001 — 交由呼叫端分類為 crawl_failure
            last_exc = exc
            if attempt < max_retries:
                time.sleep(backoff_base * (2 ** (attempt - 1)))
    assert last_exc is not None  # 迴圈至少跑一次,失敗必有例外
    raise last_exc

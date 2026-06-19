# -*- coding: utf-8 -*-
"""來源 adapter（registry / capability / URL / fetch 形狀）的離線測試。

全程不連網：fetch_detail 的 transport（governed_get / pcc_session）以 monkeypatch
替換為回傳 fixture 的假物件。對齊修訂計畫 §6 測試矩陣 6–8。
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from app.adapters import get_adapter, iter_adapters, source_seeds
from app.adapters.base import FetchResult, SourceAdapter
from app.services.report_parser import decode_pcc_pk

FIX = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


# --------------------------------------------------------------------------- #
# 6) registry / capability / source_seeds 等價
# --------------------------------------------------------------------------- #
def test_get_adapter_and_capabilities():
    pcc = get_adapter("PCC")
    tmu = get_adapter("TMU")
    assert isinstance(pcc, SourceAdapter) and isinstance(tmu, SourceAdapter)
    assert pcc.source_name == "PCC" and pcc.supports_detail_enrich is True
    assert tmu.source_name == "TMU" and tmu.supports_detail_enrich is False


def test_get_adapter_unknown():
    assert get_adapter("NOPE") is None


def test_iter_adapters_covers_both():
    names = {a.source_name for a in iter_adapters()}
    assert names == {"PCC", "TMU"}


def test_source_seeds_matches_backfill_base():
    # source_seeds() 為 adapter registry 的唯一真相來源（ensure_sources 由此驅動）
    assert source_seeds() == {
        "PCC": "https://web.pcc.gov.tw",
        "TMU": "https://cmd.tmu.edu.tw",
    }


# --------------------------------------------------------------------------- #
# 7) base64 詳情頁 URL round-trip
# --------------------------------------------------------------------------- #
def test_pcc_detail_url_base64_roundtrip():
    pcc = get_adapter("PCC")
    url = pcc.detail_url("71248861")
    assert url.startswith("https://web.pcc.gov.tw")
    assert "searchTenderDetail?pkPmsMain=" in url
    # base64 token 結尾可能帶 "=" padding,故以 pkPmsMain= 切而非最後一個 "="
    token = url.split("pkPmsMain=", 1)[-1]
    assert token == "NzEyNDg4NjE="
    # 與既有解碼互逆
    assert decode_pcc_pk(token) == "71248861"


# --------------------------------------------------------------------------- #
# 8) fetch_detail 形狀（monkeypatch transport 回 fixture）
# --------------------------------------------------------------------------- #
class _FakeResp:
    def __init__(self, text: str, status: int = 200,
                 content_type: str = "text/html; charset=utf-8"):
        self.status_code = status
        self.headers = {"Content-Type": content_type}
        self.text = text


def test_pcc_fetch_detail_shape(monkeypatch):
    full = _load("pcc_detail_full.html")
    # 不建真 session、不連網：governed_get 直接回假回應
    monkeypatch.setattr("app.adapters.pcc.pcc_session", lambda: object())
    monkeypatch.setattr(
        "app.adapters.pcc.governed_get", lambda session, url, **kw: _FakeResp(full)
    )

    pcc = get_adapter("PCC")
    res = pcc.fetch_detail("71248861")
    assert isinstance(res, FetchResult)
    assert res.source_name == "PCC"
    assert res.status_code == 200
    assert res.source_url.endswith("NzEyNDg4NjE=")
    assert "text/html" in res.content_type
    assert res.raw_content == full
    assert res.source_revision_key == "01"
    assert isinstance(res.fetched_at, datetime)


def test_tmu_does_not_support_enrich():
    tmu = get_adapter("TMU")
    assert tmu.supports_detail_enrich is False

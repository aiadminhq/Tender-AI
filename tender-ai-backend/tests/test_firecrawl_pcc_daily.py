# -*- coding: utf-8 -*-
"""scripts/firecrawl_pcc_daily.py 備援 cascade 離線測試。

全程不連網、不跑真實 OpenCLI：monkeypatch 模組內的 adapter class／helper 函式。
腳本非套件模組，用 importlib 以檔案路徑載入（本庫尚無 scripts/ 測試先例，見本檔）。
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = BACKEND_ROOT / "scripts" / "firecrawl_pcc_daily.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("firecrawl_pcc_daily", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def mod():
    return _load_module()


# --------------------------------------------------------------------- #
# _build_fallback_firecrawl
# --------------------------------------------------------------------- #
def test_build_fallback_firecrawl_skips_when_unset(mod, monkeypatch):
    monkeypatch.delenv("FIRECRAWL_FALLBACK_API_KEY", raising=False)
    monkeypatch.delenv("FIRECRAWL_FALLBACK_API_URL", raising=False)
    assert mod._build_fallback_firecrawl() is None


def test_build_fallback_firecrawl_builds_when_key_set(mod, monkeypatch):
    monkeypatch.setenv("FIRECRAWL_FALLBACK_API_KEY", "fc-fallback-key")
    monkeypatch.delenv("FIRECRAWL_FALLBACK_API_URL", raising=False)

    built = {}

    class FakeAdapter:
        def __init__(self, *, api_key=None, api_url=None):
            built["api_key"] = api_key
            built["api_url"] = api_url

    monkeypatch.setattr(mod, "PCCFirecrawlAdapter", FakeAdapter)
    result = mod._build_fallback_firecrawl()
    assert isinstance(result, FakeAdapter)
    assert built == {"api_key": "fc-fallback-key", "api_url": None}


def test_build_fallback_firecrawl_returns_none_on_init_failure(mod, monkeypatch, capsys):
    monkeypatch.setenv("FIRECRAWL_FALLBACK_API_URL", "http://localhost:3002")
    monkeypatch.delenv("FIRECRAWL_FALLBACK_API_KEY", raising=False)

    class BrokenAdapter:
        def __init__(self, *, api_key=None, api_url=None):
            raise RuntimeError("boom")

    monkeypatch.setattr(mod, "PCCFirecrawlAdapter", BrokenAdapter)
    assert mod._build_fallback_firecrawl() is None
    assert "boom" in capsys.readouterr().err


# --------------------------------------------------------------------- #
# _build_opencli_fallback
# --------------------------------------------------------------------- #
def test_build_opencli_fallback_skips_when_binary_missing(mod, monkeypatch, capsys):
    def fake_init(self, *, captcha_wait_s=180.0):
        raise RuntimeError("找不到 opencli 執行檔（~/.hermes/node/bin/opencli 或 PATH）")

    monkeypatch.setattr(mod.PCCOpenCLIAdapter, "__init__", fake_init)
    assert mod._build_opencli_fallback() is None
    assert "OpenCLI" in capsys.readouterr().err


def test_build_opencli_fallback_returns_instance_with_captcha_wait_zero(mod, monkeypatch):
    seen = {}

    def fake_init(self, *, captcha_wait_s=180.0):
        seen["captcha_wait_s"] = captcha_wait_s

    monkeypatch.setattr(mod.PCCOpenCLIAdapter, "__init__", fake_init)
    result = mod._build_opencli_fallback()
    assert isinstance(result, mod.PCCOpenCLIAdapter)
    assert seen["captcha_wait_s"] == 0


# --------------------------------------------------------------------- #
# _build_fallback_transports
# --------------------------------------------------------------------- #
def test_build_fallback_transports_disabled_returns_empty(mod, monkeypatch):
    # 就算兩個備援都會成功，enabled=False 也不該去建構
    monkeypatch.setattr(mod, "_build_fallback_firecrawl", lambda: object())
    monkeypatch.setattr(mod, "_build_opencli_fallback", lambda: object())
    assert mod._build_fallback_transports(enabled=False) == []


def test_build_fallback_transports_orders_firecrawl_before_opencli(mod, monkeypatch):
    fc = object()
    cli = object()
    monkeypatch.setattr(mod, "_build_fallback_firecrawl", lambda: fc)
    monkeypatch.setattr(mod, "_build_opencli_fallback", lambda: cli)
    transports = mod._build_fallback_transports(enabled=True)
    assert transports == [("備援 Firecrawl", fc), ("OpenCLI", cli)]


def test_build_fallback_transports_skips_none_entries(mod, monkeypatch):
    cli = object()
    monkeypatch.setattr(mod, "_build_fallback_firecrawl", lambda: None)
    monkeypatch.setattr(mod, "_build_opencli_fallback", lambda: cli)
    transports = mod._build_fallback_transports(enabled=True)
    assert transports == [("OpenCLI", cli)]


# --------------------------------------------------------------------- #
# _fallback_fetch_list
# --------------------------------------------------------------------- #
class _FakeTransport:
    def __init__(self, *, pks=None, detail=None, error=None):
        self._pks = pks
        self._detail = detail
        self._error = error
        self.calls = 0

    def fetch_list_case_pks(self, exec_location, start, end):
        self.calls += 1
        if self._error:
            raise self._error
        return self._pks

    def fetch_detail(self, pk):
        self.calls += 1
        if self._error:
            raise self._error
        return self._detail


def test_fallback_fetch_list_no_transports_returns_none(mod):
    assert mod._fallback_fetch_list("台北市", "loc", "2026/07/01", "2026/07/01", []) is None


def test_fallback_fetch_list_returns_first_success_even_if_empty(mod):
    first = _FakeTransport(pks=[])
    second = _FakeTransport(pks=["PK1"])
    transports = [("備援 A", first), ("備援 B", second)]
    result = mod._fallback_fetch_list("台北市", "loc", "2026/07/01", "2026/07/01", transports)
    assert result == []
    assert first.calls == 1
    assert second.calls == 0  # 第一層已回應（即使 0 筆），不再往下試


def test_fallback_fetch_list_falls_through_on_exception(mod):
    first = _FakeTransport(error=RuntimeError("網路失敗"))
    second = _FakeTransport(pks=["PK1", "PK2"])
    transports = [("備援 A", first), ("備援 B", second)]
    result = mod._fallback_fetch_list("台北市", "loc", "2026/07/01", "2026/07/01", transports)
    assert result == ["PK1", "PK2"]
    assert first.calls == 1
    assert second.calls == 1


def test_fallback_fetch_list_all_fail_returns_none(mod):
    first = _FakeTransport(error=RuntimeError("A 失敗"))
    second = _FakeTransport(error=RuntimeError("B 失敗"))
    transports = [("備援 A", first), ("備援 B", second)]
    result = mod._fallback_fetch_list("台北市", "loc", "2026/07/01", "2026/07/01", transports)
    assert result is None


# --------------------------------------------------------------------- #
# _fallback_fetch_detail
# --------------------------------------------------------------------- #
def test_fallback_fetch_detail_no_transports_returns_none(mod):
    assert mod._fallback_fetch_detail("52009999", []) is None


def test_fallback_fetch_detail_returns_first_success(mod):
    sentinel = object()
    first = _FakeTransport(detail=sentinel)
    second = _FakeTransport(detail=object())
    transports = [("備援 A", first), ("備援 B", second)]
    result = mod._fallback_fetch_detail("52009999", transports)
    assert result is sentinel
    assert first.calls == 1
    assert second.calls == 0


def test_fallback_fetch_detail_falls_through_on_exception(mod):
    sentinel = object()
    first = _FakeTransport(error=RuntimeError("A 失敗"))
    second = _FakeTransport(detail=sentinel)
    transports = [("備援 A", first), ("備援 B", second)]
    result = mod._fallback_fetch_detail("52009999", transports)
    assert result is sentinel
    assert first.calls == 1
    assert second.calls == 1


def test_fallback_fetch_detail_all_fail_returns_none(mod):
    first = _FakeTransport(error=RuntimeError("A 失敗"))
    second = _FakeTransport(error=RuntimeError("B 失敗"))
    transports = [("備援 A", first), ("備援 B", second)]
    result = mod._fallback_fetch_detail("52009999", transports)
    assert result is None

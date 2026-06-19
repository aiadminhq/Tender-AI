# -*- coding: utf-8 -*-
"""PCCAdapter 進階查詢列表全抓的離線測試(不連網)。

涵蓋:真實列表 fixture 抽 case_pk(去重、全數字、token 解碼)、URL 組裝(execLocation
代入、日期斜線 URL-encode)、空/無效輸入防御、不過濾(只去重)。
"""
from __future__ import annotations

from pathlib import Path

from app.adapters.pcc import PCCAdapter

FIX = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


def test_parse_list_real_fixture_unique_case_pks():
    """台北進階查詢列表 → 11 筆唯一 case_pk,全為純數字(已由 base64 token 解碼)。"""
    pks = PCCAdapter.parse_list_case_pks(_load("pcc_list_taipei.html"))
    assert len(pks) == 11
    assert len(set(pks)) == 11  # 已去重
    assert all(p.isdigit() for p in pks)
    assert "71252818" in pks  # 與含投標須知詳情 fixture 同源案件


def test_parse_list_dedup_preserves_order():
    """同一 tpam token 重複出現(列表每列多個錨點)→ 去重保序。"""
    import base64

    tok = base64.b64encode(b"71252818").decode("ascii")
    href = f"/prkms/urlSelector/common/tpam?pk={tok}"
    html = (
        '<table id="tpam">'
        f'<tr><td><a href="{href}">檢視</a></td><td><a href="{href}">機關</a></td></tr>'
        f'<tr><td><a href="/prkms/urlSelector/common/tpam?pk={base64.b64encode(b"999").decode()}">檢視</a></td></tr>'
        "</table>"
    )
    assert PCCAdapter.parse_list_case_pks(html) == ["71252818", "999"]


def test_parse_list_empty_and_none():
    assert PCCAdapter.parse_list_case_pks("") == []
    assert PCCAdapter.parse_list_case_pks(None) == []
    assert PCCAdapter.parse_list_case_pks("<html><body>查無資料</body></html>") == []


def test_advanced_list_url_encodes_location_and_dates():
    url = PCCAdapter().advanced_list_url("EXECUTE_LOCATION_20000200", "2026/06/18", "2026/06/18")
    assert "readTenderAdvanced?" in url
    assert "execLocation=EXECUTE_LOCATION_20000200" in url
    # 日期斜線 URL-encode
    assert "tenderStartDate=2026%2F06%2F18" in url
    assert "tenderEndDate=2026%2F06%2F18" in url


def test_exec_locations_cover_two_cities():
    """兩條進階 URL 僅 execLocation 不同;加縣市只需在 EXEC_LOCATIONS 增一筆。"""
    assert PCCAdapter.EXEC_LOCATIONS["台北市"] == "EXECUTE_LOCATION_2"
    assert PCCAdapter.EXEC_LOCATIONS["新北市"] == "EXECUTE_LOCATION_20000200"

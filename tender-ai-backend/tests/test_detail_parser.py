# -*- coding: utf-8 -*-
"""PCC 詳情頁純函式解析器 detail_parser 的離線測試。

全程不連網：以 tests/fixtures/ 內的 transport 等價 HTML（full）與人工變體
（corrected/minimal/invalid）為輸入，斷言型別欄正規化、防御性缺欄、有效頁判斷、
NFKC 與 <br> 換行。對齊修訂計畫 §6 測試矩陣 detail_parser 部分（1–5）。
"""
from __future__ import annotations

from pathlib import Path

from app.services.detail_parser import (
    ParsedDetail,
    extract_source_revision_key,
    is_captcha_page,
    parse_pcc_detail,
    structure_text,
)

FIX = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


def _page(rows: list[tuple[str, str]]) -> str:
    """組一個會通過有效頁判斷（>=30 個 headers=tb_02）的合成 PCC 詳情頁。

    rows 為 (label, value_html)；另補 20 列 filler 確保 td[headers=tb_02] 充足。
    """
    filler = [(f"欄位{i}", f"值{i}") for i in range(20)]
    trs = "".join(
        f'<tr><td headers="tb_02">{k}</td><td headers="tb_02">{v}</td></tr>'
        for k, v in rows + filler
    )
    return f"<html><body><table>{trs}</table></body></html>"


# --------------------------------------------------------------------------- #
# 1) full fixture → 各型別欄正確
# --------------------------------------------------------------------------- #
def test_full_typed_fields():
    d = parse_pcc_detail(_load("pcc_detail_full.html"))
    assert isinstance(d, ParsedDetail)

    # 押標金：開頭「是」→ True、額度去逗號轉 int、原文保留
    assert d.deposit_required is True
    assert d.deposit_amount_twd == 150000
    assert "150000" in d.deposit_raw_text

    # 廠商資格：代碼抽成陣列（去重保序）、原文保留
    assert d.qualification_codes == ["E101011", "E102011"]
    assert "E101011" in d.qualification_text

    # 標的分類：主類 / 4 碼代碼 / 名稱 / 原文
    assert d.category_main == "工程類"
    assert d.category_code == "5179"
    assert d.category_name == "其他裝修工程"
    assert "工程類" in d.category_raw

    # 決標方式：白名單命中
    assert d.award_method == "最有利標"

    # 履約：期限/地點
    assert d.performance_period and "竣工" in d.performance_period
    assert d.performance_location and "臺北市" in d.performance_location

    # 新增公告傳輸次數 = source_revision_key
    assert d.source_revision_key == "01"

    # raw_fields 含公開來源欄位
    assert "預算金額" in d.raw_fields
    assert "3,129,067" in d.raw_fields["預算金額"]


# --------------------------------------------------------------------------- #
# 2) corrected fixture → 押標金被清空、傳輸次數遞增（更正公告如實反映）
# --------------------------------------------------------------------------- #
def test_corrected_clears_deposit():
    d = parse_pcc_detail(_load("pcc_detail_corrected.html"))
    assert d is not None
    # 免押標金 → 非「是」開頭：required False、金額 None、原文保留
    assert d.deposit_required is False
    assert d.deposit_amount_twd is None
    assert d.deposit_raw_text == "免押標金"
    # 傳輸次數已從 01 → 02
    assert d.source_revision_key == "02"


def test_deposit_without_amount():
    """押標金「是」但無額度數字 → required True、amount None、原文保留。"""
    d = parse_pcc_detail(_page([("是否須繳納押標金", "是，但不提供線上繳納")]))
    assert d.deposit_required is True
    assert d.deposit_amount_twd is None
    assert "線上繳納" in d.deposit_raw_text


# --------------------------------------------------------------------------- #
# 3) minimal fixture → 缺欄回 None/空，不丟例外（防御）
# --------------------------------------------------------------------------- #
def test_minimal_defensive_none():
    d = parse_pcc_detail(_load("pcc_detail_minimal.html"))
    assert d is not None  # 仍是有效頁
    assert d.deposit_required is None
    assert d.deposit_amount_twd is None
    assert d.deposit_raw_text is None
    assert d.qualification_codes == []
    assert d.qualification_text is None
    assert d.category_main is None
    assert d.category_code is None
    assert d.award_method is None
    assert d.performance_period is None
    assert d.source_revision_key is None
    # 但既有標籤仍進 raw_fields
    assert d.raw_fields.get("招標方式") == "公開招標"
    assert "預算金額" in d.raw_fields


# --------------------------------------------------------------------------- #
# 4) invalid fixture（查無資料）→ 有效頁判斷擋下，回 None
# --------------------------------------------------------------------------- #
def test_invalid_page_returns_none():
    assert parse_pcc_detail(_load("pcc_detail_invalid.html")) is None
    assert parse_pcc_detail("") is None
    assert parse_pcc_detail("<html><body>哈囉</body></html>") is None


# --------------------------------------------------------------------------- #
# 5) NFKC 正規化 與 <br> → 換行
# --------------------------------------------------------------------------- #
def test_nfkc_normalization():
    # 全形英數 ＡＢ１２３ 經 NFKC → 半形 AB123
    d = parse_pcc_detail(_page([("標案案號", "ＡＢ１２３")]))
    assert d.raw_fields["標案案號"] == "AB123"


def test_category_br_to_newline():
    d = parse_pcc_detail(_page([("標的分類", "財物類<br>3052 - 電腦設備")]))
    assert d.category_main == "財物類"
    assert d.category_code == "3052"
    assert d.category_name == "電腦設備"
    assert "\n" in d.category_raw


# --------------------------------------------------------------------------- #
# 6) 投標須知下載附件解析
# --------------------------------------------------------------------------- #
def test_attachments_real_bid_doc_fixture():
    """含投標須知的真實詳情頁 → 抓到一筆、URL 絕對化且帶完整 query。"""
    d = parse_pcc_detail(_load("pcc_detail_with_bid_doc.html"))
    assert d is not None
    assert len(d.attachments) == 1
    att = d.attachments[0]
    assert att["filename"] == "投標須知下載"
    assert att["url"].startswith("https://web.pcc.gov.tw/tps/QueryTender/query/downloadNoticeDocument")
    assert "pkPmsMain=" in att["url"]


def test_attachments_absent_when_no_bid_doc():
    """minimal 頁無投標須知連結 → 空清單,不丟例外。"""
    d = parse_pcc_detail(_load("pcc_detail_minimal.html"))
    assert d is not None
    assert d.attachments == []


def test_attachments_absolutize_and_filter():
    """相對連結補前綴;tb_02 區外的下載連結與 javascript: 連結都排除;去重。"""
    DL = "/tps/QueryTender/query/downloadNoticeDocument?pkPmsMain=X"
    rows = (
        # 有效欄位區內的投標須知(相對連結) → 命中、絕對化
        f'<tr><td headers="tb_02">投標文件</td>'
        f'<td headers="tb_02"><a href="{DL}">投標須知下載</a></td></tr>'
        # 同一連結重複 → 去重
        f'<tr><td headers="tb_02">重複</td>'
        f'<td headers="tb_02"><a href="{DL}">投標須知下載</a></td></tr>'
        # javascript: 領標 → 排除
        '<tr><td headers="tb_02">領標</td>'
        '<td headers="tb_02"><a href="javascript:void(0)">電子領標</a></td></tr>'
    )
    filler = "".join(
        f'<tr><td headers="tb_02">欄位{i}</td><td headers="tb_02">值{i}</td></tr>'
        for i in range(30)
    )
    # tb_02 區外的下載專區連結 → 排除（無 headers 屬性）
    footer = '<tr><td>頁尾</td><td><a href="/pis/prac/downloadGroupClient/x?id=1">系統使用手冊下載</a></td></tr>'
    html = f"<html><body><table>{rows}{filler}{footer}</table></body></html>"
    d = parse_pcc_detail(html)
    assert d is not None
    assert d.attachments == [
        {"filename": "投標須知下載", "url": "https://web.pcc.gov.tw/tps/QueryTender/query/downloadNoticeDocument?pkPmsMain=X"}
    ]


# --------------------------------------------------------------------------- #
# 7) CAPTCHA 攔截頁辨識(反大量查詢;不破解、僅辨識供容錯分流)
# --------------------------------------------------------------------------- #
def test_captcha_page_detected():
    """真實縮樣 CAPTCHA 頁 → is_captcha_page True;且 parse 仍判無效頁回 None。"""
    raw = _load("pcc_detail_captcha.html")
    assert is_captcha_page(raw) is True
    # 區分點:CAPTCHA 頁無 tb_02 → 一般解析器當作「無效頁」回 None,
    # 故必須靠 is_captcha_page 才能與「查無資料」分流。
    assert parse_pcc_detail(raw) is None


def test_captcha_markers_each_hit():
    """任一已知標記命中即判 True(撲克牌配對指示 / 驗證端點 / 防惡意程式語句)。"""
    assert is_captcha_page("...請於B區挑選與A區相同之撲克牌...") is True
    assert is_captcha_page('<form action="/tps/validate/check">') is True
    assert is_captcha_page("本系統為預防惡意程式進行大量查詢") is True


def test_non_captcha_pages_are_false():
    """正常/查無資料/空頁皆非 CAPTCHA(不誤判,避免把真失敗當可重試)。"""
    assert is_captcha_page(_load("pcc_detail_full.html")) is False
    assert is_captcha_page(_load("pcc_detail_invalid.html")) is False
    assert is_captcha_page("") is False
    assert is_captcha_page(None) is False


# --------------------------------------------------------------------------- #
# extract_source_revision_key：供 adapter 在 fetch 階段廉價取得（與 full parse 同源）
# --------------------------------------------------------------------------- #
def test_extract_source_revision_key():
    assert extract_source_revision_key(_load("pcc_detail_full.html")) == "01"
    assert extract_source_revision_key(_load("pcc_detail_corrected.html")) == "02"
    assert extract_source_revision_key("<html></html>") is None


# --------------------------------------------------------------------------- #
# structure_text：資格摘要結構化為通用「屬性/標籤/內文/參數」條目
# --------------------------------------------------------------------------- #
def test_structure_text_codes_and_requirements_from_full_fixture():
    d = parse_pcc_detail(_load("pcc_detail_full.html"))
    items = d.qualification_items
    assert isinstance(items, list) and items

    # 代碼行被依代碼切成 code 條目：label＝代碼、content＝其後中文名稱
    codes = [it for it in items if it["kind"] == "code"]
    assert [c["label"] for c in codes] == ["E101011", "E102011"]
    assert codes[0]["content"] == "綜合營造業丙等(含以上)"
    assert "土木包工業" in codes[1]["content"]

    # 非代碼行為 requirement 條目
    reqs = [it for it in items if it["kind"] == "requirement"]
    assert any("廠商登記或設立之證明" == r["content"] for r in reqs)

    # 通用結構鍵齊備、params 預設空 dict
    for it in items:
        assert set(it) == {"kind", "label", "content", "params"}
        assert it["params"] == {}


def test_structure_text_ordinal_prefix_stripped_to_label():
    items = [it.to_dict() for it in structure_text("一、廠商登記\n2.納稅證明\n（3）其他資格")]
    assert items[0] == {"kind": "requirement", "label": "一", "content": "廠商登記", "params": {}}
    assert items[1]["label"] == "2" and items[1]["content"] == "納稅證明"
    assert items[2]["label"] == "3" and items[2]["content"] == "其他資格"


def test_structure_text_note_before_codes():
    items = [it.to_dict() for it in structure_text("符合下列任一：E101011綜合營造業、E102011土木包工業")]
    assert items[0]["kind"] == "note" and items[0]["content"] == "符合下列任一"
    assert [it["label"] for it in items if it["kind"] == "code"] == ["E101011", "E102011"]


def test_structure_text_empty_and_none():
    assert structure_text(None) == []
    assert structure_text("   \n  \n") == []

# -*- coding: utf-8 -*-
"""PCC 政府電子採購網「招標公告詳情頁」的純函式解析器。

此模組**不連網、無副作用**：輸入一段已抓回的 HTML，輸出正規化後的
``ParsedDetail``；由 adapter 負責抓取、由 enrich job 負責持久化。對齊
修訂計畫 §5 欄位正規化與 §6 測試矩陣。

設計要點
--------
* **以標籤文字定位**：詳情頁欄位編碼為「一列兩格」的 ``<tr>``，左格是標籤、
  右格是值；class 僅供配色，不可當語意鍵。
* **頂層欄位過濾**：頂層欄位列的兩個 *直接子* ``<td>`` 都帶 ``headers="tb_02"``；
  巢狀表格的 td 帶 inline style 而無此屬性，藉此乾淨排除巢狀雜訊。
  注意 ``headers`` 在 BeautifulSoup 為多值屬性，``td.get("headers")`` 回傳
  ``['tb_02']``（list），故須以成員判斷而非字串相等。
* **有效頁判斷**：正常詳情頁帶 ≥30 個 ``headers="tb_02"`` 的 td（完整頁約 132 個）；
  「查無資料」頁為 0，據此擋下無效頁回 ``None``。
* **正規化**：值文字一律 NFKC（全形→半形、全形空格→半形）並把 ``<br>`` 轉為換行。
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from bs4 import BeautifulSoup

# 有效頁門檻：headers="tb_02" 的 td 數量
_VALID_TB02_MIN = 30

# PCC 站台基底（投標須知等相對連結絕對化用）
_PCC_BASE = "https://web.pcc.gov.tw"

# 投標須知下載：詳情頁唯一落在 tb_02 有效區內的下載連結;
# 以「連結文字含投標須知」或「href 含下載端點」雙重命中(頁尾教學/下載專區均在 tb_02 外,不誤抓)。
_BID_DOC_ENDPOINT = "downloadNoticeDocument"
_BID_DOC_LABEL = "投標須知"

# 決標方式白名單（以實際頁面用語為準，掃描第一個命中者）
_AWARD_METHODS = ("最有利標", "最低標", "複數決標", "統包", "協商措施", "公開評選")

# 押標金額度：「押標金額度：150000」（NFKC 後冒號為半形，仍容半/全形）
_DEPOSIT_AMOUNT_RE = re.compile(r"押標金額度[：:]\s*([0-9,]+)")

# 廠商資格代碼：一碼英文 + 六碼數字，如 E101011
_QUALIFICATION_CODE_RE = re.compile(r"[A-Z]\d{6}")

# 標的分類代碼-名稱：4 碼 - 名稱，如「5179 - 其他裝修工程」
_CATEGORY_CODE_RE = re.compile(r"(\d{4})\s*-\s*(.+)")


@dataclass
class ParsedDetail:
    """詳情頁正規化結果；對應 tender_revisions 的型別欄 + raw_fields。"""

    award_method: str | None = None
    deposit_required: bool | None = None
    deposit_amount_twd: int | None = None
    deposit_raw_text: str | None = None
    qualification_codes: list[str] = field(default_factory=list)
    qualification_text: str | None = None
    category_main: str | None = None
    category_code: str | None = None
    category_name: str | None = None
    category_raw: str | None = None
    performance_period: str | None = None
    performance_location: str | None = None
    subsidy_source: str | None = None
    extra_note: str | None = None
    source_revision_key: str | None = None
    attachments: list[dict] = field(default_factory=list)
    raw_fields: dict[str, str] = field(default_factory=dict)


# --------------------------------------------------------------------------- #
# 內部 helper
# --------------------------------------------------------------------------- #
def _nfkc(text: str) -> str:
    """NFKC 正規化（全形英數→半形、全形空格→半形）。"""
    return unicodedata.normalize("NFKC", text)


def _cell_text(td) -> str:
    """把值格轉為文字：``<br>`` → 換行、逐行 strip、去空行、整體 NFKC。

    會抓進巢狀表格/div 的可見文字（押標金收款資訊等），符合「原文逐字保留」。
    """
    for br in td.find_all("br"):
        br.replace_with("\n")
    raw = td.get_text("\n")
    lines = [ln.strip() for ln in raw.splitlines()]
    joined = "\n".join(ln for ln in lines if ln)
    return _nfkc(joined).strip()


def _is_valid_page(soup: BeautifulSoup) -> bool:
    return len(soup.find_all("td", attrs={"headers": "tb_02"})) >= _VALID_TB02_MIN


def _top_level_fields(soup: BeautifulSoup) -> dict[str, str]:
    """抽出所有頂層欄位列 → ``{label: value_text}``（首見為準）。"""
    fields: dict[str, str] = {}
    for tr in soup.find_all("tr"):
        tds = tr.find_all("td", recursive=False)
        if len(tds) != 2:
            continue
        if "tb_02" not in (tds[0].get("headers") or []):
            continue
        label = _nfkc(tds[0].get_text(strip=True)).strip()
        if not label:
            continue
        fields.setdefault(label, _cell_text(tds[1]))
    return fields


def _find(fields: dict[str, str], *keys: str) -> str | None:
    """回傳「標籤含任一 key」的第一個值；找不到回 None。"""
    for label, value in fields.items():
        if any(k in label for k in keys):
            return value or None
    return None


def _parse_deposit(raw: str | None, out: ParsedDetail) -> None:
    if not raw:
        return
    out.deposit_raw_text = raw
    head = raw.lstrip()[:1]
    if head == "是":
        out.deposit_required = True
    elif head in ("否", "免"):
        out.deposit_required = False
    m = _DEPOSIT_AMOUNT_RE.search(raw)
    if m:
        out.deposit_amount_twd = int(m.group(1).replace(",", ""))


def _parse_qualification(raw: str | None, out: ParsedDetail) -> None:
    if not raw:
        return
    out.qualification_text = raw
    seen: list[str] = []
    for code in _QUALIFICATION_CODE_RE.findall(raw):
        if code not in seen:
            seen.append(code)
    out.qualification_codes = seen


def _parse_category(raw: str | None, out: ParsedDetail) -> None:
    if not raw:
        return
    out.category_raw = raw
    lines = [ln for ln in raw.splitlines() if ln.strip()]
    if lines:
        out.category_main = lines[0].strip()
    m = _CATEGORY_CODE_RE.search(raw)
    if m:
        out.category_code = m.group(1)
        out.category_name = m.group(2).strip()


def _parse_award_method(raw: str | None, out: ParsedDetail) -> None:
    if not raw:
        return
    for method in _AWARD_METHODS:
        if method in raw:
            out.award_method = method
            return


def _absolutize(href: str) -> str:
    """相對連結補站台前綴;已是絕對 URL 則原樣回傳。"""
    href = href.strip()
    if href.startswith("http://") or href.startswith("https://"):
        return href
    if not href.startswith("/"):
        href = "/" + href
    return _PCC_BASE + href


def _parse_attachments(soup: BeautifulSoup) -> list[dict]:
    """抽出「投標須知下載」附件清單(每筆 ``{filename, url}``)。

    只認落在 ``headers="tb_02"`` 有效欄位區內、且文字含「投標須知」或 href 指向
    下載端點的 ``<a>``;頁尾「下載專區/教學資料」等連結都在 tb_02 區外,天然排除。
    檔名以連結文字為標籤(實際副檔名由下載端依 Content-Disposition 決定);依
    絕對化 URL 去重。
    """
    seen: set[str] = set()
    out: list[dict] = []
    for a in soup.find_all("a"):
        href = (a.get("href") or "").strip()
        if not href or href.lower().startswith("javascript:"):
            continue
        text = _nfkc(a.get_text(strip=True)).strip()
        hit = _BID_DOC_ENDPOINT in href or _BID_DOC_LABEL in text
        if not hit:
            continue
        if a.find_parent("td", attrs={"headers": "tb_02"}) is None:
            continue
        url = _absolutize(href)
        if url in seen:
            continue
        seen.add(url)
        out.append({"filename": text or _BID_DOC_LABEL, "url": url})
    return out


# --------------------------------------------------------------------------- #
# 公開 API
# --------------------------------------------------------------------------- #
def parse_pcc_detail(html: str | None) -> ParsedDetail | None:
    """解析 PCC 詳情頁 HTML；無效頁（查無資料/空白）回 ``None``。"""
    if not html:
        return None
    soup = BeautifulSoup(html, "lxml")
    if not _is_valid_page(soup):
        return None

    fields = _top_level_fields(soup)
    out = ParsedDetail(raw_fields=fields)

    _parse_award_method(_find(fields, "決標方式"), out)
    _parse_deposit(_find(fields, "押標金"), out)
    _parse_qualification(_find(fields, "廠商資格"), out)
    _parse_category(_find(fields, "標的分類"), out)
    out.performance_period = _find(fields, "履約期限")
    out.performance_location = _find(fields, "履約地點")
    out.subsidy_source = _find(fields, "補助")
    out.extra_note = _find(fields, "附加說明", "其他內容")
    out.source_revision_key = _find(fields, "新增公告傳輸次數")
    out.attachments = _parse_attachments(soup)
    return out


# CAPTCHA 攔截頁標記:PCC 為防大量查詢,在詳情端點掛圖形驗證碼(撲克牌配對)。
# 命中任一標記即視為被擋(非「查無資料」、非解析失敗),屬可重試/可降級的暫時阻擋。
_CAPTCHA_MARKERS: tuple[str, ...] = (
    "驗證碼檢核",
    "請於B區挑選與A區相同",
    "/tps/validate/check",
    "為預防惡意程式",
)


def is_captcha_page(html: str | None) -> bool:
    """判斷是否為 PCC 圖形驗證碼攔截頁(反大量查詢)。

    純函式、不連網。命中任一已知標記即回 ``True``;與「查無資料」空頁(tb_02=0
    但無驗證碼字樣)區分開來,讓 enrich job 能把 CAPTCHA 歸為**可重試**而非
    解析失敗。**本函式不嘗試破解/繞過驗證碼**,僅做辨識供容錯分流。
    """
    if not html:
        return False
    return any(marker in html for marker in _CAPTCHA_MARKERS)


def extract_source_revision_key(html: str | None) -> str | None:
    """廉價取得「新增公告傳輸次數」（adapter 在 fetch 階段用，與完整解析同源）。

    無效頁或無此欄位回 ``None``。
    """
    if not html:
        return None
    soup = BeautifulSoup(html, "lxml")
    if not _is_valid_page(soup):
        return None
    return _find(_top_level_fields(soup), "新增公告傳輸次數")

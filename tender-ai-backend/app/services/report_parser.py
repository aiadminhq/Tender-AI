# -*- coding: utf-8 -*-
"""報表解析器：把歷史 HTML 報表還原成結構化標案資料（Layer A）。

純函式 + BeautifulSoup，完全 offline，不連任何外部站台（CI 安全）。設計重點：
- 以「表頭文字」辨識表格（PCC vs TMU），不依賴位置索引——0617 起 TMU 表排在 PCC 之前。
- 標的分類（category）與 TMU 區塊皆為可選；舊格式（0515）兩者皆無。
- 去重鍵 case_pk：PCC 取連結中 base64 編碼 pk 解碼後的數字串；
  TMU 取詳情頁 `Page.aspx?id=` 的 URL-decoded 值。
- 不重寫既有爬蟲核心；此模組只負責「讀回歷史產出」供回填與測試。
"""
from __future__ import annotations

import base64
import re
import unicodedata
import urllib.parse
from dataclasses import dataclass, field
from datetime import date

from bs4 import BeautifulSoup, NavigableString

# 台灣 22 直轄市/縣市正規名：由機關名稱「盡力」推斷城市，推不出回 None（不亂猜）。
_CITIES = [
    "臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市",
    "基隆市", "新竹市", "嘉義市",
    "新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義縣",
    "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣",
]

_TIER_BY_CLASS = {"tag-h": "high", "tag-m": "mid", "tag-l": "low"}
_ROC_RE = re.compile(r"(\d{2,3})/(\d{1,2})/(\d{1,2})")
_ISO_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
_DAYS_RE = re.compile(r"剩\s*(-?\d+)\s*天")
_PK_RE = re.compile(r"[?&]pk=([^&\"]+)")
_TMU_ID_RE = re.compile(r"[?&]id=([^&]+)")


@dataclass
class ParsedTender:
    source: str  # 'PCC' | 'TMU'
    case_pk: str
    name: str
    org: str | None
    category: str | None
    budget_wan: int | None
    deadline_roc: str | None
    deadline_iso: date | None
    tender_method: str | None
    city: str | None
    link: str | None
    tier: str | None
    days_left: int | None


@dataclass
class ParsedReport:
    pcc: list[ParsedTender] = field(default_factory=list)
    tmu: list[ParsedTender] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# 純函式 helper
# --------------------------------------------------------------------------- #
def _norm(s: str | None) -> str | None:
    """文字正規化：NFKC（把 PCC 來源混入的 CJK 相容字如 U+F98E 年 → 正規 U+5E74），
    供顯示／去重／後續 RAG 嵌入使用一致字形。空字串回 None。"""
    if not s:
        return None
    return unicodedata.normalize("NFKC", s).strip() or None


def roc_to_date(s: str | None) -> date | None:
    """民國日期字串（YYY/MM/DD，可夾在其他文字中）→ date；無法解析回 None。"""
    if not s:
        return None
    m = _ROC_RE.search(s)
    if not m:
        return None
    try:
        y, mo, d = (int(x) for x in m.groups())
        return date(y + 1911, mo, d)
    except ValueError:
        return None


def iso_to_date(s: str | None) -> date | None:
    """ISO 日期字串（YYYY-MM-DD，可夾在其他文字中）→ date；無法解析回 None。"""
    if not s:
        return None
    m = _ISO_RE.search(s)
    if not m:
        return None
    try:
        return date(*(int(x) for x in m.groups()))
    except ValueError:
        return None


def decode_pcc_pk(b64: str) -> str:
    """PCC 連結中的 base64 pk → 數字串；非合法 base64/非數字則原樣返回（防御）。"""
    try:
        dec = base64.b64decode(b64).decode("ascii")
        return dec if dec.isdigit() else b64
    except Exception:
        return b64


def parse_budget_wan(s: str | None) -> int | None:
    """預算字串（如 '177萬'、'1,234萬'）→ 整數（萬元）；無數字回 None。"""
    if not s:
        return None
    digits = re.sub(r"[^\d]", "", s)
    return int(digits) if digits else None


def parse_days_left(s: str | None) -> int | None:
    """'剩 N 天'（N 可為負）→ int；無匹配回 None。"""
    if not s:
        return None
    m = _DAYS_RE.search(s)
    return int(m.group(1)) if m else None


def tier_from_class(classes: list[str] | None) -> str | None:
    """潛力標籤 CSS class（tag-h/m/l）→ high/mid/low；其他回 None。"""
    if not classes:
        return None
    for c in classes:
        if c in _TIER_BY_CLASS:
            return _TIER_BY_CLASS[c]
    return None


def infer_city(org: str | None) -> str | None:
    """由機關名稱盡力推斷城市（含台→臺 正規化）；推不出回 None。"""
    if not org:
        return None
    norm = org.replace("台", "臺")
    for c in _CITIES:
        if c in norm:
            return c
    return None


def extract_pcc_pk(href: str | None) -> str | None:
    """PCC 連結 → 解碼後的 case_pk；無 pk 參數回 None。"""
    if not href:
        return None
    m = _PK_RE.search(href)
    return decode_pcc_pk(m.group(1)) if m else None


def extract_tmu_pk(href: str | None) -> str | None:
    """TMU 詳情頁連結（Page.aspx?id=）→ URL-decoded case_pk；非詳情頁回 None。"""
    if not href or "Page.aspx" not in href:
        return None
    m = _TMU_ID_RE.search(href)
    return urllib.parse.unquote(m.group(1)) if m else None


def aggregate(tenders: list[ParsedTender]) -> dict:
    """由列資料計算 daily_runs 聚合（精確可驗證者）。

    priority（期間最優先）無法由單列資料推得，固定回 0，由上層另行處理。
    刻意不耦合報表 footer/stats（舊版計算口徑含 TMU/其他，數字不一致）。
    """
    return {
        "total": len(tenders),
        "high": sum(1 for t in tenders if t.tier == "high"),
        "mid": sum(1 for t in tenders if t.tier == "mid"),
        "low": sum(1 for t in tenders if t.tier == "low"),
        "urgent": sum(1 for t in tenders if t.days_left is not None and t.days_left <= 7),
        "priority": 0,
        "budget_sum_wan": sum(t.budget_wan for t in tenders if t.budget_wan),
    }


# --------------------------------------------------------------------------- #
# 表格解析
# --------------------------------------------------------------------------- #
def _identify(table) -> str | None:
    ths = [th.get_text(strip=True) for th in table.find_all("th")]
    if "潛力" in ths and "招標方式" in ths:
        return "PCC"
    if "院區" in ths:
        return "TMU"
    return None


def _body_rows(table):
    body = table.find("tbody")
    return body.find_all("tr") if body else table.find_all("tr")


def _clean_name(div) -> str:
    """取 div 的直接文字節點（排除標的分類/緊急等 span），組成乾淨標案名稱。"""
    parts = [c for c in div.children if isinstance(c, NavigableString)]
    return "".join(parts).strip()


def _parse_pcc_row(tr) -> ParsedTender | None:
    tds = tr.find_all("td", recursive=False)
    if len(tds) < 6:
        return None
    tspan = tds[0].find("span")
    tier = tier_from_class(tspan.get("class") if tspan else None)

    divs = tds[1].find_all("div", recursive=False)
    cat_span = tds[1].find("span", title="標的分類")
    category = _norm(cat_span.get_text(strip=True)) if cat_span else None
    name = _norm(_clean_name(divs[0]) if divs else tds[1].get_text(strip=True))
    org = _norm(divs[1].get_text(strip=True)) if len(divs) > 1 else None

    budget = parse_budget_wan(tds[2].get_text(strip=True))

    dtext = tds[3].get_text(" ", strip=True)
    m_roc = _ROC_RE.search(dtext)
    deadline_roc = m_roc.group(0) if m_roc else None
    deadline_iso = roc_to_date(deadline_roc)
    days_left = parse_days_left(dtext)

    method = _norm(tds[4].get_text(strip=True))

    a = tds[5].find("a", href=True)
    link = a["href"] if a else None
    case_pk = extract_pcc_pk(link)
    if not case_pk:
        return None  # 無有效 pk 的列略過（去重鍵必備）

    return ParsedTender(
        source="PCC", case_pk=case_pk, name=name, org=org, category=category,
        budget_wan=budget, deadline_roc=deadline_roc, deadline_iso=deadline_iso,
        tender_method=method, city=infer_city(org), link=link,
        tier=tier, days_left=days_left,
    )


def _parse_tmu_row(tr) -> ParsedTender | None:
    tds = tr.find_all("td", recursive=False)
    if len(tds) < 5:
        return None
    cat_span = tds[0].find("span")
    category = _norm(cat_span.get_text(strip=True) if cat_span else tds[0].get_text(strip=True))
    hosp_span = tds[1].find("span")
    org = _norm(hosp_span.get_text(strip=True) if hosp_span else tds[1].get_text(strip=True))
    name = _norm(tds[2].get_text(strip=True))

    dtext = tds[3].get_text(" ", strip=True)
    deadline_iso = iso_to_date(dtext)
    days_left = parse_days_left(dtext)

    case_pk = link = None
    for a in tds[4].find_all("a", href=True):
        pk = extract_tmu_pk(a["href"])
        if pk:
            case_pk, link = pk, a["href"]
            break
    if not case_pk:
        return None

    return ParsedTender(
        source="TMU", case_pk=case_pk, name=name, org=org, category=category,
        budget_wan=None, deadline_roc=None, deadline_iso=deadline_iso,
        tender_method=None, city=infer_city(org), link=link,
        tier=None, days_left=days_left,
    )


def parse_report(html: str) -> ParsedReport:
    """解析單份報表 HTML → ParsedReport（pcc / tmu 兩串列）。日期由呼叫端從檔名決定。"""
    soup = BeautifulSoup(html, "lxml")
    report = ParsedReport()
    for table in soup.find_all("table"):
        kind = _identify(table)
        if kind == "PCC":
            report.pcc.extend(r for tr in _body_rows(table) if (r := _parse_pcc_row(tr)))
        elif kind == "TMU":
            report.tmu.extend(r for tr in _body_rows(table) if (r := _parse_tmu_row(tr)))
    return report

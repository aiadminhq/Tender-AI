# -*- coding: utf-8 -*-
"""report_parser 的 TDD 測試（offline，純解析歷史報表 HTML，不連 PCC/TMU）。

涵蓋：
- 純函式 helper（民國/ISO 日期、pk 解碼、預算、剩餘天數、分級、城市推斷）。
- 兩種報表格式的整合解析：
  * 0515 舊格式（143 筆 PCC、無標的分類 span、無 TMU、含 🔥 緊急 標記需濾除）。
  * 0617 新格式（22 筆 PCC 皆含標的分類、5 筆 TMU、TMU 表在 PCC 之前）。
- 聚合邏輯以合成資料測試，不與報表 footer/stats 耦合。
"""
from datetime import date
from pathlib import Path

import pytest

from app.services import report_parser as rp

FIX = Path(__file__).resolve().parent / "fixtures"
HTML_0515 = (FIX / "report_20260515.html").read_text(encoding="utf-8")
HTML_0617 = (FIX / "report_20260617.html").read_text(encoding="utf-8")


# --------------------------------------------------------------------------- #
# 純函式 helper
# --------------------------------------------------------------------------- #
class TestHelpers:
    def test_roc_to_date(self):
        assert rp.roc_to_date("115/06/25") == date(2026, 6, 25)
        assert rp.roc_to_date("114/05/15") == date(2025, 5, 15)
        assert rp.roc_to_date("亂碼") is None
        assert rp.roc_to_date("") is None

    def test_iso_to_date(self):
        assert rp.iso_to_date("2026-06-17") == date(2026, 6, 17)
        assert rp.iso_to_date("not-a-date") is None

    def test_decode_pcc_pk(self):
        assert rp.decode_pcc_pk("NzEyNDgwNzM=") == "71248073"
        assert rp.decode_pcc_pk("NzEyMTAzMjU=") == "71210325"
        # 非 base64 → 原樣返回（防御性，不丟例外）
        assert rp.decode_pcc_pk("plain123") == "plain123"

    def test_parse_budget_wan(self):
        assert rp.parse_budget_wan("177萬") == 177
        assert rp.parse_budget_wan("540萬") == 540
        assert rp.parse_budget_wan("1,234萬") == 1234
        assert rp.parse_budget_wan("") is None
        assert rp.parse_budget_wan(None) is None

    def test_parse_days_left(self):
        assert rp.parse_days_left("剩 8 天") == 8
        assert rp.parse_days_left("115/06/25 剩 0 天") == 0
        assert rp.parse_days_left("剩 -3 天") == -3
        assert rp.parse_days_left("沒有天數") is None

    def test_tier_from_class(self):
        assert rp.tier_from_class(["tag-h"]) == "high"
        assert rp.tier_from_class(["tag-m"]) == "mid"
        assert rp.tier_from_class(["tag-l"]) == "low"
        assert rp.tier_from_class(["something"]) is None
        assert rp.tier_from_class(None) is None

    def test_infer_city(self):
        assert rp.infer_city("臺北市文山區公所") == "臺北市"
        assert rp.infer_city("桃園市政府") == "桃園市"
        assert rp.infer_city("台中市某某局") == "臺中市"  # 台→臺 正規化
        assert rp.infer_city("某不含縣市的機關") is None
        assert rp.infer_city(None) is None

    def test_extract_tmu_pk(self):
        href = "https://cmd.tmu.edu.tw/Front/TMU/Page.aspx?id=dX0SPPp16ang%2BVR2zOgnpg=="
        assert rp.extract_tmu_pk(href) == "dX0SPPp16ang+VR2zOgnpg=="
        assert rp.extract_tmu_pk("https://x/Download.aspx?file=a.pdf") is None


# --------------------------------------------------------------------------- #
# 0515 舊格式整合
# --------------------------------------------------------------------------- #
class TestParse0515:
    @pytest.fixture(scope="class")
    def report(self):
        return rp.parse_report(HTML_0515)

    def test_counts(self, report):
        assert len(report.pcc) == 143
        assert len(report.tmu) == 0

    def test_tier_distribution(self, report):
        tiers = [t.tier for t in report.pcc]
        assert tiers.count("high") == 67
        assert tiers.count("mid") == 58
        assert tiers.count("low") == 18

    def test_first_row_fields(self, report):
        t = report.pcc[0]
        assert t.source == "PCC"
        assert t.name == "114年開刀房及ICU空調箱汰換"  # 🔥 緊急 已濾除
        assert t.org == "國立臺灣大學醫學院附設醫院新竹臺大分院"
        assert t.category is None  # 舊格式無標的分類
        assert t.budget_wan == 540
        assert t.deadline_roc == "115/05/15"
        assert t.deadline_iso == date(2026, 5, 15)
        assert t.days_left == 0
        assert t.tier == "high"
        assert t.tender_method == "公開招標"
        assert t.case_pk == "71210325"
        assert t.link and t.link.startswith("https://web.pcc.gov.tw/")

    def test_all_pk_are_digits(self, report):
        assert all(t.case_pk.isdigit() for t in report.pcc)

    def test_no_category_in_old_format(self, report):
        assert all(t.category is None for t in report.pcc)


# --------------------------------------------------------------------------- #
# 0617 新格式整合
# --------------------------------------------------------------------------- #
class TestParse0617:
    @pytest.fixture(scope="class")
    def report(self):
        return rp.parse_report(HTML_0617)

    def test_counts(self, report):
        assert len(report.pcc) == 22
        assert len(report.tmu) == 5

    def test_tier_distribution(self, report):
        tiers = [t.tier for t in report.pcc]
        assert tiers.count("high") == 20
        assert tiers.count("mid") == 2
        assert tiers.count("low") == 0

    def test_first_pcc_row(self, report):
        t = report.pcc[0]
        assert t.source == "PCC"
        assert t.category == "工程"
        assert t.name == "久康區民活動中心空間改善室內裝修工程"
        assert t.org == "臺北市文山區公所"
        assert t.budget_wan == 177
        assert t.deadline_roc == "115/06/25"
        assert t.deadline_iso == date(2026, 6, 25)
        assert t.days_left == 8
        assert t.tier == "high"
        assert t.tender_method == "公開招標"
        assert t.case_pk == "71248073"
        assert t.city == "臺北市"

    def test_all_pcc_have_category(self, report):
        assert all(t.category for t in report.pcc)

    def test_first_tmu_row(self, report):
        t = report.tmu[0]
        assert t.source == "TMU"
        assert t.category == "營繕工程"
        assert t.org == "附設醫院"  # 院區
        assert t.name == "第三醫療大樓戶外草坪整修工程案-1式"
        assert t.deadline_iso == date(2026, 6, 17)
        assert t.days_left == 0
        assert t.case_pk == "dX0SPPp16ang+VR2zOgnpg=="
        assert t.deadline_roc is None  # TMU 以 ISO 呈現

    def test_tmu_all_have_pk(self, report):
        assert all(t.case_pk for t in report.tmu)
        # TMU pk 不是純數字（base64-ish detail id）
        assert not report.tmu[0].case_pk.isdigit()


# --------------------------------------------------------------------------- #
# 聚合邏輯（合成資料，不耦合報表 footer/stats）
# --------------------------------------------------------------------------- #
class TestAggregate:
    def _mk(self, tier, days, budget):
        return rp.ParsedTender(
            source="PCC", case_pk="x", name="n", org=None, category=None,
            budget_wan=budget, deadline_roc=None, deadline_iso=None,
            tender_method=None, city=None, link=None, tier=tier, days_left=days,
        )

    def test_aggregate_counts(self):
        rows = [
            self._mk("high", 3, 100),
            self._mk("high", 10, 200),
            self._mk("mid", 5, 300),
            self._mk("low", 40, None),  # 預算缺值不計入總額
        ]
        agg = rp.aggregate(rows)
        assert agg["total"] == 4
        assert agg["high"] == 2
        assert agg["mid"] == 1
        assert agg["low"] == 1
        assert agg["urgent"] == 2  # days_left <= 7：3 與 5
        assert agg["budget_sum_wan"] == 600  # 100+200+300
        assert agg["priority"] == 0  # 期間最優先無法由列資料推得，保留 0

    def test_aggregate_empty(self):
        agg = rp.aggregate([])
        assert agg == {
            "total": 0, "high": 0, "mid": 0, "low": 0,
            "urgent": 0, "priority": 0, "budget_sum_wan": 0,
        }

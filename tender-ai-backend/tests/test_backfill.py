# -*- coding: utf-8 -*-
"""backfill 的純函式測試（不需 DB／不連網，CI 安全）。

DB 寫入路徑（upsert／冪等）以實際回填執行＋再跑驗證涵蓋，不在此處連線測試。
"""
from datetime import date

from app.jobs.backfill import _dedupe, date_from_filename
from app.services.report_parser import ParsedTender


def _t(case_pk, name="n"):
    return ParsedTender(
        source="PCC", case_pk=case_pk, name=name, org=None, category=None,
        budget_wan=None, deadline_roc=None, deadline_iso=None, tender_method=None,
        city=None, link=None, tier="high", days_left=1,
    )


class TestDateFromFilename:
    def test_valid(self):
        assert date_from_filename("tender-20260617.html") == date(2026, 6, 17)
        assert date_from_filename("/abs/path/tender-20260515.html") == date(2026, 5, 15)

    def test_invalid(self):
        assert date_from_filename("notes.html") is None
        assert date_from_filename("tender-2026.html") is None


class TestDedupe:
    def test_dedupe_keeps_first_per_pk(self):
        rows = [_t("A", "first"), _t("B"), _t("A", "second")]
        out = _dedupe(rows)
        pks = {t.case_pk for t in out}
        assert pks == {"A", "B"}
        assert len(out) == 2
        # 保留首見
        assert next(t for t in out if t.case_pk == "A").name == "first"

    def test_drops_missing_name_or_pk(self):
        rows = [_t("A"), _t("", "noPk"), _t("C", "")]
        out = _dedupe(rows)
        assert {t.case_pk for t in out} == {"A"}

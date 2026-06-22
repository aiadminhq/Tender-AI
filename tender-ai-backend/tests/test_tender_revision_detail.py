# -*- coding: utf-8 -*-
"""GET /api/v1/tenders/{id} 的 revision 詳情投影契約測試。

驗收：當標案有最新詳情版本（tenders.current_revision_id → tender_revisions）時，
詳情 API 應在 ``revision`` 暴露履約地點／資格／押標金／附件等 Layer A 欄位；
未 enrich 的案 ``revision`` 為 None（前端據此優雅退化為空狀態）。

資料硬規則：本測試僅用合成種子，附件清單只放索引（無 Layer B 行為資料）。
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.models.revision import TenderRevision, TenderSnapshot
from app.models.tender import Tender
from tests.conftest import TestSessionLocal

BASE = "/api/v1/tenders"


async def _attach_revision(tender_id: int) -> None:
    """為指定標案建 snapshot + revision_no=1，並把 current_revision_id 指過去。"""
    async with TestSessionLocal() as s:
        fetched = datetime(2026, 6, 18, 9, 0, tzinfo=timezone.utc)
        snap = TenderSnapshot(
            tender_id=tender_id,
            source_url="https://web.pcc.gov.tw/detail/h",
            http_status=200,
            content_hash="a" * 64,
            raw_html="<html>detail</html>",
            fetched_at=fetched,
        )
        s.add(snap)
        await s.flush()

        rev = TenderRevision(
            tender_id=tender_id,
            snapshot_id=snap.id,
            revision_no=1,
            content_hash="a" * 64,
            award_method="最有利標",
            deposit_required=True,
            deposit_amount_twd=120_000,
            deposit_raw_text="押標金新臺幣 120,000 元整",
            qualification_codes=["A123456", "B654321"],
            qualification_text="須具備室內裝修業登記證、近三年實績一件。",
            category_main="工程",
            category_name="室內裝修工程",
            category_raw="C 工程／室內裝修",
            performance_period="自決標日起 120 日曆天",
            performance_location="臺北市信義區市府路1號",
            subsidy_source="教育部補助款",
            extra_note="須辦理現場會勘。",
            attachments=[
                {
                    "filename": "投標須知.pdf",
                    "url": "https://web.pcc.gov.tw/files/notice.pdf",
                    "storage_uri": "data/downloads/h/notice.pdf",
                    "sha256": "b" * 64,
                },
                {
                    "filename": "設計圖.zip",
                    "url": "https://web.pcc.gov.tw/files/drawing.zip",
                    "skipped": True,
                    "error": "檔案過大，略過下載",
                },
            ],
            fetched_at=fetched,
        )
        s.add(rev)
        await s.flush()

        tender = await s.get(Tender, tender_id)
        tender.current_revision_id = rev.id
        tender.detail_checked_at = fetched
        await s.commit()


async def test_detail_exposes_revision_fields(client, seeded):
    """有 revision 的案：API 在 revision 暴露履約地點/資格/押標金/附件。"""
    await _attach_revision(seeded["high"])

    r = await client.get(f"{BASE}/{seeded['high']}")
    assert r.status_code == 200
    rev = r.json()["revision"]
    assert rev is not None

    assert rev["revision_no"] == 1
    assert rev["award_method"] == "最有利標"
    assert rev["deposit_required"] is True
    assert rev["deposit_amount_twd"] == 120_000
    assert rev["performance_location"] == "臺北市信義區市府路1號"
    assert rev["performance_period"] == "自決標日起 120 日曆天"
    assert rev["qualification_codes"] == ["A123456", "B654321"]
    assert "室內裝修" in rev["qualification_text"]
    assert rev["category_name"] == "室內裝修工程"
    assert rev["subsidy_source"] == "教育部補助款"

    # 附件：保留 filename/url，並依 storage_uri 推導 archived；skipped/error 如實帶出
    atts = rev["attachments"]
    assert len(atts) == 2
    assert atts[0]["filename"] == "投標須知.pdf"
    assert atts[0]["archived"] is True
    assert atts[1]["archived"] is False
    assert atts[1]["skipped"] is True
    assert atts[1]["error"] == "檔案過大，略過下載"


async def test_detail_without_revision_is_none(client, seeded):
    """未 enrich 的案（current_revision_id 為空）：revision 應為 None。"""
    r = await client.get(f"{BASE}/{seeded['mid']}")
    assert r.status_code == 200
    assert r.json()["revision"] is None

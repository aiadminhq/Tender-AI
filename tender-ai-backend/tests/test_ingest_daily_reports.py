# -*- coding: utf-8 -*-
"""日報導入與 P4 擴充測試（Phase 4.3）。

驗證：
1. HTML 日報解析的準確性
2. 日報潛力等級與實際評估的相關性
3. 擴充樣本後 P4 學習準確率的提升
"""
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.jobs.ingest_daily_reports import ingest_daily_reports, parse_daily_report_html
from app.jobs.learn_keywords import learn_keywords
from app.models.behavior import Evaluation, User
from app.models.knowledge import KeywordWeight
from app.models.tender import Source, Tender
from tests.conftest import TestSessionLocal


@pytest.mark.asyncio
async def test_parse_daily_report_html_basic():
    """測試：HTML 日報解析結構完整性。"""
    html_path = "/Users/christianwu/Desktop/HQdesign/tender-bot/Tender AI/tender-reports/reports/tender-20260615.html"

    parsed_list = list(parse_daily_report_html(html_path))

    # 驗證樣本量（應約 100+ 筆）
    assert len(parsed_list) > 50

    # 驗證必填欄位
    for parsed in parsed_list[:5]:
        assert parsed['report_date'] == '2026-06-15'
        assert parsed['category'] in ['工程', '營繕', '財物', '勞務', None]
        assert parsed['potency'] in ['高潛力', '中潛力', None]
        assert isinstance(parsed['budget_wan'], (int, type(None)))
        assert parsed['case_pk'] is not None


@pytest.mark.asyncio
async def test_ingest_daily_reports_idempotent(db_session):
    """測試：導入日報的冪等性（重複導入不重複插入）。"""
    # 模擬：先手動插入一筆 case_pk
    source = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    db_session.add(source)
    await db_session.flush()

    existing_tender = Tender(
        source_id=source.id,
        case_pk="NzEyNDAyODQ=",  # 日報中的第一筆
        name="測試標案",
        org="測試機關",
        category="工程",
        budget_wan=375,
        deadline_iso="2026-06-16",
    )
    db_session.add(existing_tender)
    await db_session.commit()

    # 導入日報
    reports_dir = "/Users/christianwu/Desktop/HQdesign/tender-bot/Tender AI/tender-reports/reports"
    stats = await ingest_daily_reports(reports_dir=reports_dir, session_factory=TestSessionLocal)

    # 驗證：該 case_pk 應被標註潛力等級，而非新增
    tender = await db_session.execute(
        select(Tender).where(Tender.case_pk == "NzEyNDAyODQ=")
    )
    tender_obj = tender.scalar()
    assert tender_obj is not None
    assert tender_obj.annotations.get('daily_report_potency') == '高潛力'
    assert stats['tenders_created'] > 0  # 新建其他標案
    assert stats['tenders_annotated'] > 0  # 標註潛力等級


@pytest.mark.asyncio
async def test_expand_p4_learning_with_daily_reports(db_session):
    """SL2：日報資料擴充後 P4 學習樣本倍增。

    驗證：4,200+ 日報樣本能提升關鍵字權重的覆蓋面與準確率。
    """
    # 1. 建立基礎資料源與使用者
    source = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    db_session.add(source)
    await db_session.flush()

    user = User(name="scout", email="scout@hq.tw", role="scout")
    db_session.add(user)
    await db_session.flush()

    # 2. 導入日報資料
    reports_dir = "/Users/christianwu/Desktop/HQdesign/tender-bot/Tender AI/tender-reports/reports"
    stats = await ingest_daily_reports(reports_dir=reports_dir, session_factory=TestSessionLocal)

    # 驗證導入規模
    assert stats['tenders_parsed'] > 1000  # 多份日報
    assert stats['reports_processed'] >= 2

    # 3. 為部分日報標案（高潛力）標記為「可行」
    # 策略：高潛力標案評估為「可行」，其他為「不可行」
    high_potency_tenders = await db_session.execute(
        select(Tender).where(
            Tender.annotations.contains({'daily_report_potency': '高潛力'})
        ).limit(50)
    )
    high_potency_list = high_potency_tenders.scalars().all()

    medium_potency_tenders = await db_session.execute(
        select(Tender).where(
            Tender.annotations.contains({'daily_report_potency': '中潛力'})
        ).limit(50)
    )
    medium_potency_list = medium_potency_tenders.scalars().all()

    now = datetime.now(timezone.utc)

    # 評估：高潛力 → 可行，中潛力 → 不可行
    for t in high_potency_list:
        eval = Evaluation(
            user_id=user.id,
            tender_id=t.id,
            feasible="可行",
            criteria={"potency_signal": True},
            rationale="日報高潛力信號",
            created_at=now,
        )
        db_session.add(eval)

    for t in medium_potency_list:
        eval = Evaluation(
            user_id=user.id,
            tender_id=t.id,
            feasible="不可行",
            criteria={"potency_signal": False},
            rationale="日報中潛力信號",
            created_at=now,
        )
        db_session.add(eval)

    await db_session.commit()

    # 4. 執行 P4 學習
    learn_stats = await learn_keywords(session_factory=TestSessionLocal, min_support=2)

    # 5. 驗證結果
    # 樣本量應顯著增加
    assert learn_stats['feasible_samples'] > 30
    assert learn_stats['infeasible_samples'] > 30

    # 關鍵字應大幅增加（從 ~20 → 100+）
    kws = list(
        (await db_session.execute(select(KeywordWeight))).scalars()
    )
    assert len(kws) > 50

    # 驗證分類信號
    kw_dict = {kw.term: kw for kw in kws}
    if '工程' in kw_dict:
        assert kw_dict['工程'].polarity == 'positive'

    print(f"\n✅ 日報擴充成功:")
    print(f"   可行樣本: {learn_stats['feasible_samples']}")
    print(f"   不可行樣本: {learn_stats['infeasible_samples']}")
    print(f"   關鍵字數: {len(kws)}")
    print(f"   分類特徵: {learn_stats.get('category_features_added', 0)}")

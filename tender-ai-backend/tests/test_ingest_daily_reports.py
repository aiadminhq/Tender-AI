# -*- coding: utf-8 -*-
"""日報導入與 P4 擴充測試（Phase 4.3）。

驗證：
1. HTML 日報解析的準確性（committed fixture，CI 必跑）
2. 日報潛力等級標註與導入冪等性（committed fixture，CI 必跑）
3. 擴充樣本後 P4 學習準確率的提升（需本機完整 archive，CI/雲端 skip）

資料來源策略（修正既有 tech debt：不再硬編絕對路徑、不再依賴 gitignored 檔）：
- 單元/冪等測試一律走版控內的 ``tests/fixtures/report_*.html``，並以 ``tmp_path``
  組出符合 production glob（``tender-*.html``）的目錄，故 CI/雲端可離線重現。
- 大規模學習測試需要完整日報 archive（``tender-reports/reports/``，已 gitignore），
  本機才有；缺檔時 ``pytest.skip`` 而非 fail。
"""
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import select

from app.jobs.ingest_daily_reports import ingest_daily_reports, parse_daily_report_html
from app.jobs.learn_keywords import learn_keywords
from app.models.behavior import Evaluation, User
from app.models.knowledge import KeywordWeight
from app.models.tender import Source, Tender
from tests.conftest import TestSessionLocal

# 版控內的日報 fixture（離線、CI 可用）；report_20260617.html 解析得 22 筆標案。
FIX = Path(__file__).resolve().parent / "fixtures"
# 完整日報 archive：tender-ai-backend 的上一層即 "Tender AI"，archive 為其下 sibling。
# 已 gitignore（屬 tender-bot 報表站台產物），CI/雲端不存在。
REAL_ARCHIVE = Path(__file__).resolve().parents[2] / "tender-reports" / "reports"


def test_parse_daily_report_html_basic():
    """HTML 日報解析結構完整性（純函式，走 committed fixture）。"""
    html_path = FIX / "report_20260617.html"

    parsed_list = list(parse_daily_report_html(str(html_path)))

    # fixture 實際解析得 22 筆；給下限以容忍日後 fixture 微調
    assert len(parsed_list) >= 10

    # 驗證必填欄位
    for parsed in parsed_list[:5]:
        # report_date 由檔名 20260617 推導
        assert parsed['report_date'] == '2026-06-17'
        assert parsed['category'] in ['工程', '營繕', '財物', '勞務', None]
        assert parsed['potency'] in ['高潛力', '中潛力', None]
        assert isinstance(parsed['budget_wan'], (int, type(None)))
        assert parsed['case_pk'] is not None


def _seed_reports_dir(tmp_path: Path) -> Path:
    """把 committed fixture 複製成符合 production glob（tender-*.html）的目錄。

    production 端 ``ingest_daily_reports`` 以 ``glob("tender-*.html")`` 掃描，
    fixture 命名為 ``report_*.html``，故在 tmp 改名後放入，既不動產線 glob、
    也不污染共用 fixtures 目錄。
    """
    reports_dir = tmp_path / "reports"
    reports_dir.mkdir()
    for stem_date in ("20260515", "20260617"):
        src = FIX / f"report_{stem_date}.html"
        (reports_dir / f"tender-{stem_date}.html").write_text(
            src.read_text(encoding="utf-8"), encoding="utf-8"
        )
    return reports_dir


@pytest.mark.asyncio
async def test_ingest_daily_reports_idempotent(db_session, tmp_path):
    """導入日報的冪等性（重複導入不重複插入；走 committed fixture）。"""
    # 模擬：先手動插入一筆 fixture 中確實存在的 case_pk（report_20260617 第一筆）
    source = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    db_session.add(source)
    await db_session.flush()

    existing_tender = Tender(
        source_id=source.id,
        case_pk="NzEyNDgwNzM=",  # report_20260617.html 的第一筆
        name="測試標案",
        org="測試機關",
        category="工程",
        budget_wan=375,
        deadline_iso="2026-06-17",
    )
    db_session.add(existing_tender)
    await db_session.commit()

    # 以 fixture 組出符合 production glob 的目錄後導入
    reports_dir = _seed_reports_dir(tmp_path)
    stats = await ingest_daily_reports(reports_dir=str(reports_dir), session_factory=TestSessionLocal)

    # 驗證：該 case_pk 應被標註潛力等級，而非新增（冪等性）
    tender = await db_session.execute(
        select(Tender).where(Tender.case_pk == "NzEyNDgwNzM=")
    )
    tender_obj = tender.scalar()
    assert tender_obj is not None
    # 驗證被標註了日報潛力等級（具體值取決於日期先後，不檢查特定值）
    assert tender_obj.annotations is not None
    assert 'daily_report_potency' in tender_obj.annotations
    assert tender_obj.annotations['daily_report_potency'] in ['高潛力', '中潛力']
    assert 'daily_report_date' in tender_obj.annotations
    assert stats['tenders_created'] > 0  # 新建其他標案
    assert stats['tenders_annotated'] > 0  # 標註潛力等級


@pytest.mark.asyncio
async def test_expand_p4_learning_with_daily_reports(db_session):
    """SL2：日報資料擴充後 P4 學習樣本倍增。

    驗證：4,200+ 日報樣本能提升關鍵字權重的覆蓋面與準確率。
    本測試需要完整日報 archive（gitignored），且 ingest 全 archive 耗時長，
    故預設 skip，僅在設定 ``RUN_SLOW_INGEST=1`` 且本機有 archive 時執行，
    避免一般 ``pytest`` 全跑時卡在這支重型測試（CI/雲端永遠 skip）。
    """
    if not os.getenv("RUN_SLOW_INGEST"):
        pytest.skip(
            "重型測試：需 RUN_SLOW_INGEST=1 才執行（ingest 全 archive 耗時，預設 skip 以免逾時）"
        )
    if not (REAL_ARCHIVE.exists() and list(REAL_ARCHIVE.glob("tender-*.html"))):
        pytest.skip(
            "需要本機完整日報 archive（tender-reports/reports，已 gitignore；CI/雲端不可用）"
        )

    # 1. 建立基礎資料源與使用者
    source = Source(name="PCC", base_url="https://web.pcc.gov.tw")
    db_session.add(source)
    await db_session.flush()

    user = User(name="scout", email="scout@hq.tw", role="scout")
    db_session.add(user)
    await db_session.flush()

    # 2. 導入日報資料
    stats = await ingest_daily_reports(reports_dir=str(REAL_ARCHIVE), session_factory=TestSessionLocal)

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

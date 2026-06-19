# -*- coding: utf-8 -*-
"""每日報告解析與資料擴充（Phase 4.3 日報數據學習）。

工作流程：
1. 批量掃描 tender-YYYYMMDD.html 日報
2. 逐行解析標案欄位：分類、名稱、預算、截止、潛力評分
3. 提取 PCC case_pk（base64 編碼）
4. 與既有 tenders 表整合（case_pk 去重）
5. 標註日報潛力等級至 tender.metadata（供 P4 學習擴充）

鐵則：不連網；純 HTML 解析，無外部抓取。
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator

from bs4 import BeautifulSoup
from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.tender import Source, Tender


def parse_roc_date(roc_str: str) -> str:
    """將民國年月日格式（115/06/16）轉為 ISO 日期（2026-06-16）。

    ROC year = Western year - 1911
    """
    match = re.match(r"(\d+)/(\d+)/(\d+)", roc_str.strip())
    if not match:
        return None

    roc_year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
    western_year = roc_year + 1911
    return f"{western_year:04d}-{month:02d}-{day:02d}"


def extract_budget_wan(budget_str: str) -> int | None:
    """從「375萬」格式提取整數 375。"""
    match = re.search(r"(\d+(?:,\d+)*)", budget_str)
    if match:
        try:
            return int(match.group(1).replace(",", ""))
        except ValueError:
            return None
    return None


def parse_daily_report_html(html_path: str) -> Generator[dict, None, None]:
    """解析日報 HTML，逐行產出標案資料。

    Yields:
        {
            'report_date': '2026-06-15',
            'potency': '高潛力',  # 🟢 or 🟡
            'category': '工程',
            'tender_name': '新北市三芝區埔坪市民活動中央空調系統汰換工程',
            'agency': '新北市三芝區公所',
            'budget_wan': 375,
            'deadline_iso': '2026-06-16',
            'tender_method': '公開招標',
            'case_pk': 'NzEyNDAyODQ=',  # base64 編碼的 PCC case_pk
            'is_urgent': True,  # 🔥 標記
        }
    """
    with open(html_path, 'r', encoding='utf-8') as f:
        soup = BeautifulSoup(f.read(), 'html.parser')

    # 從檔名提取日期
    filename = Path(html_path).stem
    report_date_match = re.search(r"(\d{4})(\d{2})(\d{2})", filename)
    if not report_date_match:
        return
    report_date = f"{report_date_match.group(1)}-{report_date_match.group(2)}-{report_date_match.group(3)}"

    # 主表（第二個 table，第一個是 TMU 專區）
    tables = soup.find_all('table')
    if len(tables) < 2:
        return

    main_table = tables[1]
    rows = main_table.find_all('tr')[1:]  # 跳過表頭

    for row in rows:
        cols = row.find_all('td')
        if len(cols) < 6:
            continue

        # 欄位提取
        potency_raw = cols[0].get_text(strip=True)  # "🟢 高潛力" or "🟡 中潛力"
        potency = "高潛力" if "🟢" in potency_raw else ("中潛力" if "🟡" in potency_raw else None)

        tender_html = cols[1].decode_contents()
        tender_text = cols[1].get_text(strip=True)

        # 從 tender_text 中分離分類、名稱、機關
        category_span = cols[1].find('span', {'style': lambda x: x and '1e3a5f' in x})
        category = category_span.get_text(strip=True) if category_span else None

        # 機關名通常在第 2、3 行（HTML 結構中）
        agency_lines = [line.strip() for line in tender_text.split('\n') if line.strip()]
        agency = agency_lines[-1] if len(agency_lines) >= 2 else None

        # 標案名稱 = 整個 text 去掉分類、機關、緊急標記
        tender_name = tender_text.replace(category or "", "").replace("🔥 緊急", "").replace(agency or "", "").strip()

        budget_wan = extract_budget_wan(cols[2].get_text(strip=True))

        deadline_roc = None
        for line in cols[3].get_text(strip=True).split('\n'):
            if re.match(r"\d+/\d+/\d+", line.strip()):
                deadline_roc = line.strip()
                break
        deadline_iso = parse_roc_date(deadline_roc) if deadline_roc else None

        tender_method = cols[4].get_text(strip=True)

        # PCC case_pk 從 href 提取（base64 編碼）
        case_pk = None
        link_elem = cols[5].find('a')
        if link_elem:
            href = link_elem.get('href', '')
            match = re.search(r'pk=([A-Za-z0-9%/+=]+)', href)
            if match:
                case_pk = match.group(1)

        is_urgent = "🔥" in tender_text

        yield {
            'report_date': report_date,
            'potency': potency,
            'category': category,
            'tender_name': tender_name,
            'agency': agency,
            'budget_wan': budget_wan,
            'deadline_iso': deadline_iso,
            'tender_method': tender_method,
            'case_pk': case_pk,
            'is_urgent': is_urgent,
        }


async def ingest_daily_reports(
    reports_dir: str = "/Users/christianwu/Desktop/HQdesign/tender-bot/Tender AI/tender-reports/reports",
    session_factory=None,
) -> dict:
    """批量導入日報 → 擴充 P4 學習樣本。

    策略：
    - 若 tender.case_pk 已存在，附註日報潛力等級至 metadata
    - 若不存在，建立新 Tender（回填用，但不覆蓋既有評估）

    Args:
        reports_dir: 日報目錄路徑
        session_factory: 測試用 session 工廠

    Returns:
        {
            'reports_processed': 日報檔數,
            'tenders_parsed': 總標案數,
            'tenders_created': 新建標案數,
            'tenders_annotated': 標註潛力等級數,
            'stats_by_potency': {'高潛力': N, '中潛力': M, ...},
        }
    """
    if session_factory is None:
        session_factory = AsyncSessionLocal

    stats = {
        'reports_processed': 0,
        'tenders_parsed': 0,
        'tenders_created': 0,
        'tenders_annotated': 0,
        'stats_by_potency': {},
    }

    report_dir_path = Path(reports_dir)
    html_files = sorted(report_dir_path.glob("tender-*.html"))

    async with session_factory() as session:
        # 確保 PCC Source 存在
        pcc_source = await session.execute(
            select(Source).where(Source.name == "PCC")
        )
        pcc_source_obj = pcc_source.scalar()
        if not pcc_source_obj:
            pcc_source_obj = Source(name="PCC", base_url="https://web.pcc.gov.tw")
            session.add(pcc_source_obj)
            await session.flush()
        source_id = pcc_source_obj.id

        for html_path in html_files:
            stats['reports_processed'] += 1

            for parsed in parse_daily_report_html(str(html_path)):
                stats['tenders_parsed'] += 1

                potency = parsed.get('potency')
                if potency:
                    stats['stats_by_potency'][potency] = stats['stats_by_potency'].get(potency, 0) + 1

                # 若 case_pk 為 None，跳過（無法定位）
                if not parsed['case_pk']:
                    continue

                # 查詢既有標案
                existing = await session.execute(
                    select(Tender).where(Tender.case_pk == parsed['case_pk'])
                )
                tender_obj = existing.scalar()

                if tender_obj:
                    # 附註日報潛力等級
                    if tender_obj.annotations is None:
                        tender_obj.annotations = {}
                    if 'daily_report_potency' not in tender_obj.annotations:
                        tender_obj.annotations['daily_report_potency'] = potency
                        tender_obj.annotations['daily_report_date'] = parsed['report_date']
                        tender_obj.annotations['daily_report_urgent'] = parsed['is_urgent']
                        stats['tenders_annotated'] += 1
                else:
                    # 建立新標案（回填）
                    tender_obj = Tender(
                        source_id=source_id,
                        case_pk=parsed['case_pk'],
                        name=parsed['tender_name'],
                        org=parsed['agency'],
                        category=parsed['category'],
                        budget_wan=parsed['budget_wan'],
                        deadline_iso=parsed['deadline_iso'],
                        tender_method=parsed['tender_method'],
                        annotations={
                            'daily_report_potency': potency,
                            'daily_report_date': parsed['report_date'],
                            'daily_report_urgent': parsed['is_urgent'],
                        },
                        first_seen=datetime.fromisoformat(f"{parsed['report_date']}T00:00:00+00:00"),
                        last_seen=datetime.fromisoformat(f"{parsed['report_date']}T23:59:59+00:00"),
                    )
                    session.add(tender_obj)
                    stats['tenders_created'] += 1

        await session.commit()

    return stats


async def main() -> None:
    stats = await ingest_daily_reports()
    print(f"✅ 日報導入完成：{stats}")


if __name__ == "__main__":
    asyncio.run(main())

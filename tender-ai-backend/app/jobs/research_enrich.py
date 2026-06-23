# -*- coding: utf-8 -*-
"""研究資料蒐集 enrich job:PCC 進階查詢「全抓」→ 詳情深抓 → 投標須知歸檔。

與 ``enrich_details`` 的差異(後者只對「既有 Tender 列」做 TTL 補抓):本 job 先以
兩條進階查詢 URL(台北/新北,僅 ``execLocation`` 不同)**全抓列表**,**建/更新**
``tenders``(``case_pk`` 去重 + ``first_seen``/``last_seen``),再對每筆打詳情頁、解析、
**下載並歸檔投標須知**,落成不可變 revision。沿用既有 revision-first 持久層與失敗退避。

定位與鐵則
----------
* **不過濾**:地點/預算等條件已編在進階查詢 URL 內;程式碼只去重 ``case_pk``,
  不再砍案(全收作為研究數據與標注參考)。
* **關鍵字 = 標注標籤,非過濾器**:命中室內/裝修語彙寫成 ``annotations``(布林 + 命中詞),
  供後續研究標注「較易中標 × 投標須知條件」的關聯,**絕不據此剔除標案**。
* **投標須知歸檔**:詳情頁 ``tb_02`` 區內的「投標須知下載」連結 → ``archiver`` 下載到
  ``data/downloads/<source>/<case_pk>/``,索引(含 ``storage_uri``)寫入 ``revision.attachments``。
* **唯一 live 連 PCC 的研究元件 → 絕不在 CI/pytest 跑。** 測試 monkeypatch
  ``PCCAdapter.fetch_list_case_pks`` / ``fetch_detail`` 回 fixture、注入 ``archiver``
  與 ``session_factory`` / ``now``,不連網。

執行(本機手動 / 排程):
    uv run python -m app.jobs.research_enrich                       # 今日,台北+新北
    uv run python -m app.jobs.research_enrich --start 2026/06/18 --end 2026/06/18
    uv run python -m app.jobs.research_enrich --city 台北市 --rate-limit 1.5
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import random
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select, update

from app.adapters import get_adapter
from app.adapters.pcc import PCCAdapter
from app.db.session import AsyncSessionLocal
from app.jobs.backfill_category import normalize_category
from app.jobs.enrich_details import (
    INTERIOR_KEYWORDS,
    _archive_dir,
    _record_failure,
    _resolve_failures,
    derive_annotations,
)
from app.models.revision import CrawlRun, TenderRevision, TenderSnapshot
from app.models.tender import Source, Tender
from app.services.archiver import archive_attachments
from app.services.detail_parser import is_captcha_page, parse_pcc_detail
from app.services.report_parser import parse_budget_wan, roc_to_date

_SOURCE_NAME = "PCC"

# 室內/裝修語彙種子、衍生標注、附件歸檔目錄三者與 TTL enrich 共用一份,
# 集中定義於 app.jobs.enrich_details(此處 re-import,避免兩路徑漂移)。


def _budget_wan_from_detail(raw: str | None) -> int | None:
    """詳情頁「預算金額」為**元**(如 '9,800,000元')→ 轉萬元整數;無數字回 None。"""
    twd = parse_budget_wan(raw)  # 僅抽數字,得元值
    return twd // 10000 if twd else None


async def _ensure_source(session, name: str) -> int:
    """取得(或建立)來源列,回 source_id。"""
    sid = (
        await session.execute(select(Source.id).where(Source.name == name))
    ).scalar()
    if sid is not None:
        return sid
    src = Source(name=name, base_url=PCCAdapter.base_url)
    session.add(src)
    await session.flush()
    return src.id


async def _discover(
    session,
    *,
    adapter: PCCAdapter,
    source_id: int,
    cities: list[str],
    start: str,
    end: str,
    now: datetime,
) -> list[tuple[int, str, str]]:
    """全抓各縣市進階查詢列表 → 建/更新 Tender(case_pk 去重)→ 回 [(tender_id, case_pk, city)]。

    新案以暫定名建列(詳情解析成功後回填真實欄位);既有案更新 ``last_seen``。
    **不過濾**,只去重(首見縣市為準)。連網點:``adapter.fetch_list_case_pks``。
    """
    discovered: dict[str, str] = {}  # case_pk → city(首見為準)
    for city in cities:
        loc = adapter.EXEC_LOCATIONS[city]
        for pk in adapter.fetch_list_case_pks(loc, start, end):
            discovered.setdefault(pk, city)

    today = now.date()
    out: list[tuple[int, str, str]] = []
    for case_pk, city in discovered.items():
        existing = (
            await session.execute(
                select(Tender.id).where(
                    Tender.source_id == source_id, Tender.case_pk == case_pk
                )
            )
        ).scalar()
        if existing is None:
            tender = Tender(
                source_id=source_id,
                case_pk=case_pk,
                name=f"(待補) {case_pk}",  # 詳情解析成功後回填
                city=city,
                link=adapter.detail_url(case_pk),
                first_seen=today,
                last_seen=today,
            )
            session.add(tender)
            await session.flush()
            tid = tender.id
        else:
            await session.execute(
                update(Tender).where(Tender.id == existing).values(last_seen=today)
            )
            tid = existing
        out.append((tid, case_pk, city))
    await session.commit()
    return out


async def _process_one(
    session,
    *,
    run_id: int,
    adapter: PCCAdapter,
    tender_id: int,
    case_pk: str,
    now: datetime,
    archive_base_dir: Path | None,
    archiver,
) -> tuple[str, int, bool]:
    """處理單一標的(各自獨立 transaction);回傳 ``(outcome, archived_count, interior_hit)``。

    outcome:``new`` / ``unchanged`` / ``fetch_fail`` / ``parse_fail``。整批不中斷。
    """
    # 1) 抓詳情(唯一 live 連 PCC 之處)
    try:
        fr = adapter.fetch_detail(case_pk)
    except Exception as exc:  # noqa: BLE001 — 整批不中斷,記帳後續跑
        await session.rollback()
        await _record_failure(
            session, run_id=run_id, tender_id=tender_id, stage="fetch",
            http_status=None, exc=exc, retriable=True, now=now,
        )
        return "fetch_fail", 0, False

    # 2) 抓取驗證
    if fr.status_code != 200:
        await _record_failure(
            session, run_id=run_id, tender_id=tender_id, stage="fetch",
            http_status=fr.status_code, exc=None,
            retriable=fr.status_code >= 500, now=now,
        )
        return "fetch_fail", 0, False
    if "text/html" not in (fr.content_type or ""):
        await _record_failure(
            session, run_id=run_id, tender_id=tender_id, stage="fetch",
            http_status=fr.status_code, exc=None, retriable=False, now=now,
        )
        return "fetch_fail", 0, False

    raw = fr.raw_content
    content_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()

    # 3) 去重:同案同 content_hash 已入庫 → 內容未變
    exists = (
        await session.execute(
            select(TenderSnapshot.id).where(
                TenderSnapshot.tender_id == tender_id,
                TenderSnapshot.content_hash == content_hash,
            )
        )
    ).scalar()
    if exists is not None:
        await session.execute(
            update(Tender).where(Tender.id == tender_id).values(detail_checked_at=now)
        )
        await _resolve_failures(session, tender_id, now)
        await session.commit()
        return "unchanged", 0, False

    # 4) CAPTCHA 攔截分流:PCC 詳情端點掛反大量查詢的圖形驗證碼,回 200+HTML 但
    #    tb_02=0。**不破解/不繞過**,辨識後歸為「可重試的暫時阻擋」(非 parse 失敗),
    #    讓退避重試生效;呼叫端據此優雅中止整批(見主迴圈),避免連發被封 IP。
    if is_captcha_page(raw):
        await _record_failure(
            session, run_id=run_id, tender_id=tender_id, stage="captcha",
            http_status=fr.status_code, exc=None, retriable=True, now=now,
        )
        return "captcha", 0, False

    # 5) 解析(失敗則不入 snapshot,記 parse 失敗)
    parsed = parse_pcc_detail(raw)
    if parsed is None:
        await _record_failure(
            session, run_id=run_id, tender_id=tender_id, stage="parse",
            http_status=fr.status_code, exc=None, retriable=False, now=now,
        )
        return "parse_fail", 0, False

    # 5) 投標須知歸檔(逐檔防呆;連網點可注入 archiver 離線測試)
    archived = (
        archiver(adapter.source_name, case_pk, parsed.attachments, base_dir=archive_base_dir)
        if parsed.attachments
        else []
    )
    archived_ok = sum(1 for r in archived if r.get("storage_uri"))

    # 6) 衍生標注標籤(供標注,不過濾)
    name = parsed.raw_fields.get("標案名稱") if parsed.raw_fields else None
    annotations = derive_annotations(
        name, parsed.category_name, parsed.category_raw, parsed.extra_note
    )

    # 7) 單一 transaction:snapshot → revision → 回填 Tender 真實欄位 + 現值投影 → 解除失敗
    revision_key = parsed.source_revision_key or fr.source_revision_key
    snapshot = TenderSnapshot(
        tender_id=tender_id,
        source_url=fr.source_url,
        http_status=fr.status_code,
        content_type=fr.content_type,
        content_hash=content_hash,
        source_revision_key=fr.source_revision_key,
        raw_html=raw,
        storage_uri=_archive_dir(archived),  # 附件歸檔目錄(離庫指標)
        fetched_at=fr.fetched_at,
    )
    session.add(snapshot)
    await session.flush()

    next_no = (
        await session.execute(
            select(func.coalesce(func.max(TenderRevision.revision_no), 0)).where(
                TenderRevision.tender_id == tender_id
            )
        )
    ).scalar() + 1
    revision = TenderRevision(
        tender_id=tender_id,
        snapshot_id=snapshot.id,
        revision_no=next_no,
        content_hash=content_hash,
        source_revision_key=revision_key,
        award_method=parsed.award_method,
        deposit_required=parsed.deposit_required,
        deposit_amount_twd=parsed.deposit_amount_twd,
        deposit_raw_text=parsed.deposit_raw_text,
        qualification_codes=parsed.qualification_codes,
        qualification_text=parsed.qualification_text,
        category_main=parsed.category_main,
        category_code=parsed.category_code,
        category_name=parsed.category_name,
        category_raw=parsed.category_raw,
        performance_period=parsed.performance_period,
        performance_location=parsed.performance_location,
        subsidy_source=parsed.subsidy_source,
        extra_note=parsed.extra_note,
        raw_fields=parsed.raw_fields,
        attachments=archived or None,
        annotations=annotations,
        fetched_at=fr.fetched_at,
    )
    session.add(revision)
    await session.flush()

    # 回填 Tender 主檔欄位(詳情為憑;city 於 discovery 已定,不覆蓋)
    rf = parsed.raw_fields or {}
    deadline_roc = (rf.get("截止投標") or "").split()[0] or None  # 去掉時間段
    tender_values = {
        "current_revision_id": revision.id,
        "detail_checked_at": now,
        "org": rf.get("機關名稱"),
        "budget_wan": _budget_wan_from_detail(rf.get("預算金額")),
        "deadline_roc": deadline_roc,
        "deadline_iso": roc_to_date(deadline_roc),
        "tender_method": (rf.get("招標方式") or "")[:32] or None,
        "category": normalize_category(parsed.category_main),
    }
    if name:  # 有真實名稱才覆蓋暫定名
        tender_values["name"] = name
    await session.execute(
        update(Tender).where(Tender.id == tender_id).values(**tender_values)
    )
    await _resolve_failures(session, tender_id, now)
    await session.commit()
    return "new", archived_ok, bool(annotations["interior_match"])


async def run_research_enrich(
    *,
    start: str | None = None,
    end: str | None = None,
    cities: list[str] | None = None,
    trigger: str = "manual",
    rate_limit_s: float = 2.0,
    now: datetime | None = None,
    session_factory=None,
    archive_base_dir: Path | None = None,
    archiver=archive_attachments,
    adapter: PCCAdapter | None = None,
    limit: int | None = None,
) -> dict:
    """執行一次研究 enrich;回傳統計 dict。

    參數
    ----
    start / end : 進階查詢日期(``YYYY/MM/DD``);省略則皆為今日。
    cities : 縣市清單(預設 ``PCCAdapter.EXEC_LOCATIONS`` 全部:台北市+新北市)。
    trigger / rate_limit_s : 寫入 crawl_run 的觸發來源 / 每筆抓取間隔秒數(測試傳 0)。
    now / session_factory / archive_base_dir / archiver : 測試注入點(固定時鐘 / 測試庫 /
        歸檔根目錄 / 假 archiver),全注入即可離線、不連網。
    adapter : 注入自訂 PCC adapter(如 ``PCCOpenCLIAdapter`` 走瀏覽器繞 CAPTCHA);
        省略則用 registry 預設的 server-side ``PCCAdapter``。
    """
    now = now or datetime.now(timezone.utc)
    factory = session_factory or AsyncSessionLocal
    adapter = adapter or get_adapter(_SOURCE_NAME)
    cities = cities or list(adapter.EXEC_LOCATIONS)
    today_roc = _ad_to_roc(now)
    start = start or today_roc
    end = end or today_roc

    stats = {
        "run_id": None,
        "trigger": trigger,
        "discovered": 0,
        "fetched": 0,
        "unchanged": 0,
        "new_revisions": 0,
        "failed": 0,
        "captcha": 0,
        "deferred": 0,
        "attachments_archived": 0,
        "interior_hits": 0,
        "aborted_on_captcha": False,
    }

    async with factory() as session:
        run = CrawlRun(trigger=trigger, status="running")
        session.add(run)
        await session.flush()
        run_id = run.id
        await session.commit()
        stats["run_id"] = run_id

        source_id = await _ensure_source(session, _SOURCE_NAME)
        await session.commit()

        targets = await _discover(
            session, adapter=adapter, source_id=source_id,
            cities=cities, start=start, end=end, now=now,
        )
        if limit is not None and limit >= 0:
            # 分階段抓取(先單頁驗證再全批)：discovery 後截斷處理數，不影響去重建檔。
            targets = targets[:limit]
        stats["discovered"] = len(targets)

        for idx, (tid, case_pk, _city) in enumerate(targets):
            if idx and rate_limit_s:
                # 禮貌節流:基準間隔 + 抖動,避免規律請求被識別(jitter 0~rate 的 50%)
                await asyncio.sleep(rate_limit_s + random.uniform(0, rate_limit_s * 0.5))
            try:
                outcome, archived_ok, interior = await _process_one(
                    session, run_id=run_id, adapter=adapter, tender_id=tid,
                    case_pk=case_pk, now=now, archive_base_dir=archive_base_dir,
                    archiver=archiver,
                )
            except Exception as exc:  # noqa: BLE001 — 殘餘錯誤亦不中斷整批
                await session.rollback()
                await _record_failure(
                    session, run_id=run_id, tender_id=tid, stage="fetch",
                    http_status=None, exc=exc, retriable=True, now=now,
                )
                outcome, archived_ok, interior = "fetch_fail", 0, False

            if outcome == "new":
                stats["fetched"] += 1
                stats["new_revisions"] += 1
                stats["attachments_archived"] += archived_ok
                stats["interior_hits"] += int(interior)
            elif outcome == "unchanged":
                stats["fetched"] += 1
                stats["unchanged"] += 1
            elif outcome == "captcha":
                stats["failed"] += 1
                stats["captcha"] += 1
            else:
                stats["failed"] += 1
            print(
                f"  [{idx + 1}/{stats['discovered']}] {_SOURCE_NAME}/{case_pk} → {outcome}",
                file=sys.stderr,
            )

            # 優雅中止:一旦撞到反大量查詢的驗證碼,繼續連發既無用(常駐攔截)又不禮貌
            #(易招 IP 封鎖)。停止整批,剩餘標的標為 deferred(已記可重試失敗,下輪退避再抓)。
            if outcome == "captcha":
                stats["aborted_on_captcha"] = True
                stats["deferred"] = stats["discovered"] - (idx + 1)
                print(
                    f"  ⚠ 撞到 PCC 驗證碼攔截,優雅中止;剩餘 {stats['deferred']} 筆 deferred",
                    file=sys.stderr,
                )
                break

        run = await session.get(CrawlRun, run_id)
        run.targeted = stats["discovered"]
        run.fetched = stats["fetched"]
        run.unchanged = stats["unchanged"]
        run.new_revisions = stats["new_revisions"]
        run.failed = stats["failed"]
        run.finished_at = now
        run.status = "completed"
        run.notes = {
            "job": "research_enrich",
            "cities": cities,
            "dates": [start, end],
            "discovered": stats["discovered"],
            "attachments_archived": stats["attachments_archived"],
            "interior_hits": stats["interior_hits"],
            "captcha": stats["captcha"],
            "deferred": stats["deferred"],
            "aborted_on_captcha": stats["aborted_on_captcha"],
        }
        await session.commit()

    return stats


def _ad_to_roc(dt: datetime) -> str:
    """西元 datetime → 民國 ``YYY/MM/DD``(進階查詢用)。"""
    return f"{dt.year - 1911}/{dt.month:02d}/{dt.day:02d}"


def main() -> None:
    ap = argparse.ArgumentParser(
        description="PCC 研究資料蒐集 enrich(進階查詢全抓 + 投標須知歸檔;勿在 CI 跑)"
    )
    ap.add_argument("--start", default=None, help="進階查詢起日 民國 YYY/MM/DD(預設今日)")
    ap.add_argument("--end", default=None, help="進階查詢迄日 民國 YYY/MM/DD(預設今日)")
    ap.add_argument(
        "--city", action="append", default=None,
        help="限定縣市(可重複;預設台北市+新北市)",
    )
    ap.add_argument(
        "--trigger", default="manual", choices=["manual", "daily"],
        help="執行觸發來源(寫入 crawl_run)",
    )
    ap.add_argument("--rate-limit", type=float, default=2.0, help="每筆抓取基準間隔秒數(預設 2.0;另加 0~50% 抖動)")
    ap.add_argument(
        "--opencli", action="store_true",
        help="走 OpenCLI 瀏覽器 bridge 抓詳情(繞 CAPTCHA;需已 bind 已過驗證分頁)。"
        "此模式下 --start/--end 請給西元年 YYYY/MM/DD。",
    )
    ap.add_argument("--limit", type=int, default=None, help="只處理前 N 筆(分階段抓取;省略=全部)")
    args = ap.parse_args()

    adapter = None
    start, end = args.start, args.end
    if args.opencli:
        from app.adapters.pcc_opencli import PCCOpenCLIAdapter  # lazy:避免污染測試環境

        # OpenCLI/isDate 用西元年;未給日期時預設為「公告日期=當日」(西元年)。
        today_ad = datetime.now(timezone.utc).strftime("%Y/%m/%d")
        start = start or today_ad
        end = end or today_ad
        adapter = PCCOpenCLIAdapter()
        print("綁定 OpenCLI 瀏覽器 session …", file=sys.stderr)
        adapter.bind()

    stats = asyncio.run(
        run_research_enrich(
            start=start, end=end, cities=args.city,
            trigger=args.trigger, rate_limit_s=args.rate_limit,
            adapter=adapter, limit=args.limit,
        )
    )
    print(
        f"研究 enrich 完成(run #{stats['run_id']}）｜發現 {stats['discovered']}"
        f"｜新版 {stats['new_revisions']}｜未變 {stats['unchanged']}｜失敗 {stats['failed']}"
        f"｜歸檔附件 {stats['attachments_archived']}｜室內標注 {stats['interior_hits']}"
    )
    if stats["aborted_on_captcha"]:
        print(
            f"⚠ 本批撞到 PCC 驗證碼攔截(captcha {stats['captcha']}）,已優雅中止;"
            f"剩餘 {stats['deferred']} 筆 deferred(下輪退避重試)。"
            f"server-side 詳情抓取被反大量查詢驗證碼常駐封鎖,需改走瀏覽器互動式取得。"
        )


if __name__ == "__main__":
    main()

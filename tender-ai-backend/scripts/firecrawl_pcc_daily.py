# -*- coding: utf-8 -*-
"""透過 Firecrawl 取得 PCC 每日標案清單＋詳情頁資訊的獨立腳本。

transport 走 :class:`PCCFirecrawlAdapter`（Firecrawl scrape API），解析全部複用
既有純函式（`parse_list_case_pks` / `parse_pcc_detail`），不寫 DB、輸出 JSON 檔，
適合快速取數與驗證；要入庫仍走既有 `app.jobs.enrich_details` 管線。

紅線（與 enriching-pcc-tender-details 技能一致）：撞 CAPTCHA ＝ 優雅中止訊號，
本腳本偵測到即停止整批、剩餘標 deferred（exit code 2），**絕不破解、絕不繞過**。

用法（於 tender-ai-backend/ 下）：
    uv run python scripts/firecrawl_pcc_daily.py                    # 今日、全縣市
    uv run python scripts/firecrawl_pcc_daily.py --date 2026-07-03  # 指定公告日
    uv run python scripts/firecrawl_pcc_daily.py --list-only        # 只抓清單
    uv run python scripts/firecrawl_pcc_daily.py --limit 5 --save-raw

需要 .env（或環境）提供 FIRECRAWL_API_KEY；self-host 另設 FIRECRAWL_API_URL。
輸出：data/firecrawl/<date>/list.json、details.json、summary.json（--save-raw 加 raw/*.html）。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from dotenv import load_dotenv  # noqa: E402（先補 sys.path 再 import 專案內模組）

load_dotenv(BACKEND_ROOT / ".env")

from app.adapters.pcc_firecrawl import PCCFirecrawlAdapter  # noqa: E402
from app.services.detail_parser import is_captcha_page, parse_pcc_detail  # noqa: E402

TAIPEI = ZoneInfo("Asia/Taipei")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Firecrawl 版 PCC 每日清單＋詳情抓取")
    parser.add_argument("--date", default=None, help="公告日（YYYY-MM-DD，預設台北今日）")
    parser.add_argument("--end-date", default=None, help="公告迄日（預設同 --date）")
    parser.add_argument(
        "--locations", nargs="*", default=None,
        help=f"縣市（預設全部：{' '.join(PCCFirecrawlAdapter.EXEC_LOCATIONS)}）",
    )
    parser.add_argument("--limit", type=int, default=0, help="詳情頁最多抓 N 筆（0=全抓）")
    parser.add_argument("--rate-limit", type=float, default=2.5, help="詳情頁間隔秒數（禮貌節流）")
    parser.add_argument("--list-only", action="store_true", help="只抓清單，不抓詳情")
    parser.add_argument("--save-raw", action="store_true", help="另存詳情頁原始 HTML")
    parser.add_argument("--out", default=None, help="輸出目錄（預設 data/firecrawl/<date>）")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    date = args.date or datetime.now(TAIPEI).strftime("%Y-%m-%d")
    end_date = args.end_date or date
    start_slash, end_slash = date.replace("-", "/"), end_date.replace("-", "/")

    adapter = PCCFirecrawlAdapter()
    locations = args.locations or list(adapter.EXEC_LOCATIONS)
    unknown = [loc for loc in locations if loc not in adapter.EXEC_LOCATIONS]
    if unknown:
        print(f"✗ 未知縣市 {unknown}；可用：{list(adapter.EXEC_LOCATIONS)}", file=sys.stderr)
        return 1

    out_dir = Path(args.out) if args.out else BACKEND_ROOT / "data" / "firecrawl" / date
    out_dir.mkdir(parents=True, exist_ok=True)

    # ---------------- 1) 每日清單（各縣市進階查詢，公告日期=isDate） ---------------- #
    by_location: dict[str, list[str]] = {}
    case_pks: list[str] = []
    for loc in locations:
        try:
            pks = adapter.fetch_list_case_pks(adapter.EXEC_LOCATIONS[loc], start_slash, end_slash)
        except Exception as exc:  # noqa: BLE001 — 帳號/網路層錯誤，給人話後結束
            print(f"✗ 清單抓取失敗（{loc}）：{exc}", file=sys.stderr)
            print("  提示：402=Firecrawl credits 用罄、401=金鑰無效；見 .env FIRECRAWL_API_KEY。", file=sys.stderr)
            return 1
        by_location[loc] = pks
        for pk in pks:
            if pk not in case_pks:
                case_pks.append(pk)
        print(f"清單 {loc} {start_slash}~{end_slash}：{len(pks)} 筆")

    list_payload = {
        "date": date, "end_date": end_date,
        "locations": by_location, "case_pks": case_pks,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    (out_dir / "list.json").write_text(
        json.dumps(list_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"清單合計（去重）：{len(case_pks)} 筆 → {out_dir / 'list.json'}")

    if args.list_only or not case_pks:
        return 0

    # ---------------- 2) 詳情頁（限量 + 節流；CAPTCHA 優雅中止） ---------------- #
    targets = case_pks[: args.limit] if args.limit > 0 else case_pks
    details: dict[str, dict] = {}
    stats = {"targeted": len(targets), "fetched": 0, "parsed": 0,
             "parse_fail": 0, "fetch_fail": 0, "captcha": 0, "deferred": 0,
             "aborted_on_captcha": False}
    raw_dir = out_dir / "raw"
    if args.save_raw:
        raw_dir.mkdir(exist_ok=True)

    for i, pk in enumerate(targets):
        if i > 0 and args.rate_limit > 0:
            time.sleep(args.rate_limit)
        try:
            result = adapter.fetch_detail(pk)
        except Exception as exc:  # noqa: BLE001 — 記帳續跑，與 enrich job 同語義
            stats["fetch_fail"] += 1
            details[pk] = {"error": f"fetch_fail: {exc}"}
            print(f"  ✗ {pk} 抓取失敗：{exc}", file=sys.stderr)
            continue
        stats["fetched"] += 1
        if args.save_raw:
            (raw_dir / f"{pk}.html").write_text(result.raw_content, encoding="utf-8")

        # 紅線：CAPTCHA ＝ 優雅中止訊號。停止整批、剩餘 deferred，不重試、不繞過。
        if is_captcha_page(result.raw_content):
            stats["captcha"] += 1
            stats["aborted_on_captcha"] = True
            stats["deferred"] = len(targets) - i - 1
            details[pk] = {"source_url": result.source_url, "captcha": True}
            print(
                f"  ⚠ {pk} 撞 CAPTCHA，優雅中止整批；剩餘 {stats['deferred']} 筆 deferred。"
                "續抓請走 enriching-pcc-tender-details 技能的真人解題流程。",
                file=sys.stderr,
            )
            break

        parsed = parse_pcc_detail(result.raw_content)
        if parsed is None:
            stats["parse_fail"] += 1
            details[pk] = {"source_url": result.source_url, "captcha": False,
                           "error": "parse_fail: 非有效詳情頁"}
            print(f"  ✗ {pk} 解析失敗（非有效詳情頁）", file=sys.stderr)
            continue
        stats["parsed"] += 1
        details[pk] = {
            "source_url": result.source_url,
            "status_code": result.status_code,
            "fetched_at": result.fetched_at.isoformat(),
            "source_revision_key": result.source_revision_key,
            "captcha": False,
            "parsed": asdict(parsed),
        }
        title = parsed.raw_fields.get("標案名稱") or parsed.raw_fields.get("標案案號") or ""
        print(f"  ✓ {pk} {title[:40]}")

    (out_dir / "details.json").write_text(
        json.dumps(details, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    summary = {"date": date, "end_date": end_date, "list_total": len(case_pks), **stats}
    (out_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"詳情：目標 {stats['targeted']}｜成功解析 {stats['parsed']}"
        f"｜解析失敗 {stats['parse_fail']}｜抓取失敗 {stats['fetch_fail']}"
        f"｜CAPTCHA {stats['captcha']}（deferred {stats['deferred']}）→ {out_dir / 'details.json'}"
    )
    return 2 if stats["aborted_on_captcha"] else 0


if __name__ == "__main__":
    sys.exit(main())

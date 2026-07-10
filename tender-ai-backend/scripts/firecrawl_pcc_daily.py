# -*- coding: utf-8 -*-
"""透過 Firecrawl 取得 PCC 每日標案清單＋詳情頁資訊的獨立腳本。

transport 走 :class:`PCCFirecrawlAdapter`（Firecrawl scrape API），解析全部複用
既有純函式（`parse_list_case_pks` / `parse_pcc_detail`），不寫 DB、輸出 JSON 檔，
適合快速取數與驗證；要入庫仍走既有 `app.jobs.enrich_details` 管線。

紅線（與 enriching-pcc-tender-details 技能一致）：撞 CAPTCHA ＝ 優雅中止訊號，
本腳本偵測到即停止整批、剩餘標 deferred（exit code 2），**絕不破解、絕不繞過**。

備援 transport（cascade，任一層失敗才試下一層；預設全開，可用 --no-fallback 關閉）：
    1. 主要 Firecrawl（FIRECRAWL_API_KEY / FIRECRAWL_API_URL）。
    2. 次要 Firecrawl endpoint（self-host 或備用帳號，設了才啟用）：
       FIRECRAWL_FALLBACK_API_KEY / FIRECRAWL_FALLBACK_API_URL。
    3. PCCOpenCLIAdapter（真人已過 CAPTCHA 的暖機瀏覽器 session）；沒裝 opencli
       或沒有已綁定分頁時優雅跳過，不當作致命錯誤。**不解、不繞過 CAPTCHA**——本層
       只是換一條「已合法通過驗證」的 transport，CAPTCHA 中止語義完全不受影響。

用法（於 tender-ai-backend/ 下）：
    uv run python scripts/firecrawl_pcc_daily.py                    # 今日、全縣市
    uv run python scripts/firecrawl_pcc_daily.py --date 2026-07-03  # 指定公告日
    uv run python scripts/firecrawl_pcc_daily.py --list-only        # 只抓清單
    uv run python scripts/firecrawl_pcc_daily.py --limit 5 --save-raw
    uv run python scripts/firecrawl_pcc_daily.py --no-fallback      # 只用主要 Firecrawl

需要 .env（或環境）提供 FIRECRAWL_API_KEY；self-host 另設 FIRECRAWL_API_URL。
輸出：data/firecrawl/<date>/list.json、details.json、summary.json（--save-raw 加 raw/*.html）。
"""
from __future__ import annotations

import argparse
import json
import os
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
from app.adapters.pcc_opencli import PCCOpenCLIAdapter  # noqa: E402
from app.services.detail_parser import is_captcha_page, parse_pcc_detail  # noqa: E402

TAIPEI = ZoneInfo("Asia/Taipei")

FallbackTransport = tuple[str, object]


def _build_fallback_firecrawl() -> PCCFirecrawlAdapter | None:
    """次要 Firecrawl endpoint（self-host 或備用帳號）；沒設對應環境變數就跳過。"""
    api_key = os.environ.get("FIRECRAWL_FALLBACK_API_KEY")
    api_url = os.environ.get("FIRECRAWL_FALLBACK_API_URL")
    if not api_key and not api_url:
        return None
    try:
        return PCCFirecrawlAdapter(api_key=api_key, api_url=api_url)
    except Exception as exc:  # noqa: BLE001 — 備援本身失敗只降級，不拖垮主流程
        print(f"  ⚠ 備援 Firecrawl endpoint 初始化失敗：{exc}", file=sys.stderr)
        return None


def _build_opencli_fallback() -> PCCOpenCLIAdapter | None:
    """OpenCLI 瀏覽器備援（真人已過 CAPTCHA 的暖機 session）。

    無人值守排程下不等真人解題（``captcha_wait_s=0``）——撞碼原樣回傳，
    交回既有 ``is_captcha_page`` 優雅中止邏輯判斷，不在此層等待或繞過。
    """
    try:
        return PCCOpenCLIAdapter(captcha_wait_s=0)
    except RuntimeError as exc:  # 找不到 opencli 執行檔：環境沒裝，優雅跳過
        print(f"  ⚠ OpenCLI 備援不可用：{exc}", file=sys.stderr)
        return None


def _build_fallback_transports(enabled: bool) -> list[FallbackTransport]:
    if not enabled:
        return []
    transports: list[FallbackTransport] = []
    fc_fallback = _build_fallback_firecrawl()
    if fc_fallback is not None:
        transports.append(("備援 Firecrawl", fc_fallback))
    opencli_fallback = _build_opencli_fallback()
    if opencli_fallback is not None:
        transports.append(("OpenCLI", opencli_fallback))
    return transports


def _fallback_fetch_list(
    loc: str, exec_location: str, start: str, end: str, transports: list[FallbackTransport],
) -> list[str] | None:
    for name, ad in transports:
        try:
            pks = ad.fetch_list_case_pks(exec_location, start, end)
        except Exception as exc:  # noqa: BLE001 — 這層失敗就換下一層，不中止
            print(f"  ↳ 備援 {name} 也失敗（{loc}）：{exc}", file=sys.stderr)
            continue
        if not pks:
            print(f"  ↳ 備援 {name} 抓到清單 {loc}：0 筆（若非預期請確認 session 已綁定）", file=sys.stderr)
        else:
            print(f"  ↳ 備援 {name} 抓到清單 {loc}：{len(pks)} 筆", file=sys.stderr)
        return pks
    return None


def _fallback_fetch_detail(pk: str, transports: list[FallbackTransport]):
    for name, ad in transports:
        try:
            result = ad.fetch_detail(pk)
        except Exception as exc:  # noqa: BLE001 — 這層失敗就換下一層，不中止
            print(f"  ↳ 備援 {name} 也失敗（{pk}）：{exc}", file=sys.stderr)
            continue
        print(f"  ↳ 備援 {name} 抓到詳情 {pk}", file=sys.stderr)
        return result
    return None


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
    parser.add_argument(
        "--no-fallback", action="store_true",
        help="關閉備援 cascade（備援 Firecrawl endpoint / OpenCLI），只用主要 Firecrawl",
    )
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

    # 備援 cascade：延遲到真的撞錯誤才建構，避免每次跑都白白啟動 OpenCLI/建連線
    fallback_transports: list[FallbackTransport] | None = None if args.no_fallback else []
    fallback_built = args.no_fallback  # True 代表「已決定不建」，跳過延遲建構判斷

    def _ensure_fallbacks() -> list[FallbackTransport]:
        nonlocal fallback_transports, fallback_built
        if not fallback_built:
            fallback_transports = _build_fallback_transports(enabled=True)
            fallback_built = True
            if fallback_transports:
                names = "、".join(name for name, _ in fallback_transports)
                print(f"  ↳ 備援 cascade 已就緒：{names}", file=sys.stderr)
            else:
                print("  ↳ 備援 cascade 無可用 transport（皆優雅跳過）", file=sys.stderr)
        return fallback_transports or []

    # ---------------- 1) 每日清單（各縣市進階查詢，公告日期=isDate） ---------------- #
    by_location: dict[str, list[str]] = {}
    case_pks: list[str] = []
    for loc in locations:
        try:
            pks = adapter.fetch_list_case_pks(adapter.EXEC_LOCATIONS[loc], start_slash, end_slash)
        except Exception as exc:  # noqa: BLE001 — 帳號/網路層錯誤，先試備援再決定是否結束
            print(f"✗ 清單抓取失敗（{loc}）：{exc}", file=sys.stderr)
            pks = None if args.no_fallback else _fallback_fetch_list(
                loc, adapter.EXEC_LOCATIONS[loc], start_slash, end_slash, _ensure_fallbacks(),
            )
            if pks is None:
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
        except Exception as exc:  # noqa: BLE001 — 先試備援 cascade，仍失敗才記帳續跑
            print(f"  ✗ {pk} 主要 transport 抓取失敗：{exc}", file=sys.stderr)
            result = None if args.no_fallback else _fallback_fetch_detail(pk, _ensure_fallbacks())
            if result is None:
                stats["fetch_fail"] += 1
                details[pk] = {"error": f"fetch_fail: {exc}"}
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

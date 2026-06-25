#!/usr/bin/env python3
"""PCC 詳情 enrich —— 人工解題續抓迴圈（不破解/不繞過 CAPTCHA）。

這支腳本「不」自己抓網頁，也「不」改變 app/jobs/enrich_details.py 的任何邏輯。
它只是把既有、已測的 HTTP enrich job（run_enrich）包成一個迴圈：

    抓一批（limit 筆，HTTP 路徑）
      → job 內部撞 CAPTCHA 時會「優雅中止整批」並回報 aborted_on_captcha=True
      → 本迴圈停下，請「真人」在同一台機器的真實瀏覽器解一次 CAPTCHA（重置 IP 計數）
      → 按 Enter 續抓下一批
    直到 backlog 抓完、或達到 --max-rounds、或使用者 Ctrl-C。

紅線（與專案 CLAUDE.md 一致，違反請勿合併）：
  * 不以程式破解 CAPTCHA（OCR / 第三方解題服務 / 自動點選）。
  * 不繞過 IP 速率限制（住宅代理輪換、換出口 IP、TLS/JA3 指紋偽裝、stealth 反偵測瀏覽器）。
  * CAPTCHA = graceful-abort 訊號；唯一正當的續抓 = 真人在同 IP 真實瀏覽器手動解題。

用法（務必在後端根目錄、PYTHONPATH 指向後端）：
  cd "<…>/Tender AI/tender-ai-backend"
  PYTHONPATH="$PWD" python "<…>/.claude/skills/enriching-pcc-tender-details/pcc_enrich_loop.py" \
      --source PCC --batch 10 --rate-limit 2.5

  # 只跑近期報表：--since 2026-06-17
  # 給排程用（不等真人、撞 CAPTCHA 直接退出碼 2）：--no-wait
"""
from __future__ import annotations

import argparse
import asyncio
import os
import subprocess
import sys
from datetime import date
from pathlib import Path


def _ensure_backend_on_path() -> Path:
    """確保能 `import app.*`。回傳後端根目錄。

    依序嘗試：① 直接 import（cwd 已是後端根）；② $TENDER_AI_BACKEND；
    ③ $TENDER_AI_ROOT/tender-ai-backend；④ 從本檔往上找 sibling 的 tender-ai-backend。
    """
    candidates: list[Path] = []
    env_backend = os.environ.get("TENDER_AI_BACKEND")
    env_root = os.environ.get("TENDER_AI_ROOT")
    if env_backend:
        candidates.append(Path(env_backend))
    if env_root:
        candidates.append(Path(env_root) / "tender-ai-backend")
    candidates.append(Path.cwd())
    # 本檔位於 …/Tender AI/.claude/skills/<skill>/pcc_enrich_loop.py
    # 後端在 …/Tender AI/tender-ai-backend
    here = Path(__file__).resolve()
    for up in here.parents:
        cand = up / "tender-ai-backend"
        if cand.is_dir():
            candidates.append(cand)
            break

    for cand in candidates:
        if cand and (cand / "app").is_dir():
            sys.path.insert(0, str(cand))
            return cand
    # 最後一搏：直接 import 看看（也許已在 path 上）
    return Path.cwd()


BACKEND_DIR = _ensure_backend_on_path()

try:
    from app.jobs.enrich_details import run_enrich
except ModuleNotFoundError as exc:  # pragma: no cover - 環境設定錯誤
    sys.exit(
        f"無法 import app.jobs.enrich_details（{exc}）。\n"
        f"請在後端根目錄執行，並設 PYTHONPATH，例如：\n"
        f'  cd "<…>/Tender AI/tender-ai-backend" && PYTHONPATH="$PWD" python {sys.argv[0]}'
    )

PCC_SOLVE_URL = "https://web.pcc.gov.tw/tps/main/pms/tps/atm/atmAwardAction.do?searchMode=common"


def _open_browser(url: str) -> None:
    """用系統預設方式開啟真實瀏覽器供真人解題（macOS: open / 其他: webbrowser）。

    這只是「替真人開一個瀏覽器分頁」，不是自動化解題，不違反紅線。
    """
    try:
        if sys.platform == "darwin":
            subprocess.run(["open", url], check=False)
        else:
            import webbrowser

            webbrowser.open(url)
    except Exception as exc:  # noqa: BLE001 - 開瀏覽器失敗只是降級成手動
        print(f"  （自動開瀏覽器失敗：{exc}；請手動開啟下列網址）")


def _print_summary(rnd: int, stats: dict) -> None:
    print(
        f"  ▸ 第 {rnd} 批｜目標 {stats.get('targeted', 0)}"
        f"｜新版 {stats.get('new_revisions', 0)}"
        f"｜未變 {stats.get('unchanged', 0)}"
        f"｜失敗 {stats.get('failed', 0)}"
        f"｜CAPTCHA {stats.get('captcha', 0)}"
        f"｜deferred {stats.get('deferred', 0)}",
        flush=True,
    )


def _human_solve_prompt(open_browser: bool, solve_url: str) -> bool:
    """提示真人解 CAPTCHA。回傳 True=續抓，False=停止。"""
    print(
        "\n  ⚠ 撞到 CAPTCHA —— 依專案紅線『不破解/不繞過』，整批已優雅中止。\n"
        "    請『真人』在這台機器的『真實瀏覽器』完成以下動作（同一條對外 IP 才有效）：\n"
        f"      1. 開啟 PCC 查詢頁：{solve_url}\n"
        "      2. 隨意做一次標案查詢；若出現驗證碼，手動輸入並送出（解一次即可重置本 IP 計數）。\n"
        "      3. 回到這裡。\n",
        flush=True,
    )
    if open_browser:
        _open_browser(solve_url)
    try:
        ans = input("    解完按 Enter 續抓下一批，或輸入 q 後 Enter 結束：").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        return False
    return ans != "q"


def run_loop(
    *,
    source: str | None,
    batch: int,
    rate_limit: float,
    since: date | None,
    max_rounds: int,
    wait_for_human: bool,
    open_browser: bool,
    solve_url: str,
) -> int:
    drained = 0
    for rnd in range(1, max_rounds + 1):
        stats = asyncio.run(
            run_enrich(
                only_missing=True,
                limit=batch,
                source=source,
                rate_limit_s=rate_limit,
                since=since,
                trigger="manual",
            )
        )
        _print_summary(rnd, stats)
        drained += int(stats.get("new_revisions", 0)) + int(stats.get("unchanged", 0))

        if stats.get("targeted", 0) == 0:
            print(f"\n✓ backlog 已抓完（本次迴圈共處理 {drained} 筆）。", flush=True)
            return 0

        if not stats.get("aborted_on_captcha"):
            # 這批沒撞 CAPTCHA：可能還有更多 backlog，直接續下一批（不需真人）。
            continue

        # 撞 CAPTCHA：依模式決定等真人或退出。
        if not wait_for_human:
            print(
                "\n⚠ 撞 CAPTCHA 且為 --no-wait 模式，退出（exit code 2）。"
                "剩餘已標記 deferred，下輪退避重試。",
                flush=True,
            )
            return 2
        if not _human_solve_prompt(open_browser, solve_url):
            print(f"\n■ 使用者結束（本次迴圈共處理 {drained} 筆）。", flush=True)
            return 0

    print(
        f"\n■ 已達 --max-rounds={max_rounds} 上限（本次迴圈共處理 {drained} 筆）。"
        "如需續抓請再次執行。",
        flush=True,
    )
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(
        description="PCC 詳情 enrich 人工解題續抓迴圈（不破解/不繞過 CAPTCHA）",
    )
    ap.add_argument("--source", default="PCC", help="收斂單一來源（預設 PCC）")
    ap.add_argument(
        "--batch", type=int, default=10,
        help="每批 enrich 筆數上限；建議 <12，留在 CAPTCHA 閾值以下（預設 10）",
    )
    ap.add_argument(
        "--rate-limit", type=float, default=2.5,
        help="每筆抓取間隔秒數（預設 2.5；禮貌限速，勿調太低）",
    )
    ap.add_argument(
        "--since", default=None,
        help="只 enrich first_seen >= 此日期（YYYY-MM-DD；catch-up 只補近期報表用）",
    )
    ap.add_argument(
        "--max-rounds", type=int, default=200,
        help="安全上限：最多跑幾批就停（預設 200）",
    )
    ap.add_argument(
        "--no-wait", action="store_true",
        help="不等真人解題：撞 CAPTCHA 直接退出（exit code 2）。給排程/非互動環境用。",
    )
    ap.add_argument(
        "--no-open-browser", action="store_true",
        help="撞 CAPTCHA 時不自動開瀏覽器（預設會替真人開 PCC 查詢頁）",
    )
    ap.add_argument(
        "--solve-url", default=PCC_SOLVE_URL,
        help="真人解題時要開的 PCC 頁面網址",
    )
    args = ap.parse_args()

    since = date.fromisoformat(args.since) if args.since else None
    if args.batch >= 12:
        print(
            f"  （提醒：--batch={args.batch} ≥ 12，幾乎必撞 CAPTCHA；建議 10 以下。）",
            flush=True,
        )

    print(
        f"PCC enrich 續抓迴圈啟動｜source={args.source}｜batch={args.batch}"
        f"｜rate={args.rate_limit}s｜since={args.since or '—'}"
        f"｜mode={'no-wait' if args.no_wait else 'human-solve'}\n"
        f"後端根目錄：{BACKEND_DIR}",
        flush=True,
    )
    code = run_loop(
        source=args.source,
        batch=args.batch,
        rate_limit=args.rate_limit,
        since=since,
        max_rounds=args.max_rounds,
        wait_for_human=not args.no_wait,
        open_browser=not args.no_open_browser,
        solve_url=args.solve_url,
    )
    sys.exit(code)


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""大腦煙測（brain-picker「測試」鈕後端）。

以**候選（未存）設定**對 ``brain.stream`` 送一個固定、無意義的極短 prompt，驗證該大腦
真的能啟動並回話，回報是否成功／耗時／極短樣本。

Layer B / secret 紅線（見 CLAUDE.md）：
- prompt 固定且無意義（不帶任何使用者資料／行為），不觸發 Layer B。
- 輸出截斷上限 ``_SAMPLE_CAP`` 字；**永不回傳金鑰本體**（BYOK 金鑰仍只從 .env 取，
  候選設定不帶祕密）。錯誤訊息來自 brain 層（不含金鑰）。
- 短 timeout，避免卡住；逾時／失敗回 ``ok=False`` 並附淨化後的錯誤字串（HTTP 仍 200）。
"""
from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace

from app.core.config import settings
from app.services import brain

# 固定、無意義的極短測試 prompt（不含任何使用者／Layer B 資料）。
_PROBE_PROMPT = "請只回覆：OK"
_SAMPLE_CAP = 200
# 短 timeout：CLI 自主代理較慢給較長，雲端／本機模型較短。
_CLI_TIMEOUT = 30.0
_OTHER_TIMEOUT = 15.0


def _candidate_model(provider: str, candidate: SimpleNamespace) -> str | None:
    """回報用的模型字串（不含祕密）。"""
    if provider == "cli":
        return getattr(candidate, "cli_model", None) or None
    if provider == "ollama":
        return getattr(candidate, "ollama_model", None) or settings.chat_model
    if provider == "byok":
        protocol = getattr(candidate, "byok_protocol", None) or "anthropic"
        default = (
            "anthropic/claude-sonnet-5"
            if protocol == "openrouter"
            else "claude-sonnet-5"
        )
        return getattr(candidate, "byok_model", None) or default
    return None


async def _collect(candidate: SimpleNamespace) -> str:
    """跑 brain.stream，串接 delta、截斷上限。progress 不計入樣本。"""
    parts: list[str] = []
    messages = [{"role": "user", "content": _PROBE_PROMPT}]
    async for chunk in brain.stream(
        config=candidate,
        messages=messages,
        prompt=_PROBE_PROMPT,
        history=None,
        focus_note="",
    ):
        if chunk.kind == "delta":
            parts.append(chunk.text)
            if sum(len(p) for p in parts) >= _SAMPLE_CAP:
                break
    return "".join(parts).strip()[:_SAMPLE_CAP]


async def smoke_test(candidate: SimpleNamespace):
    """對候選設定做煙測，回 ``BrainTestResult``（HTTP 恆 200、永不含祕密）。"""
    # 延遲匯入避免 schema↔service 循環。
    from app.schemas.settings import BrainTestResult

    provider = getattr(candidate, "provider", "ollama") or "ollama"
    model = _candidate_model(provider, candidate)
    timeout = _CLI_TIMEOUT if provider == "cli" else _OTHER_TIMEOUT

    started = time.perf_counter()
    try:
        sample = await asyncio.wait_for(_collect(candidate), timeout=timeout)
    except asyncio.TimeoutError:
        elapsed = int((time.perf_counter() - started) * 1000)
        return BrainTestResult(
            ok=False, provider=provider, model=model, elapsed_ms=elapsed,
            error=f"測試逾時（{int(timeout)}s）",
        )
    except brain.BrainError as e:
        elapsed = int((time.perf_counter() - started) * 1000)
        return BrainTestResult(
            ok=False, provider=provider, model=model, elapsed_ms=elapsed,
            error=str(e)[:200],
        )
    except Exception as e:  # noqa: BLE001
        elapsed = int((time.perf_counter() - started) * 1000)
        return BrainTestResult(
            ok=False, provider=provider, model=model, elapsed_ms=elapsed,
            error=f"測試失敗：{str(e)[:160]}",
        )

    elapsed = int((time.perf_counter() - started) * 1000)
    if not sample:
        return BrainTestResult(
            ok=False, provider=provider, model=model, elapsed_ms=elapsed,
            error="未產出任何內容",
        )
    return BrainTestResult(
        ok=True, provider=provider, model=model, elapsed_ms=elapsed, sample=sample,
    )

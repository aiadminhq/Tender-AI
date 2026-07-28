# -*- coding: utf-8 -*-
"""設定頁 API：小助手「大腦」全域設定（開發期單機單操作者 → 單列）。

  GET  /api/v1/settings/brain   讀取目前大腦設定
  PUT  /api/v1/settings/brain   部分更新非密欄位（provider／模型／CLI agent…）

secret 紅線（見 CLAUDE.md）：BYOK 金鑰本體只進 ``.env``；本端點只讀寫非密欄位，
``byok_key_set`` 由 ``.env`` 是否設定金鑰**即時推導**回傳，永不回傳金鑰本體。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_session
from app.models.assistant import AssistantBrainConfig
from app.schemas.settings import (
    BrainAgentSpec,
    BrainAgentsOut,
    BrainConfigOut,
    BrainConfigUpdate,
    BrainTestRequest,
    BrainTestResult,
    DetailFieldVisibilityOut,
    DetailFieldVisibilityUpdate,
)
from app.services import brain_config as brain_config_svc
from app.services import brain_test as brain_test_svc
from app.services import detail_field_visibility as detail_fields_svc
from app.services.brain_cli_registry import CLI_REGISTRY

router = APIRouter(prefix="/settings", tags=["settings"])


def _to_out(config: AssistantBrainConfig) -> BrainConfigOut:
    out = BrainConfigOut.model_validate(config)
    # 依目前選取的雲端協定回報對應金鑰狀態（不外洩金鑰本體）。
    protocol = config.byok_protocol or "anthropic"
    key = (
        settings.openrouter_api_key
        if protocol == "openrouter"
        else settings.anthropic_api_key
    )
    out.byok_key_set = bool(key)
    return out


@router.get("/brain", response_model=BrainConfigOut)
async def get_brain(
    session: AsyncSession = Depends(get_session),
) -> BrainConfigOut:
    config = await brain_config_svc.get_or_create(session)
    await session.commit()  # 首次讀取可能建立單列預設
    return _to_out(config)


@router.put("/brain", response_model=BrainConfigOut)
async def put_brain(
    body: BrainConfigUpdate,
    session: AsyncSession = Depends(get_session),
) -> BrainConfigOut:
    # 只套用實際送來的欄位（exclude_unset），未送欄位不動。
    changes = body.model_dump(exclude_unset=True)
    config = await brain_config_svc.update(session, changes)
    await session.commit()
    # updated_at 帶 onupdate=func.now()：commit 後該欄被 expire，需在 async 情境
    # 先 refresh 載回，否則 _to_out 的 model_validate 會觸發同步 lazy-load（MissingGreenlet）。
    await session.refresh(config)
    return _to_out(config)


# ── 大腦：CLI 代理清單 ＋ 候選設定煙測（brain-picker 擴充）──────────────────────
#   GET  /api/v1/settings/brain/agents   回傳 CLI 代理註冊表（前端建選單）
#   POST /api/v1/settings/brain/test     以候選（未存）設定做煙測（HTTP 恆 200）


@router.get("/brain/agents", response_model=BrainAgentsOut)
async def get_brain_agents() -> BrainAgentsOut:
    """回傳 CLI 代理註冊表，供前端動態建立 agent／model 選單。"""
    agents = [
        BrainAgentSpec(
            key=spec.key,
            label_i18n=spec.label_i18n,
            models=list(spec.models),
            default_model=spec.default_model,
            supports_model=bool(spec.model_flag),
            needs_local_verify=spec.needs_local_verify,
        )
        for spec in CLI_REGISTRY.values()
    ]
    return BrainAgentsOut(agents=agents)


@router.post("/brain/test", response_model=BrainTestResult)
async def post_brain_test(body: BrainTestRequest) -> BrainTestResult:
    """對候選設定做煙測（固定無意義 prompt、短 timeout、截斷樣本、永不含祕密）。

    不落地：用 ``SimpleNamespace`` 組候選設定丟給 ``brain.stream``；BYOK 金鑰仍由
    ``.env`` 取得（body 不帶）。結果 HTTP 恆 200，由 ``ok`` 區分成功／失敗。
    """
    from types import SimpleNamespace

    candidate = SimpleNamespace(
        provider=body.provider,
        ollama_model=body.ollama_model,
        cli_agent=body.cli_agent,
        cli_model=body.cli_model,
        byok_protocol=body.byok_protocol,
        byok_base_url=body.byok_base_url,
        byok_model=body.byok_model,
    )
    return await brain_test_svc.smoke_test(candidate)


# ── 標案詳情規格表：欄位顯示設定（團隊共用，單列）───────────────────────────────
#   GET  /api/v1/settings/detail-fields   讀取目前被隱藏的詳情欄位
#   PUT  /api/v1/settings/detail-fields   整批覆蓋被隱藏的詳情欄位


@router.get("/detail-fields", response_model=DetailFieldVisibilityOut)
async def get_detail_fields(
    session: AsyncSession = Depends(get_session),
) -> DetailFieldVisibilityOut:
    config = await detail_fields_svc.get_or_create(session)
    await session.commit()  # 首次讀取可能建立單列預設
    return DetailFieldVisibilityOut.model_validate(config)


@router.put("/detail-fields", response_model=DetailFieldVisibilityOut)
async def put_detail_fields(
    body: DetailFieldVisibilityUpdate,
    session: AsyncSession = Depends(get_session),
) -> DetailFieldVisibilityOut:
    changes = body.model_dump(exclude_unset=True)
    config = await detail_fields_svc.update(session, changes)
    await session.commit()
    # 同 put_brain：updated_at onupdate 在 commit 後 expire，async 需先 refresh。
    await session.refresh(config)
    return DetailFieldVisibilityOut.model_validate(config)

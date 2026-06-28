# -*- coding: utf-8 -*-
"""CLI 大腦代理註冊表（單一事實來源）。

把「有哪些 headless CLI 代理、各自怎麼啟動、怎麼解析輸出、能不能指定模型」集中於此，
供 ``brain.py``（組 argv＋dispatch parser）與 ``schemas/settings.py``（驗證 cli_agent）、
``api/v1/settings.py``（GET /settings/brain/agents 回前端）共用。

argv 內 ``{prompt}`` 為佔位，由 ``brain._cli_argv`` 帶入實際 prompt。
``model_flag`` 注入策略：僅當使用者設了 ``cli_model`` 時，把 ``[model_flag, model]`` **append
到 argv 尾端**（避免 claude ``-p`` 位置參數歧義；無 model 時與現況完全一致 → 非破壞性）。

claude/codex/hermes 為已在本機驗證過的既有代理（argv／parser 不變）；opencode/antigravity 為
best-effort 模板，``needs_local_verify=True``，UI 顯示「需本機驗證」徽章、live 須在本機跑。
祕密紅線：CLI 路徑完全不碰 secret（見 CLAUDE.md）。
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class CliSpec:
    key: str                          # claude / codex / hermes / opencode / antigravity
    label_i18n: str                   # 前端 i18n key
    argv: list[str]                   # 含 {prompt} 佔位
    parser: str                       # "claude" | "codex" | "hermes" | "text"
    model_flag: str | None = None     # 注入模型的 flag；None=該 CLI 不支援指定模型
    default_model: str | None = None
    models: list[str] = field(default_factory=list)  # UI 候選模型（空=自由填）
    needs_local_verify: bool = False  # opencode/antigravity=True（模板未在本機驗證）


# 註冊表：key → CliSpec。新增代理只需在此加一筆（並補 i18n label）。
CLI_REGISTRY: dict[str, CliSpec] = {
    "claude": CliSpec(
        key="claude",
        label_i18n="brainCliClaude",
        argv=[
            "claude", "-p", "{prompt}",
            "--allowedTools", "mcp__tender-ai-brain",
            "--output-format", "stream-json", "--verbose",
        ],
        parser="claude",
        model_flag="--model",
        default_model=None,
        models=["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
        needs_local_verify=False,
    ),
    "codex": CliSpec(
        key="codex",
        label_i18n="brainCliCodex",
        argv=["codex", "exec", "--json", "--skip-git-repo-check", "{prompt}"],
        parser="codex",
        model_flag="--model",
        default_model=None,
        models=["gpt-5-codex", "gpt-5", "o3"],
        needs_local_verify=False,
    ),
    "hermes": CliSpec(
        key="hermes",
        label_i18n="brainCliHermes",
        argv=["hermes", "-z", "{prompt}", "--yolo"],
        parser="hermes",
        # hermes 純文字輸出、是否支援 --model 未在本機驗證 → 暫不開放指定模型。
        model_flag=None,
        default_model=None,
        models=[],
        needs_local_verify=False,
    ),
    "opencode": CliSpec(
        key="opencode",
        label_i18n="brainCliOpencode",
        # opencode run [message]；純文字輸出 → text parser。best-effort，需本機驗證。
        argv=["opencode", "run", "{prompt}"],
        parser="text",
        model_flag="--model",
        default_model=None,
        models=[],
        needs_local_verify=True,
    ),
    "antigravity": CliSpec(
        key="antigravity",
        label_i18n="brainCliAntigravity",
        # antigravity headless 一次性執行；純文字輸出 → text parser。best-effort，需本機驗證。
        argv=["antigravity", "{prompt}"],
        parser="text",
        model_flag="--model",
        default_model=None,
        models=[],
        needs_local_verify=True,
    ),
}


def cli_agent_keys() -> tuple[str, ...]:
    """合法的 CLI 代理 key（供 schema 驗證）。"""
    return tuple(CLI_REGISTRY.keys())


def get_spec(agent: str) -> CliSpec | None:
    return CLI_REGISTRY.get(agent)

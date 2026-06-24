# -*- coding: utf-8 -*-
"""小助手對話留存 models（Phase 4）。

把右側 LLM 助手的對話串落地，讓使用者重開浮窗／指揮中心時能接續上次對話。

Layer B 紅線（見 CLAUDE.md）：登入身分尚未落地前，一律
``owner_user_id="default"``、``consent_state="pending-consent"``、
``layer_b_opt_in=False``——不具名、不共享、對外永不揭露；登入到位後再回填
真實帳號並依本人逐串同意決定是否納入團隊共享學習。

- 留存的 ``content`` 僅為對話文字，``sources`` 僅含公開標案欄位（A 層）與知識庫
  片段摘要；不在此存任何 Layer B 行為明細。
- ``owner_user_id`` 刻意用字串而非 FK→users.id：登入前以 "default" 佔位，
  避免在 demo 階段被 users 表的整數主鍵綁死。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AssistantThread(Base):
    __tablename__ = "assistant_threads"

    # 前端產生的 thread_id（uuid 字串）；缺值時 service 端補一個。
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # 登入前佔位 "default"；登入到位後回填真實帳號。
    owner_user_id: Mapped[str] = mapped_column(
        String(64), default="default", server_default="default", index=True, nullable=False
    )
    # assistant（浮窗）｜ assistant_page（指揮中心整頁）
    scope: Mapped[str] = mapped_column(String(32), nullable=False)
    # 由第一則使用者訊息截斷而來，供 thread 列表顯示。
    title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # pending-consent（預設，不具名/不共享）｜ named（登入到位回填）
    consent_state: Mapped[str] = mapped_column(
        String(24),
        default="pending-consent",
        server_default="pending-consent",
        nullable=False,
    )
    # 本人是否逐串同意把這串對話納入團隊共享學習；預設一律 false。
    layer_b_opt_in: Mapped[bool] = mapped_column(
        default=False, server_default="false", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class AssistantMessage(Base):
    __tablename__ = "assistant_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    thread_id: Mapped[str] = mapped_column(
        ForeignKey("assistant_threads.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # user | assistant（tool/system 不留存）
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 助手訊息的來源卡（標案／知識庫，公開欄位），使用者訊息為 None。
    sources: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )


class AssistantBrainConfig(Base):
    """小助手「大腦」全域設定（開發期單機單操作者 → 單列 id=1，get-or-create）。

    選擇 AI 助手視窗背後由哪個 provider 生成：
    - ``ollama``（預設）：本機 Ollama 換模型，即現行 ``llm.stream_chat`` 路徑。
    - ``cli``：spawn 本機 headless CLI（claude/codex/hermes，已注入 tender-ai-brain MCP）
      自主 agentic 檢索＋推理。
    - ``byok``：自帶金鑰直連雲端 LLM。

    金鑰隔離（Layer B/secret 紅線）：BYOK 金鑰本體只進 ``.env``（gitignored），
    此表只存 ``byok_key_set`` 布林供 UI 顯示，**永不入庫/版控**。CLI 路徑完全不碰 secret。
    """

    __tablename__ = "assistant_brain_config"

    # 固定單列：service 端 get-or-create id=1。
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    # ollama | cli | byok；預設 ollama（無設定時即現行行為）。
    provider: Mapped[str] = mapped_column(
        String(16), default="ollama", server_default="ollama", nullable=False
    )
    # provider=ollama 時的模型；NULL → 用 settings.chat_model。
    ollama_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # provider=cli 時的 CLI：claude | codex | hermes。
    cli_agent: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # provider=byok 的協定（v1 先支援 anthropic）。
    byok_protocol: Mapped[str | None] = mapped_column(String(16), nullable=True)
    byok_base_url: Mapped[str | None] = mapped_column(String(256), nullable=True)
    byok_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 金鑰是否已設定（只存布林；金鑰本體放 .env）。
    byok_key_set: Mapped[bool] = mapped_column(
        default=False, server_default="false", nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

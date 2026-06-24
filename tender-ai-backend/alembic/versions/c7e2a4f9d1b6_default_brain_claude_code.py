"""default assistant brain → Claude Code (cli/claude)

Revision ID: c7e2a4f9d1b6
Revises: b3c9d5f1a2e8
Create Date: 2026-06-24 00:00:00.000000

開發期算力由本機 CLI 提供，故把小助手「大腦」預設改為 Claude Code
（provider=cli, cli_agent=claude）。內容：
- 調整 server_default：provider ollama→cli、cli_agent → claude。
- 一次性把既有單列（id=1，原 seed 的 ollama 預設）翻成 cli/claude。
  這只跑一次（alembic 版本追蹤），不會在日後覆蓋使用者於設定頁的選擇。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c7e2a4f9d1b6'
down_revision: Union[str, None] = 'b3c9d5f1a2e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'assistant_brain_config', 'provider',
        server_default='cli', existing_type=sa.String(length=16),
        existing_nullable=False,
    )
    op.alter_column(
        'assistant_brain_config', 'cli_agent',
        server_default='claude', existing_type=sa.String(length=32),
        existing_nullable=True,
    )
    # 一次性翻轉既有單列：只動仍是 seed 預設（ollama）的列，避免覆蓋人為選擇。
    op.execute(
        "UPDATE assistant_brain_config "
        "SET provider = 'cli', cli_agent = 'claude' "
        "WHERE id = 1 AND provider = 'ollama'"
    )


def downgrade() -> None:
    op.alter_column(
        'assistant_brain_config', 'cli_agent',
        server_default=None, existing_type=sa.String(length=32),
        existing_nullable=True,
    )
    op.alter_column(
        'assistant_brain_config', 'provider',
        server_default='ollama', existing_type=sa.String(length=16),
        existing_nullable=False,
    )
    op.execute(
        "UPDATE assistant_brain_config "
        "SET provider = 'ollama', cli_agent = NULL "
        "WHERE id = 1 AND provider = 'cli' AND cli_agent = 'claude'"
    )

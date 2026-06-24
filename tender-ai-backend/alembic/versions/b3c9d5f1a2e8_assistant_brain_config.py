"""assistant brain config (global single-row brain picker)

Revision ID: b3c9d5f1a2e8
Revises: a8f2c1e7b9d4
Create Date: 2026-06-23 00:00:00.000000

小助手「大腦」全域設定（開發期單機單操作者 → 單列 id=1）。選擇 AI 助手視窗背後
由哪個 provider 生成：ollama（預設，本機換模型）／cli（spawn 本機 headless CLI 自主
agentic）／byok（自帶金鑰直連雲端）。
secret 紅線（見 CLAUDE.md）：BYOK 金鑰本體只進 .env（gitignored）；此表只存
byok_key_set 布林，永不入庫/版控。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b3c9d5f1a2e8'
down_revision: Union[str, None] = 'a8f2c1e7b9d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'assistant_brain_config',
        sa.Column('id', sa.Integer(), autoincrement=False, nullable=False),
        sa.Column(
            'provider', sa.String(length=16),
            server_default='ollama', nullable=False,
        ),
        sa.Column('ollama_model', sa.String(length=64), nullable=True),
        sa.Column('cli_agent', sa.String(length=32), nullable=True),
        sa.Column('byok_protocol', sa.String(length=16), nullable=True),
        sa.Column('byok_base_url', sa.String(length=256), nullable=True),
        sa.Column('byok_model', sa.String(length=64), nullable=True),
        sa.Column(
            'byok_key_set', sa.Boolean(),
            server_default='false', nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    # seed 單列預設（id=1, provider=ollama）；service 端亦 get-or-create 兜底。
    op.execute(
        "INSERT INTO assistant_brain_config (id, provider) VALUES (1, 'ollama')"
    )


def downgrade() -> None:
    op.drop_table('assistant_brain_config')

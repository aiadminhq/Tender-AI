"""assistant_brain_config 新增 cli_model 欄

provider=cli 時傳給 CLI 代理的模型名稱（NULL = 用代理預設 / 不帶 model flag）。
僅新增可空欄，無資料遷移、冪等。

Revision ID: b7c2e9d4a8f1
Revises: f3b8d1a6c920
Create Date: 2026-06-28 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c2e9d4a8f1'
down_revision: Union[str, None] = 'f3b8d1a6c920'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'assistant_brain_config',
        sa.Column('cli_model', sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('assistant_brain_config', 'cli_model')

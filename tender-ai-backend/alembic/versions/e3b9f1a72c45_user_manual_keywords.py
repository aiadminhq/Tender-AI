"""user_manual_keywords: 推理卡手動關鍵字覆寫（Phase 2）

Revision ID: e3b9f1a72c45
Revises: d8f1a3c6e904
Create Date: 2026-06-24 00:30:00.000000

使用者在「為什麼·推理」卡上親手 add／remove 的偏好／迴避／常點開關鍵字。
複合主鍵 (user_id, term, kind)；excluded 切換 add(False)／remove(True)。
個人化線（Layer B）只用本人資料、不需共享同意；kind=negative 為「負分人工
專屬」合規路徑。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e3b9f1a72c45'
down_revision: Union[str, None] = 'd8f1a3c6e904'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_manual_keywords',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('term', sa.String(length=128), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('excluded', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'term', 'kind'),
    )


def downgrade() -> None:
    op.drop_table('user_manual_keywords')

"""user_password_hash: users 加 password_hash 欄位（Phase 2 認證）

users 擴充 password_hash（pbkdf2_sha256 字串，nullable）。既有列回填 NULL：
佔位／pre-provision 帳號尚未設密碼，登入時須有此值。明文密碼永不落地。
僅加欄位（schema-only），不動既有資料與其他表。

Revision ID: d4f6a2c8e1b9
Revises: c2f5a8b1d4e6
Create Date: 2026-06-22 15:10:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4f6a2c8e1b9'
down_revision: Union[str, None] = 'c2f5a8b1d4e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('password_hash', sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('users', 'password_hash')

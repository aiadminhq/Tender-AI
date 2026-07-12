# -*- coding: utf-8 -*-
"""user_whitelist_auth_columns

Revision ID: d4b8f21a6c93
Revises: 957639bef8a7
Create Date: 2026-07-12 00:00:00.000000

白名單登入（@hqdesign.tw）：users 表補 whitelist_active／consent_shared／
consent_at／password_hash，供 app 自簽 JWT 登入與 Layer B 合作範圍共識同意
（見 CLAUDE.md）。以 IF NOT EXISTS 寫法保護：部分環境（如既有 Supabase
專案）已手動補過同名欄位，重跑不應報錯。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd4b8f21a6c93'
down_revision: Union[str, None] = '957639bef8a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whitelist_active "
        "boolean NOT NULL DEFAULT false"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_shared "
        "boolean NOT NULL DEFAULT false"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_at "
        "timestamptz NULL"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash "
        "varchar(128) NULL"
    )


def downgrade() -> None:
    op.drop_column('users', 'password_hash')
    op.drop_column('users', 'consent_at')
    op.drop_column('users', 'consent_shared')
    op.drop_column('users', 'whitelist_active')

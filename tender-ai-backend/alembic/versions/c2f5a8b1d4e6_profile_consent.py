"""profile_consent: users 加白名單/同意 3 欄 + 個人化雙軌學習表

users 擴充 whitelist_active / consent_shared / consent_at（前兩者預設 false，
回填亦 false）；新增 preference_profiles（個人化輪廓，1-1）與 user_keyword_weights
（個人線逐詞權重，user_id + term 複合主鍵）。既有 keyword_weights 與
keyword_weight_revisions 管線完全不動。

Revision ID: c2f5a8b1d4e6
Revises: 957639bef8a7
Create Date: 2026-06-22 09:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c2f5a8b1d4e6'
down_revision: Union[str, None] = '957639bef8a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # users：白名單 / 同意三欄（既有列回填 false / NULL）
    op.add_column(
        'users',
        sa.Column('whitelist_active', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    op.add_column(
        'users',
        sa.Column('consent_shared', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    op.add_column(
        'users',
        sa.Column('consent_at', sa.DateTime(timezone=True), nullable=True),
    )

    # preference_profiles：個人化輪廓（1-1 綁定 user）
    op.create_table(
        'preference_profiles',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('top_keywords', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('avoid_keywords', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('preferred_categories', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('budget_min', sa.Integer(), nullable=True),
        sa.Column('budget_max', sa.Integer(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', name='uq_preference_profiles_user_id'),
    )

    # user_keyword_weights：個人線逐詞權重（user_id + term 複合主鍵）
    op.create_table(
        'user_keyword_weights',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('term', sa.String(length=128), nullable=False),
        sa.Column('polarity', sa.String(length=16), nullable=False),
        sa.Column('weight', sa.Float(), nullable=False),
        sa.Column('support', sa.Integer(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'term'),
    )
    op.create_index(
        op.f('ix_user_keyword_weights_polarity'), 'user_keyword_weights', ['polarity'], unique=False
    )
    op.create_index(
        op.f('ix_user_keyword_weights_updated_at'), 'user_keyword_weights', ['updated_at'], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_user_keyword_weights_updated_at'), table_name='user_keyword_weights')
    op.drop_index(op.f('ix_user_keyword_weights_polarity'), table_name='user_keyword_weights')
    op.drop_table('user_keyword_weights')
    op.drop_table('preference_profiles')
    op.drop_column('users', 'consent_at')
    op.drop_column('users', 'consent_shared')
    op.drop_column('users', 'whitelist_active')

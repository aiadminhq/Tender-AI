"""可行性推導潛力分級 Stage 1：tenders.feasibility_team 欄 + tier_threshold_revisions 表

潛力分級（高/中/低）改由團隊線可行性分數分帶而來：
- ``tenders.feasibility_team``：物化的團隊線可行性分數（0–100，可重算；NULL = 尚未物化）。
- ``tier_threshold_revisions``：分帶切點的版本快照（信心校準學習的稽核軌跡，append-only）。

本表只存分數切點與樣本計數，不產生任何負分關鍵字權重（與「負分人工專屬」紅線無涉）。

Revision ID: f3b8d1a6c920
Revises: a2d6f8c4b1e3
Create Date: 2026-06-25 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3b8d1a6c920'
down_revision: Union[str, None] = 'a2d6f8c4b1e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 物化的團隊線可行性分數（0–100）；NULL = 尚未物化 → 查詢端回退報表分級
    op.add_column(
        'tenders',
        sa.Column('feasibility_team', sa.Integer(), nullable=True),
    )

    # 潛力分帶門檻版本快照（append-only 稽核軌跡）
    op.create_table(
        'tier_threshold_revisions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('batch', sa.String(length=32), nullable=False),
        sa.Column('c_high', sa.Integer(), nullable=False),
        sa.Column('c_low', sa.Integer(), nullable=False),
        sa.Column('target_high', sa.Float(), nullable=False),
        sa.Column('target_low', sa.Float(), nullable=False),
        sa.Column('min_support', sa.Integer(), nullable=False),
        sa.Column('support_high', sa.Integer(), nullable=False),
        sa.Column('support_low', sa.Integer(), nullable=False),
        sa.Column('feasible_samples', sa.Integer(), nullable=False),
        sa.Column('infeasible_samples', sa.Integer(), nullable=False),
        sa.Column('fallback', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_tier_threshold_revisions_batch'), 'tier_threshold_revisions', ['batch'], unique=False)
    op.create_index(op.f('ix_tier_threshold_revisions_created_at'), 'tier_threshold_revisions', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_tier_threshold_revisions_created_at'), table_name='tier_threshold_revisions')
    op.drop_index(op.f('ix_tier_threshold_revisions_batch'), table_name='tier_threshold_revisions')
    op.drop_table('tier_threshold_revisions')
    op.drop_column('tenders', 'feasibility_team')

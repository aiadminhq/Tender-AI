"""SL2: keyword_weight_revisions（關鍵字權重版本快照）

Revision ID: b7d2f3a9c5e8
Revises: a1c4e7d9f201
Create Date: 2026-06-18 17:40:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7d2f3a9c5e8'
down_revision: Union[str, None] = 'a1c4e7d9f201'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'keyword_weight_revisions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('batch', sa.String(length=32), nullable=False),
        sa.Column('term', sa.String(length=128), nullable=False),
        sa.Column('polarity', sa.String(length=16), nullable=False),
        sa.Column('weight', sa.Float(), nullable=False),
        sa.Column('support', sa.Integer(), nullable=False),
        sa.Column('feasible_samples', sa.Integer(), nullable=False),
        sa.Column('infeasible_samples', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_keyword_weight_revisions_batch'), 'keyword_weight_revisions', ['batch'], unique=False)
    op.create_index(op.f('ix_keyword_weight_revisions_created_at'), 'keyword_weight_revisions', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_keyword_weight_revisions_created_at'), table_name='keyword_weight_revisions')
    op.drop_index(op.f('ix_keyword_weight_revisions_batch'), table_name='keyword_weight_revisions')
    op.drop_table('keyword_weight_revisions')

"""SL6: evolution_logs（自我進化稽核日誌）

Revision ID: e9c1a4b7f3d2
Revises: d7a3f9c2e6b1
Create Date: 2026-06-18 22:10:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e9c1a4b7f3d2'
down_revision: Union[str, None] = 'd7a3f9c2e6b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'evolution_logs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('batch', sa.String(length=32), nullable=False),
        sa.Column('trigger', sa.String(length=16), nullable=False),
        sa.Column('feasible_samples', sa.Integer(), nullable=False),
        sa.Column('infeasible_samples', sa.Integer(), nullable=False),
        sa.Column('keywords_added', sa.Integer(), nullable=False),
        sa.Column('keywords_updated', sa.Integer(), nullable=False),
        sa.Column('revision_rows', sa.Integer(), nullable=False),
        sa.Column('top_positive', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('top_negative', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('signals', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_evolution_logs_batch'), 'evolution_logs', ['batch'], unique=False)
    op.create_index(op.f('ix_evolution_logs_created_at'), 'evolution_logs', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_evolution_logs_created_at'), table_name='evolution_logs')
    op.drop_index(op.f('ix_evolution_logs_batch'), table_name='evolution_logs')
    op.drop_table('evolution_logs')

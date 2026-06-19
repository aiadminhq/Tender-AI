"""SL5 push_logs (Layer B 主動推播紀錄)

Revision ID: d7a3f9c2e6b1
Revises: c8e4f1a6d3b2
Create Date: 2026-06-18 23:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd7a3f9c2e6b1'
down_revision: Union[str, None] = 'c8e4f1a6d3b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'push_logs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('tender_id', sa.Integer(), nullable=True),
        sa.Column('run_date', sa.Date(), nullable=False),
        sa.Column('score', sa.Integer(), nullable=True),
        sa.Column('tier', sa.String(length=16), nullable=True),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('channel', sa.String(length=32), server_default='in_app', nullable=False),
        sa.Column('status', sa.String(length=16), server_default='pending', nullable=False),
        sa.Column('pushed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tender_id'], ['tenders.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'tender_id', 'run_date', name='uq_push_user_tender_date'),
    )
    op.create_index(op.f('ix_push_logs_user_id'), 'push_logs', ['user_id'], unique=False)
    op.create_index(op.f('ix_push_logs_tender_id'), 'push_logs', ['tender_id'], unique=False)
    op.create_index(op.f('ix_push_logs_run_date'), 'push_logs', ['run_date'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_push_logs_run_date'), table_name='push_logs')
    op.drop_index(op.f('ix_push_logs_tender_id'), table_name='push_logs')
    op.drop_index(op.f('ix_push_logs_user_id'), table_name='push_logs')
    op.drop_table('push_logs')

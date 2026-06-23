"""assistant conversation persistence (Phase 4)

Revision ID: a8f2c1e7b9d4
Revises: d4f6a2c8e1b9
Create Date: 2026-06-23 00:00:00.000000

小助手對話留存：assistant_threads / assistant_messages。
Layer B 紅線（見 CLAUDE.md）：登入身分未落地前 owner_user_id 一律 "default"、
consent_state="pending-consent"、layer_b_opt_in=false——不具名、不共享、對外永不揭露。
留存內容僅對話文字與公開 A 層來源卡，不存任何 Layer B 行為明細。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a8f2c1e7b9d4'
down_revision: Union[str, None] = 'd4f6a2c8e1b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'assistant_threads',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column(
            'owner_user_id', sa.String(length=64),
            server_default='default', nullable=False,
        ),
        sa.Column('scope', sa.String(length=32), nullable=False),
        sa.Column('title', sa.String(length=120), nullable=True),
        sa.Column(
            'consent_state', sa.String(length=24),
            server_default='pending-consent', nullable=False,
        ),
        sa.Column(
            'layer_b_opt_in', sa.Boolean(),
            server_default='false', nullable=False,
        ),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_assistant_threads_owner_user_id'),
        'assistant_threads', ['owner_user_id'], unique=False,
    )
    op.create_table(
        'assistant_messages',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('thread_id', sa.String(length=64), nullable=False),
        sa.Column('role', sa.String(length=16), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('sources', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['thread_id'], ['assistant_threads.id'], ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_assistant_messages_thread_id'),
        'assistant_messages', ['thread_id'], unique=False,
    )
    op.create_index(
        op.f('ix_assistant_messages_created_at'),
        'assistant_messages', ['created_at'], unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_assistant_messages_created_at'), table_name='assistant_messages',
    )
    op.drop_index(
        op.f('ix_assistant_messages_thread_id'), table_name='assistant_messages',
    )
    op.drop_table('assistant_messages')
    op.drop_index(
        op.f('ix_assistant_threads_owner_user_id'), table_name='assistant_threads',
    )
    op.drop_table('assistant_threads')

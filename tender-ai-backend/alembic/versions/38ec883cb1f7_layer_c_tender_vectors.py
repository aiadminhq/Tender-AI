"""layer C tender_vectors

Revision ID: 38ec883cb1f7
Revises: fe50d023c38b
Create Date: 2026-06-18 09:24:24.569925
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision: str = '38ec883cb1f7'
down_revision: Union[str, None] = 'fe50d023c38b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# bge-m3 向量維度；與 app.models.knowledge.EMBED_DIM 一致，換模型須出新 migration。
EMBED_DIM = 1024


def upgrade() -> None:
    # vector 擴充已於初版 migration（52513f0eb85d）以 CREATE EXTENSION 建立，此處不重建。
    op.create_table(
        'tender_vectors',
        sa.Column('tender_id', sa.Integer(), nullable=False),
        sa.Column('embedding', Vector(EMBED_DIM), nullable=False),
        sa.Column('model', sa.String(length=32), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['tender_id'], ['tenders.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('tender_id'),
    )
    # HNSW + cosine：與查詢端 <=>（cosine distance）對齊。空表上建索引為即時操作。
    op.create_index(
        'ix_tender_vectors_embedding_hnsw',
        'tender_vectors',
        ['embedding'],
        unique=False,
        postgresql_using='hnsw',
        postgresql_ops={'embedding': 'vector_cosine_ops'},
    )


def downgrade() -> None:
    op.drop_index('ix_tender_vectors_embedding_hnsw', table_name='tender_vectors')
    op.drop_table('tender_vectors')

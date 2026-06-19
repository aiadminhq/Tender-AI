"""SL4 knowledge_chunks（知識庫切塊 + 向量 + 斷詞索引）

Revision ID: c8e4f1a6d3b2
Revises: b7d2f3a9c5e8
Create Date: 2026-06-18 22:05:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision: str = 'c8e4f1a6d3b2'
down_revision: Union[str, None] = 'b7d2f3a9c5e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# bge-m3 向量維度；與 app.models.knowledge.EMBED_DIM 一致，換模型須出新 migration。
EMBED_DIM = 1024


def upgrade() -> None:
    # vector 擴充已於初版 migration（52513f0eb85d）建立，此處不重建。
    op.create_table(
        'knowledge_chunks',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('doc_id', sa.String(length=128), nullable=False),
        sa.Column('title', sa.String(length=256), nullable=False),
        sa.Column('heading', sa.String(length=256), nullable=True),
        sa.Column('chunk_index', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('tokens', sa.Text(), server_default='', nullable=False),
        sa.Column('embedding', Vector(EMBED_DIM), nullable=False),
        sa.Column('model', sa.String(length=32), nullable=False),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('doc_id', 'chunk_index', name='uq_knowledge_chunks_doc_idx'),
    )
    op.create_index(
        'ix_knowledge_chunks_doc_id', 'knowledge_chunks', ['doc_id'], unique=False
    )
    # HNSW + cosine：與查詢端 <=>（cosine distance）對齊。空表上建索引為即時操作。
    op.create_index(
        'ix_knowledge_chunks_embedding_hnsw',
        'knowledge_chunks',
        ['embedding'],
        unique=False,
        postgresql_using='hnsw',
        postgresql_ops={'embedding': 'vector_cosine_ops'},
    )
    # GIN(tsvector)：jieba 斷詞後關鍵字檢索（simple config，不依賴中文分詞器）。
    op.create_index(
        'ix_knowledge_chunks_tokens_fts',
        'knowledge_chunks',
        [sa.text("to_tsvector('simple', tokens)")],
        unique=False,
        postgresql_using='gin',
    )


def downgrade() -> None:
    op.drop_index('ix_knowledge_chunks_tokens_fts', table_name='knowledge_chunks')
    op.drop_index('ix_knowledge_chunks_embedding_hnsw', table_name='knowledge_chunks')
    op.drop_index('ix_knowledge_chunks_doc_id', table_name='knowledge_chunks')
    op.drop_table('knowledge_chunks')

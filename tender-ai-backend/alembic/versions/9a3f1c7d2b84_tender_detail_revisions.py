"""tender detail revisions (revision-first enrich)

新增詳情 enrich 的 revision-first 持久層:tender_snapshots(原始抓取/去重帳本)、
tender_revisions(不可變正規化版本)、crawl_runs / crawl_failures(抓取治理),
並於 tenders 加 current_revision_id(現值投影,循環 FK 以 use_alter 在建表後 ALTER)
與 detail_checked_at(TTL)。embedding 維度/內容不動。

Revision ID: 9a3f1c7d2b84
Revises: 38ec883cb1f7
Create Date: 2026-06-18 11:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '9a3f1c7d2b84'
down_revision: Union[str, None] = '38ec883cb1f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- tender_snapshots:每次「不同內容」的原始抓取(稽核 + 去重帳本) --- #
    op.create_table(
        'tender_snapshots',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tender_id', sa.Integer(), nullable=False),
        sa.Column('source_url', sa.Text(), nullable=True),
        sa.Column('http_status', sa.Integer(), nullable=True),
        sa.Column('content_type', sa.String(length=128), nullable=True),
        sa.Column('content_hash', sa.String(length=64), nullable=False),
        sa.Column('source_revision_key', sa.String(length=16), nullable=True),
        sa.Column('raw_html', sa.Text(), nullable=False),
        sa.Column('storage_uri', sa.Text(), nullable=True),
        sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['tender_id'], ['tenders.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'tender_id', 'content_hash', name='uq_snapshot_tender_hash'
        ),
    )
    op.create_index(
        'ix_tender_snapshots_tender_id', 'tender_snapshots', ['tender_id']
    )

    # --- tender_revisions:不可變正規化版本(永不 UPDATE) --- #
    op.create_table(
        'tender_revisions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tender_id', sa.Integer(), nullable=False),
        sa.Column('snapshot_id', sa.Integer(), nullable=False),
        sa.Column('revision_no', sa.Integer(), nullable=False),
        sa.Column('content_hash', sa.String(length=64), nullable=False),
        sa.Column('source_revision_key', sa.String(length=16), nullable=True),
        sa.Column('award_method', sa.String(length=32), nullable=True),
        sa.Column('deposit_required', sa.Boolean(), nullable=True),
        sa.Column('deposit_amount_twd', sa.BigInteger(), nullable=True),
        sa.Column('deposit_raw_text', sa.Text(), nullable=True),
        sa.Column('qualification_codes', postgresql.JSONB(), nullable=True),
        sa.Column('qualification_text', sa.Text(), nullable=True),
        sa.Column('category_main', sa.String(length=16), nullable=True),
        sa.Column('category_code', sa.String(length=8), nullable=True),
        sa.Column('category_name', sa.Text(), nullable=True),
        sa.Column('category_raw', sa.Text(), nullable=True),
        sa.Column('performance_period', sa.Text(), nullable=True),
        sa.Column('performance_location', sa.Text(), nullable=True),
        sa.Column('subsidy_source', sa.Text(), nullable=True),
        sa.Column('extra_note', sa.Text(), nullable=True),
        sa.Column('raw_fields', postgresql.JSONB(), nullable=True),
        sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['tender_id'], ['tenders.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(
            ['snapshot_id'], ['tender_snapshots.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'tender_id', 'revision_no', name='uq_revision_tender_no'
        ),
        sa.UniqueConstraint(
            'tender_id', 'content_hash', name='uq_revision_tender_hash'
        ),
    )
    op.create_index(
        'ix_tender_revisions_tender_id', 'tender_revisions', ['tender_id']
    )

    # --- crawl_runs:每日/手動 enrich 一次執行的稽核與計數 --- #
    op.create_table(
        'crawl_runs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('trigger', sa.String(length=16), nullable=False),
        sa.Column(
            'started_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('targeted', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('fetched', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('unchanged', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column(
            'new_revisions', sa.Integer(), server_default=sa.text('0'), nullable=False
        ),
        sa.Column('failed', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column(
            'status',
            sa.String(length=16),
            server_default=sa.text("'running'"),
            nullable=False,
        ),
        sa.Column('notes', postgresql.JSONB(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )

    # --- crawl_failures:抓取/解析失敗帳本(支援重試) --- #
    op.create_table(
        'crawl_failures',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('crawl_run_id', sa.Integer(), nullable=True),
        sa.Column('tender_id', sa.Integer(), nullable=False),
        sa.Column('stage', sa.String(length=8), nullable=False),
        sa.Column('http_status', sa.Integer(), nullable=True),
        sa.Column('error_class', sa.String(length=64), nullable=True),
        sa.Column('error_detail', sa.Text(), nullable=True),
        sa.Column('attempt', sa.Integer(), server_default=sa.text('1'), nullable=False),
        sa.Column(
            'retriable', sa.Boolean(), server_default=sa.text('true'), nullable=False
        ),
        sa.Column('next_retry_after', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['crawl_run_id'], ['crawl_runs.id'], ondelete='SET NULL'
        ),
        sa.ForeignKeyConstraint(['tender_id'], ['tenders.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_crawl_failures_crawl_run_id', 'crawl_failures', ['crawl_run_id']
    )
    op.create_index('ix_crawl_failures_tender_id', 'crawl_failures', ['tender_id'])
    op.create_index(
        'ix_crawl_failures_retry',
        'crawl_failures',
        ['resolved_at', 'retriable', 'next_retry_after'],
    )

    # --- tenders 投影欄:current_revision_id(循環 FK 後 ALTER)、detail_checked_at --- #
    op.add_column(
        'tenders', sa.Column('current_revision_id', sa.Integer(), nullable=True)
    )
    op.add_column(
        'tenders',
        sa.Column('detail_checked_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_tenders_current_revision',
        'tenders',
        'tender_revisions',
        ['current_revision_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        'ix_tenders_detail_checked_at', 'tenders', ['detail_checked_at']
    )


def downgrade() -> None:
    # 先解循環 FK 與投影欄,再逆序 drop 四表。
    op.drop_index('ix_tenders_detail_checked_at', table_name='tenders')
    op.drop_constraint('fk_tenders_current_revision', 'tenders', type_='foreignkey')
    op.drop_column('tenders', 'detail_checked_at')
    op.drop_column('tenders', 'current_revision_id')

    op.drop_index('ix_crawl_failures_retry', table_name='crawl_failures')
    op.drop_index('ix_crawl_failures_tender_id', table_name='crawl_failures')
    op.drop_index('ix_crawl_failures_crawl_run_id', table_name='crawl_failures')
    op.drop_table('crawl_failures')

    op.drop_table('crawl_runs')

    op.drop_index('ix_tender_revisions_tender_id', table_name='tender_revisions')
    op.drop_table('tender_revisions')

    op.drop_index('ix_tender_snapshots_tender_id', table_name='tender_snapshots')
    op.drop_table('tender_snapshots')

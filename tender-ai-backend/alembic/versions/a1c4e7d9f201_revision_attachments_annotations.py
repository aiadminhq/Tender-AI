"""tender_revisions 加 attachments / annotations(研究 pipeline)

研究資料蒐集 pipeline(進階查詢全抓 + 投標須知歸檔)需在不可變 revision 上多存兩欄:
- attachments(JSONB):投標須知等附件索引(每筆 {filename, url, storage_uri, sha256, ...});
  實檔離庫落 data/downloads/,此處只存索引。
- annotations(JSONB):衍生標注標籤(如室內/裝修關鍵字命中),**供研究標注,非過濾**。

皆 nullable,既有列補 NULL;不動其餘欄與維度。

Revision ID: a1c4e7d9f201
Revises: ef13668b507f
Create Date: 2026-06-18 15:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a1c4e7d9f201'
down_revision: Union[str, None] = 'ef13668b507f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'tender_revisions',
        sa.Column('attachments', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        'tender_revisions',
        sa.Column('annotations', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('tender_revisions', 'annotations')
    op.drop_column('tender_revisions', 'attachments')

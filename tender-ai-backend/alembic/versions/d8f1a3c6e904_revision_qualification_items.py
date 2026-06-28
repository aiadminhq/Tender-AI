"""tender_revisions: 加 qualification_items（資格摘要結構化條目）

Revision ID: d8f1a3c6e904
Revises: c7e2a4f9d1b6
Create Date: 2026-06-24 00:00:00.000000

資格摘要長文（qualification_text）結構化為通用「屬性/標籤/內文/參數」條目，
供前端表格呈現與後續向量化。此為可由原始文字重算的衍生投影（Layer A 公開），
nullable，回填走離線冪等 job backfill_qualification_items。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd8f1a3c6e904'
down_revision: Union[str, None] = 'c7e2a4f9d1b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'tender_revisions',
        sa.Column('qualification_items', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('tender_revisions', 'qualification_items')

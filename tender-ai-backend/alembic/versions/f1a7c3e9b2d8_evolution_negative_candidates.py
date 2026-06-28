"""evolution_logs.negative_candidates：疑似迴避詞「候選」（人工審核用）

Revision ID: f1a7c3e9b2d8
Revises: e3b9f1a72c45
Create Date: 2026-06-24 15:30:00.000000

自我進化每批由資料浮現、偏「不可行」的疑似迴避詞，存為「附理由的建議候選」
（[{term, feasible_count, infeasible_count, lift, support, reason}, ...]）供管理者
審核是否手動列為迴避詞。系統**不得**據此自動寫入負權重——負分一律由人手動
給出（負分人工專屬紅線，見 CLAUDE.md P4/P5、記憶 negative-keywords-human-only）。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f1a7c3e9b2d8'
down_revision: Union[str, None] = 'e3b9f1a72c45'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'evolution_logs',
        sa.Column(
            'negative_candidates',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column('evolution_logs', 'negative_candidates')

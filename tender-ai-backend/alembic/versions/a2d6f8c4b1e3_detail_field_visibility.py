"""detail field visibility config (team-shared single-row)

Revision ID: a2d6f8c4b1e3
Revises: f1a7c3e9b2d8
Create Date: 2026-06-24 00:00:00.000000

標案詳情「常態性規格表」的欄位顯示設定（團隊共用 → 單列 id=1）。
hidden_fields 存被隱藏的欄位鍵清單（前端欄位註冊表 key），空陣列＝全部顯示。
只存 UI 偏好，不含 Layer A/B 內容，可入版控。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a2d6f8c4b1e3'
down_revision: Union[str, None] = 'f1a7c3e9b2d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'detail_field_visibility_config',
        sa.Column('id', sa.Integer(), autoincrement=False, nullable=False),
        sa.Column(
            'hidden_fields', postgresql.JSONB(astext_type=sa.Text()),
            server_default='[]', nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    # seed 單列預設（id=1, hidden_fields=[]）；service 端亦 get-or-create 兜底。
    op.execute(
        "INSERT INTO detail_field_visibility_config (id, hidden_fields) "
        "VALUES (1, '[]'::jsonb)"
    )


def downgrade() -> None:
    op.drop_table('detail_field_visibility_config')

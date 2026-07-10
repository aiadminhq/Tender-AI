"""add design_feedback_items table

Revision ID: c9a4e7d2b6f1
Revises: b7c2e9d4a8f1
Create Date: 2026-07-02 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c9a4e7d2b6f1"
down_revision: Union[str, None] = "b7c2e9d4a8f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "design_feedback_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.String(length=64), nullable=False),
        sa.Column("owner_user_id", sa.String(length=64), server_default="default", nullable=False),
        sa.Column("source", sa.String(length=32), server_default="annotation", nullable=False),
        sa.Column("target_cli", sa.String(length=32), nullable=True),
        sa.Column("route", sa.String(length=256), nullable=False),
        sa.Column("selector", sa.Text(), nullable=False),
        sa.Column("component_guess", sa.String(length=128), nullable=True),
        sa.Column("text_snapshot", sa.Text(), nullable=True),
        sa.Column("rect", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("feedback_type", sa.String(length=32), nullable=False),
        sa.Column("severity", sa.String(length=24), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at_client", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_design_feedback_items_batch_id", "design_feedback_items", ["batch_id"])
    op.create_index("ix_design_feedback_items_created_at", "design_feedback_items", ["created_at"])
    op.create_index("ix_design_feedback_items_owner_user_id", "design_feedback_items", ["owner_user_id"])
    op.create_index("ix_design_feedback_items_route", "design_feedback_items", ["route"])
    op.create_index("ix_design_feedback_items_severity", "design_feedback_items", ["severity"])
    op.create_index("ix_design_feedback_items_source", "design_feedback_items", ["source"])
    op.create_index("ix_design_feedback_items_target_cli", "design_feedback_items", ["target_cli"])


def downgrade() -> None:
    op.drop_index("ix_design_feedback_items_target_cli", table_name="design_feedback_items")
    op.drop_index("ix_design_feedback_items_source", table_name="design_feedback_items")
    op.drop_index("ix_design_feedback_items_severity", table_name="design_feedback_items")
    op.drop_index("ix_design_feedback_items_route", table_name="design_feedback_items")
    op.drop_index("ix_design_feedback_items_owner_user_id", table_name="design_feedback_items")
    op.drop_index("ix_design_feedback_items_created_at", table_name="design_feedback_items")
    op.drop_index("ix_design_feedback_items_batch_id", table_name="design_feedback_items")
    op.drop_table("design_feedback_items")

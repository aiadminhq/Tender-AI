# -*- coding: utf-8 -*-
"""Design feedback persistence and markdown aggregation."""
from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.design_feedback import DesignFeedbackItem
from app.schemas.design_feedback import (
    DesignFeedbackCreateItem,
    DesignFeedbackCreateRequest,
)

TYPE_LABEL = {
    "visual": "視覺",
    "interaction": "互動",
    "copy": "文案",
    "layout": "版面",
    "other": "其他",
}

SEVERITY_LABEL = {
    "suggest": "建議",
    "important": "重要",
    "blocker": "阻擋",
}

SEVERITY_MARK = {
    "suggest": "·",
    "important": "!",
    "blocker": "‼",
}


async def create_batch(
    session: AsyncSession,
    payload: DesignFeedbackCreateRequest,
    owner_user_id: str,
) -> tuple[str, list[DesignFeedbackItem]]:
    batch_id = payload.batch_id or uuid4().hex
    rows = [
        _to_row(item, batch_id, payload.source, payload.target_cli, owner_user_id)
        for item in payload.items
    ]
    session.add_all(rows)
    await session.flush()
    for row in rows:
        await session.refresh(row)
    return batch_id, rows


async def list_items(
    session: AsyncSession,
    *,
    limit: int = 100,
    target_cli: str | None = None,
    owner_user_id: str | None = None,
) -> list[DesignFeedbackItem]:
    stmt = select(DesignFeedbackItem).order_by(
        DesignFeedbackItem.created_at.desc(),
        DesignFeedbackItem.id.desc(),
    )
    if target_cli:
        stmt = stmt.where(DesignFeedbackItem.target_cli == target_cli)
    if owner_user_id:
        stmt = stmt.where(DesignFeedbackItem.owner_user_id == owner_user_id)
    stmt = stmt.limit(max(1, min(limit, 500)))
    return list((await session.execute(stmt)).scalars().all())


def render_markdown(items: list[DesignFeedbackItem]) -> str:
    stamp = datetime.now(UTC).isoformat()
    if not items:
        return f"## 設計回饋彙整（{stamp}）\n\n（目前沒有回饋）\n"

    by_route: dict[str, list[DesignFeedbackItem]] = defaultdict(list)
    for item in sorted(items, key=lambda x: (x.route, x.created_at, x.id)):
        by_route[item.route].append(item)

    target_labels = sorted({i.target_cli for i in items if i.target_cli})
    source_labels = sorted({i.source for i in items if i.source})
    blocks = [
        f"## 設計回饋彙整（{stamp}）",
        f"共 {len(items)} 則，跨 {len(by_route)} 個頁面。",
    ]
    if target_labels:
        blocks.append(f"目標 CLI：{', '.join(target_labels)}")
    if source_labels:
        blocks.append(f"來源：{', '.join(source_labels)}")

    for route, route_items in by_route.items():
        blocks.append(f"\n### 頁面：`{route}`")
        blocks.append("\n\n".join(_format_item(item, index + 1) for index, item in enumerate(route_items)))

    return "\n".join(blocks) + "\n"


def _to_row(
    item: DesignFeedbackCreateItem,
    batch_id: str,
    source: str,
    target_cli: str | None,
    owner_user_id: str,
) -> DesignFeedbackItem:
    return DesignFeedbackItem(
        batch_id=batch_id,
        owner_user_id=owner_user_id,
        source=source,
        target_cli=target_cli,
        route=item.route,
        selector=item.selector,
        component_guess=item.component_guess,
        text_snapshot=item.text_snapshot,
        rect=item.rect.model_dump() if item.rect else None,
        feedback_type=item.type,
        severity=item.severity,
        comment=item.comment,
        metadata_json=item.metadata,
        created_at_client=item.created_at,
    )


def _format_item(item: DesignFeedbackItem, index: int) -> str:
    lines = [
        f"{index}. **{SEVERITY_MARK.get(item.severity, '·')} {TYPE_LABEL.get(item.feedback_type, item.feedback_type)}** — {item.comment.strip()}",
        f"   - 元件：`{item.component_guess or '未知'}`",
        f"   - 選擇器：`{item.selector}`",
    ]
    if item.text_snapshot:
        lines.append(f"   - 原文：「{item.text_snapshot}」")
    if item.target_cli:
        lines.append(f"   - 目標 CLI：`{item.target_cli}`")
    lines.append(f"   - 嚴重度：{SEVERITY_LABEL.get(item.severity, item.severity)} ｜ 批次：`{item.batch_id}`")
    return "\n".join(lines)

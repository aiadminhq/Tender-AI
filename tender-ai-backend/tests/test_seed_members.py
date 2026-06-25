# -*- coding: utf-8 -*-
"""seed_members 整合測試。

設計重點（對應 task-13 controller 消歧）：
- 入口：`await seed_members(session_factory)`（非 .run(session)）
- Fixture：`session_factory`（TestSessionLocal），非 `db_session`
- 非空測：「既有不覆蓋」用名單內的 alex@hqdesign.tw，預先建 consent_shared=False，
  才真正走到 upsert 的「既有分支」
- Identity-map staleness：assert 一律用全新 `async with session_factory() as s:` 重查
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.jobs.seed_members import seed_members, MEMBERS
from app.models.behavior import User


@pytest.mark.asyncio
async def test_new_accounts_seed_consent_true(session_factory):
    """新建的所有帳號 consent_shared 應全為 True（MEMBERS 名單 9 位）。"""
    stats = await seed_members(session_factory)
    assert stats["created"] == len(MEMBERS), (
        f"應建立 {len(MEMBERS)} 位成員，實際 created={stats['created']}"
    )

    async with session_factory() as s:
        member_emails = [m["email"] for m in MEMBERS]
        rows = (
            await s.execute(select(User).where(User.email.in_(member_emails)))
        ).scalars().all()

    assert rows, "DB 應有成員帳號"
    non_consented = [u.email for u in rows if not u.consent_shared]
    assert not non_consented, (
        f"新建帳號 consent_shared 應全為 True，以下為 False：{non_consented}"
    )


@pytest.mark.asyncio
async def test_existing_optout_not_clobbered(session_factory):
    """名單內既有帳號（alex@hqdesign.tw）預先 consent_shared=False，跑 seed 後仍為 False。

    使用名單內的真實 email 才能真正觸發 upsert「既有分支」的程式路徑。
    """
    target_email = "alex@hqdesign.tw"

    # setup：先建一個 consent_shared=False 的既有帳號
    async with session_factory() as s:
        existing = User(
            name="Alex",
            email=target_email,
            role="member",
            whitelist_active=True,
            consent_shared=False,
        )
        s.add(existing)
        await s.commit()

    # 跑 seed（自己開 session，在自己的 session 裡 commit）
    stats = await seed_members(session_factory)
    assert stats["updated"] >= 1, "應至少更新一個既有帳號"

    # assert：用全新 session 重查，避免 identity-map staleness
    async with session_factory() as s:
        user = (
            await s.execute(select(User).where(User.email == target_email))
        ).scalar_one()

    assert user.consent_shared is False, (
        "既有帳號的 consent_shared=False（個人 opt-out）不可被 seed 覆蓋"
    )

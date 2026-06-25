# -*- coding: utf-8 -*-
"""種子：建立惠強（@hqdesign.tw）成員帳號（Phase 2 認證）。

依目前合作範圍成員建檔，作為「越用越聰明」共享知識庫的具名貢獻者基礎：
- 帳號 ＝ 信箱；預設密碼一律 "admin"（雜湊後落地，明文不存）。
- 角色：christian.wu / aaron.chang = admin，其餘 = member。
- whitelist_active = True：管理員（本次建檔的行為）開通合作範圍（第 1 段同意）。
- 同意模型（2026-06-25 團隊協議，opt-out）：
    白名單（@hqdesign.tw）帳號登入操作本站即視為同意共享其資訊與行為。
    新建帳號 consent_shared=True；既有帳號不觸碰（永不覆蓋個人 opt-out），
    與「密碼僅在未設定時才寫」哲學一致。個人可於設定頁退出共享。

冪等（idempotent）：以 email upsert。
- 帳號不存在 → 建立並設預設密碼。
- 帳號已存在 → 補正 name／role／whitelist_active；**密碼僅在尚未設定（None）時**
  才寫入預設值，已設過（含使用者自行改過）一律不覆蓋。
- 旗標 ``--reset-passwords`` 才會把所有成員密碼強制重置回預設（管理員用，慎用）。

執行：
    uv run python -m app.jobs.seed_members
    uv run python -m app.jobs.seed_members --reset-passwords
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.session import AsyncSessionLocal
from app.models.behavior import User
from app.services.account import DEFAULT_SEED_PASSWORD
from app.core.security import hash_password

# 合作範圍成員（截圖 9 位，皆 @hqdesign.tw）。role 僅 christian.wu／aaron.chang 為 admin。
MEMBERS: list[dict[str, str]] = [
    {"name": "Aaron", "email": "aaron.chang@hqdesign.tw", "role": "admin"},
    {"name": "Alex", "email": "alex@hqdesign.tw", "role": "member"},
    {"name": "Christian Wu", "email": "christian.wu@hqdesign.tw", "role": "admin"},
    {"name": "David", "email": "david.tsai@hqdesign.tw", "role": "member"},
    {"name": "Dison Fu", "email": "dinson.fu@hqdesign.tw", "role": "member"},
    {"name": "Ivy", "email": "ivy.chang@hqdesign.tw", "role": "member"},
    {"name": "james.hu", "email": "james.hu@hqdesign.tw", "role": "member"},
    {"name": "Lily.chang", "email": "lily.chang@hqdesign.tw", "role": "member"},
    {"name": "Nylon", "email": "nylon.chen@hqdesign.tw", "role": "member"},
]


async def seed_members(
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    *,
    reset_passwords: bool = False,
) -> dict[str, int]:
    """建立／補正成員帳號（冪等）。回傳統計：created／updated／password_set。"""
    factory = session_factory or AsyncSessionLocal
    stats = {"created": 0, "updated": 0, "password_set": 0}
    async with factory() as session:
        for m in MEMBERS:
            email = m["email"].strip().lower()
            user = (
                await session.execute(select(User).where(User.email == email))
            ).scalar_one_or_none()
            if user is None:
                user = User(
                    name=m["name"],
                    email=email,
                    role=m["role"],
                    whitelist_active=True,
                    consent_shared=True,   # 團隊協議：登入操作即同意（opt-out，可於設定頁退出）
                    password_hash=hash_password(DEFAULT_SEED_PASSWORD),
                )
                session.add(user)
                stats["created"] += 1
                stats["password_set"] += 1
            else:
                user.name = m["name"]
                user.role = m["role"]
                user.whitelist_active = True
                # 密碼：僅在尚未設定，或明確要求重置時才寫入（不覆蓋已改過的密碼）
                if reset_passwords or not user.password_hash:
                    user.password_hash = hash_password(DEFAULT_SEED_PASSWORD)
                    stats["password_set"] += 1
                stats["updated"] += 1
        await session.commit()
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description="建立惠強成員帳號（Phase 2）")
    ap.add_argument(
        "--reset-passwords",
        action="store_true",
        help="強制把所有成員密碼重置回預設 admin（慎用）",
    )
    args = ap.parse_args()
    stats = asyncio.run(seed_members(reset_passwords=args.reset_passwords))
    print(
        f"成員種子完成：新增 {stats['created']}｜更新 {stats['updated']}"
        f"｜設定密碼 {stats['password_set']}（預設密碼，請提醒成員儘速修改）",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()

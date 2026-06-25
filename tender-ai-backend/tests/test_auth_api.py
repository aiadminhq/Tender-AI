# -*- coding: utf-8 -*-
"""登入／改密／管理員重置 API 測試（Phase 2 認證）。

對照本次需求：
  POST /api/v1/auth/login                     信箱＋密碼驗證身分（輕量，不簽 token）
  PUT  /api/v1/me/password                    本人改密（須舊密碼）
  POST /api/v1/admin/users/{id}/password      管理員重置（require_admin）
  app.jobs.seed_members.seed_members          種子 9 位成員（冪等）

信任邊界：沿用 Phase 1——身分由 body 帶入、未驗證；管理權限暫以 X-User-Role
header 把關。密碼以 pbkdf2_sha256 雜湊，明文不落地。
"""
from __future__ import annotations

from app.core.security import hash_password, verify_password
from app.jobs.seed_members import MEMBERS, seed_members
from app.services.account import DEFAULT_SEED_PASSWORD

LOGIN = "/api/v1/auth/login"
ME = "/api/v1/me"
ME_PASSWORD = "/api/v1/me/password"
WHITELIST = "/api/v1/admin/whitelist"
ADMIN = {"X-User-Role": "admin"}


def _admin_password_url(user_id: int) -> str:
    return f"/api/v1/admin/users/{user_id}/password"


# --------------------------------------------------------------------------- #
# 雜湊工具（純函式，不需 DB）
# --------------------------------------------------------------------------- #
def test_hash_password_roundtrip_and_unique_salt():
    h1 = hash_password("admin")
    h2 = hash_password("admin")
    assert h1 != h2  # 每次新鹽
    assert verify_password("admin", h1) is True
    assert verify_password("wrong", h1) is False
    assert h1.startswith("pbkdf2_sha256$")


def test_verify_password_handles_none_and_garbage():
    assert verify_password("x", None) is False
    assert verify_password("x", "") is False
    assert verify_password("x", "not-a-valid-hash") is False


# --------------------------------------------------------------------------- #
# 種子成員（冪等 + 角色/白名單）
# --------------------------------------------------------------------------- #
async def test_seed_members_creates_named_accounts(client, session_factory):
    stats = await seed_members(session_factory)
    assert stats["created"] == len(MEMBERS)

    # christian.wu 為 admin、已開通白名單、未自動同意，且能以預設密碼登入
    r = await client.post(
        LOGIN,
        json={"email": "christian.wu@hqdesign.tw", "password": DEFAULT_SEED_PASSWORD},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["role"] == "admin"
    assert body["whitelist_active"] is True
    assert body["consent_shared"] is False
    assert body["password_is_default"] is True


async def test_seed_members_is_idempotent_and_keeps_changed_password(
    client, session_factory
):
    await seed_members(session_factory)
    # 某成員自行改密
    me = (
        await client.post(
            LOGIN, json={"email": "alex@hqdesign.tw", "password": DEFAULT_SEED_PASSWORD}
        )
    ).json()
    chg = await client.put(
        ME_PASSWORD,
        json={
            "user_id": me["id"],
            "old_password": DEFAULT_SEED_PASSWORD,
            "new_password": "newpass1",
        },
    )
    assert chg.status_code == 200

    # 再跑一次種子：不得覆蓋已改過的密碼
    stats = await seed_members(session_factory)
    assert stats["created"] == 0
    r = await client.post(
        LOGIN, json={"email": "alex@hqdesign.tw", "password": "newpass1"}
    )
    assert r.status_code == 200
    # 預設密碼此時已失效
    r2 = await client.post(
        LOGIN, json={"email": "alex@hqdesign.tw", "password": DEFAULT_SEED_PASSWORD}
    )
    assert r2.status_code == 403


# --------------------------------------------------------------------------- #
# POST /auth/login
# --------------------------------------------------------------------------- #
async def test_login_wrong_password_403(client, session_factory):
    await seed_members(session_factory)
    r = await client.post(
        LOGIN, json={"email": "ivy.chang@hqdesign.tw", "password": "nope"}
    )
    assert r.status_code == 403


async def test_login_unknown_email_403(client):
    r = await client.post(
        LOGIN, json={"email": "ghost@hqdesign.tw", "password": "admin"}
    )
    assert r.status_code == 403


async def test_login_password_is_default_flag_false_after_change(
    client, session_factory
):
    await seed_members(session_factory)
    me = (
        await client.post(
            LOGIN,
            json={"email": "david.tsai@hqdesign.tw", "password": DEFAULT_SEED_PASSWORD},
        )
    ).json()
    await client.put(
        ME_PASSWORD,
        json={
            "user_id": me["id"],
            "old_password": DEFAULT_SEED_PASSWORD,
            "new_password": "strongpass",
        },
    )
    r = await client.post(
        LOGIN, json={"email": "david.tsai@hqdesign.tw", "password": "strongpass"}
    )
    assert r.status_code == 200
    assert r.json()["password_is_default"] is False


# --------------------------------------------------------------------------- #
# GET /me（重整／自動登入路徑也須帶 password_is_default — 回歸測試）
# --------------------------------------------------------------------------- #
async def test_me_carries_password_is_default_true_for_seed(client, session_factory):
    """GET /me 須由伺服器依儲存雜湊推導 password_is_default。

    回歸：先前 MeOut 不帶此欄位，導致前端重整／自動登入後「建議修改密碼」提示消失。
    """
    await seed_members(session_factory)
    me = (
        await client.post(
            LOGIN,
            json={"email": "ivy.chang@hqdesign.tw", "password": DEFAULT_SEED_PASSWORD},
        )
    ).json()
    # 模擬重整：不重新登入，僅以 user_id 取 /me
    r = await client.get(ME, params={"user_id": me["id"]})
    assert r.status_code == 200
    assert r.json()["password_is_default"] is True


async def test_me_password_is_default_flips_false_after_change(
    client, session_factory
):
    await seed_members(session_factory)
    me = (
        await client.post(
            LOGIN,
            json={"email": "ivy.chang@hqdesign.tw", "password": DEFAULT_SEED_PASSWORD},
        )
    ).json()
    chg = await client.put(
        ME_PASSWORD,
        json={
            "user_id": me["id"],
            "old_password": DEFAULT_SEED_PASSWORD,
            "new_password": "strongpass",
        },
    )
    assert chg.status_code == 200
    # 改密回應本身即應為 False
    assert chg.json()["password_is_default"] is False
    # 重整再取 /me 仍為 False（不再殘留提示）
    r = await client.get(ME, params={"user_id": me["id"]})
    assert r.json()["password_is_default"] is False


async def test_me_password_is_default_true_again_after_admin_reset_to_default(
    client, session_factory
):
    """管理員把密碼重置回預設 admin 時，/me 應重新顯示 True。"""
    await seed_members(session_factory)
    me = (
        await client.post(
            LOGIN,
            json={"email": "ivy.chang@hqdesign.tw", "password": DEFAULT_SEED_PASSWORD},
        )
    ).json()
    # 先改成非預設，確認轉 False
    await client.put(
        ME_PASSWORD,
        json={
            "user_id": me["id"],
            "old_password": DEFAULT_SEED_PASSWORD,
            "new_password": "strongpass",
        },
    )
    assert (await client.get(ME, params={"user_id": me["id"]})).json()[
        "password_is_default"
    ] is False
    # 管理員重置回預設密碼 → 再度 True
    rst = await client.post(
        _admin_password_url(me["id"]),
        json={"new_password": DEFAULT_SEED_PASSWORD},
        headers=ADMIN,
    )
    assert rst.status_code == 200
    assert (await client.get(ME, params={"user_id": me["id"]})).json()[
        "password_is_default"
    ] is True


# --------------------------------------------------------------------------- #
# PUT /me/password（本人改密）
# --------------------------------------------------------------------------- #
async def test_change_password_wrong_old_403(client, session_factory):
    await seed_members(session_factory)
    me = (
        await client.post(
            LOGIN,
            json={"email": "nylon.chen@hqdesign.tw", "password": DEFAULT_SEED_PASSWORD},
        )
    ).json()
    r = await client.put(
        ME_PASSWORD,
        json={"user_id": me["id"], "old_password": "wrong", "new_password": "abcd"},
    )
    assert r.status_code == 403


async def test_change_password_too_short_422(client, session_factory):
    await seed_members(session_factory)
    me = (
        await client.post(
            LOGIN,
            json={"email": "nylon.chen@hqdesign.tw", "password": DEFAULT_SEED_PASSWORD},
        )
    ).json()
    r = await client.put(
        ME_PASSWORD,
        json={
            "user_id": me["id"],
            "old_password": DEFAULT_SEED_PASSWORD,
            "new_password": "ab",
        },
    )
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# POST /admin/users/{id}/password（管理員重置）
# --------------------------------------------------------------------------- #
async def test_admin_reset_requires_admin_role_403(client, session_factory):
    await seed_members(session_factory)
    me = (
        await client.post(
            LOGIN,
            json={"email": "ivy.chang@hqdesign.tw", "password": DEFAULT_SEED_PASSWORD},
        )
    ).json()
    r = await client.post(
        _admin_password_url(me["id"]), json={"new_password": "reset123"}
    )
    assert r.status_code == 403


async def test_admin_reset_password_then_login(client, session_factory):
    await seed_members(session_factory)
    me = (
        await client.post(
            LOGIN,
            json={"email": "ivy.chang@hqdesign.tw", "password": DEFAULT_SEED_PASSWORD},
        )
    ).json()
    # 管理員把密碼重置
    r = await client.post(
        _admin_password_url(me["id"]),
        json={"new_password": "reset123"},
        headers=ADMIN,
    )
    assert r.status_code == 200
    # 舊密碼失效、新密碼可登入
    assert (
        await client.post(
            LOGIN,
            json={"email": "ivy.chang@hqdesign.tw", "password": DEFAULT_SEED_PASSWORD},
        )
    ).status_code == 403
    assert (
        await client.post(
            LOGIN, json={"email": "ivy.chang@hqdesign.tw", "password": "reset123"}
        )
    ).status_code == 200


async def test_admin_reset_unknown_user_404(client):
    r = await client.post(
        _admin_password_url(99999), json={"new_password": "reset123"}, headers=ADMIN
    )
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# Phase 2：登入成功簽發 token
# --------------------------------------------------------------------------- #
async def test_login_returns_token(client):
    from app.models.behavior import User
    from tests.conftest import TestSessionLocal

    async with TestSessionLocal() as s:
        u = User(
            name="登入測試",
            email="login@hqdesign.tw",
            role="member",
            whitelist_active=True,
            consent_shared=True,
            password_hash=hash_password("admin"),
        )
        s.add(u)
        await s.commit()

    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "login@hqdesign.tw", "password": "admin"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["token"] and "." in body["token"]
    assert body["expires_at"]

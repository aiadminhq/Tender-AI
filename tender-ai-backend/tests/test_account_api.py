# -*- coding: utf-8 -*-
"""個人資料／白名單／同意／個人偏好輪廓 API 測試（Phase 2）。

對照 plans/profile-and-learning-db/plan.mdx 四支端點與驗收 v1–v4：
  GET  /api/v1/me                     帳戶＋白名單＋同意狀態
  PUT  /api/v1/me/consent             本人設定／撤回（前置：須先在白名單內）
  GET  /api/v1/me/preference-profile  尚未學出時回空輪廓、不 404
  GET/POST /api/v1/admin/whitelist    管理員（Phase 2：token 推導 role）

Phase 2：/me/* 與 /admin/* 端點身分均由 token 推導；consent body 移除 user_id。
"""
from __future__ import annotations

ME = "/api/v1/me"
CONSENT = "/api/v1/me/consent"
PROFILE = "/api/v1/me/preference-profile"
WHITELIST = "/api/v1/admin/whitelist"


# --------------------------------------------------------------------------- #
# GET /me
# --------------------------------------------------------------------------- #
async def test_get_me_unknown_user_401(client, auth_headers):
    """v1（Phase 2）：不存在的 uid 發 token → 401（token 有效但 DB 查無 user）。"""
    r = await client.get(ME, headers=auth_headers(99999))
    assert r.status_code == 401


# --------------------------------------------------------------------------- #
# PUT /me/consent（第 2 段；前置須在白名單內）
# --------------------------------------------------------------------------- #
async def test_consent_requires_whitelist_403(client):
    """v2：未開通白名單者設定同意 → 403（get_current_user dependency 擋）。

    建立一個 whitelist_active=False 的 user，對其發 token，
    get_current_user 會在驗證白名單時拋 403。
    """
    from app.models.behavior import User
    from tests.conftest import TestSessionLocal
    from app.core.auth import issue_token
    from types import SimpleNamespace

    async with TestSessionLocal() as s:
        u = User(
            name="no-whitelist",
            email="nowhitelist@hqdesign.tw",
            role="member",
            whitelist_active=False,
            consent_shared=False,
        )
        s.add(u)
        await s.commit()
        await s.refresh(u)
        uid = u.id

    token = issue_token(SimpleNamespace(id=uid))
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.put(CONSENT, json={"consent_shared": True}, headers=headers)
    assert r.status_code == 403


async def test_consent_after_whitelist_sets_consent_at(client, admin_user, auth_headers):
    """v2：先由管理員開通白名單，本人同意 → consent_shared=True、consent_at 落地。"""
    # 第 1 段：管理員開通
    w = await client.post(
        WHITELIST,
        json={"email": "ivy@hqdesign.tw", "whitelist_active": True},
        headers=auth_headers(admin_user),
    )
    assert w.status_code == 200
    uid = w.json()["id"]

    # 第 2 段：本人同意（以 token 認身分，body 無 user_id）
    r = await client.put(CONSENT, json={"consent_shared": True}, headers=auth_headers(uid))
    assert r.status_code == 200
    body = r.json()
    assert body["consent_shared"] is True
    assert body["consent_at"] is not None

    # 撤回：consent_shared=False，但 consent_at 不清空（僅停止後續匯入）
    r2 = await client.put(CONSENT, json={"consent_shared": False}, headers=auth_headers(uid))
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["consent_shared"] is False
    assert body2["consent_at"] is not None


# --------------------------------------------------------------------------- #
# GET /me/preference-profile
# --------------------------------------------------------------------------- #
async def test_preference_profile_empty_not_404(client, default_user, auth_headers):
    """v3：尚未學出輪廓 → 回空輪廓（欄位 None），不 404。"""
    r = await client.get(PROFILE, headers=auth_headers(default_user))
    assert r.status_code == 200
    body = r.json()
    assert body["top_keywords"] is None
    assert body["preferred_categories"] is None
    assert body["budget_min"] is None


# --------------------------------------------------------------------------- #
# admin /whitelist（Phase 2 token 把關 + 網域驗證）
# --------------------------------------------------------------------------- #
async def test_whitelist_requires_admin_token(client, admin_user, default_user, auth_headers):
    # 一般 member token → 403
    r = await client.get("/api/v1/admin/whitelist", headers=auth_headers(default_user))
    assert r.status_code == 403
    # admin token → 200
    r2 = await client.get("/api/v1/admin/whitelist", headers=auth_headers(admin_user))
    assert r2.status_code == 200


async def test_whitelist_rejects_fake_header(client, default_user):
    # 偽造 X-User-Role 不再有效（無 token）→ 401
    r = await client.get("/api/v1/admin/whitelist", headers={"X-User-Role": "admin"})
    assert r.status_code == 401


async def test_admin_whitelist_requires_admin_role_403(client, default_user, auth_headers):
    """v4：非管理員（member token）→ 403。"""
    r = await client.post(
        WHITELIST,
        json={"email": "ken@hqdesign.tw", "whitelist_active": True},
        headers=auth_headers(default_user),
    )
    assert r.status_code == 403


async def test_admin_whitelist_rejects_foreign_domain_422(client, admin_user, auth_headers):
    """v4：信箱非 @hqdesign.tw → 422（合作範圍邊界）。"""
    r = await client.post(
        WHITELIST,
        json={"email": "outsider@gmail.com", "whitelist_active": True},
        headers=auth_headers(admin_user),
    )
    assert r.status_code == 422


async def test_admin_whitelist_provision_and_list(client, admin_user, auth_headers):
    """v4：開通新帳號（pre-provision）後出現在列表，且只動 whitelist_active。"""
    r = await client.post(
        WHITELIST,
        json={"email": "leo@hqdesign.tw", "whitelist_active": True},
        headers=auth_headers(admin_user),
    )
    assert r.status_code == 200
    created = r.json()
    assert created["email"] == "leo@hqdesign.tw"
    assert created["whitelist_active"] is True
    assert created["consent_shared"] is False  # 管理員不得碰同意

    rows = (await client.get(WHITELIST, headers=auth_headers(admin_user))).json()
    assert any(u["email"] == "leo@hqdesign.tw" for u in rows)


# --------------------------------------------------------------------------- #
# DELETE /admin/whitelist/{email}（移除帳號；管理員）
# 名單管理：UI 刪除須真正落地後端，否則重整時 hydration 會把帳號併回（復活）。
# --------------------------------------------------------------------------- #
async def test_admin_delete_requires_admin_role_403(client, default_user, auth_headers):
    """非管理員（member token）→ 403。"""
    r = await client.delete(
        f"{WHITELIST}/someone@hqdesign.tw", headers=auth_headers(default_user)
    )
    assert r.status_code == 403


async def test_admin_delete_rejects_foreign_domain_422(client, admin_user, auth_headers):
    """信箱非 @hqdesign.tw → 422（合作範圍邊界，與開通對稱）。"""
    r = await client.delete(
        f"{WHITELIST}/outsider@gmail.com", headers=auth_headers(admin_user)
    )
    assert r.status_code == 422


async def test_admin_delete_unknown_404(client, admin_user, auth_headers):
    """查無此帳號 → 404。"""
    r = await client.delete(
        f"{WHITELIST}/ghost@hqdesign.tw", headers=auth_headers(admin_user)
    )
    assert r.status_code == 404


async def test_admin_delete_removes_account(client, admin_user, auth_headers):
    """開通新帳號後刪除 → 204，且不再出現在列表（落地後端，重整不復活）。"""
    created = await client.post(
        WHITELIST,
        json={"email": "tmp@hqdesign.tw", "whitelist_active": True},
        headers=auth_headers(admin_user),
    )
    assert created.status_code == 200

    d = await client.delete(
        f"{WHITELIST}/tmp@hqdesign.tw", headers=auth_headers(admin_user)
    )
    assert d.status_code == 204

    rows = (await client.get(WHITELIST, headers=auth_headers(admin_user))).json()
    assert all(u["email"] != "tmp@hqdesign.tw" for u in rows)


async def test_admin_delete_refuses_system_default_403(
    client, db_session, admin_user, auth_headers
):
    """系統佔位帳號（name=default）為保護對象、不可刪 → 403（即使具 @hqdesign 信箱）。"""
    from app.models.behavior import User

    u = User(name="default", email="default-sys@hqdesign.tw", role="member")
    db_session.add(u)
    await db_session.commit()

    r = await client.delete(
        f"{WHITELIST}/default-sys@hqdesign.tw", headers=auth_headers(admin_user)
    )
    assert r.status_code == 403

# -*- coding: utf-8 -*-
"""個人資料／白名單／同意／個人偏好輪廓 API 測試（Phase 1）。

對照 plans/profile-and-learning-db/plan.mdx 四支端點與驗收 v1–v4：
  GET  /api/v1/me                     帳戶＋白名單＋同意狀態
  PUT  /api/v1/me/consent             本人設定／撤回（前置：須先在白名單內）
  GET  /api/v1/me/preference-profile  尚未學出時回空輪廓、不 404
  GET/POST /api/v1/admin/whitelist    管理員（暫以 X-User-Role: admin 把關）

信任邊界（Phase 1）：身分由 body／query 帶入、未驗證；管理權限以暫時性 header
檢查（Phase 2 改 session 推導）。網域／白名單前置等可驗證業務規則於此強制。
"""
from __future__ import annotations

ME = "/api/v1/me"
CONSENT = "/api/v1/me/consent"
PROFILE = "/api/v1/me/preference-profile"
WHITELIST = "/api/v1/admin/whitelist"
ADMIN = {"X-User-Role": "admin"}


# --------------------------------------------------------------------------- #
# GET /me
# --------------------------------------------------------------------------- #
async def test_get_me_returns_default_placeholder(client):
    """v1：省略 user_id → 回佔位（default）帳號，旗標預設關閉。"""
    r = await client.get(ME)
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "default"
    assert body["whitelist_active"] is False
    assert body["consent_shared"] is False
    assert body["consent_at"] is None


async def test_get_me_unknown_user_404(client):
    r = await client.get(ME, params={"user_id": 99999})
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# PUT /me/consent（第 2 段；前置須在白名單內）
# --------------------------------------------------------------------------- #
async def test_consent_requires_whitelist_403(client):
    """v2：未開通白名單者設定同意 → 403（無從匯入團隊庫）。"""
    me = (await client.get(ME)).json()
    r = await client.put(CONSENT, json={"user_id": me["id"], "consent_shared": True})
    assert r.status_code == 403


async def test_consent_after_whitelist_sets_consent_at(client):
    """v2：先由管理員開通白名單，本人同意 → consent_shared=True、consent_at 落地。"""
    # 第 1 段：管理員開通
    w = await client.post(
        WHITELIST,
        json={"email": "ivy@hqdesign.tw", "whitelist_active": True},
        headers=ADMIN,
    )
    assert w.status_code == 200
    uid = w.json()["id"]

    # 第 2 段：本人同意
    r = await client.put(CONSENT, json={"user_id": uid, "consent_shared": True})
    assert r.status_code == 200
    body = r.json()
    assert body["consent_shared"] is True
    assert body["consent_at"] is not None

    # 撤回：consent_shared=False，但 consent_at 不清空（僅停止後續匯入）
    r2 = await client.put(CONSENT, json={"user_id": uid, "consent_shared": False})
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["consent_shared"] is False
    assert body2["consent_at"] is not None


# --------------------------------------------------------------------------- #
# GET /me/preference-profile
# --------------------------------------------------------------------------- #
async def test_preference_profile_empty_not_404(client):
    """v3：尚未學出輪廓 → 回空輪廓（欄位 None），不 404。"""
    r = await client.get(PROFILE)
    assert r.status_code == 200
    body = r.json()
    assert body["top_keywords"] is None
    assert body["preferred_categories"] is None
    assert body["budget_min"] is None


# --------------------------------------------------------------------------- #
# admin /whitelist（暫時性 X-User-Role 把關 + 網域驗證）
# --------------------------------------------------------------------------- #
async def test_admin_whitelist_requires_admin_role_403(client):
    """v4：非管理員（缺 X-User-Role: admin）→ 403。"""
    r = await client.get(WHITELIST)
    assert r.status_code == 403
    r2 = await client.post(
        WHITELIST, json={"email": "ken@hqdesign.tw", "whitelist_active": True}
    )
    assert r2.status_code == 403


async def test_admin_whitelist_rejects_foreign_domain_422(client):
    """v4：信箱非 @hqdesign.tw → 422（合作範圍邊界）。"""
    r = await client.post(
        WHITELIST,
        json={"email": "outsider@gmail.com", "whitelist_active": True},
        headers=ADMIN,
    )
    assert r.status_code == 422


async def test_admin_whitelist_provision_and_list(client):
    """v4：開通新帳號（pre-provision）後出現在列表，且只動 whitelist_active。"""
    r = await client.post(
        WHITELIST,
        json={"email": "leo@hqdesign.tw", "whitelist_active": True},
        headers=ADMIN,
    )
    assert r.status_code == 200
    created = r.json()
    assert created["email"] == "leo@hqdesign.tw"
    assert created["whitelist_active"] is True
    assert created["consent_shared"] is False  # 管理員不得碰同意

    rows = (await client.get(WHITELIST, headers=ADMIN)).json()
    assert any(u["email"] == "leo@hqdesign.tw" for u in rows)

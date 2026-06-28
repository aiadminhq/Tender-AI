import pytest
from types import SimpleNamespace

from app.core import auth as auth_mod
from app.core.config import Settings, settings


def test_settings_have_auth_defaults():
    s = Settings(_env_file=None)
    assert s.auth_secret == ""
    assert s.auth_token_ttl_hours == 168


@pytest.fixture
def _with_secret(monkeypatch):
    monkeypatch.setattr(settings, "auth_secret", "test-secret-do-not-use-in-prod")
    monkeypatch.setattr(settings, "auth_token_ttl_hours", 168)


def test_issue_then_decode_roundtrip(_with_secret):
    token = auth_mod.issue_token(SimpleNamespace(id=42))
    payload = auth_mod.decode_token(token)
    assert payload is not None
    assert payload["uid"] == 42
    assert payload["exp"] > payload["iat"]


def test_tampered_signature_rejected(_with_secret):
    token = auth_mod.issue_token(SimpleNamespace(id=42))
    payload_b64, sig = token.split(".", 1)
    bad_sig = ("A" if sig[0] != "A" else "B") + sig[1:]
    assert auth_mod.decode_token(f"{payload_b64}.{bad_sig}") is None


def test_tampered_payload_rejected(_with_secret):
    token = auth_mod.issue_token(SimpleNamespace(id=42))
    payload_b64, sig = token.split(".", 1)
    bad_payload = ("A" if payload_b64[0] != "A" else "B") + payload_b64[1:]
    assert auth_mod.decode_token(f"{bad_payload}.{sig}") is None


def test_garbage_token_rejected(_with_secret):
    assert auth_mod.decode_token("not-a-token") is None
    assert auth_mod.decode_token("") is None


def test_expired_token_rejected(monkeypatch):
    monkeypatch.setattr(settings, "auth_secret", "test-secret-do-not-use-in-prod")
    monkeypatch.setattr(settings, "auth_token_ttl_hours", -1)  # exp 落在過去
    token = auth_mod.issue_token(SimpleNamespace(id=42))
    assert auth_mod.decode_token(token) is None


def test_missing_secret_raises(monkeypatch):
    monkeypatch.setattr(settings, "auth_secret", "")
    with pytest.raises(RuntimeError):
        auth_mod.issue_token(SimpleNamespace(id=1))
    with pytest.raises(RuntimeError):
        auth_mod.decode_token("anything.anything")


# ── Task 4 dependency 測試 ───────────────────────────────────────────────────

import pytest_asyncio

from app.models.behavior import User
from tests.conftest import TestSessionLocal


@pytest_asyncio.fixture
async def _users():
    async with TestSessionLocal() as s:
        member = User(name="一般", email="m@hqdesign.tw", role="member", whitelist_active=True)
        admin = User(name="管理", email="a@hqdesign.tw", role="admin", whitelist_active=True)
        disabled = User(name="停用", email="d@hqdesign.tw", role="member", whitelist_active=False)
        s.add_all([member, admin, disabled])
        await s.commit()
        for u in (member, admin, disabled):
            await s.refresh(u)
        return {"member": member, "admin": admin, "disabled": disabled}


def _bearer(uid: int) -> dict[str, str]:
    return {"Authorization": f"Bearer {auth_mod.issue_token(SimpleNamespace(id=uid))}"}


async def test_whoami_resolves_user_from_token(auth_probe_client, _users):
    r = await auth_probe_client.get("/whoami", headers=_bearer(_users["member"].id))
    assert r.status_code == 200
    assert r.json()["id"] == _users["member"].id


async def test_role_read_from_db_not_token(auth_probe_client, _users):
    # token 只帶 uid；admin 的 role 由 DB 推導 → admin-only 放行
    r = await auth_probe_client.get("/admin-only", headers=_bearer(_users["admin"].id))
    assert r.status_code == 200


async def test_non_admin_forbidden(auth_probe_client, _users):
    r = await auth_probe_client.get("/admin-only", headers=_bearer(_users["member"].id))
    assert r.status_code == 403


async def test_disabled_whitelist_forbidden(auth_probe_client, _users):
    r = await auth_probe_client.get("/whoami", headers=_bearer(_users["disabled"].id))
    assert r.status_code == 403


async def test_missing_token_unauthorized(auth_probe_client):
    assert (await auth_probe_client.get("/whoami")).status_code == 401


async def test_bad_token_unauthorized(auth_probe_client):
    r = await auth_probe_client.get("/whoami", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401


async def test_unknown_uid_unauthorized(auth_probe_client):
    r = await auth_probe_client.get("/whoami", headers=_bearer(999999))
    assert r.status_code == 401

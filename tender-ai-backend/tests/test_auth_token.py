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

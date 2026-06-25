from app.core.config import Settings


def test_settings_have_auth_defaults():
    s = Settings(_env_file=None)
    assert s.auth_secret == ""
    assert s.auth_token_ttl_hours == 168

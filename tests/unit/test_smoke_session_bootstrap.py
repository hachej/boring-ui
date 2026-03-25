from __future__ import annotations

from tests.smoke.smoke_lib import session_bootstrap as bootstrap_module


class _FakeSmokeClient:
    base_url = "http://127.0.0.1:8000"


def test_ensure_session_forwards_public_origin_to_verify_flow(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        bootstrap_module,
        "resolve_neon_auth_url",
        lambda base_url, neon_auth_url="": "https://neon.example.com",
    )
    monkeypatch.setattr(bootstrap_module, "resend_api_key", lambda: "resend-key")
    monkeypatch.setattr(bootstrap_module, "random_password", lambda: "generated-password")

    def fake_neon_signup_verify_flow(client, **kwargs):
        captured.update(kwargs)
        return {"user": {"email": kwargs["email"]}}

    monkeypatch.setattr(bootstrap_module, "neon_signup_verify_flow", fake_neon_signup_verify_flow)

    result = bootstrap_module.ensure_session(
        _FakeSmokeClient(),
        auth_mode="neon",
        base_url="http://127.0.0.1:8000",
        public_app_base_url="https://app.example.com",
    )

    assert captured["public_app_base_url"] == "https://app.example.com"
    assert result["public_app_base_url"] == "https://app.example.com"


def test_ensure_session_forwards_public_origin_to_signup_then_signin_fallback(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        bootstrap_module,
        "resolve_neon_auth_url",
        lambda base_url, neon_auth_url="": "https://neon.example.com",
    )
    monkeypatch.setattr(bootstrap_module, "resend_api_key", lambda: "resend-key")
    monkeypatch.setattr(bootstrap_module, "random_password", lambda: "generated-password")
    monkeypatch.setattr(
        bootstrap_module,
        "neon_signup_verify_flow",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("verification timeout")),
    )
    monkeypatch.setattr(
        bootstrap_module,
        "neon_signin_flow",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("signin failed")),
    )

    def fake_neon_signup_then_signin(client, **kwargs):
        captured.update(kwargs)
        return {"ok": True}

    monkeypatch.setattr(bootstrap_module, "neon_signup_then_signin", fake_neon_signup_then_signin)

    result = bootstrap_module.ensure_session(
        _FakeSmokeClient(),
        auth_mode="neon",
        base_url="http://127.0.0.1:8000",
        public_app_base_url="https://app.example.com",
    )

    assert captured["public_app_base_url"] == "https://app.example.com"
    assert result["public_app_base_url"] == "https://app.example.com"

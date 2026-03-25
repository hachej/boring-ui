from __future__ import annotations

from tests.smoke.smoke_lib import auth as auth_module


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self) -> dict:
        return self._payload


class _FakeSmokeClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url
        self.results: list[object] = []
        self.calls: list[dict[str, object]] = []
        self.phase = "init"

    def set_phase(self, phase: str) -> None:
        self.phase = phase

    def post(self, path: str, **kwargs):
        self.calls.append({"method": "POST", "path": path, "phase": self.phase, **kwargs})
        if path == "/auth/sign-up":
            return _FakeResponse(
                200,
                {
                    "ok": True,
                    "requires_email_verification": True,
                },
            )
        if path == "/auth/token-exchange":
            return _FakeResponse(200, {"ok": True})
        raise AssertionError(f"Unexpected POST path: {path}")

    def get(self, path: str, **kwargs):
        self.calls.append({"method": "GET", "path": path, "phase": self.phase, **kwargs})
        if path == "/auth/session":
            return _FakeResponse(200, {"user": {"email": "new@example.com"}})
        raise AssertionError(f"Unexpected GET path: {path}")


class _FakeVerifyClient:
    def __init__(self, *args, **kwargs) -> None:
        self.calls: list[str] = []
        self.headers = kwargs.get("headers", {})

    def get(self, url: str):
        self.calls.append(url)
        if "verify-email" in url:
            return _FakeResponse(200, {"ok": True}, text="verified")
        if url.endswith("/token"):
            return _FakeResponse(200, {"token": "jwt-from-neon"})
        raise AssertionError(f"Unexpected verification GET: {url}")

    def close(self) -> None:
        return None


def test_neon_signup_verify_flow_uses_public_app_base_url_for_signup_origin_and_callback_assertion(
    monkeypatch,
) -> None:
    client = _FakeSmokeClient("http://127.0.0.1:36213")
    verify_client = _FakeVerifyClient()
    confirmation_url = "https://example.neonauth.test/verify-email?token=abc123"
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        auth_module,
        "wait_for_email",
        lambda *args, **kwargs: {"id": "email-1", "subject": "Verify your account"},
    )
    monkeypatch.setattr(auth_module, "get_email", lambda *args, **kwargs: {"html": "ignored"})
    monkeypatch.setattr(auth_module, "extract_confirmation_url", lambda details: confirmation_url)

    def fake_assert_confirmation_callback_url(
        url: str,
        *,
        expected_app_base_url: str,
        expected_redirect_uri: str,
        require_pending_login: bool = False,
    ) -> str:
        captured["url"] = url
        captured["expected_app_base_url"] = expected_app_base_url
        captured["expected_redirect_uri"] = expected_redirect_uri
        captured["require_pending_login"] = require_pending_login
        return (
            f"{expected_app_base_url}/auth/callback"
            f"?redirect_uri={expected_redirect_uri}&pending_login=token"
        )

    monkeypatch.setattr(
        auth_module,
        "assert_confirmation_callback_url",
        fake_assert_confirmation_callback_url,
    )
    monkeypatch.setattr(auth_module.httpx, "Client", lambda *args, **kwargs: verify_client)

    session = auth_module.neon_signup_verify_flow(
        client,
        neon_auth_url="https://example.neonauth.test/neondb/auth",
        resend_api_key="resend-key",
        email="new@example.com",
        password="password123",
        timeout_seconds=30,
        redirect_uri="/",
        public_app_base_url="http://127.0.0.1:8010",
    )

    signup_call = client.calls[0]
    assert signup_call["path"] == "/auth/sign-up"
    assert signup_call["headers"] == {"Origin": "http://127.0.0.1:8010"}
    assert captured == {
        "url": confirmation_url,
        "expected_app_base_url": "http://127.0.0.1:8010",
        "expected_redirect_uri": "/",
        "require_pending_login": True,
    }
    assert verify_client.calls == [
        confirmation_url,
        "https://example.neonauth.test/neondb/auth/token",
    ]
    assert session["user"]["email"] == "new@example.com"

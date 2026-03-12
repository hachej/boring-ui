"""Unit tests for /auth/* session lifecycle routes."""

from pathlib import Path
from urllib.parse import parse_qs, urlparse

import boring_ui.api.modules.control_plane.auth_router_neon as auth_router_neon
from fastapi.testclient import TestClient

from boring_ui.api import APIConfig, create_app
from boring_ui.api.modules.control_plane.auth_session import create_session_cookie


def _client(tmp_path: Path, *, auth_dev_login_enabled: bool = True) -> TestClient:
    config = APIConfig(
        workspace_root=tmp_path,
        auth_dev_login_enabled=auth_dev_login_enabled,
        auth_dev_auto_login=False,
        control_plane_provider="local",
        supabase_url=None,
        supabase_anon_key=None,
        supabase_service_role_key=None,
        supabase_jwt_secret=None,
        supabase_db_url=None,
        database_url=None,
        neon_auth_base_url=None,
        neon_auth_jwks_url=None,
    )
    app = create_app(config=config, include_pty=False, include_stream=False, include_approval=False)
    return TestClient(app)


def _client_neon(tmp_path: Path) -> TestClient:
    config = APIConfig(
        workspace_root=tmp_path,
        auth_dev_login_enabled=False,
        auth_dev_auto_login=False,
        control_plane_provider="neon",
        database_url="postgresql://example.invalid/neondb",
        neon_auth_base_url="https://example.neonauth.test/neondb/auth",
        neon_auth_jwks_url="https://example.neonauth.test/neondb/auth/.well-known/jwks.json",
        cors_origins=["http://127.0.0.1:5176", "http://213.32.19.186:5176"],
    )
    app = create_app(config=config, include_pty=False, include_stream=False, include_approval=False)
    return TestClient(app)


class _FakeAsyncResponse:
    def __init__(self, status_code: int, payload: dict | None = None, content: bytes | None = None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.content = content if content is not None else b"{}"

    def json(self) -> dict:
        return self._payload


class _FakeAsyncClient:
    post_response = _FakeAsyncResponse(200, {})
    token_response = _FakeAsyncResponse(200, {"token": "jwt-from-neon"})
    last_post: tuple[str, dict] | None = None
    last_get: str | None = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, *, headers=None, json=None):
        type(self).last_post = (url, json or {})
        return type(self).post_response

    async def get(self, url):
        type(self).last_get = url
        return type(self).token_response


def test_auth_login_requires_identity_params(tmp_path: Path) -> None:
    client = _client(tmp_path)
    response = client.get("/auth/login", follow_redirects=False)
    assert response.status_code == 400
    payload = response.json()
    assert payload["code"] == "LOGIN_IDENTITY_REQUIRED"
    assert payload["error"] == "bad_request"


def test_auth_login_disabled_by_default(tmp_path: Path) -> None:
    client = _client(tmp_path, auth_dev_login_enabled=False)
    response = client.get(
        "/auth/login?user_id=user-1&email=owner@example.com&redirect_uri=/",
        follow_redirects=False,
    )
    assert response.status_code == 501
    assert response.json()["code"] == "LOGIN_NOT_CONFIGURED"


def test_auth_login_sets_session_cookie_and_redirects(tmp_path: Path) -> None:
    client = _client(tmp_path)
    response = client.get(
        "/auth/login?user_id=user-1&email=owner@example.com&redirect_uri=/w/workspace-1",
        follow_redirects=False,
    )
    assert response.status_code == 302
    assert response.headers["location"] == "/w/workspace-1"
    assert "boring_session=" in response.headers.get("set-cookie", "")
    assert "HttpOnly" in response.headers.get("set-cookie", "")

    session = client.get("/auth/session")
    assert session.status_code == 200
    payload = session.json()
    assert payload["authenticated"] is True
    assert payload["user"]["user_id"] == "user-1"
    assert payload["user"]["email"] == "owner@example.com"


def test_auth_callback_sets_cookie_and_session(tmp_path: Path) -> None:
    client = _client(tmp_path)
    response = client.get(
        "/auth/callback?user_id=user-2&email=viewer@example.com&redirect_uri=/",
        follow_redirects=False,
    )
    assert response.status_code == 302
    assert response.headers["location"] == "/"
    assert "boring_session=" in response.headers.get("set-cookie", "")

    session = client.get("/auth/session")
    assert session.status_code == 200
    assert session.json()["user"]["user_id"] == "user-2"


def test_auth_session_returns_401_without_cookie(tmp_path: Path) -> None:
    client = _client(tmp_path)
    response = client.get("/auth/session")
    assert response.status_code == 401
    assert response.json()["code"] == "SESSION_REQUIRED"


def test_auth_session_returns_401_for_invalid_cookie(tmp_path: Path) -> None:
    client = _client(tmp_path)
    response = client.get("/auth/session", headers={"Cookie": "boring_session=invalid.token"})
    assert response.status_code == 401
    assert response.json()["code"] == "SESSION_INVALID"


def test_auth_session_returns_401_for_expired_cookie(tmp_path: Path) -> None:
    client = _client(tmp_path)
    expired_token = create_session_cookie(
        "user-expired",
        "expired@example.com",
        secret=client.app.state.app_config.auth_session_secret,
        ttl_seconds=-60,
    )
    response = client.get("/auth/session", headers={"Cookie": f"boring_session={expired_token}"})
    assert response.status_code == 401
    assert response.json()["code"] == "SESSION_EXPIRED"


def test_auth_login_sanitizes_encoded_redirects(tmp_path: Path) -> None:
    client = _client(tmp_path)
    response = client.get(
        "/auth/login?user_id=user-9&email=redirect@example.com&redirect_uri=/%2F%2Fevil.com",
        follow_redirects=False,
    )
    assert response.status_code == 302
    assert response.headers["location"] == "/"


def test_auth_logout_clears_cookie_and_session(tmp_path: Path) -> None:
    client = _client(tmp_path)
    login = client.get(
        "/auth/login?user_id=user-3&email=logout@example.com&redirect_uri=/",
        follow_redirects=False,
    )
    assert login.status_code == 302

    logout = client.get("/auth/logout", follow_redirects=False)
    assert logout.status_code == 302
    assert logout.headers["location"] == "/auth/login"
    # Cookie cleared via Max-Age=0 or explicit deletion header
    cookie_header = logout.headers.get("set-cookie", "")
    assert "boring_session" in cookie_header

    session = client.get("/auth/session")
    assert session.status_code == 401
    assert session.json()["code"] == "SESSION_REQUIRED"


def test_neon_sign_in_sets_session_cookie_without_browser_direct_neon_calls(
    tmp_path: Path,
    monkeypatch,
) -> None:
    client = _client_neon(tmp_path)
    _FakeAsyncClient.post_response = _FakeAsyncResponse(200, {})
    _FakeAsyncClient.token_response = _FakeAsyncResponse(200, {"token": "jwt-from-neon"})
    _FakeAsyncClient.last_post = None
    _FakeAsyncClient.last_get = None
    monkeypatch.setattr(auth_router_neon.httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr(
        auth_router_neon,
        "_validate_neon_jwt",
        lambda token, *, config: {"user_id": "user-neon-1", "email": "owner@example.com"},
    )

    response = client.post(
        "/auth/sign-in",
        json={"email": "owner@example.com", "password": "password123", "redirect_uri": "/w/demo"},
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "redirect_uri": "/w/demo"}
    assert "boring_session=" in response.headers.get("set-cookie", "")
    assert _FakeAsyncClient.last_post == (
        "https://example.neonauth.test/neondb/auth/sign-in/email",
        {
            "email": "owner@example.com",
            "password": "password123",
            "callbackURL": "http://127.0.0.1:5176/auth/callback?redirect_uri=/w/demo",
        },
    )
    assert _FakeAsyncClient.last_get == "https://example.neonauth.test/neondb/auth/token"

    session = client.get("/auth/session")
    assert session.status_code == 200
    assert session.json()["user"]["email"] == "owner@example.com"


def test_neon_sign_up_returns_upstream_validation_error(tmp_path: Path, monkeypatch) -> None:
    client = _client_neon(tmp_path)
    _FakeAsyncClient.post_response = _FakeAsyncResponse(
        400,
        {"message": "Invalid origin"},
        content=b'{"message":"Invalid origin"}',
    )
    _FakeAsyncClient.token_response = _FakeAsyncResponse(200, {"token": "unused"})
    monkeypatch.setattr(auth_router_neon.httpx, "AsyncClient", _FakeAsyncClient)

    response = client.post(
        "/auth/sign-up",
        json={"email": "new@example.com", "password": "password123", "redirect_uri": "/"},
    )
    assert response.status_code == 400
    payload = response.json()
    assert payload["code"] == "NEON_AUTH_REJECTED"
    assert payload["message"] == "Invalid origin"


def test_neon_sign_up_requires_email_verification_instead_of_auto_login(
    tmp_path: Path,
    monkeypatch,
) -> None:
    client = _client_neon(tmp_path)
    _FakeAsyncClient.post_response = _FakeAsyncResponse(200, {"user": {"email": "new@example.com"}})
    _FakeAsyncClient.token_response = _FakeAsyncResponse(200, {"token": "unused"})
    _FakeAsyncClient.last_post = None
    _FakeAsyncClient.last_get = None
    monkeypatch.setattr(auth_router_neon.httpx, "AsyncClient", _FakeAsyncClient)

    response = client.post(
        "/auth/sign-up",
        json={"email": "new@example.com", "password": "password123", "redirect_uri": "/"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "requires_email_verification": True,
        "message": "Check your email to verify your account.",
        "redirect_uri": "/",
    }
    assert "set-cookie" not in {k.lower(): v for k, v in response.headers.items()}
    assert _FakeAsyncClient.last_post is not None
    assert _FakeAsyncClient.last_post[0] == "https://example.neonauth.test/neondb/auth/sign-up/email"
    sent_payload = _FakeAsyncClient.last_post[1]
    assert sent_payload["email"] == "new@example.com"
    assert sent_payload["password"] == "password123"
    assert sent_payload["name"] == "new"
    parsed = urlparse(sent_payload["callbackURL"])
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == "http://127.0.0.1:5176/auth/callback"
    params = parse_qs(parsed.query)
    assert params["redirect_uri"] == ["/"]
    assert params["pending_login"]


def test_neon_resend_verification_email_uses_same_origin_backend_endpoint(
    tmp_path: Path,
    monkeypatch,
) -> None:
    client = _client_neon(tmp_path)
    _FakeAsyncClient.post_response = _FakeAsyncResponse(200, {"ok": True})
    _FakeAsyncClient.last_post = None
    monkeypatch.setattr(auth_router_neon.httpx, "AsyncClient", _FakeAsyncClient)

    response = client.post(
        "/auth/resend-verification",
        json={"email": "new@example.com", "redirect_uri": "/w/demo"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "message": "Verification email sent. Check your inbox.",
        "redirect_uri": "/w/demo",
    }
    assert _FakeAsyncClient.last_post == (
        "https://example.neonauth.test/neondb/auth/send-verification-email",
        {
            "email": "new@example.com",
            "callbackURL": "http://127.0.0.1:5176/auth/callback?redirect_uri=/w/demo",
        },
    )


def test_neon_callback_renders_exchange_page(tmp_path: Path) -> None:
    client = _client_neon(tmp_path)
    response = client.get("/auth/callback?redirect_uri=/w/demo")
    assert response.status_code == 200
    assert "Finishing email verification." in response.text
    assert '"neonAuthUrl":"https://example.neonauth.test/neondb/auth"' in response.text
    assert "/w/demo" in response.text


def test_neon_sign_up_uses_browser_origin_for_callback_url(tmp_path: Path, monkeypatch) -> None:
    client = _client_neon(tmp_path)
    _FakeAsyncClient.post_response = _FakeAsyncResponse(200, {"user": {"email": "new@example.com"}})
    _FakeAsyncClient.token_response = _FakeAsyncResponse(200, {"token": "unused"})
    _FakeAsyncClient.last_post = None
    monkeypatch.setattr(auth_router_neon.httpx, "AsyncClient", _FakeAsyncClient)

    response = client.post(
        "/auth/sign-up",
        headers={"Origin": "http://213.32.19.186:5176"},
        json={"email": "new@example.com", "password": "password123", "redirect_uri": "/"},
    )

    assert response.status_code == 200
    assert _FakeAsyncClient.last_post is not None
    parsed = urlparse(_FakeAsyncClient.last_post[1]["callbackURL"])
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == "http://213.32.19.186:5176/auth/callback"
    params = parse_qs(parsed.query)
    assert params["redirect_uri"] == ["/"]
    assert params["pending_login"]


def test_neon_sign_up_uses_same_origin_https_hosted_base_url_for_callback_url(
    tmp_path: Path,
    monkeypatch,
) -> None:
    config = APIConfig(
        workspace_root=tmp_path,
        auth_dev_login_enabled=False,
        auth_dev_auto_login=False,
        control_plane_provider="neon",
        database_url="postgresql://example.invalid/neondb",
        neon_auth_base_url="https://example.neonauth.test/neondb/auth",
        neon_auth_jwks_url="https://example.neonauth.test/neondb/auth/.well-known/jwks.json",
        cors_origins=["http://127.0.0.1:5176", "http://213.32.19.186:5176"],
    )
    app = create_app(config=config, include_pty=False, include_stream=False, include_approval=False)
    client = TestClient(app, base_url="https://julien-hurault--boring-ui-core-core.modal.run")
    _FakeAsyncClient.post_response = _FakeAsyncResponse(200, {"user": {"email": "new@example.com"}})
    _FakeAsyncClient.token_response = _FakeAsyncResponse(200, {"token": "unused"})
    _FakeAsyncClient.last_post = None
    monkeypatch.setattr(auth_router_neon.httpx, "AsyncClient", _FakeAsyncClient)

    response = client.post(
        "/auth/sign-up",
        headers={"Origin": "https://julien-hurault--boring-ui-core-core.modal.run"},
        json={"email": "new@example.com", "password": "password123", "redirect_uri": "/"},
    )

    assert response.status_code == 200
    assert _FakeAsyncClient.last_post is not None
    parsed = urlparse(_FakeAsyncClient.last_post[1]["callbackURL"])
    assert (
        f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        == "https://julien-hurault--boring-ui-core-core.modal.run/auth/callback"
    )
    params = parse_qs(parsed.query)
    assert params["redirect_uri"] == ["/"]
    assert params["pending_login"]


def test_neon_sign_up_ignores_untrusted_origin_for_callback_url(tmp_path: Path, monkeypatch) -> None:
    client = _client_neon(tmp_path)
    _FakeAsyncClient.post_response = _FakeAsyncResponse(200, {"user": {"email": "new@example.com"}})
    _FakeAsyncClient.token_response = _FakeAsyncResponse(200, {"token": "unused"})
    _FakeAsyncClient.last_post = None
    monkeypatch.setattr(auth_router_neon.httpx, "AsyncClient", _FakeAsyncClient)

    response = client.post(
        "/auth/sign-up",
        headers={"Origin": "https://attacker.example"},
        json={"email": "new@example.com", "password": "password123", "redirect_uri": "/"},
    )

    assert response.status_code == 200
    assert _FakeAsyncClient.last_post is not None
    parsed = urlparse(_FakeAsyncClient.last_post[1]["callbackURL"])
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == "http://127.0.0.1:5176/auth/callback"
    params = parse_qs(parsed.query)
    assert params["redirect_uri"] == ["/"]
    assert params["pending_login"]


def test_neon_callback_completes_pending_sign_in_and_redirects_to_workspace(
    tmp_path: Path,
    monkeypatch,
) -> None:
    client = _client_neon(tmp_path)
    _FakeAsyncClient.post_response = _FakeAsyncResponse(200, {})
    _FakeAsyncClient.token_response = _FakeAsyncResponse(200, {"token": "jwt-from-neon"})
    _FakeAsyncClient.last_post = None
    _FakeAsyncClient.last_get = None
    monkeypatch.setattr(auth_router_neon.httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr(
        auth_router_neon,
        "_validate_neon_jwt",
        lambda token, *, config: {"user_id": "user-neon-2", "email": "verified@example.com"},
    )

    pending = auth_router_neon._encode_pending_login(
        config=client.app.state.app_config,
        email="verified@example.com",
        password="password123",
    )
    response = client.get(
        f"/auth/callback?redirect_uri=/w/demo&pending_login={pending}",
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == "/w/demo"
    assert "boring_session=" in response.headers.get("set-cookie", "")
    assert _FakeAsyncClient.last_post == (
        "https://example.neonauth.test/neondb/auth/sign-in/email",
        {
            "email": "verified@example.com",
            "password": "password123",
            "callbackURL": "http://127.0.0.1:5176/auth/callback?redirect_uri=/w/demo",
        },
    )

"""Unit tests for supabase auth/session routes."""

from pathlib import Path

from fastapi.testclient import TestClient

from boring_ui.api import APIConfig, create_app


def _client(tmp_path: Path) -> TestClient:
    config = APIConfig(
        workspace_root=tmp_path,
        control_plane_provider="supabase",
        supabase_url="https://example.supabase.co",
        supabase_anon_key="anon-key",
        auth_dev_login_enabled=False,
    )
    app = create_app(config=config, include_pty=False, include_stream=False, include_approval=False)
    return TestClient(app)


def test_supabase_login_serves_html_page(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.get("/auth/login?redirect_uri=/w/workspace-1", follow_redirects=False)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "createClient" in response.text
    assert '"initialMode":"sign_in"' in response.text
    assert "/auth/callback" in response.text


def test_supabase_signup_serves_signup_mode_html(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.get("/auth/signup?redirect_uri=/", follow_redirects=False)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert '"initialMode":"sign_up"' in response.text
    assert "signUp" in response.text
    assert "Too many email attempts right now" in response.text

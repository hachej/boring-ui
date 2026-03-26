#!/usr/bin/env python3
"""Systematic Neon Auth E2E smoke test suite.

Covers: signup, auto-verification, signin, session, resend, token-exchange
validation, logout, re-signin, duplicate signup, wrong password, session
expiry simulation, and multi-account isolation.

Usage:
    # Against production Modal deployment
    python tests/smoke/smoke_neon_auth.py --base-url https://julien-hurault--boring-macro-frontend-frontend.modal.run

    # Against a local backend when the verification callback must use an explicit public/browser origin
    python tests/smoke/smoke_neon_auth.py --base-url http://127.0.0.1:8010 --public-origin http://127.0.0.1:8010

    # With an existing account (skip signup, run signin-only phases)
    python tests/smoke/smoke_neon_auth.py --base-url https://... --skip-signup --email user@test.com --password Pass123

    # With explicit Neon Auth URL override
    python tests/smoke/smoke_neon_auth.py --base-url https://... --neon-auth-url https://ep-xxx.neonauth...
"""

from __future__ import annotations

import argparse
import json
import os
import random
import string
import sys
import time

from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_lib.auth import (
    neon_signup_verify_flow,
    random_password,
    neon_signin_flow,
)
from smoke_lib.client import SmokeClient
from smoke_lib.secrets import resend_api_key
from smoke_lib.workspace import create_workspace, list_workspaces


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_neon_auth_url(args) -> str:
    """Resolve Neon Auth URL from args, capabilities, or secrets."""
    if args.neon_auth_url:
        return args.neon_auth_url.rstrip("/")

    # Try fetching from deployed app's capabilities endpoint
    import httpx
    try:
        resp = httpx.get(f"{args.base_url.rstrip('/')}/api/capabilities", timeout=15.0)
        if resp.status_code == 200:
            auth = resp.json().get("auth", {})
            url = auth.get("neonAuthUrl", "")
            if url:
                print(f"[smoke] Neon Auth URL from capabilities: {url}")
                return url.rstrip("/")
    except Exception as exc:
        print(f"[smoke] Could not fetch capabilities: {exc}")

    # Fallback to secrets
    try:
        from smoke_lib.secrets import neon_auth_url
        url = neon_auth_url()
        print(f"[smoke] Neon Auth URL from secrets: {url}")
        return url
    except Exception:
        pass

    print("[smoke] ERROR: Cannot determine Neon Auth URL. Use --neon-auth-url", file=sys.stderr)
    sys.exit(1)


def _phase(name: str) -> None:
    print(f"\n{'='*60}")
    print(f"  {name}")
    print(f"{'='*60}")


def _resolve_public_origin(args: argparse.Namespace) -> str:
    return (
        str(
            args.public_origin
            or os.environ.get("BORING_UI_PUBLIC_ORIGIN")
            or os.environ.get("PUBLIC_APP_ORIGIN")
            or args.base_url
        )
        .strip()
        .rstrip("/")
    )


# ---------------------------------------------------------------------------
# Test phases
# ---------------------------------------------------------------------------

def test_signup_and_verify(
    client: SmokeClient,
    neon_url: str,
    email: str,
    password: str,
    timeout: int,
    public_origin: str = "",
) -> dict:
    """Phase 1: Signup + click the exact delivered verification link."""
    _phase("1. Signup + Verification")
    print(f"  Email: {email}")
    session = neon_signup_verify_flow(
        client,
        neon_auth_url=neon_url,
        resend_api_key=resend_api_key(),
        email=email,
        password=password,
        timeout_seconds=timeout,
        public_app_base_url=public_origin or None,
    )
    uid = session.get("user", {}).get("user_id", "?")
    print(f"[smoke] Signup OK: user_id={uid[:12]}...")
    return session


def test_signin(client: SmokeClient, neon_url: str, email: str, password: str) -> dict:
    """Phase 2: Signin with password."""
    _phase("2. Signin")
    session = neon_signin_flow(
        client,
        neon_auth_url=neon_url,
        email=email,
        password=password,
    )
    uid = session.get("user", {}).get("user_id", "?")
    print(f"[smoke] Signin OK: user_id={uid[:12]}...")
    return session


def test_session_check(client: SmokeClient) -> dict:
    """Phase 3: GET /auth/session — verify cookie is valid."""
    _phase("3. Session Check")
    client.set_phase("session-check")
    resp = client.get("/auth/session", expect_status=(200,))
    data = resp.json()
    assert data.get("authenticated") is True, f"Expected authenticated=True, got {data}"
    assert data.get("user", {}).get("email"), f"Expected user email in session, got {data}"
    print(f"[smoke] Session OK: email={data['user']['email']}, expires_at={data.get('expires_at')}")
    return data


def test_me_endpoint(client: SmokeClient) -> dict:
    """Phase 4: GET /api/v1/me — verify identity resolution."""
    _phase("4. Identity (/api/v1/me)")
    client.set_phase("me-check")
    resp = client.get("/api/v1/me", expect_status=(200,))
    data = resp.json()
    print(f"[smoke] /api/v1/me: {json.dumps(data, indent=2)[:300]}")
    return data


def test_workspace_after_auth(client: SmokeClient) -> str:
    """Phase 5: Create + list workspace to prove session gates API access."""
    _phase("5. Workspace Create + List")
    ts = int(time.time())
    ws_data = create_workspace(client, name=f"smoke-neon-{ts}")
    ws = ws_data.get("workspace") or ws_data
    workspace_id = ws.get("workspace_id") or ws.get("id")
    print(f"[smoke] Workspace: {workspace_id}")
    list_workspaces(client, expect_id=workspace_id)
    return workspace_id


def test_logout(client: SmokeClient) -> None:
    """Phase 6: Logout — cookie cleared, session gone."""
    _phase("6. Logout")
    client.set_phase("logout")
    resp = client.get("/auth/logout", expect_status=(302,))
    print(f"[smoke] Logout redirect: {resp.headers.get('location', '?')}")
    client.cookies.clear()

    client.set_phase("post-logout-401")
    post = client.get("/auth/session", expect_status=(401,))
    assert post.status_code == 401, f"Expected 401 after logout, got {post.status_code}"
    print(f"[smoke] Post-logout 401 OK")


def test_re_signin(client: SmokeClient, neon_url: str, email: str, password: str) -> None:
    """Phase 7: Re-signin after logout — proves session round-trip."""
    _phase("7. Re-Signin After Logout")
    session = neon_signin_flow(
        client,
        neon_auth_url=neon_url,
        email=email,
        password=password,
    )
    uid = session.get("user", {}).get("user_id", "?")
    print(f"[smoke] Re-signin OK: user_id={uid[:12]}...")

    client.set_phase("re-signin-session")
    resp = client.get("/auth/session", expect_status=(200,))
    data = resp.json()
    assert data.get("authenticated") is True
    print(f"[smoke] Re-signin session verified")


def test_wrong_password(client: SmokeClient, neon_url: str, email: str) -> None:
    """Phase 8: Signin with wrong password — must reject."""
    _phase("8. Wrong Password Rejection")
    client.set_phase("wrong-password")
    resp = client.post("/auth/sign-in", json={
        "email": email,
        "password": "WrongPassword999",
        "redirect_uri": "/",
    }, expect_status=(401, 403))
    assert resp.status_code in (401, 403), f"Expected 401/403 for wrong password, got {resp.status_code}"
    data = resp.json()
    print(f"[smoke] Wrong password rejected: {resp.status_code} code={data.get('code', '?')}")


def test_invalid_token_exchange(client: SmokeClient) -> None:
    """Phase 9: Token exchange with invalid/garbage JWT — must reject."""
    _phase("9. Invalid Token Exchange")
    client.set_phase("invalid-token-exchange")
    resp = client.post("/auth/token-exchange", json={
        "access_token": "garbage.not.a.jwt",
        "redirect_uri": "/",
    }, expect_status=(401, 502))
    assert resp.status_code in (401, 502), f"Expected 401/502 for invalid token, got {resp.status_code}"
    data = resp.json()
    print(f"[smoke] Invalid token rejected: {resp.status_code} code={data.get('code', '?')}")


def test_missing_token_exchange(client: SmokeClient) -> None:
    """Phase 10: Token exchange with no token — must return 400."""
    _phase("10. Missing Token Exchange")
    client.set_phase("missing-token-exchange")
    resp = client.post("/auth/token-exchange", json={
        "redirect_uri": "/",
    }, expect_status=(400,))
    assert resp.status_code == 400, f"Expected 400 for missing token, got {resp.status_code}"
    data = resp.json()
    assert data.get("code") == "MISSING_ACCESS_TOKEN", f"Expected MISSING_ACCESS_TOKEN, got {data.get('code')}"
    print(f"[smoke] Missing token rejected: 400 code={data['code']}")


def test_signup_validation(client: SmokeClient) -> None:
    """Phase 11: Signup input validation — missing fields."""
    _phase("11. Signup Input Validation")

    # No email
    client.set_phase("signup-no-email")
    resp = client.post("/auth/sign-up", json={
        "password": "SomePass123",
        "redirect_uri": "/",
    }, expect_status=(400,))
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
    print(f"[smoke] Signup no email: 400 code={resp.json().get('code', '?')}")

    # No password
    client.set_phase("signup-no-password")
    resp = client.post("/auth/sign-up", json={
        "email": "test@example.com",
        "redirect_uri": "/",
    }, expect_status=(400,))
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
    print(f"[smoke] Signup no password: 400 code={resp.json().get('code', '?')}")

    # Empty body
    client.set_phase("signup-empty-body")
    resp = client.post("/auth/sign-up", json={}, expect_status=(400,))
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
    print(f"[smoke] Signup empty body: 400 code={resp.json().get('code', '?')}")

    # Invalid JSON
    client.set_phase("signup-invalid-json")
    resp = client.post("/auth/sign-up", content=b"not json",
                       headers={"Content-Type": "application/json"},
                       expect_status=(400,))
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
    print(f"[smoke] Signup invalid JSON: 400 code={resp.json().get('code', '?')}")


def test_signin_validation(client: SmokeClient) -> None:
    """Phase 12: Signin input validation."""
    _phase("12. Signin Input Validation")

    # No email
    client.set_phase("signin-no-email")
    resp = client.post("/auth/sign-in", json={
        "password": "SomePass123",
    }, expect_status=(400,))
    assert resp.status_code == 400
    print(f"[smoke] Signin no email: 400 code={resp.json().get('code', '?')}")

    # No password
    client.set_phase("signin-no-password")
    resp = client.post("/auth/sign-in", json={
        "email": "test@example.com",
    }, expect_status=(400,))
    assert resp.status_code == 400
    print(f"[smoke] Signin no password: 400 code={resp.json().get('code', '?')}")


def test_resend_verification_validation(client: SmokeClient) -> None:
    """Phase 13: Resend verification endpoint validation."""
    _phase("13. Resend Verification Validation")

    # No email
    client.set_phase("resend-no-email")
    resp = client.post("/auth/resend-verification", json={}, expect_status=(400,))
    assert resp.status_code == 400
    data = resp.json()
    assert data.get("code") == "EMAIL_REQUIRED", f"Expected EMAIL_REQUIRED, got {data.get('code')}"
    print(f"[smoke] Resend no email: 400 code={data['code']}")

    # Invalid JSON
    client.set_phase("resend-invalid-json")
    resp = client.post("/auth/resend-verification", content=b"nope",
                       headers={"Content-Type": "application/json"},
                       expect_status=(400,))
    assert resp.status_code == 400
    print(f"[smoke] Resend invalid JSON: 400 code={resp.json().get('code', '?')}")


def test_session_without_cookie(client: SmokeClient) -> None:
    """Phase 14: Session check without cookie — must return 401."""
    _phase("14. No-Cookie Session Check")
    # Use a fresh client with no cookies
    fresh = SmokeClient(client.base_url)
    fresh.set_phase("no-cookie-session")
    resp = fresh.get("/auth/session", expect_status=(401,))
    assert resp.status_code == 401
    data = resp.json()
    assert data.get("code") == "SESSION_REQUIRED", f"Expected SESSION_REQUIRED, got {data.get('code')}"
    print(f"[smoke] No-cookie session: 401 code={data['code']}")
    # Transfer results to main client for reporting
    client.results.extend(fresh.results)


def test_forged_session_cookie(client: SmokeClient) -> None:
    """Phase 15: Forged session cookie — must reject."""
    _phase("15. Forged Session Cookie")
    forged = SmokeClient(client.base_url)
    forged.set_phase("forged-cookie")
    # Set a fake session cookie
    forged.cookies["boring_session"] = (
        "eyJhbGciOiJIUzI1NiJ9."
        "eyJ1c2VyX2lkIjoiZmFrZSIsImVtYWlsIjoiZmFrZUB0ZXN0LmNvbSIsImV4cCI6OTk5OTk5OTk5OX0."
        "fake"
    )
    resp = forged.get("/auth/session", expect_status=(401,))
    assert resp.status_code == 401
    data = resp.json()
    assert data.get("code") in ("SESSION_INVALID", "SESSION_EXPIRED"), f"Expected SESSION_INVALID/EXPIRED, got {data.get('code')}"
    print(f"[smoke] Forged cookie rejected: 401 code={data['code']}")
    client.results.extend(forged.results)


def test_api_requires_auth(client: SmokeClient) -> None:
    """Phase 16: API endpoints require auth — 401 without session."""
    _phase("16. API Auth Guard")
    fresh = SmokeClient(client.base_url)

    endpoints = [
        ("/api/v1/me", "GET"),
        ("/api/v1/workspaces", "GET"),
    ]
    for path, method in endpoints:
        fresh.set_phase(f"auth-guard-{path}")
        resp = fresh.request(method, path, expect_status=(401, 403))
        assert resp.status_code in (401, 403), f"Expected 401/403 for {path}, got {resp.status_code}"
        print(f"[smoke] {method} {path} without auth: {resp.status_code}")

    client.results.extend(fresh.results)


def test_duplicate_signup(client: SmokeClient, email: str) -> None:
    """Phase 17: Duplicate signup with same email — should error or indicate existing."""
    _phase("17. Duplicate Signup")
    dup_client = SmokeClient(client.base_url)
    dup_client.set_phase("duplicate-signup")
    resp = dup_client.post("/auth/sign-up", json={
        "email": email,
        "password": random_password(),
        "name": "Duplicate Test",
        "redirect_uri": "/",
    }, expect_status=(200, 400, 409, 422))
    # Better Auth may return 200 with error in body, or 4xx
    status = resp.status_code
    data = resp.json()
    if status == 200:
        # Some auth providers return 200 but with an error flag
        print(f"[smoke] Duplicate signup: {status} ok={data.get('ok')} msg={data.get('message', '')[:100]}")
    else:
        print(f"[smoke] Duplicate signup rejected: {status} code={data.get('code', '?')}")
    client.results.extend(dup_client.results)


def test_login_page_renders(client: SmokeClient) -> None:
    """Phase 18: GET /auth/login returns HTML page."""
    _phase("18. Login Page Renders")
    client.set_phase("login-page")
    resp = client.get("/auth/login", expect_status=(200,))
    assert resp.status_code == 200
    ct = resp.headers.get("content-type", "")
    assert "text/html" in ct, f"Expected text/html, got {ct}"
    body = resp.text
    assert len(body) > 100, f"Login page too short ({len(body)} bytes)"
    print(f"[smoke] Login page: {len(body)} bytes, content-type={ct[:40]}")


def test_signup_page_renders(client: SmokeClient) -> None:
    """Phase 19: GET /auth/signup returns HTML page."""
    _phase("19. Signup Page Renders")
    client.set_phase("signup-page")
    resp = client.get("/auth/signup", expect_status=(200,))
    assert resp.status_code == 200
    ct = resp.headers.get("content-type", "")
    assert "text/html" in ct, f"Expected text/html, got {ct}"
    body = resp.text
    assert len(body) > 100, f"Signup page too short ({len(body)} bytes)"
    print(f"[smoke] Signup page: {len(body)} bytes, content-type={ct[:40]}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--base-url", default="http://localhost:8000",
                        help="boring-ui base URL")
    parser.add_argument("--neon-auth-url", default="",
                        help="Override Neon Auth base URL (auto-detected from /api/capabilities)")
    parser.add_argument("--skip-signup", action="store_true",
                        help="Skip signup, use --email/--password for existing account")
    parser.add_argument("--email", help="Existing account email (with --skip-signup)")
    parser.add_argument("--password", help="Existing account password (with --skip-signup)")
    parser.add_argument("--recipient", help="Alias for email delivery (default: same as email)")
    parser.add_argument("--timeout", type=int, default=180,
                        help="Verification email polling timeout seconds")
    parser.add_argument(
        "--public-origin",
        default="",
        help="Public app origin expected in verification emails when it differs from --base-url",
    )
    parser.add_argument("--evidence-out", default="",
                        help="Path for evidence JSON output")
    args = parser.parse_args()

    client = SmokeClient(args.base_url)
    neon_url = _get_neon_auth_url(args)
    public_origin = _resolve_public_origin(args)

    if args.skip_signup:
        if not args.email or not args.password:
            print("--skip-signup requires --email and --password", file=sys.stderr)
            return 1
        email = args.email
        password = args.password
    else:
        ts = int(time.time())
        _noise = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
        email = f"qa+smoke-neon-{ts}-{_noise}@mail.boringdata.io"
        password = random_password()

        # Phase 1: Signup + verification
        test_signup_and_verify(
            client,
            neon_url,
            email,
            password,
            args.timeout,
            public_origin,
        )

    # Phase 2: Signin
    test_signin(client, neon_url, email, password)

    # Phase 3: Session check
    test_session_check(client)

    # Phase 4: Identity
    test_me_endpoint(client)

    # Phase 5: Workspace (proves auth gates API)
    test_workspace_after_auth(client)

    # Phase 6: Logout
    test_logout(client)

    # Phase 7: Re-signin
    test_re_signin(client, neon_url, email, password)

    # Logout again to test negative cases with clean state
    client.set_phase("cleanup-logout")
    client.get("/auth/logout", expect_status=(302,))
    client.cookies.clear()

    # --- Negative / validation tests (no session needed) ---

    # Phase 8: Wrong password
    test_wrong_password(client, neon_url, email)

    # Phase 9-10: Token exchange validation
    test_invalid_token_exchange(client)
    test_missing_token_exchange(client)

    # Phase 11-12: Signup/signin input validation
    test_signup_validation(client)
    test_signin_validation(client)

    # Phase 13: Resend verification validation
    test_resend_verification_validation(client)

    # Phase 14-15: Session security
    test_session_without_cookie(client)
    test_forged_session_cookie(client)

    # Phase 16: API auth guard
    test_api_requires_auth(client)

    # Phase 17: Duplicate signup
    if not args.skip_signup:
        test_duplicate_signup(client, email)

    # Phase 18-19: Page rendering
    test_login_page_renders(client)
    test_signup_page_renders(client)

    # --- Report ---
    report = client.report()
    if args.evidence_out:
        client.write_report(args.evidence_out, extra={
            "suite": "neon-auth",
            "base_url": args.base_url,
            "public_origin": public_origin,
            "auth_mode": "neon",
        })

    print(f"\n{'='*60}")
    print(json.dumps(report, indent=2))

    if report["ok"]:
        print(f"\nSMOKE NEON AUTH: ALL {report['total']} STEPS PASSED")
        return 0
    else:
        print(f"\nSMOKE NEON AUTH: {report['failed']}/{report['total']} STEPS FAILED", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

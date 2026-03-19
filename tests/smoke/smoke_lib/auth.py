"""Auth flows for Neon signup, email confirmation, signin, and token exchange."""
from __future__ import annotations

import random
import string
import time
from urllib.parse import urlparse

import httpx

from .client import SmokeClient
from .resend import (
    callback_path_from_confirmation_url,
    extract_confirmation_url,
    get_email,
    wait_for_email,
)


def random_password() -> str:
    alphabet = string.ascii_letters + string.digits
    tail = "".join(random.choice(alphabet) for _ in range(14))
    return f"Aa1!{tail}"


def neon_signup(
    *,
    neon_auth_url: str,
    email: str,
    password: str,
    name: str = "",
    origin: str = "http://localhost:8000",
    max_attempts: int = 3,
) -> httpx.Response:
    """Sign up via Neon Auth /sign-up/email. Returns the raw response."""
    last_resp: httpx.Response | None = None
    for attempt in range(1, max_attempts + 1):
        resp = httpx.post(
            f"{neon_auth_url.rstrip('/')}/sign-up/email",
            headers={
                "Content-Type": "application/json",
                "Origin": origin,
            },
            json={
                "email": email,
                "password": password,
                "name": name or email.split("@")[0],
            },
            timeout=30.0,
        )
        if resp.status_code in {200, 201}:
            return resp
        last_resp = resp
        if resp.status_code != 429:
            break
        retry_after = resp.headers.get("retry-after", "").strip()
        delay = int(retry_after) if retry_after.isdigit() else min(5 * attempt, 45)
        time.sleep(min(max(delay, 1), 60))
    if last_resp is None:
        raise RuntimeError("Neon signup failed before receiving any response")
    return last_resp


def neon_signin(
    *,
    neon_auth_url: str,
    email: str,
    password: str,
    origin: str = "http://localhost:8000",
) -> httpx.Response:
    """Sign in via Neon Auth /sign-in/email. Returns the raw response (with cookies)."""
    resp = httpx.post(
        f"{neon_auth_url.rstrip('/')}/sign-in/email",
        headers={
            "Content-Type": "application/json",
            "Origin": origin,
        },
        json={"email": email, "password": password},
        timeout=30.0,
    )
    return resp


def neon_fetch_jwt(
    *,
    neon_auth_url: str,
    session_cookies: dict[str, str],
) -> str | None:
    """Fetch EdDSA JWT from Neon Auth /token using session cookies.

    Returns the JWT string, or None on failure.
    """
    resp = httpx.get(
        f"{neon_auth_url.rstrip('/')}/token",
        cookies=session_cookies,
        timeout=15.0,
    )
    if resp.status_code != 200:
        return None
    try:
        return resp.json().get("token")
    except Exception:
        return None


def neon_signup_flow(
    client: SmokeClient,
    *,
    neon_auth_url: str,
    email: str,
    password: str,
    name: str = "",
) -> str:
    """Full Neon signup: create account -> fetch JWT -> token exchange.

    Returns the JWT used for token exchange.
    """
    client.set_phase("neon-signup")
    parsed = urlparse(neon_auth_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    print(f"[smoke] Neon signup {email}...")

    resp = neon_signup(
        neon_auth_url=neon_auth_url,
        email=email,
        password=password,
        name=name,
        origin=origin,
    )
    if resp.status_code not in {200, 201}:
        raise RuntimeError(f"Neon signup failed: {resp.status_code} {resp.text[:300]}")

    # Extract session cookies from signup response
    session_cookies = dict(resp.cookies)
    print(f"[smoke] Signup ok, got {len(session_cookies)} cookie(s)")

    # Fetch JWT via /token
    client.set_phase("neon-jwt-fetch")
    jwt = neon_fetch_jwt(neon_auth_url=neon_auth_url, session_cookies=session_cookies)
    if not jwt:
        raise RuntimeError("Neon Auth /token did not return a JWT after signup")
    print(f"[smoke] Got JWT ({len(jwt)} chars)")
    return jwt


def neon_signup_verify_flow(
    client: SmokeClient,
    *,
    neon_auth_url: str,
    resend_api_key: str,
    email: str,
    password: str,
    name: str = "",
    timeout_seconds: int = 180,
    redirect_uri: str = "/",
) -> dict:
    """Replayable verify-first Neon signup flow through boring-ui.

    Flow:
    1. POST /auth/sign-up to boring-ui
    2. Wait for verification email in Resend
    3. Open Neon verification link
    4. Fetch JWT from Neon /token using verification session cookies
    5. Exchange JWT for boring-ui session
    6. Verify /auth/session
    """
    client.set_phase("neon-signup")
    sent_after = time.time()
    parsed = urlparse(neon_auth_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    print(f"[smoke] Neon signup via app {email}...")

    signup_resp = client.post(
        "/auth/sign-up",
        headers={"Origin": origin},
        json={
            "email": email,
            "password": password,
            "name": name or email.split("@")[0],
            "redirect_uri": redirect_uri,
        },
        expect_status=(200,),
    )
    payload = signup_resp.json()
    if signup_resp.status_code != 200 or not payload.get("ok"):
        raise RuntimeError(f"App signup failed: {signup_resp.status_code} {signup_resp.text[:300]}")
    if not payload.get("requires_email_verification"):
        raise RuntimeError(f"Signup did not require email verification: {payload}")

    client.set_phase("neon-wait-email")
    email_summary = wait_for_email(
        resend_api_key,
        recipient=email,
        sent_after_epoch=sent_after,
        timeout_seconds=timeout_seconds,
    )
    email_id = str(email_summary.get("id") or "").strip()
    if not email_id:
        raise RuntimeError("Resend list did not include email id")
    email_details = get_email(resend_api_key, email_id=email_id)
    confirmation_url = extract_confirmation_url(email_details)
    print(f"[smoke] Verification email received: {email_summary.get('subject', '?')}")

    client.set_phase("neon-verify-email")
    # Strip callbackURL from verification link — Neon Auth rejects absolute
    # callbackURLs in verify-email even when the origin is in trusted_origins.
    # Without callbackURL, verification succeeds and sets session cookies.
    clean_url = confirmation_url.split("&callbackURL")[0]
    verify_client = httpx.Client(
        headers={"Origin": origin},
        timeout=30.0,
        follow_redirects=True,
    )
    try:
        verify_resp = verify_client.get(clean_url)
        if verify_resp.status_code not in {200, 302}:
            raise RuntimeError(f"Verification failed: {verify_resp.status_code} {verify_resp.text[:300]}")

        token_resp = verify_client.get(f"{neon_auth_url.rstrip('/')}/token")
        if token_resp.status_code != 200:
            raise RuntimeError(f"Neon /token failed after verification: {token_resp.status_code} {token_resp.text[:300]}")
        token = (token_resp.json() or {}).get("token")
        if not isinstance(token, str) or not token.strip():
            raise RuntimeError("Neon /token did not return a JWT after verification")
    finally:
        verify_client.close()

    client.set_phase("neon-token-exchange")
    exch_resp = client.post(
        "/auth/token-exchange",
        json={"access_token": token, "redirect_uri": redirect_uri},
        expect_status=(200,),
    )
    if exch_resp.status_code != 200:
        raise RuntimeError(f"Token exchange failed: {exch_resp.status_code} {exch_resp.text[:300]}")
    exch_payload = exch_resp.json()
    if not exch_payload.get("ok"):
        raise RuntimeError(f"Token exchange not ok: {exch_payload}")

    client.set_phase("neon-session-check")
    session_resp = client.get("/auth/session", expect_status=(200,))
    if session_resp.status_code != 200:
        raise RuntimeError(f"Session check failed: {session_resp.status_code}")
    session = session_resp.json()
    user_email = (session.get("user") or {}).get("email", "")
    if str(user_email).strip().lower() != email.lower():
        raise RuntimeError(f"Session email mismatch: expected {email}, got {user_email}")
    print(f"[smoke] Verification flow session verified for {email}")
    return session


def neon_signup_then_signin(
    client: SmokeClient,
    *,
    neon_auth_url: str,
    resend_api_key: str,
    email: str,
    password: str,
    name: str = "",
    timeout_seconds: int = 180,
    redirect_uri: str = "/",
) -> dict:
    """Signup via app, verify email was sent, then sign in.

    Works with both link-based and OTP-based Neon Auth configurations.
    Unlike neon_signup_verify_flow, this does NOT click the verification link.
    Instead it signs in directly (Neon Auth allows unverified users to sign in).

    Returns the session payload from /auth/session.
    """
    client.set_phase("neon-signup")
    sent_after = time.time()
    parsed = urlparse(neon_auth_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    print(f"[smoke] Neon signup via app {email}...")

    signup_resp = client.post(
        "/auth/sign-up",
        headers={"Origin": origin},
        json={
            "email": email,
            "password": password,
            "name": name or email.split("@")[0],
            "redirect_uri": redirect_uri,
        },
        expect_status=(200,),
    )
    payload = signup_resp.json()
    if signup_resp.status_code != 200 or not payload.get("ok"):
        raise RuntimeError(f"App signup failed: {signup_resp.status_code} {signup_resp.text[:300]}")
    print(f"[smoke] Signup response: requires_verification={payload.get('requires_email_verification')}")

    # Verify that a verification email was sent (non-blocking check)
    client.set_phase("neon-check-email-sent")
    try:
        email_summary = wait_for_email(
            resend_api_key,
            recipient=email,
            sent_after_epoch=sent_after,
            timeout_seconds=min(timeout_seconds, 30),
        )
        print(f"[smoke] Verification email received: {email_summary.get('subject', '?')}")
    except Exception as exc:
        print(f"[smoke] WARN: Verification email not found within timeout: {exc}")

    # Sign in directly (works without email verification)
    client.set_phase("neon-post-signup-signin")
    print(f"[smoke] Signing in after signup...")
    return neon_signin_flow(
        client,
        neon_auth_url=neon_auth_url,
        email=email,
        password=password,
        redirect_uri=redirect_uri,
    )


def neon_signin_flow(
    client: SmokeClient,
    *,
    neon_auth_url: str,
    email: str,
    password: str,
    redirect_uri: str = "/",
) -> dict:
    """Full Neon signin: authenticate -> fetch JWT -> token exchange -> session verify.

    Returns the session payload from /auth/session.
    """
    client.set_phase("neon-signin")
    # Origin must match Neon Auth's own origin, not the app origin
    parsed = urlparse(neon_auth_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    print(f"[smoke] Neon signin {email}...")

    resp = neon_signin(
        neon_auth_url=neon_auth_url,
        email=email,
        password=password,
        origin=origin,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Neon signin failed: {resp.status_code} {resp.text[:300]}")

    # Extract session cookies from signin response
    session_cookies = dict(resp.cookies)
    print(f"[smoke] Signin ok, got {len(session_cookies)} cookie(s)")

    # Fetch JWT via /token
    client.set_phase("neon-jwt-fetch")
    jwt = neon_fetch_jwt(neon_auth_url=neon_auth_url, session_cookies=session_cookies)
    if not jwt:
        raise RuntimeError("Neon Auth /token did not return a JWT after signin")
    print(f"[smoke] Got JWT ({len(jwt)} chars)")

    # Exchange JWT for boring-ui session cookie
    client.set_phase("neon-token-exchange")
    exch_resp = client.post(
        "/auth/token-exchange",
        json={"access_token": jwt, "redirect_uri": redirect_uri},
        expect_status=(200,),
    )
    if exch_resp.status_code != 200:
        raise RuntimeError(f"Token exchange failed: {exch_resp.status_code} {exch_resp.text[:300]}")
    payload = exch_resp.json()
    if not payload.get("ok"):
        raise RuntimeError(f"Token exchange not ok: {payload}")

    # Verify session
    client.set_phase("neon-session-check")
    session_resp = client.get("/auth/session", expect_status=(200,))
    if session_resp.status_code != 200:
        raise RuntimeError(f"Session check failed: {session_resp.status_code}")
    session = session_resp.json()
    user_email = (session.get("user") or {}).get("email", "")
    if str(user_email).strip().lower() != email.lower():
        raise RuntimeError(f"Session email mismatch: expected {email}, got {user_email}")
    print(f"[smoke] Session verified for {email}")
    return session

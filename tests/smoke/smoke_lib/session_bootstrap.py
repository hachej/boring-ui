"""Shared auth/session bootstrap helpers for smoke tests."""
from __future__ import annotations

import time

import httpx

from .auth import (
    neon_signin_flow,
    neon_signup_then_signin,
    neon_signup_verify_flow,
    random_password,
    signin_flow,
    signup_flow,
)
from .client import SmokeClient
from .secrets import neon_auth_url as secret_neon_auth_url
from .secrets import resend_api_key, supabase_anon_key, supabase_url


def dev_login(client: SmokeClient, *, user_id: str, email: str, redirect_uri: str = "/") -> dict:
    client.set_phase("dev-login")
    resp = client.get(
        "/auth/login",
        params={"user_id": user_id, "email": email, "redirect_uri": redirect_uri},
        expect_status=(200, 302),
    )
    if resp.status_code not in (200, 302):
        raise RuntimeError(f"Dev login failed: {resp.status_code} {resp.text[:300]}")
    print(f"[smoke] Dev login OK: {email}")
    return {"auth_mode": "dev", "email": email, "user_id": user_id}


def resolve_neon_auth_url(base_url: str, neon_auth_url: str = "") -> str:
    if neon_auth_url:
        return neon_auth_url.rstrip("/")

    try:
        resp = httpx.get(f"{base_url.rstrip('/')}/api/capabilities", timeout=15.0)
        if resp.status_code == 200:
            auth = resp.json().get("auth", {})
            discovered = str(auth.get("neonAuthUrl", "")).strip()
            if discovered:
                print(f"[smoke] Neon Auth URL from capabilities: {discovered}")
                return discovered.rstrip("/")
    except Exception as exc:
        print(f"[smoke] Could not fetch Neon Auth URL from capabilities: {exc}")

    discovered = secret_neon_auth_url()
    print(f"[smoke] Neon Auth URL from secrets: {discovered}")
    return discovered.rstrip("/")


def ensure_session(
    client: SmokeClient,
    *,
    auth_mode: str,
    base_url: str,
    neon_auth_url: str = "",
    email: str | None = None,
    password: str | None = None,
    recipient: str | None = None,
    skip_signup: bool = False,
    timeout_seconds: int = 180,
    redirect_uri: str = "/",
) -> dict:
    mode = str(auth_mode or "neon").strip().lower()

    if mode == "dev":
        ts = int(time.time())
        user_id = f"smoke-dev-{ts}"
        user_email = email or f"smoke-dev-{ts}@test.local"
        return dev_login(client, user_id=user_id, email=user_email, redirect_uri=redirect_uri)

    if skip_signup and (not email or not password):
        raise RuntimeError("--skip-signup requires --email and --password")

    if mode == "neon":
        resolved_neon_url = resolve_neon_auth_url(base_url, neon_auth_url)
        account_email = email or recipient or f"qa+smoke-neon-{int(time.time())}@boringdata.io"
        account_password = password or random_password()
        if skip_signup:
            neon_signin_flow(
                client,
                neon_auth_url=resolved_neon_url,
                email=account_email,
                password=account_password,
                redirect_uri=redirect_uri,
            )
        else:
            try:
                neon_signup_verify_flow(
                    client,
                    neon_auth_url=resolved_neon_url,
                    resend_api_key=resend_api_key(),
                    email=account_email,
                    password=account_password,
                    timeout_seconds=min(timeout_seconds, 60),
                    redirect_uri=redirect_uri,
                )
            except RuntimeError:
                # Signup likely succeeded but verification timed out.
                # Try sign-in directly first (works without email verification),
                # then fall back to full signup+signin if sign-in fails.
                try:
                    neon_signin_flow(
                        client,
                        neon_auth_url=resolved_neon_url,
                        email=account_email,
                        password=account_password,
                        redirect_uri=redirect_uri,
                    )
                except RuntimeError:
                    neon_signup_then_signin(
                        client,
                        neon_auth_url=resolved_neon_url,
                        resend_api_key=resend_api_key(),
                        email=account_email,
                        password=account_password,
                        timeout_seconds=timeout_seconds,
                        redirect_uri=redirect_uri,
                    )
        return {
            "auth_mode": mode,
            "email": account_email,
            "password": account_password,
            "neon_auth_url": resolved_neon_url,
        }

    if mode == "supabase":
        sb_url = supabase_url()
        sb_anon = supabase_anon_key()
        account_email = email or recipient or f"qa+smoke-supabase-{int(time.time())}@boringdata.io"
        account_password = password or random_password()
        if not skip_signup:
            signup_flow(
                client,
                supabase_url=sb_url,
                supabase_anon_key=sb_anon,
                resend_api_key=resend_api_key(),
                email=account_email,
                password=account_password,
                timeout_seconds=timeout_seconds,
            )
        signin_flow(
            client,
            supabase_url=sb_url,
            supabase_anon_key=sb_anon,
            email=account_email,
            password=account_password,
        )
        return {
            "auth_mode": mode,
            "email": account_email,
            "password": account_password,
        }

    raise RuntimeError(f"Unsupported auth_mode: {auth_mode}")

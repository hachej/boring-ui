#!/usr/bin/env python3
"""Live smoke test: Supabase signup email + Resend capture + boring-ui callback/session."""

from __future__ import annotations

import argparse
import html
import json
import os
import random
import re
import string
import subprocess
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import httpx
from fastapi.testclient import TestClient

from boring_ui.api import APIConfig, create_app

RESEND_API_BASE = "https://api.resend.com"


def _vault(path: str, field: str) -> str:
    return subprocess.check_output(
        ["vault", "kv", "get", f"-field={field}", path],
        text=True,
    ).strip()


def _secret(name: str, *, env: str, vault_path: str, vault_field: str) -> str:
    value = (os.environ.get(env) or "").strip()
    if value:
        return value
    return _vault(vault_path, vault_field)


def _iso_to_epoch(value: str | None) -> float | None:
    if not value:
        return None
    raw = value.strip()
    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"
    try:
        return datetime.fromisoformat(raw).timestamp()
    except ValueError:
        return None


def _normalize_recipients(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        return [raw]
    if isinstance(raw, list):
        out: list[str] = []
        for item in raw:
            if isinstance(item, str):
                out.append(item)
            elif isinstance(item, dict):
                email = item.get("email")
                if isinstance(email, str) and email.strip():
                    out.append(email.strip())
        return out
    return []


def _resend_list_emails(api_key: str, *, limit: int = 25) -> list[dict[str, Any]]:
    for attempt in range(1, 8):
        resp = httpx.get(
            f"{RESEND_API_BASE}/emails",
            headers={"Authorization": f"Bearer {api_key}"},
            params={"limit": limit},
            timeout=20.0,
        )
        if resp.status_code == 429:
            time.sleep(min(0.5 * attempt, 3.0))
            continue
        resp.raise_for_status()
        payload = resp.json()
        if isinstance(payload, dict):
            data = payload.get("data")
            return data if isinstance(data, list) else []
        return payload if isinstance(payload, list) else []
    raise RuntimeError("Resend list endpoint kept returning rate limits")


def _resend_get_email(api_key: str, *, email_id: str) -> dict[str, Any]:
    for attempt in range(1, 8):
        resp = httpx.get(
            f"{RESEND_API_BASE}/emails/{email_id}",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=20.0,
        )
        if resp.status_code in {404, 429}:
            time.sleep(min(0.5 * attempt, 4.0))
            continue
        resp.raise_for_status()
        payload = resp.json()
        if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
            return payload["data"]
        if isinstance(payload, dict):
            return payload
        raise RuntimeError("Unexpected Resend email detail payload")
    raise RuntimeError("Resend detail endpoint kept returning rate limits")


def _wait_for_resend_email(
    api_key: str,
    *,
    recipient: str,
    sent_after_epoch: float,
    timeout_seconds: int,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    recipient_lower = recipient.lower()
    while time.monotonic() < deadline:
        for email in _resend_list_emails(api_key):
            if not isinstance(email, dict):
                continue
            recipients = _normalize_recipients(email.get("to"))
            if recipient_lower not in {item.lower() for item in recipients}:
                continue
            created_epoch = _iso_to_epoch(email.get("created_at"))
            if created_epoch is not None and created_epoch + 5 < sent_after_epoch:
                continue
            return email
        time.sleep(3)
    raise RuntimeError("Timed out waiting for signup email in Resend")


def _extract_confirmation_url(payload: dict[str, Any]) -> str:
    candidates: list[str] = []
    for key in ("html", "text"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            candidates.extend(re.findall(r"https?://[^\s\"'<>]+", value))

    for raw_url in candidates:
        url = html.unescape(raw_url.strip()).rstrip("]")
        for _ in range(3):
            parsed = urlparse(url)
            query = parse_qs(parsed.query)
            if ("token_hash" in query or "token" in query) and "type" in query:
                return url
            decoded = unquote(url)
            if decoded == url:
                break
            url = decoded

    if candidates:
        return html.unescape(candidates[0].strip()).rstrip("]")
    raise RuntimeError("No URL found in Resend payload")


def _callback_path_from_confirmation_url(url: str) -> str:
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    verify_type = (params.get("type") or [""])[0].strip()
    token_hash = (params.get("token_hash") or [""])[0].strip()
    token = (params.get("token") or [""])[0].strip()
    if not verify_type:
        raise RuntimeError("Confirmation URL missing type")
    if token_hash:
        return f"/auth/callback?token_hash={token_hash}&type={verify_type}"
    if token:
        return f"/auth/callback?token={token}&type={verify_type}"
    raise RuntimeError("Confirmation URL missing token/token_hash")


def _random_password() -> str:
    alphabet = string.ascii_letters + string.digits
    tail = "".join(random.choice(alphabet) for _ in range(14))
    return f"Aa1!{tail}"


def _supabase_signup_with_retry(
    *,
    supabase_url: str,
    supabase_anon_key: str,
    recipient: str,
    password: str,
    max_attempts: int = 3,
) -> httpx.Response:
    last_resp: httpx.Response | None = None
    for attempt in range(1, max_attempts + 1):
        resp = httpx.post(
            f"{supabase_url}/auth/v1/signup",
            headers={
                "apikey": supabase_anon_key,
                "Authorization": f"Bearer {supabase_anon_key}",
                "Content-Type": "application/json",
            },
            json={
                "email": recipient,
                "password": password,
                "options": {
                    "email_redirect_to": "http://127.0.0.1:8000/auth/callback?redirect_uri=%2F",
                },
            },
            timeout=30.0,
        )
        if resp.status_code in {200, 201}:
            return resp

        last_resp = resp
        retry_after = resp.headers.get("retry-after", "").strip()
        is_rate_limited = resp.status_code == 429
        if not is_rate_limited:
            break

        if retry_after.isdigit():
            delay = min(max(int(retry_after), 1), 60)
        else:
            delay = min(5 * attempt, 45)
        time.sleep(delay)

    if last_resp is None:
        raise RuntimeError("Signup attempt failed before receiving any response")
    return last_resp


def _supabase_admin_generate_signup_link(
    *,
    supabase_url: str,
    supabase_service_role_key: str,
    recipient: str,
    password: str,
) -> str:
    resp = httpx.post(
        f"{supabase_url}/auth/v1/admin/generate_link",
        headers={
            "apikey": supabase_service_role_key,
            "Authorization": f"Bearer {supabase_service_role_key}",
            "Content-Type": "application/json",
        },
        json={
            "type": "signup",
            "email": recipient,
            "password": password,
            "options": {
                "redirect_to": "http://127.0.0.1:8000/auth/callback?redirect_uri=%2F",
            },
        },
        timeout=30.0,
    )
    resp.raise_for_status()
    payload = resp.json()
    action_link = str(payload.get("action_link") or "").strip()
    if not action_link:
        raise RuntimeError("Supabase admin generate_link did not return action_link")
    return action_link


def _resend_send_confirmation_email(
    *,
    api_key: str,
    recipient: str,
    action_link: str,
    from_email: str,
    from_name: str,
) -> str:
    resp = httpx.post(
        f"{RESEND_API_BASE}/emails",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "from": f"{from_name} <{from_email}>",
            "to": [recipient],
            "subject": "Confirm Your Signup",
            "html": (
                "<h2>Confirm your signup</h2>"
                "<p>Follow this link to confirm your user:</p>"
                f'<p><a href="{action_link}">Confirm your mail</a></p>'
            ),
            "text": (
                "CONFIRM YOUR SIGNUP\n\n"
                "Follow this link to confirm your user:\n\n"
                f"{action_link}\n"
            ),
        },
        timeout=30.0,
    )
    resp.raise_for_status()
    payload = resp.json()
    email_id = str(payload.get("id") or "").strip()
    if not email_id:
        raise RuntimeError("Resend send endpoint did not return email id")
    return email_id


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipient", help="Signup recipient email address")
    parser.add_argument("--timeout", type=int, default=180, help="Resend polling timeout seconds")
    args = parser.parse_args()

    supabase_url = _secret(
        "supabase_url",
        env="SUPABASE_URL",
        vault_path="secret/agent/boring-ui-supabase-project-url",
        vault_field="url",
    ).rstrip("/")
    supabase_anon_key = _secret(
        "supabase_anon_key",
        env="SUPABASE_ANON_KEY",
        vault_path="secret/agent/boring-ui-supabase-publishable-key",
        vault_field="key",
    )
    resend_api_key = _secret(
        "resend_api_key",
        env="RESEND_API_KEY",
        vault_path="secret/agent/services/resend",
        vault_field="api_key",
    )

    if args.recipient:
        recipient = args.recipient.strip().lower()
    else:
        stamp = int(time.time())
        recipient = f"qa+boring-ui-signup-{stamp}@mail.boringdata.io"
    password = _random_password()
    sent_after_epoch = time.time()
    signup_mode = "public_signup"

    signup_resp = _supabase_signup_with_retry(
        supabase_url=supabase_url,
        supabase_anon_key=supabase_anon_key,
        recipient=recipient,
        password=password,
    )
    if signup_resp.status_code in {200, 201}:
        email_summary = _wait_for_resend_email(
            resend_api_key,
            recipient=recipient,
            sent_after_epoch=sent_after_epoch,
            timeout_seconds=args.timeout,
        )
        email_id = str(email_summary.get("id") or "").strip()
        if not email_id:
            raise RuntimeError("Resend list payload did not include email id")
        email_details = _resend_get_email(resend_api_key, email_id=email_id)
    elif signup_resp.status_code == 429:
        signup_mode = "admin_generate_link_fallback"
        supabase_service_role_key = _secret(
            "supabase_service_role_key",
            env="SUPABASE_SERVICE_ROLE_KEY",
            vault_path="secret/agent/boring-ui-supabase-service-role-key",
            vault_field="key",
        )
        action_link = _supabase_admin_generate_signup_link(
            supabase_url=supabase_url,
            supabase_service_role_key=supabase_service_role_key,
            recipient=recipient,
            password=password,
        )
        from_email = (os.environ.get("RESEND_FROM_EMAIL") or "auth@mail.boringdata.io").strip()
        from_name = (os.environ.get("RESEND_FROM_NAME") or "Boring UI").strip()
        email_id = _resend_send_confirmation_email(
            api_key=resend_api_key,
            recipient=recipient,
            action_link=action_link,
            from_email=from_email,
            from_name=from_name,
        )
        email_details = _resend_get_email(resend_api_key, email_id=email_id)
    else:
        raise RuntimeError(f"Supabase signup failed: {signup_resp.status_code} {signup_resp.text}")

    confirmation_url = _extract_confirmation_url(email_details)
    callback_path = _callback_path_from_confirmation_url(confirmation_url)

    with tempfile.TemporaryDirectory() as tmpdir:
        config = APIConfig(
            workspace_root=Path(tmpdir),
            control_plane_provider="supabase",
            supabase_url=supabase_url,
            supabase_anon_key=supabase_anon_key,
            auth_dev_login_enabled=False,
            auth_session_secret="boring-ui-smoke-secret",
        )
        app = create_app(config=config, include_pty=False, include_stream=False, include_approval=False)
        client = TestClient(app)

        callback_resp = client.get(callback_path, follow_redirects=False)
        if callback_resp.status_code != 302:
            raise RuntimeError(
                f"Callback did not redirect: {callback_resp.status_code} {callback_resp.text[:300]}"
            )
        location = callback_resp.headers.get("location", "")
        if not location.startswith("/"):
            raise RuntimeError(f"Unexpected callback redirect location: {location}")

        session_resp = client.get("/auth/session")
        if session_resp.status_code != 200:
            raise RuntimeError(
                f"Session endpoint failed after callback: {session_resp.status_code} {session_resp.text[:300]}"
            )
        payload = session_resp.json()
        user = payload.get("user") if isinstance(payload, dict) else None
        user_email = (user or {}).get("email", "")
        if str(user_email).strip().lower() != recipient:
            raise RuntimeError(
                f"Session email mismatch; expected {recipient}, got {user_email}"
            )

    print(
        json.dumps(
            {
                "ok": True,
                "recipient": recipient,
                "resend_email_id": email_id,
                "signup_mode": signup_mode,
                "callback_path": callback_path,
                "redirect_location": location,
            },
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

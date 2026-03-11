#!/usr/bin/env python3
"""Neon Auth E2E smoke test: verify-first signup/signin -> session -> /me.

Usage:
    # Against production Modal deployment
    python tests/smoke/smoke_neon_auth.py --base-url https://julien-hurault--boring-ui-core-core.modal.run

    # With an existing account (skip signup)
    python tests/smoke/smoke_neon_auth.py --base-url https://... --skip-signup --email user@test.com --password Pass123!

    # With explicit Neon Auth URL override
    python tests/smoke/smoke_neon_auth.py --base-url https://... --neon-auth-url https://ep-xxx.neonauth...
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_lib.auth import (
    random_password,
    neon_signup_verify_flow,
    neon_signin_flow,
)
from smoke_lib.client import SmokeClient
from smoke_lib.secrets import resend_api_key
from smoke_lib.workspace import create_workspace, list_workspaces


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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000",
                        help="boring-ui base URL")
    parser.add_argument("--neon-auth-url", default="",
                        help="Override Neon Auth base URL (auto-detected from /api/capabilities)")
    parser.add_argument("--skip-signup", action="store_true",
                        help="Skip signup, use --email/--password for existing account")
    parser.add_argument("--email", help="Existing account email (with --skip-signup)")
    parser.add_argument("--password", help="Existing account password (with --skip-signup)")
    parser.add_argument("--timeout", type=int, default=180, help="Verification email polling timeout seconds")
    args = parser.parse_args()

    client = SmokeClient(args.base_url)
    neon_url = _get_neon_auth_url(args)

    if args.skip_signup:
        if not args.email or not args.password:
            print("--skip-signup requires --email and --password", file=sys.stderr)
            return 1
        email = args.email
        password = args.password
    else:
        email = f"qa+smoke-neon-{int(time.time())}@mail.boringdata.io"
        password = random_password()

        # Phase 1: Signup + verification email + token exchange
        print(f"\n{'='*60}")
        print(f"Phase 1: Neon Signup + Verification")
        print(f"  Email: {email}")
        print(f"  Neon Auth: {neon_url}")
        print(f"  Target: {args.base_url}")
        print(f"{'='*60}")
        session = neon_signup_verify_flow(
            client,
            neon_auth_url=neon_url,
            resend_api_key=resend_api_key(),
            email=email,
            password=password,
            timeout_seconds=args.timeout,
        )
        print(f"[smoke] Verification signup session: user_id={session.get('user', {}).get('user_id', '?')[:12]}...")

    # Phase 2: Signin + full flow
    print(f"\n{'='*60}")
    print(f"Phase 2: Neon Signin Flow")
    print(f"{'='*60}")
    session = neon_signin_flow(
        client,
        neon_auth_url=neon_url,
        email=email,
        password=password,
    )
    print(f"[smoke] Session: user_id={session.get('user', {}).get('user_id', '?')[:12]}...")

    # Phase 3: Verify /auth/session
    print(f"\n{'='*60}")
    print(f"Phase 3: Session Verification")
    print(f"{'='*60}")
    client.set_phase("session-verify")
    session_resp = client.get("/auth/session", expect_status=(200,))
    if session_resp.status_code == 200:
        s = session_resp.json()
        print(f"[smoke] /auth/session: authenticated={s.get('authenticated')}, email={s.get('user', {}).get('email')}")
    else:
        print(f"[smoke] FAIL: /auth/session returned {session_resp.status_code}")

    # Phase 4: Verify /api/v1/me
    print(f"\n{'='*60}")
    print(f"Phase 4: Identity Check (/api/v1/me)")
    print(f"{'='*60}")
    client.set_phase("me-check")
    me_resp = client.get("/api/v1/me", expect_status=(200,))
    if me_resp.status_code == 200:
        me = me_resp.json()
        print(f"[smoke] /api/v1/me: {json.dumps(me, indent=2)[:300]}")
    else:
        print(f"[smoke] FAIL: /api/v1/me returned {me_resp.status_code}: {me_resp.text[:200]}")

    # Phase 5: Create workspace
    print(f"\n{'='*60}")
    print(f"Phase 5: Create Workspace")
    print(f"{'='*60}")
    ts = int(time.time())
    ws_data = create_workspace(client, name=f"smoke-neon-{ts}")
    ws = ws_data.get("workspace") or ws_data
    workspace_id = ws.get("workspace_id") or ws.get("id")
    print(f"[smoke] Workspace ID: {workspace_id}")

    # Phase 6: List workspaces
    print(f"\n{'='*60}")
    print(f"Phase 6: List Workspaces")
    print(f"{'='*60}")
    list_workspaces(client, expect_id=workspace_id)

    # Phase 7: Logout
    print(f"\n{'='*60}")
    print(f"Phase 7: Logout")
    print(f"{'='*60}")
    client.set_phase("logout")
    logout_resp = client.get("/auth/logout", expect_status=(302,))
    if logout_resp.status_code == 302:
        print(f"[smoke] Logout redirect: {logout_resp.headers.get('location', '?')}")
    else:
        print(f"[smoke] WARN: Logout returned {logout_resp.status_code}")

    # Clear cookies client-side (httpx doesn't auto-delete on Set-Cookie max_age=0)
    client.cookies.clear()

    # Phase 8: Confirm session is gone
    client.set_phase("post-logout-check")
    post_resp = client.get("/auth/session", expect_status=(401,))
    if post_resp.status_code == 401:
        print(f"[smoke] Post-logout session correctly returns 401")
    else:
        print(f"[smoke] WARN: Post-logout session returned {post_resp.status_code}")

    # Report
    report = client.report()
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

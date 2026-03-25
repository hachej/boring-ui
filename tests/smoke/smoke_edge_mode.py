#!/usr/bin/env python3
"""Edge mode E2E smoke test: auth -> workspace -> provisioning -> sprite -> agent."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_lib.client import SmokeClient, StepResult
from smoke_lib.files import check_file_tree, create_and_read_file, check_git_status
from smoke_lib.session_bootstrap import ensure_session
from smoke_lib.workspace import (
    create_workspace,
    list_workspaces,
    get_runtime,
    retry_runtime,
    poll_runtime_ready,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--auth-mode", choices=["neon", "dev"], default="neon")
    parser.add_argument("--neon-auth-url", default="")
    parser.add_argument("--recipient", help="Override test email address")
    parser.add_argument("--public-origin", default="",
                        help="Public app origin expected in verification emails when it differs from --base-url")
    parser.add_argument("--timeout", type=int, default=180, help="Resend polling timeout seconds")
    parser.add_argument("--provision-timeout", type=int, default=120, help="Sprite provisioning timeout")
    parser.add_argument("--skip-signup", action="store_true", help="Skip signup, use --email/--password")
    parser.add_argument("--email", help="Existing account email (with --skip-signup)")
    parser.add_argument("--password", help="Existing account password (with --skip-signup)")
    parser.add_argument("--skip-sprite", action="store_true", help="Skip sprite/sandbox phases (10-16)")
    parser.add_argument("--skip-agent", action="store_true", help="Skip agent WebSocket test")
    parser.add_argument("--sandbox-url", help="Sandbox gateway URL (for sprite proxy access)")
    args = parser.parse_args()

    client = SmokeClient(args.base_url)
    ensure_session(
        client,
        auth_mode=args.auth_mode,
        base_url=args.base_url,
        neon_auth_url=args.neon_auth_url,
        email=args.email,
        password=args.password,
        recipient=args.recipient,
        skip_signup=args.skip_signup,
        timeout_seconds=args.timeout,
        public_app_base_url=args.public_origin or None,
    )

    # --- Phase 5-6: Workspace ---
    ts = int(time.time())
    ws_data = create_workspace(client, name=f"smoke-edge-{ts}")
    ws = ws_data.get("workspace") or ws_data
    workspace_id = ws.get("workspace_id") or ws.get("id")
    list_workspaces(client, expect_id=workspace_id)

    # --- Phase 7: Retry guard (409 if pending, 200 if retry is allowed) ---
    client.set_phase("retry-guard")
    print("[smoke] Testing retry guard...")
    retry_resp = client.post(
        f"/api/v1/workspaces/{workspace_id}/runtime/retry",
        expect_status=(200, 409),
    )
    retry_status = retry_resp.status_code
    if retry_status == 409:
        print("[smoke] Retry guard: correctly rejected (409 INVALID_TRANSITION)")
    else:
        print(f"[smoke] Retry guard: accepted ({retry_status})")

    # --- Phase 8: Boundary setup ---
    client.set_phase("boundary-setup")
    print("[smoke] Checking boundary setup...")
    setup_resp = client.get(f"/w/{workspace_id}/setup", expect_status=(200,))
    if setup_resp.status_code == 200:
        setup_data = setup_resp.json()
        print(f"[smoke] Boundary setup OK: workspace_id={setup_data.get('workspace_id')}")
    else:
        print(f"[smoke] Boundary setup failed: {setup_resp.status_code}")

    # --- Phase 9: Boundary runtime ---
    client.set_phase("boundary-runtime")
    print("[smoke] Checking boundary runtime...")
    runtime_resp = client.get(f"/w/{workspace_id}/runtime", expect_status=(200,))
    if runtime_resp.status_code == 200:
        print("[smoke] Boundary runtime OK")
    else:
        print(f"[smoke] Boundary runtime failed: {runtime_resp.status_code}")

    # --- Phases 10-16: Sprite provisioning + operations ---
    if not args.skip_sprite:
        # Phase 10: Poll runtime until ready
        print(f"[smoke] Polling runtime (timeout={args.provision_timeout}s)...")
        runtime = poll_runtime_ready(
            client,
            workspace_id,
            timeout_seconds=args.provision_timeout,
        )
        sprite_url = runtime.get("sprite_url", "")
        if not sprite_url:
            print("[smoke] ERROR: Runtime ready but no sprite_url", file=sys.stderr)
            return 1
        print(f"[smoke] Sprite URL: {sprite_url}")

        # In edge mode, access the sprite through the sandbox gateway proxy
        # which handles auth (session cookie → bearer token).
        # Route: {sandbox_gateway}/w/{workspace_id}/...
        sandbox_base = args.sandbox_url
        if sandbox_base:
            proxy_base = f"{sandbox_base.rstrip('/')}/w/{workspace_id}"
            print(f"[smoke] Using sandbox gateway proxy: {proxy_base}")
            client.switch_base(proxy_base)
        else:
            # Fallback: try the sprite URL directly (works if URL auth is public)
            print("[smoke] No --sandbox-url; accessing sprite directly")
            client.switch_base(sprite_url)

        # Phase 11: Sprite health
        client.set_phase("sprite-health")
        print("[smoke] Checking sprite health...")
        health_resp = client.get("/health", expect_status=(200,))
        if health_resp.status_code == 200:
            print("[smoke] Sprite health OK")

        # Phase 12: Sprite file tree
        check_file_tree(client)

        # Phase 13-14: Sprite create + read file
        create_and_read_file(client, path="smoke-test.txt", content=f"smoke-edge-{ts}")

        # Phase 15: Sprite git status
        check_git_status(client)

        # Phase 16: Agent interaction
        if not args.skip_agent:
            from smoke_lib.agent import agent_roundtrip
            ws_base = proxy_base if sandbox_base else sprite_url
            result = agent_roundtrip(
                ws_base,
                message="Say exactly: SMOKE_OK",
                timeout_seconds=30.0,
                cookies=dict(client.cookies),
            )
            if not result.get("ok") and not result.get("skipped"):
                client.results.append(StepResult(
                    phase="agent", method="WS", path="/ws/agent/normal/stream",
                    status=0, ok=False, elapsed_ms=0, detail=result.get("error", "unknown"),
                ))
    else:
        print("[smoke] Skipping sprite phases (--skip-sprite)")

    # --- Report ---
    report = client.report()
    print(json.dumps(report, indent=2))

    if report["ok"]:
        print(f"\nSMOKE EDGE: ALL {report['total']} STEPS PASSED")
        return 0
    else:
        print(f"\nSMOKE EDGE: {report['failed']}/{report['total']} STEPS FAILED", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

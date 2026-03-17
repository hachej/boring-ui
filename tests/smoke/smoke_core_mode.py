#!/usr/bin/env python3
"""Core mode E2E smoke test: auth -> workspace -> files.

Core mode validation stays on the browser/PI path and does not require a
backend agent WebSocket roundtrip.
"""

from __future__ import annotations

import argparse
import json
import sys
import time

# Add scripts dir to path for smoke_lib import
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_lib.client import SmokeClient
from smoke_lib.files import check_file_tree, create_and_read_file
from smoke_lib.session_bootstrap import ensure_session
from smoke_lib.workspace import create_workspace, list_workspaces


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--auth-mode", choices=["neon", "supabase", "dev"], default="neon")
    parser.add_argument("--neon-auth-url", default="")
    parser.add_argument("--skip-signup", action="store_true", help="Skip signup, use --email/--password")
    parser.add_argument("--email", help="Existing account email (with --skip-signup)")
    parser.add_argument("--password", help="Existing account password (with --skip-signup)")
    parser.add_argument("--recipient", help="Override test email address")
    parser.add_argument("--timeout", type=int, default=180, help="Auth/bootstrap timeout seconds")
    parser.add_argument("--evidence-out", default="")
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
    )

    # Phase 1: Create workspace
    ts = int(time.time())
    ws_data = create_workspace(client, name=f"smoke-core-{ts}")
    ws = ws_data.get("workspace") or ws_data
    workspace_id = ws.get("workspace_id") or ws.get("id")
    if not workspace_id:
        raise RuntimeError(f"No workspace_id in response: {ws_data}")

    # Phase 2: List workspaces
    list_workspaces(client, expect_id=workspace_id)

    ws_base = f"{args.base_url.rstrip('/')}/w/{workspace_id}"
    client.switch_base(ws_base)
    print(f"[smoke] Workspace scope: /w/{workspace_id}")

    # Phase 3: File tree
    check_file_tree(client)

    # Phase 4-5: Create + read file
    create_and_read_file(client, path="smoke-test.txt", content=f"smoke-core-{ts}")

    # Report
    report = client.report()
    if args.evidence_out:
        client.write_report(
            args.evidence_out,
            extra={
                "suite": "core-mode",
                "base_url": args.base_url,
                "workspace_id": workspace_id,
                "auth_mode": args.auth_mode,
            },
        )
    print(json.dumps(report, indent=2))

    if report["ok"]:
        print(f"\nSMOKE CORE: ALL {report['total']} STEPS PASSED")
        return 0
    else:
        print(f"\nSMOKE CORE: {report['failed']}/{report['total']} STEPS FAILED", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

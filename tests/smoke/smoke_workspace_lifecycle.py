#!/usr/bin/env python3
"""Workspace lifecycle smoke: auth -> create -> list -> boundary -> runtime -> rename."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_lib.client import SmokeClient
from smoke_lib.session_bootstrap import ensure_session
from smoke_lib.settings import rename_workspace, verify_workspace_name
from smoke_lib.workspace import (
    check_workspace_root,
    create_workspace,
    get_runtime,
    get_workspace_boundary_runtime,
    get_workspace_setup,
    list_workspaces,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--auth-mode", choices=["neon", "dev"], default="neon")
    parser.add_argument("--neon-auth-url", default="")
    parser.add_argument("--skip-signup", action="store_true")
    parser.add_argument("--email")
    parser.add_argument("--password")
    parser.add_argument("--recipient")
    parser.add_argument("--public-origin", default="")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--workspace-name", default="")
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
        public_app_base_url=args.public_origin or None,
    )

    ts = int(time.time())
    workspace_name = args.workspace_name.strip() or f"smoke-workspace-{ts}"
    ws_data = create_workspace(client, name=workspace_name)
    ws = ws_data.get("workspace") or ws_data
    workspace_id = ws.get("workspace_id") or ws.get("id")
    if not workspace_id:
        raise RuntimeError(f"No workspace_id in response: {ws_data}")

    list_workspaces(client, expect_id=workspace_id)

    setup = get_workspace_setup(client, workspace_id)
    print(
        f"[smoke] Workspace setup OK: kind={setup.get('_response_kind', '?')}, "
        f"workspace_id={setup.get('workspace_id', workspace_id)}"
    )

    runtime_data = get_runtime(client, workspace_id)
    runtime = runtime_data.get("runtime", runtime_data)
    print(f"[smoke] Workspace runtime state: {runtime.get('state', '?')}")

    boundary_runtime = get_workspace_boundary_runtime(client, workspace_id)
    boundary_state = (boundary_runtime.get("runtime") or {}).get("state")
    print(f"[smoke] Boundary runtime state: {boundary_state}")

    check_workspace_root(client, workspace_id)

    renamed = f"{workspace_name}-renamed"
    rename_workspace(client, workspace_id, name=renamed)
    verify_workspace_name(client, workspace_id, expected_name=renamed)

    report = client.report()
    if args.evidence_out:
        client.write_report(
            args.evidence_out,
            extra={
                "suite": "workspace-lifecycle",
                "base_url": args.base_url,
                "workspace_id": workspace_id,
                "auth_mode": args.auth_mode,
            },
        )

    print(json.dumps(report, indent=2))
    if report["ok"]:
        print(f"\nSMOKE WORKSPACE LIFECYCLE: ALL {report['total']} STEPS PASSED")
        return 0
    print(f"\nSMOKE WORKSPACE LIFECYCLE: {report['failed']}/{report['total']} STEPS FAILED", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

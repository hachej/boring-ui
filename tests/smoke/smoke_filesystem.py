#!/usr/bin/env python3
"""Filesystem smoke: auth -> workspace scope -> list -> write/read -> rename -> delete."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_lib.client import SmokeClient
from smoke_lib.files import check_file_tree, full_file_cycle
from smoke_lib.session_bootstrap import ensure_session
from smoke_lib.workspace import create_workspace


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--auth-mode", choices=["neon", "dev"], default="neon")
    parser.add_argument("--neon-auth-url", default="")
    parser.add_argument("--skip-signup", action="store_true")
    parser.add_argument("--email")
    parser.add_argument("--password")
    parser.add_argument("--recipient")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--workspace-id", default="")
    parser.add_argument("--prefix", default="smoke-fs")
    parser.add_argument("--include-search", action="store_true")
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

    workspace_id = args.workspace_id.strip()
    if not workspace_id:
        ws_data = create_workspace(client, name=f"{args.prefix}-workspace")
        ws = ws_data.get("workspace") or ws_data
        workspace_id = ws.get("workspace_id") or ws.get("id") or ""
    if not workspace_id:
        raise RuntimeError("Could not determine workspace_id")

    client.switch_base(f"{args.base_url.rstrip('/')}/w/{workspace_id}")
    print(f"[smoke] Switched to workspace scope: /w/{workspace_id}")

    check_file_tree(client)
    cycle = full_file_cycle(client, prefix=args.prefix, include_search=args.include_search)

    report = client.report()
    if args.evidence_out:
        client.write_report(
            args.evidence_out,
            extra={
                "suite": "filesystem",
                "base_url": args.base_url,
                "workspace_id": workspace_id,
                "auth_mode": args.auth_mode,
                "paths": cycle,
            },
        )

    print(json.dumps(report, indent=2))
    if report["ok"]:
        print(f"\nSMOKE FILESYSTEM: ALL {report['total']} STEPS PASSED")
        return 0
    print(f"\nSMOKE FILESYSTEM: {report['failed']}/{report['total']} STEPS FAILED", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

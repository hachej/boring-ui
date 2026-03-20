#!/usr/bin/env python3
"""Git sync smoke test: auth → workspace → init → write → add → commit → remotes → security.

Usage:
    python3 tests/smoke/smoke_git_sync.py --base-url http://localhost:8000 --auth-mode dev
    python3 tests/smoke/smoke_git_sync.py --base-url https://... --auth-mode neon --skip-signup --email ... --password ...
    python3 tests/smoke/smoke_git_sync.py --with-github  # also test GitHub auth status
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_lib.client import SmokeClient
from smoke_lib.session_bootstrap import ensure_session
from smoke_lib.workspace import create_workspace
from smoke_lib.git import (
    check_git_status,
    full_git_cycle,
    full_git_remote_cycle,
    git_nothing_to_commit,
    git_security_checks,
    github_status,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://localhost:8000",
                        help="Backend base URL (default: http://localhost:8000)")
    parser.add_argument("--auth-mode", choices=["neon", "dev"], default="dev")
    parser.add_argument("--neon-auth-url", default="")
    parser.add_argument("--skip-signup", action="store_true")
    parser.add_argument("--email")
    parser.add_argument("--password")
    parser.add_argument("--recipient")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--workspace-id", default="")
    parser.add_argument("--with-github", action="store_true",
                        help="Also test GitHub auth status endpoint")
    parser.add_argument("--evidence-out", default="")
    args = parser.parse_args()

    client = SmokeClient(args.base_url)
    ts = int(time.time())

    # ── Phase 0: Auth ──────────────────────────────────────────────────
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

    # Create or reuse workspace
    workspace_id = args.workspace_id.strip()
    if not workspace_id:
        ws_data = create_workspace(client, name=f"smoke-git-{ts}")
        ws = ws_data.get("workspace") or ws_data
        workspace_id = ws.get("workspace_id") or ws.get("id") or ""
    if not workspace_id:
        raise RuntimeError("Could not determine workspace_id")

    # ── Phase 1: Health check (before workspace scope) ──────────────
    client.set_phase("health")
    resp = client.get("/health", expect_status=(200,))
    if resp.status_code != 200:
        print(f"[smoke] Backend not reachable at {args.base_url}", file=sys.stderr)
        return 1
    health = resp.json()
    features = health.get("features", {})
    print(f"[smoke] Backend OK: git={features.get('git')}")

    client.switch_base(f"{args.base_url.rstrip('/')}/w/{workspace_id}")
    print(f"[smoke] Workspace scope: /w/{workspace_id}")

    # ── Phase 2: Initial git status (pre-init) ────────────────────────
    status = check_git_status(client)
    is_repo = status.get("is_repo", False)
    print(f"[smoke] Pre-init state: is_repo={is_repo}")

    # ── Phase 3: Full git cycle — init → write → add → commit ────────
    commit_data = full_git_cycle(
        client,
        file_path=f"smoke-git-{ts}.txt",
        content=f"git sync smoke test {ts}",
    )
    oid = commit_data.get("oid", "")
    print(f"[smoke] Phase 3 complete: committed {oid[:8]}")

    # ── Phase 4: Nothing-to-commit guard ──────────────────────────────
    git_nothing_to_commit(client)

    # ── Phase 5: Remote management cycle ──────────────────────────────
    full_git_remote_cycle(client)

    # ── Phase 6: Security checks ──────────────────────────────────────
    git_security_checks(client)

    # ── Phase 7: GitHub auth status (optional) ────────────────────────
    if args.with_github:
        gh = github_status(client)
        configured = gh.get("configured", False)
        print(f"[smoke] GitHub App configured={configured}")

    # ── Report ────────────────────────────────────────────────────────
    report = client.report()
    if args.evidence_out:
        client.write_report(args.evidence_out, extra={
            "suite": "git-sync",
            "workspace_id": workspace_id,
        })

    print(json.dumps(report, indent=2))

    if report["ok"]:
        print(f"\nSMOKE GIT SYNC: ALL {report['total']} STEPS PASSED")
        return 0
    else:
        print(f"\nSMOKE GIT SYNC: {report['failed']}/{report['total']} STEPS FAILED",
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

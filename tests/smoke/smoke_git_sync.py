#!/usr/bin/env python3
"""Git sync smoke test: init → write → add → commit → remotes → security checks.

Runs against a local boring-ui backend with no auth required.
Does NOT require GitHub App credentials — tests core git operations only.

Usage:
    python3 tests/smoke/smoke_git_sync.py
    python3 tests/smoke/smoke_git_sync.py --base-url http://localhost:8000
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
    parser.add_argument("--with-github", action="store_true",
                        help="Also test GitHub auth status endpoint")
    args = parser.parse_args()

    client = SmokeClient(args.base_url)
    ts = int(time.time())

    # ── Phase 1: Health check ──────────────────────────────────────────
    client.set_phase("health")
    resp = client.get("/health", expect_status=(200,))
    if resp.status_code != 200:
        print(f"[smoke] Backend not reachable at {args.base_url}", file=sys.stderr)
        return 1
    health = resp.json()
    features = health.get("features", {})
    print(f"[smoke] Backend OK: git={features.get('git')}")

    # ── Phase 2: Initial git status (pre-init) ────────────────────────
    status = check_git_status(client)
    # Workspace might already have a repo or not — both are valid starting states
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

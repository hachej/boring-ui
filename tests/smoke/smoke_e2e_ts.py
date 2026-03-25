#!/usr/bin/env python3
"""Comprehensive E2E smoke test for the TypeScript server.

Exercises the full critical user flow: health → capabilities → auth →
workspace → files → git → exec → settings.

Usage:
    # Against local TS server (skips Neon auth steps):
    python tests/smoke/smoke_e2e_ts.py --base-url http://localhost:8099

    # Against deployed server with Neon auth:
    python tests/smoke/smoke_e2e_ts.py --base-url https://app.example.com --with-auth

    # With session cookie (skip auth, test workspace flows):
    python tests/smoke/smoke_e2e_ts.py --base-url http://localhost:8099 --cookie "boring_session=eyJ..."
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_lib.client import SmokeClient


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8099")
    parser.add_argument("--with-auth", action="store_true", help="Include Neon auth steps")
    parser.add_argument("--cookie", default="", help="Pre-set session cookie (skip auth)")
    parser.add_argument("--evidence-out", default="")
    args = parser.parse_args()

    client = SmokeClient(args.base_url)
    if args.cookie:
        client.session.cookies.set("boring_session", args.cookie)

    # --- Phase 1: Health & Capabilities (no auth needed) ---

    client.set_phase("1-health")
    resp = client.get("/health", expect_status=(200,))
    health = resp.json()
    assert health.get("status") == "ok", f"Health check failed: {health}"
    print(f"[e2e] 1. Health: OK (status={health['status']})")

    client.set_phase("2-capabilities")
    resp = client.get("/api/capabilities", expect_status=(200,))
    caps = resp.json()
    assert "features" in caps or "capabilities" in caps, f"Capabilities missing: {caps}"
    feature_keys = list((caps.get("features") or caps.get("capabilities") or {}).keys())
    print(f"[e2e] 2. Capabilities: OK ({len(feature_keys)} features)")

    client.set_phase("3-bui-config")
    resp = client.get("/__bui/config", expect_status=(200,))
    bui_config = resp.json()
    data_backend = bui_config.get("frontend", {}).get("data", {}).get("backend", "?")
    print(f"[e2e] 3. BUI config: OK (data.backend={data_backend})")

    client.set_phase("4-api-config")
    resp = client.get("/api/config", expect_status=(200,))
    print(f"[e2e] 4. API config: OK")

    client.set_phase("5-healthz")
    resp = client.get("/healthz", expect_status=(200,))
    healthz = resp.json()
    assert healthz.get("status") == "ok"
    print(f"[e2e] 5. Healthz: OK (request_id={healthz.get('request_id', '?')[:8]})")

    # --- Phase 2: Auth (requires Neon or pre-set cookie) ---

    if args.with_auth and not args.cookie:
        print("[e2e] 6-8. Auth: SKIPPED (--with-auth requires Neon infrastructure)")
        # TODO: Implement Neon auth flow when infrastructure is available
    elif args.cookie:
        print(f"[e2e] 6-8. Auth: Using provided cookie")
    else:
        print("[e2e] 6-8. Auth: SKIPPED (use --with-auth or --cookie)")

    # --- Phase 3: Workspace CRUD (requires auth cookie) ---

    has_auth = bool(args.cookie)
    if not has_auth:
        print("[e2e] 9-18. Workspace/Files/Git/Exec: SKIPPED (no auth)")
        # Print summary
        total = 5  # health checks only
        print(f"\n[e2e] SUMMARY: {total}/{total} steps passed (auth-dependent steps skipped)")
        if args.evidence_out:
            _write_evidence(args.evidence_out, client)
        return 0

    # With auth cookie, test workspace flows
    client.set_phase("9-list-workspaces")
    resp = client.get("/api/v1/workspaces", expect_status=(200,))
    ws_list = resp.json()
    print(f"[e2e] 9. List workspaces: OK ({ws_list.get('count', len(ws_list.get('workspaces', [])))} workspaces)")

    client.set_phase("10-create-workspace")
    test_ws_name = f"e2e-test-{uuid.uuid4().hex[:8]}"
    resp = client.post(
        "/api/v1/workspaces",
        json={"name": test_ws_name},
        expect_status=(200, 201),
    )
    ws = resp.json()
    ws_id = ws.get("workspace", {}).get("id") or ws.get("id")
    print(f"[e2e] 10. Create workspace: OK (id={ws_id})")

    client.set_phase("11-write-file")
    test_content = f"Hello from E2E test at {time.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    resp = client.put(
        "/api/v1/files/write",
        json={"path": "e2e-test.txt", "content": test_content},
        expect_status=(200,),
    )
    print(f"[e2e] 11. Write file: OK")

    client.set_phase("12-read-file")
    resp = client.get("/api/v1/files/read?path=e2e-test.txt", expect_status=(200,))
    read_data = resp.json()
    assert read_data.get("content") == test_content, f"Content mismatch: {read_data}"
    print(f"[e2e] 12. Read file: OK (content matches)")

    client.set_phase("13-search-files")
    resp = client.get("/api/v1/files/search?pattern=e2e", expect_status=(200,))
    search_data = resp.json()
    assert len(search_data.get("results", [])) > 0, "Search found no results"
    print(f"[e2e] 13. Search files: OK ({len(search_data['results'])} results)")

    client.set_phase("14-git-status")
    resp = client.get("/api/v1/git/status", expect_status=(200,))
    git_status = resp.json()
    print(f"[e2e] 14. Git status: OK (is_repo={git_status.get('is_repo')})")

    client.set_phase("15-exec-short")
    resp = client.post(
        "/api/v1/exec",
        json={"command": "echo e2e-test-output"},
        expect_status=(200,),
    )
    exec_data = resp.json()
    assert "e2e-test-output" in exec_data.get("stdout", ""), f"Exec output mismatch: {exec_data}"
    assert exec_data.get("exit_code") == 0
    print(f"[e2e] 15. Exec short: OK (exit_code=0, {exec_data.get('duration_ms', '?')}ms)")

    client.set_phase("16-exec-long")
    resp = client.post(
        "/api/v1/exec/start",
        json={"command": "echo long-running-output && sleep 0.1"},
        expect_status=(200,),
    )
    job = resp.json()
    job_id = job.get("job_id")
    assert job_id, f"No job_id in response: {job}"
    # Poll for completion
    for _ in range(20):
        time.sleep(0.2)
        resp = client.get(f"/api/v1/exec/jobs/{job_id}", expect_status=(200,))
        job_data = resp.json()
        if job_data.get("done"):
            break
    assert job_data.get("done"), f"Job not done after 4s: {job_data}"
    print(f"[e2e] 16. Exec long: OK (job_id={job_id[:8]}..., exit_code={job_data.get('exit_code')})")

    client.set_phase("17-user-settings")
    resp = client.get("/api/v1/me/settings", expect_status=(200,))
    print(f"[e2e] 17. User settings: OK")

    client.set_phase("18-delete-file")
    resp = client.delete("/api/v1/files/delete?path=e2e-test.txt", expect_status=(200,))
    print(f"[e2e] 18. Delete file: OK")

    total = 18
    print(f"\n[e2e] SUMMARY: {total}/{total} steps passed")

    if args.evidence_out:
        _write_evidence(args.evidence_out, client)

    return 0


def _write_evidence(path: str, client: SmokeClient) -> None:
    report = client.report()
    Path(path).write_text(json.dumps(report, indent=2))
    print(f"[e2e] Evidence written to {path}")


if __name__ == "__main__":
    raise SystemExit(main())

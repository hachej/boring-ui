#!/usr/bin/env python3
"""Generic child app smoke test — validates a deployed boring-ui child app.

Tests: health, capabilities, neon auth, workspace creation, file operations,
and optionally app-specific features.

Usage:
    # Basic health check (no auth)
    python tests/smoke/smoke_child_app.py --base-url https://hachej--boring-doctor-core-web.modal.run

    # Full smoke with auth
    python tests/smoke/smoke_child_app.py \
        --base-url https://hachej--boring-doctor-core-web.modal.run \
        --app-name boring-doctor \
        --auth-mode neon --skip-signup --email ... --password ...

    # Expect specific features/routers
    python tests/smoke/smoke_child_app.py \
        --base-url https://... --app-name boring-content \
        --expect-features files,git \
        --expect-routers files,git,pty
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", required=True,
                        help="Deployed child app URL")
    parser.add_argument("--app-name", default="child-app",
                        help="App name for reporting (e.g., boring-doctor)")
    parser.add_argument("--auth-mode", choices=["neon", "supabase", "dev", "none"], default="neon")
    parser.add_argument("--neon-auth-url", default="")
    parser.add_argument("--skip-signup", action="store_true")
    parser.add_argument("--email")
    parser.add_argument("--password")
    parser.add_argument("--recipient")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--expect-features", default="",
                        help="Comma-separated features that must be present")
    parser.add_argument("--expect-routers", default="",
                        help="Comma-separated routers that must be present")
    parser.add_argument("--expect-auth", default="",
                        help="Expected auth provider (neon, local, none)")
    parser.add_argument("--skip-workspace", action="store_true",
                        help="Skip workspace + file tests (health + capabilities only)")
    parser.add_argument("--skip-files", action="store_true",
                        help="Skip file operation tests")
    parser.add_argument("--evidence-out", default="")
    args = parser.parse_args()

    app = args.app_name
    client = SmokeClient(args.base_url)
    ts = int(time.time())

    print(f"\n{'='*60}")
    print(f"  CHILD APP SMOKE: {app}")
    print(f"  URL: {args.base_url}")
    print(f"{'='*60}\n")

    # ── Phase 1: Health ──────────────────────────────────────
    client.set_phase("health")
    resp = client.get("/health", expect_status=(200,))
    if resp.status_code == 200:
        print(f"[{app}] /health OK")
    else:
        print(f"[{app}] /health FAIL: {resp.status_code}")
        # If health fails, bail early
        report = client.report()
        print(json.dumps(report, indent=2))
        return 1

    # ── Phase 2: Config ──────────────────────────────────────
    client.set_phase("config")
    resp = client.get("/api/config", expect_status=(200,))
    if resp.status_code == 200:
        cfg = resp.json()
        print(f"[{app}] /api/config: mode={cfg.get('mode', '?')}")
    else:
        print(f"[{app}] /api/config FAIL: {resp.status_code}")

    # ── Phase 3: Capabilities ────────────────────────────────
    client.set_phase("capabilities")
    resp = client.get("/api/capabilities", expect_status=(200,))
    if resp.status_code != 200:
        print(f"[{app}] /api/capabilities FAIL: {resp.status_code}")
        report = client.report()
        print(json.dumps(report, indent=2))
        return 1

    caps = resp.json()
    features = caps.get("features", {})
    routers = caps.get("routers", [])
    auth = caps.get("auth", {})

    # Extract router names (may be strings or dicts with 'name')
    router_names = set()
    for r in routers:
        if isinstance(r, str):
            router_names.add(r)
        elif isinstance(r, dict):
            router_names.add(r.get("name", ""))

    enabled_features = [k for k, v in features.items() if v]
    print(f"[{app}] Features: {enabled_features}")
    print(f"[{app}] Routers: {sorted(router_names)}")
    print(f"[{app}] Auth: {auth.get('provider', 'none')}")

    # ── Phase 4: Validate expected auth ──────────────────────
    if args.expect_auth:
        client.set_phase("expect-auth")
        actual = auth.get("provider", "none")
        ok = actual == args.expect_auth
        client._record("GET", f"/api/capabilities [auth={args.expect_auth}]",
                       resp, ok, 0.0, f"expected={args.expect_auth}, got={actual}")
        if ok:
            print(f"[{app}] Auth provider OK: {actual}")
        else:
            print(f"[{app}] FAIL: expected auth={args.expect_auth}, got={actual}")

    # ── Phase 5: Validate expected features ──────────────────
    if args.expect_features:
        for feat in (f.strip() for f in args.expect_features.split(",") if f.strip()):
            client.set_phase(f"expect-feature-{feat}")
            present = bool(features.get(feat))
            client._record("GET", f"/api/capabilities [feature:{feat}]",
                           resp, present, 0.0, f"present={present}")
            status = "OK" if present else "FAIL"
            print(f"[{app}] Feature '{feat}': {status}")

    # ── Phase 6: Validate expected routers ───────────────────
    if args.expect_routers:
        for router in (r.strip() for r in args.expect_routers.split(",") if r.strip()):
            client.set_phase(f"expect-router-{router}")
            present = router in router_names
            client._record("GET", f"/api/capabilities [router:{router}]",
                           resp, present, 0.0, f"present={present}")
            status = "OK" if present else "FAIL"
            print(f"[{app}] Router '{router}': {status}")

    # ── Phase 7: Auth (if not --skip-workspace or --auth-mode none) ──
    if args.auth_mode == "none" or args.skip_workspace:
        print(f"[{app}] Skipping auth + workspace tests")
    else:
        ensure_session(
            client,
            auth_mode=args.auth_mode,
            base_url=args.base_url,
            neon_auth_url=args.neon_auth_url or auth.get("neonAuthUrl", ""),
            email=args.email,
            password=args.password,
            recipient=args.recipient,
            skip_signup=args.skip_signup,
            timeout_seconds=args.timeout,
        )

        # ── Phase 8: Create workspace ────────────────────────
        client.set_phase("create-workspace")
        ws_data = create_workspace(client, name=f"smoke-{app}-{ts}")
        ws = ws_data.get("workspace") or ws_data
        workspace_id = ws.get("workspace_id") or ws.get("id")
        if not workspace_id:
            raise RuntimeError(f"No workspace_id: {ws_data}")
        print(f"[{app}] Workspace created: {workspace_id}")

        # Switch to workspace scope
        ws_base = f"{args.base_url.rstrip('/')}/w/{workspace_id}"
        client.switch_base(ws_base)

        # ── Phase 9: Workspace capabilities ──────────────────
        client.set_phase("workspace-capabilities")
        resp = client.get("/api/capabilities", expect_status=(200,))
        if resp.status_code == 200:
            ws_caps = resp.json()
            ws_features = ws_caps.get("features", {})
            print(f"[{app}] Workspace features: {[k for k, v in ws_features.items() if v]}")

        # ── Phase 10: File operations (if files feature enabled) ──
        has_files = features.get("files", False)
        if has_files and not args.skip_files:
            # File tree
            client.set_phase("file-tree")
            resp = client.get("/api/v1/files/list", params={"path": "."}, expect_status=(200,))
            if resp.status_code == 200:
                try:
                    tree = resp.json()
                    entries = tree.get("entries", tree.get("children", []))
                    print(f"[{app}] File tree: {len(entries)} entries")
                except Exception:
                    print(f"[{app}] File tree: non-JSON response ({len(resp.content)} bytes)")
            else:
                print(f"[{app}] File tree: {resp.status_code}")

            # Create file (PUT with path as query param, content in body)
            client.set_phase("file-create")
            test_path = f"smoke-{app}-{ts}.txt"
            test_content = f"Smoke test for {app} at {ts}"
            resp = client.put(
                "/api/v1/files/write",
                params={"path": test_path},
                json={"content": test_content},
                expect_status=(200,),
            )
            if resp.status_code == 200:
                print(f"[{app}] File created: {test_path}")
            else:
                print(f"[{app}] File create FAIL: {resp.status_code}")

            # Read file back
            client.set_phase("file-read")
            resp = client.get(
                "/api/v1/files/read",
                params={"path": test_path},
                expect_status=(200,),
            )
            if resp.status_code == 200:
                try:
                    data = resp.json()
                    content = data.get("content", "")
                except Exception:
                    content = resp.text
                ok = test_content in content
                if ok:
                    print(f"[{app}] File read-back OK")
                else:
                    print(f"[{app}] File read-back content mismatch")
                    client._record("GET", "/api/v1/files/read [content]",
                                   resp, False, 0.0, "content mismatch")
            else:
                print(f"[{app}] File read FAIL: {resp.status_code}")

            # Delete file (DELETE with path as query param)
            client.set_phase("file-delete")
            resp = client.delete(
                "/api/v1/files/delete",
                params={"path": test_path},
                expect_status=(200,),
            )
            if resp.status_code == 200:
                print(f"[{app}] File deleted: {test_path}")
            else:
                print(f"[{app}] File delete FAIL: {resp.status_code}")
        elif not has_files:
            print(f"[{app}] Files feature not enabled, skipping file ops")

    # ── Report ───────────────────────────────────────────────
    report = client.report()
    if args.evidence_out:
        client.write_report(args.evidence_out, extra={
            "suite": f"child-app-{app}",
            "app_name": app,
            "features": enabled_features,
            "routers": sorted(router_names),
            "auth_provider": auth.get("provider", "none"),
        })

    print(json.dumps(report, indent=2))

    if report["ok"]:
        print(f"\nSMOKE {app.upper()}: ALL {report['total']} STEPS PASSED")
        return 0
    print(f"\nSMOKE {app.upper()}: {report['failed']}/{report['total']} STEPS FAILED", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

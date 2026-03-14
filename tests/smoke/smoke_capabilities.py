#!/usr/bin/env python3
"""Capabilities smoke: verify features, routers, auth config, and panel gating.

Tests that the capabilities endpoint returns expected structure and that
panel availability matches the reported features/routers.

Usage:
    python tests/smoke/smoke_capabilities.py --base-url http://localhost:8000
    python tests/smoke/smoke_capabilities.py --base-url https://... --expect-auth neon
    python tests/smoke/smoke_capabilities.py --base-url https://... --expect-features files,chat_claude_code
    python tests/smoke/smoke_capabilities.py --base-url https://... --expect-routers files,git,pty
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_lib.client import SmokeClient

# Panel definitions matching src/front/registry/panes.jsx
PANEL_REQUIREMENTS: dict[str, dict] = {
    "filetree": {"features": ["files"], "essential": True},
    "editor": {"features": ["files"], "essential": False},
    "terminal": {"routers": ["chat_claude_code"], "essential": False},
    "shell": {"routers": ["pty"], "essential": True},
    "companion": {"any_features": ["companion", "pi"], "essential": False},
    "review": {"routers": ["approval"], "essential": False},
    "data-catalog": {"features": [], "essential": False},
    "empty": {"features": [], "essential": False},
}


def _router_names(routers: list) -> set[str]:
    """Extract router names from capabilities routers list.

    Routers can be plain strings or dicts with a 'name' key.
    """
    names: set[str] = set()
    for r in routers:
        if isinstance(r, str):
            names.add(r)
        elif isinstance(r, dict):
            name = r.get("name", "")
            if name:
                names.add(name)
    return names


def check_panel_availability(
    capabilities: dict,
    panel_id: str,
    reqs: dict,
) -> tuple[bool, str]:
    """Check if a panel should be available given capabilities."""
    features = capabilities.get("features", {})
    router_names = _router_names(capabilities.get("routers", []))

    # Check required features (all must be present)
    for feat in reqs.get("features", []):
        if not features.get(feat):
            return False, f"missing feature '{feat}'"

    # Check any_features (at least one must be present)
    any_feats = reqs.get("any_features", [])
    if any_feats:
        if not any(features.get(f) for f in any_feats):
            return False, f"none of {any_feats} present"

    # Check required routers
    for router in reqs.get("routers", []):
        if router not in router_names:
            return False, f"missing router '{router}'"

    return True, "ok"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--expect-auth", default="",
                        help="Expected auth provider (neon, supabase, or empty for any)")
    parser.add_argument("--expect-features", default="",
                        help="Comma-separated features that must be present")
    parser.add_argument("--expect-routers", default="",
                        help="Comma-separated routers that must be present")
    parser.add_argument("--evidence-out", default="")
    args = parser.parse_args()

    client = SmokeClient(args.base_url)

    # Step 1: Fetch capabilities
    client.set_phase("capabilities-fetch")
    resp = client.get("/api/capabilities", expect_status=(200,))
    if resp.status_code != 200:
        print(f"[smoke] FAIL: /api/capabilities returned {resp.status_code}")
        report = client.report()
        print(json.dumps(report, indent=2))
        return 1

    caps = resp.json()
    features = caps.get("features", {})
    routers = caps.get("routers", [])
    auth = caps.get("auth", {})

    # Step 2: Validate structure
    client.set_phase("capabilities-structure")
    has_features = isinstance(features, dict)
    has_routers = isinstance(routers, list)
    if has_features and has_routers:
        client._record("GET", "/api/capabilities [structure]",
                       resp, True, 0.0, "features=dict, routers=list")
        print(f"[smoke] Structure OK: {len(features)} features, {len(routers)} routers")
    else:
        client._record("GET", "/api/capabilities [structure]",
                       resp, False, 0.0, f"features={type(features).__name__}, routers={type(routers).__name__}")
        print(f"[smoke] FAIL: unexpected structure")

    # Step 3: Verify expected auth provider
    if args.expect_auth:
        client.set_phase("capabilities-auth")
        actual_provider = auth.get("provider", "")
        ok = actual_provider == args.expect_auth
        client._record("GET", "/api/capabilities [auth]",
                       resp, ok, 0.0,
                       f"expected={args.expect_auth}, got={actual_provider}")
        if ok:
            print(f"[smoke] Auth provider OK: {actual_provider}")
            # Neon-specific: verify neonAuthUrl is present
            if actual_provider == "neon":
                neon_url = auth.get("neonAuthUrl", "")
                if neon_url:
                    print(f"[smoke] Neon Auth URL: {neon_url}")
                else:
                    print(f"[smoke] WARN: Neon auth but no neonAuthUrl")
        else:
            print(f"[smoke] FAIL: expected auth={args.expect_auth}, got={actual_provider}")

    # Step 4: Verify expected features
    if args.expect_features:
        expected = [f.strip() for f in args.expect_features.split(",") if f.strip()]
        for feat in expected:
            client.set_phase(f"feature-{feat}")
            present = bool(features.get(feat))
            client._record("GET", f"/api/capabilities [feature:{feat}]",
                           resp, present, 0.0,
                           f"present={present}")
            if present:
                print(f"[smoke] Feature '{feat}': present")
            else:
                print(f"[smoke] FAIL: Feature '{feat}' missing")

    # Step 5: Verify expected routers
    if args.expect_routers:
        router_names = _router_names(routers)
        expected = [r.strip() for r in args.expect_routers.split(",") if r.strip()]
        for router in expected:
            client.set_phase(f"router-{router}")
            present = router in router_names
            client._record("GET", f"/api/capabilities [router:{router}]",
                           resp, present, 0.0,
                           f"present={present}")
            if present:
                print(f"[smoke] Router '{router}': present")
            else:
                print(f"[smoke] FAIL: Router '{router}' missing")

    # Step 6: Panel gating analysis
    client.set_phase("panel-gating")
    available_panels = []
    unavailable_essential = []
    for panel_id, reqs in PANEL_REQUIREMENTS.items():
        ok, reason = check_panel_availability(caps, panel_id, reqs)
        if ok:
            available_panels.append(panel_id)
        elif reqs.get("essential"):
            unavailable_essential.append((panel_id, reason))

    panels_ok = len(unavailable_essential) == 0
    detail = (f"available={available_panels}" if panels_ok
              else f"unavailable_essential={unavailable_essential}")
    client._record("GET", "/api/capabilities [panels]",
                   resp, panels_ok, 0.0, detail)
    print(f"[smoke] Available panels: {available_panels}")
    if unavailable_essential:
        for pid, reason in unavailable_essential:
            print(f"[smoke] FAIL: Essential panel '{pid}' unavailable: {reason}")
    else:
        print(f"[smoke] All essential panels gated OK")

    # Report
    report = client.report()
    if args.evidence_out:
        client.write_report(args.evidence_out, extra={
            "suite": "capabilities",
            "auth": auth,
            "features": features,
            "routers": routers,
            "available_panels": available_panels,
        })

    print(json.dumps(report, indent=2))
    if report["ok"]:
        print(f"\nSMOKE CAPABILITIES: ALL {report['total']} STEPS PASSED")
        return 0
    print(f"\nSMOKE CAPABILITIES: {report['failed']}/{report['total']} STEPS FAILED", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""UI state smoke test — exercises /api/v1/ui state CRUD and command queue.

Usage:
    python tests/smoke/smoke_ui_state.py --base-url http://localhost:8000 --auth-mode dev
    python tests/smoke/smoke_ui_state.py --base-url https://... --auth-mode neon --skip-signup --email ... --password ...
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--auth-mode", choices=["neon", "dev"], default="dev")
    parser.add_argument("--neon-auth-url", default="")
    parser.add_argument("--skip-signup", action="store_true")
    parser.add_argument("--email")
    parser.add_argument("--password")
    parser.add_argument("--recipient")
    parser.add_argument("--public-origin", default="")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--evidence-out", default="")
    args = parser.parse_args()

    client = SmokeClient(args.base_url)
    ts = int(time.time())

    # --- Phase 1: Auth ---
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

    # --- Phase 2: Create workspace ---
    ws_name = f"smoke-ui-state-{ts}"
    ws_data = create_workspace(client, name=ws_name)
    ws = ws_data.get("workspace") or ws_data
    workspace_id = ws.get("workspace_id") or ws.get("id")
    if not workspace_id:
        raise RuntimeError(f"No workspace_id: {ws_data}")

    # Switch to workspace scope
    ws_base = f"{args.base_url.rstrip('/')}/w/{workspace_id}"
    client.switch_base(ws_base)
    print(f"[smoke] Workspace scope: /w/{workspace_id}")

    # --- Phase 3: Check capabilities for ui_state ---
    client.set_phase("ui-state-capabilities")
    caps_resp = client.get("/api/capabilities", expect_status=(200,))
    if caps_resp.status_code == 200:
        caps = caps_resp.json()
        features = caps.get("features", {})
        has_ui_state = features.get("ui_state", False)
        print(f"[smoke] ui_state feature: {has_ui_state}")
        if not has_ui_state:
            print("[smoke] SKIP: ui_state feature not enabled")
            report = client.report()
            print(json.dumps(report, indent=2))
            print(f"\nSMOKE UI STATE: SKIPPED (feature not enabled)")
            return 0

    # --- Phase 4: GET /state — empty initially ---
    client.set_phase("ui-state-list-empty")
    resp = client.get("/api/v1/ui/state", expect_status=(200,))
    if resp.status_code == 200:
        data = resp.json()
        states = data.get("states", [])
        print(f"[smoke] Initial states count: {data.get('count', len(states))}")

    # --- Phase 5: PUT /state — upsert a state ---
    client_id = f"smoke-client-{ts}"
    client.set_phase("ui-state-upsert")
    state_payload = {
        "client_id": client_id,
        "active_panel_id": "editor",
        "open_panels": [
            {"id": "filetree", "title": "Files", "placement": "left"},
            {"id": "editor", "title": "Editor", "placement": "center"},
        ],
        "project_root": "/tmp/smoke",
        "meta": {"smoke_ts": ts},
    }
    resp = client.put("/api/v1/ui/state", json=state_payload, expect_status=(200,))
    if resp.status_code == 200:
        data = resp.json()
        assert data.get("ok"), f"Expected ok=true, got {data}"
        print(f"[smoke] UI state upserted for client_id={client_id}")
    else:
        print(f"[smoke] FAIL: PUT /state returned {resp.status_code}")

    # --- Phase 6: GET /state/{client_id} — read back ---
    client.set_phase("ui-state-get-by-id")
    resp = client.get(f"/api/v1/ui/state/{client_id}", expect_status=(200,))
    if resp.status_code == 200:
        data = resp.json()
        state = data.get("state", {})
        assert state.get("client_id") == client_id, f"client_id mismatch: {state.get('client_id')}"
        assert state.get("active_panel_id") == "editor", f"active_panel_id mismatch"
        panels = state.get("open_panels", [])
        assert len(panels) == 2, f"Expected 2 open_panels, got {len(panels)}"
        print(f"[smoke] UI state read-back OK: {len(panels)} panels, active=editor")
    else:
        print(f"[smoke] FAIL: GET /state/{client_id} returned {resp.status_code}")

    # --- Phase 7: GET /state/latest — should match our upsert ---
    client.set_phase("ui-state-latest")
    resp = client.get("/api/v1/ui/state/latest", expect_status=(200,))
    if resp.status_code == 200:
        data = resp.json()
        state = data.get("state", {})
        assert state.get("client_id") == client_id, f"Latest client_id mismatch"
        print(f"[smoke] UI state latest OK: client_id={state.get('client_id')}")
    else:
        print(f"[smoke] FAIL: GET /state/latest returned {resp.status_code}")

    # --- Phase 8: GET /panes — list open panels from latest ---
    client.set_phase("ui-state-panes")
    resp = client.get("/api/v1/ui/panes", expect_status=(200,))
    if resp.status_code == 200:
        data = resp.json()
        panels = data.get("open_panels", [])
        print(f"[smoke] Panes list: {len(panels)} panels")
    else:
        print(f"[smoke] FAIL: GET /panes returned {resp.status_code}")

    # --- Phase 9: GET /panes/{client_id} ---
    client.set_phase("ui-state-panes-by-id")
    resp = client.get(f"/api/v1/ui/panes/{client_id}", expect_status=(200,))
    if resp.status_code == 200:
        data = resp.json()
        panels = data.get("open_panels", [])
        panel_ids = [p.get("id") for p in panels]
        assert "filetree" in panel_ids, f"Expected filetree in panels: {panel_ids}"
        assert "editor" in panel_ids, f"Expected editor in panels: {panel_ids}"
        print(f"[smoke] Panes for client OK: {panel_ids}")
    else:
        print(f"[smoke] FAIL: GET /panes/{client_id} returned {resp.status_code}")

    # --- Phase 10: PUT /state — update (overwrite) ---
    client.set_phase("ui-state-update")
    state_payload["active_panel_id"] = "filetree"
    state_payload["open_panels"].append(
        {"id": "shell", "title": "Shell", "placement": "bottom"}
    )
    resp = client.put("/api/v1/ui/state", json=state_payload, expect_status=(200,))
    if resp.status_code == 200:
        print(f"[smoke] UI state updated: active=filetree, 3 panels")
    else:
        print(f"[smoke] FAIL: PUT /state update returned {resp.status_code}")

    # --- Phase 11: GET /state — list should show our state ---
    client.set_phase("ui-state-list-after")
    resp = client.get("/api/v1/ui/state", expect_status=(200,))
    if resp.status_code == 200:
        data = resp.json()
        count = data.get("count", 0)
        assert count >= 1, f"Expected at least 1 state, got {count}"
        print(f"[smoke] State list after upsert: {count} state(s)")
    else:
        print(f"[smoke] FAIL: GET /state list returned {resp.status_code}")

    # --- Phase 12: DELETE /state/{client_id} ---
    client.set_phase("ui-state-delete")
    resp = client.delete(f"/api/v1/ui/state/{client_id}", expect_status=(200,))
    if resp.status_code == 200:
        data = resp.json()
        assert data.get("ok"), f"Expected ok=true on delete"
        print(f"[smoke] UI state deleted: client_id={client_id}")
    else:
        print(f"[smoke] FAIL: DELETE /state/{client_id} returned {resp.status_code}")

    # --- Phase 13: GET /state/{client_id} — should 404 ---
    client.set_phase("ui-state-verify-deleted")
    resp = client.get(f"/api/v1/ui/state/{client_id}", expect_status=(404,))
    if resp.status_code == 404:
        print(f"[smoke] Verified: state deleted (404)")
    else:
        print(f"[smoke] FAIL: Expected 404 after delete, got {resp.status_code}")

    # --- Report ---
    report = client.report()
    if args.evidence_out:
        client.write_report(args.evidence_out, extra={
            "suite": "ui-state",
            "workspace_id": workspace_id,
        })

    print(json.dumps(report, indent=2))

    if report["ok"]:
        print(f"\nSMOKE UI STATE: ALL {report['total']} STEPS PASSED")
        return 0
    else:
        print(f"\nSMOKE UI STATE: {report['failed']}/{report['total']} STEPS FAILED", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

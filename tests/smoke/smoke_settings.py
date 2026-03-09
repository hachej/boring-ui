#!/usr/bin/env python3
"""Settings smoke test — exercises user + workspace settings against local backend.

Runs without Supabase: uses dev-login (auth_dev_login_enabled=True).

Usage:
    python tests/smoke/smoke_settings.py [--base-url http://localhost:8000]
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_lib.client import SmokeClient
from smoke_lib.settings import (
    get_user_settings,
    update_user_settings,
    verify_user_settings,
    get_workspace_settings,
    update_workspace_settings,
    rename_workspace,
    verify_workspace_name,
)
from smoke_lib.client import StepResult
from smoke_lib.workspace import list_workspaces


def dev_login(client: SmokeClient, *, user_id: str, email: str) -> None:
    """Dev-mode login (no Supabase required)."""
    client.set_phase("dev-login")
    print(f"[smoke] Dev login as {email}...")
    resp = client.get(
        f"/auth/login?user_id={user_id}&email={email}&redirect_uri=/",
        expect_status=(200, 302),
    )
    if resp.status_code not in (200, 302):
        raise RuntimeError(f"Dev login failed: {resp.status_code}")
    print("[smoke] Logged in OK")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args()

    client = SmokeClient(args.base_url)
    ts = int(time.time())

    # --- Phase 1: Dev login ---
    dev_login(client, user_id=f"smoke-settings-{ts}", email=f"smoke-{ts}@test.local")

    # --- Phase 2: User settings — read initial (empty) ---
    initial = get_user_settings(client)
    assert isinstance(initial.get("settings"), dict), "Expected settings dict"

    # --- Phase 3: User settings — update display name ---
    update_user_settings(client, display_name=f"Smoke User {ts}")

    # --- Phase 4: User settings — verify read-back ---
    verify_user_settings(client, expected_display_name=f"Smoke User {ts}")

    # --- Phase 5: Create workspace ---
    # Local mode returns 200, edge mode returns 201
    ws_name = f"smoke-settings-ws-{ts}"
    client.set_phase("create-workspace")
    print(f"[smoke] Creating workspace '{ws_name}'...")
    resp = client.post("/api/v1/workspaces", json={"name": ws_name}, expect_status=(200, 201))
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Create workspace failed: {resp.status_code} {resp.text[:300]}")
    ws_data = resp.json()
    ws = ws_data.get("workspace") or ws_data
    workspace_id = ws.get("workspace_id") or ws.get("id")
    if not workspace_id:
        raise RuntimeError(f"No workspace_id: {ws_data}")
    print(f"[smoke] Workspace created: {workspace_id}")

    # --- Phase 6: List workspaces — verify creation ---
    list_workspaces(client, expect_id=workspace_id)

    # --- Phase 7: Workspace settings — read initial (empty) ---
    ws_settings = get_workspace_settings(client, workspace_id)
    assert isinstance(ws_settings.get("settings"), dict), "Expected settings dict"

    # --- Phase 8: Workspace settings — update ---
    update_workspace_settings(client, workspace_id, settings={
        "theme": "dark",
        "smoke_ts": str(ts),
    })

    # --- Phase 9: Workspace settings — verify read-back ---
    ws_readback = get_workspace_settings(client, workspace_id)
    settings = ws_readback.get("settings", {})
    assert settings.get("theme") == "dark", f"Expected theme=dark, got {settings.get('theme')}"
    assert settings.get("smoke_ts") == str(ts), f"Expected smoke_ts={ts}"
    print("[smoke] Workspace settings verification OK")

    # --- Phase 10: Workspace settings — overwrite ---
    update_workspace_settings(client, workspace_id, settings={"theme": "light"})
    ws_readback2 = get_workspace_settings(client, workspace_id)
    assert ws_readback2.get("settings", {}).get("theme") == "light"
    print("[smoke] Workspace settings overwrite OK")

    # --- Phase 11: Workspace switch — create second workspace ---
    ws_name_b = f"smoke-settings-ws-b-{ts}"
    client.set_phase("switch-create-ws-b")
    print(f"[smoke] Creating second workspace '{ws_name_b}'...")
    resp_b = client.post("/api/v1/workspaces", json={"name": ws_name_b}, expect_status=(200, 201))
    if resp_b.status_code not in (200, 201):
        raise RuntimeError(f"Create workspace B failed: {resp_b.status_code} {resp_b.text[:300]}")
    ws_data_b = resp_b.json()
    ws_b = ws_data_b.get("workspace") or ws_data_b
    workspace_id_b = ws_b.get("workspace_id") or ws_b.get("id")
    if not workspace_id_b:
        raise RuntimeError(f"No workspace_id_b: {ws_data_b}")
    print(f"[smoke] Second workspace created: {workspace_id_b}")

    # --- Phase 12: Workspace switch — list shows both ---
    client.set_phase("switch-list-both")
    resp_list = client.get("/api/v1/workspaces", expect_status=(200,))
    if resp_list.status_code != 200:
        raise RuntimeError(f"List workspaces failed: {resp_list.status_code}")
    all_ws = resp_list.json().get("workspaces", [])
    all_ids = {(w.get("workspace_id") or w.get("id") or "") for w in all_ws}
    assert workspace_id in all_ids, f"First workspace {workspace_id} not in list"
    assert workspace_id_b in all_ids, f"Second workspace {workspace_id_b} not in list"
    print(f"[smoke] Both workspaces present in list ({len(all_ws)} total)")

    # --- Phase 13: Workspace switch — write settings to second workspace ---
    update_workspace_settings(client, workspace_id_b, settings={
        "theme": "dark",
        "project": "beta",
    })

    # --- Phase 14: Workspace switch — verify settings isolation ---
    client.set_phase("switch-isolation-verify")
    print("[smoke] Verifying workspace settings isolation after switch...")
    ws_a_settings = get_workspace_settings(client, workspace_id)
    ws_b_settings = get_workspace_settings(client, workspace_id_b)
    assert ws_a_settings.get("settings", {}).get("theme") == "light", \
        f"WS-A theme changed unexpectedly: {ws_a_settings.get('settings', {}).get('theme')}"
    assert ws_b_settings.get("settings", {}).get("theme") == "dark", \
        f"WS-B theme mismatch: {ws_b_settings.get('settings', {}).get('theme')}"
    assert ws_b_settings.get("settings", {}).get("project") == "beta", \
        f"WS-B project mismatch: {ws_b_settings.get('settings', {}).get('project')}"
    print("[smoke] Workspace switch settings isolation OK")

    # --- Report ---
    report = client.report()
    print(json.dumps(report, indent=2))

    if report["ok"]:
        print(f"\nSMOKE SETTINGS: ALL {report['total']} STEPS PASSED")
        return 0
    else:
        print(f"\nSMOKE SETTINGS: {report['failed']}/{report['total']} STEPS FAILED", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

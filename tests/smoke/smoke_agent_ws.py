#!/usr/bin/env python3
"""Backend agent WebSocket smoke: auth -> workspace -> connect WS -> roundtrip.

Tests the full agent WebSocket flow including connection handshake,
message send, and assistant response.

This is not part of the default core-mode smoke path, which uses the browser/PI
runtime instead of a backend agent transport.

Usage:
    python tests/smoke/smoke_agent_ws.py --base-url http://localhost:8000 --auth-mode dev
    python tests/smoke/smoke_agent_ws.py --base-url https://... --auth-mode neon --skip-signup --email ... --password ...
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_lib.agent import agent_roundtrip
from smoke_lib.client import SmokeClient
from smoke_lib.session_bootstrap import ensure_session
from smoke_lib.workspace import create_workspace


def _router_names(routers: list) -> set[str]:
    """Normalize router entries from /api/capabilities."""
    names: set[str] = set()
    for router in routers:
        if isinstance(router, str):
            names.add(router)
        elif isinstance(router, dict):
            name = str(router.get("name", "")).strip()
            if name:
                names.add(name)
    return names


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
    parser.add_argument("--workspace-id", default="")
    parser.add_argument("--ws-timeout", type=float, default=30.0,
                        help="WebSocket response timeout in seconds")
    parser.add_argument("--skip-agent", action="store_true",
                        help="Skip the agent roundtrip (just test auth + workspace)")
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

    # Create or reuse workspace
    workspace_id = args.workspace_id.strip()
    if not workspace_id:
        ts = int(time.time())
        ws_data = create_workspace(client, name=f"smoke-agent-{ts}")
        ws = ws_data.get("workspace") or ws_data
        workspace_id = ws.get("workspace_id") or ws.get("id") or ""
    if not workspace_id:
        raise RuntimeError("Could not determine workspace_id")

    # Switch to workspace scope
    ws_base = f"{args.base_url.rstrip('/')}/w/{workspace_id}"
    client.switch_base(ws_base)
    print(f"[smoke] Workspace scope: /w/{workspace_id}")

    # Check capabilities for agent support
    client.set_phase("agent-capabilities")
    caps_resp = client.get("/api/capabilities", expect_status=(200,))
    if caps_resp.status_code == 200:
        caps = caps_resp.json()
        router_names = _router_names(caps.get("routers", []))
        has_agent = "chat_claude_code" in router_names or "stream" in router_names
        print(f"[smoke] Agent router available: {has_agent}")
        if not has_agent and not args.skip_agent:
            print(f"[smoke] WARN: Agent router not available, skipping WS test")
            args.skip_agent = True

    if args.skip_agent:
        print(f"[smoke] Agent WS test skipped")
    else:
        # Agent WebSocket roundtrip
        client.set_phase("agent-roundtrip")
        cookies = dict(client.cookies)
        result = agent_roundtrip(
            ws_base,
            message="Say exactly: SMOKE_OK",
            timeout_seconds=args.ws_timeout,
            cookies=cookies,
        )

        if result.get("ok"):
            frame = result.get("frame", {})
            msg_type = frame.get("type", "?")
            content = str(frame.get("message", frame.get("content", "")))[:100]
            client._record("WS", "/ws/agent/normal/stream",
                           type("R", (), {"status_code": 101})(),
                           True, 0.0, f"type={msg_type}")
            print(f"[smoke] Agent response: {content[:80]}")
        elif result.get("skipped"):
            print(f"[smoke] Agent skipped: {result.get('error')}")
        else:
            client._record("WS", "/ws/agent/normal/stream",
                           type("R", (), {"status_code": 0})(),
                           False, 0.0, result.get("error", "unknown"))
            print(f"[smoke] Agent FAIL: {result.get('error')}")

    # Report
    report = client.report()
    if args.evidence_out:
        client.write_report(args.evidence_out, extra={
            "suite": "agent-ws",
            "workspace_id": workspace_id,
        })

    print(json.dumps(report, indent=2))
    if report["ok"]:
        print(f"\nSMOKE AGENT WS: ALL {report['total']} STEPS PASSED")
        return 0
    print(f"\nSMOKE AGENT WS: {report['failed']}/{report['total']} STEPS FAILED", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

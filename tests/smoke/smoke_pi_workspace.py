#!/usr/bin/env python3
"""Smoke test: PI agent and file API workspace-root alignment.

Verifies that files created via the file API are visible to the PI agent
(exec_bash), and files created by the PI agent appear via the file API.
Also checks structured tool events in the SSE stream.

Usage:
    # Against local backend-agent
    python tests/smoke/smoke_pi_workspace.py --base-url http://localhost:8001

    # Against deployed backend-agent (requires auth)
    python tests/smoke/smoke_pi_workspace.py --base-url https://boring-ui-backend-agent.fly.dev --skip-signup --email user@test.com --password Pass123
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_lib.auth import neon_signin_flow
from smoke_lib.client import SmokeClient

results = []


def step(phase, ok, detail=""):
    results.append({"phase": phase, "ok": ok, "detail": detail})
    status = "OK" if ok else "FAIL"
    print(f"[smoke] {phase}: {status} {detail}")
    if not ok:
        print(f"  FAILED: {detail}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8001")
    parser.add_argument("--email", default="")
    parser.add_argument("--password", default="")
    args = parser.parse_args()

    client = SmokeClient(args.base_url)
    tag = str(int(time.time()))

    # --- Auth (if needed) ---
    health = client.get("/health")
    health_data = health.json()
    needs_auth = health_data.get("features", {}).get("control_plane", False)

    if needs_auth:
        if not args.email or not args.password:
            print("[smoke] ERROR: --email and --password required for authenticated endpoints")
            return 1
        neon_auth_url = ""
        try:
            caps = client.get("/api/capabilities").json()
            neon_auth_url = caps.get("auth", {}).get("neonAuthUrl", "")
        except Exception:
            pass
        if not neon_auth_url:
            print("[smoke] WARNING: could not detect Neon Auth URL, trying sign-in anyway")
            neon_auth_url = "https://ep-solitary-darkness-ag6rrvrn.neonauth.c-2.eu-central-1.aws.neon.tech/neondb/auth"
        neon_signin_flow(client, email=args.email, password=args.password,
                         neon_auth_url=neon_auth_url)
        step("auth", True)
    else:
        step("auth", True, "no auth required (local mode)")

    # --- Step 1: Health check shows PI enabled ---
    print("\n" + "=" * 60)
    print("  1. Health Check — PI enabled")
    print("=" * 60)
    pi_enabled = health_data.get("features", {}).get("pi", False)
    step("pi-enabled", pi_enabled, f"pi={pi_enabled}")
    if not pi_enabled:
        print("PI not enabled, cannot continue")
        return 1

    # --- Step 2: Create PI session ---
    print("\n" + "=" * 60)
    print("  2. Create PI Session")
    print("=" * 60)
    create_resp = client.post(
        "/api/v1/agent/pi/sessions/create",
        json={},
    )
    create_data = create_resp.json()
    session_id = create_data.get("session", {}).get("id", "")
    step("create-session", bool(session_id), f"session_id={session_id[:12]}...")

    # --- Step 3: Write file via file API ---
    print("\n" + "=" * 60)
    print("  3. Write file via file API")
    print("=" * 60)
    test_content = f"smoke-test-{tag}"
    test_filename = f"smoke-pi-test-{tag}.txt"
    write_resp = client.put(
        f"/api/v1/files/write?path={test_filename}",
        json={"content": test_content},
    )
    write_ok = write_resp.status_code == 200
    step("file-write", write_ok, f"status={write_resp.status_code}")

    # --- Step 4: PI reads the file via exec_bash ---
    print("\n" + "=" * 60)
    print("  4. PI reads file created by file API")
    print("=" * 60)
    stream_resp = client.post(
        f"/api/v1/agent/pi/sessions/{session_id}/stream",
        json={"message": f"run this exact command: cat {test_filename}"},
        timeout=60,
    )
    events = _parse_sse(stream_resp)
    tool_ends = [e for e in events if e.get("event") == "tool_end"]
    pi_saw_file = any(test_content in json.dumps(e.get("data", {})) for e in tool_ends)
    step("pi-reads-file-api-file", pi_saw_file,
         f"tool_ends={len(tool_ends)}, content_match={pi_saw_file}")

    # --- Step 5: Check structured tool events ---
    print("\n" + "=" * 60)
    print("  5. Structured tool events in SSE stream")
    print("=" * 60)
    tool_starts = [e for e in events if e.get("event") == "tool_start"]
    has_tool_start = len(tool_starts) > 0
    has_tool_end = len(tool_ends) > 0
    step("tool-start-event", has_tool_start, f"count={len(tool_starts)}")
    step("tool-end-event", has_tool_end, f"count={len(tool_ends)}")

    if tool_starts:
        ts = tool_starts[0].get("data", {})
        has_tool_fields = all(k in ts for k in ("toolCallId", "toolName", "args"))
        step("tool-start-shape", has_tool_fields, f"fields={list(ts.keys())}")

    if tool_ends:
        te = tool_ends[0].get("data", {})
        has_result_fields = all(k in te for k in ("toolCallId", "toolName", "result"))
        step("tool-end-shape", has_result_fields, f"fields={list(te.keys())}")

    # --- Step 6: PI creates a file, file API reads it ---
    print("\n" + "=" * 60)
    print("  6. PI creates file, file API reads it")
    print("=" * 60)
    pi_filename = f"pi-created-{tag}.txt"
    pi_content = f"created-by-pi-{tag}"
    stream_resp2 = client.post(
        f"/api/v1/agent/pi/sessions/{session_id}/stream",
        json={"message": f"run this exact command: echo -n '{pi_content}' > {pi_filename}"},
        timeout=60,
    )
    events2 = _parse_sse(stream_resp2)
    # Small delay for filesystem sync
    time.sleep(0.5)

    read_resp = client.get(f"/api/v1/files/read?path={pi_filename}")
    if read_resp.status_code == 200:
        read_data = read_resp.json()
        file_content = read_data.get("content", "")
        content_match = pi_content in file_content
        step("file-api-reads-pi-file", content_match,
             f"expected='{pi_content}', got='{file_content[:50]}'")
    else:
        step("file-api-reads-pi-file", False, f"status={read_resp.status_code}")

    # --- Step 7: History preserves structured parts ---
    print("\n" + "=" * 60)
    print("  7. History preserves structured parts")
    print("=" * 60)
    history_resp = client.get(f"/api/v1/agent/pi/sessions/{session_id}/history")
    history_data = history_resp.json()
    messages = history_data.get("messages", [])
    has_parts = any(
        len(msg.get("parts", [])) > 0
        for msg in messages
        if msg.get("role") == "assistant"
    )
    has_tool_use_parts = any(
        any(p.get("type") == "tool_use" for p in msg.get("parts", []))
        for msg in messages
        if msg.get("role") == "assistant"
    )
    step("history-has-parts", has_parts, f"messages={len(messages)}")
    step("history-has-tool-use", has_tool_use_parts)

    # --- Cleanup ---
    print("\n" + "=" * 60)
    print("  8. Cleanup")
    print("=" * 60)
    for fname in [test_filename, pi_filename]:
        client.delete(f"/api/v1/files/delete?path={fname}")
    step("cleanup", True)

    # --- Summary ---
    passed = sum(1 for r in results if r["ok"])
    failed = sum(1 for r in results if not r["ok"])
    print(f"\nSMOKE PI WORKSPACE: {passed} passed, {failed} failed out of {len(results)}")

    if failed > 0:
        print("\nFAILED STEPS:")
        for r in results:
            if not r["ok"]:
                print(f"  - {r['phase']}: {r['detail']}")
        return 1
    return 0


def _parse_sse(response):
    """Parse SSE events from a streaming response."""
    events = []
    text = response.text if hasattr(response, "text") else response.content.decode()
    for chunk in text.split("\n\n"):
        if not chunk.strip():
            continue
        event_type = "message"
        data_lines = []
        for line in chunk.split("\n"):
            if line.startswith("event:"):
                event_type = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].strip())
        if data_lines:
            try:
                data = json.loads("\n".join(data_lines))
            except json.JSONDecodeError:
                data = {"raw": "\n".join(data_lines)}
            events.append({"event": event_type, "data": data})
    return events


if __name__ == "__main__":
    sys.exit(main())

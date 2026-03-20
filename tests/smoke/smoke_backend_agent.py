#!/usr/bin/env python3
"""Backend-agent mode smoke test.

Tests a running boring-ui instance in backend-agent mode.
Usage: python3 tests/smoke/smoke_backend_agent.py --base-url http://localhost:8500

Steps:
  1. Health endpoint returns ok with pi check
  2. Capabilities report backend mode + pi agent
  3. File write + read roundtrip
  4. File list includes written file
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import uuid

import httpx


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8500")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout seconds")
    parser.add_argument("--evidence-out", default="", help="Write evidence JSON to this path")
    args = parser.parse_args()

    client = httpx.Client(base_url=args.base_url, timeout=args.timeout)
    passed = 0
    failed = 0
    results: list[dict] = []
    run_tag = uuid.uuid4().hex[:8]

    def step(name: str, fn):
        nonlocal passed, failed
        t0 = time.monotonic()
        try:
            fn()
            ms = int((time.monotonic() - t0) * 1000)
            print(f"  PASS  {name} ({ms}ms)")
            passed += 1
            results.append({"name": name, "status": "pass", "ms": ms})
        except Exception as e:
            ms = int((time.monotonic() - t0) * 1000)
            print(f"  FAIL  {name} ({ms}ms): {e}")
            failed += 1
            results.append({"name": name, "status": "fail", "ms": ms, "error": str(e)})

    print(f"[smoke] Backend-agent mode smoke test (tag={run_tag})")
    print(f"[smoke] Target: {args.base_url}\n")

    # -----------------------------------------------------------------------
    # Step 1: Health
    # -----------------------------------------------------------------------
    def check_health():
        resp = client.get("/healthz")
        assert resp.status_code == 200, f"status={resp.status_code}"
        data = resp.json()
        assert data["status"] == "ok", f"status={data.get('status')}"
        assert "pi" in data.get("checks", {}), "missing pi check"
        pi_status = data["checks"]["pi"]
        assert pi_status in ("ok", "degraded"), f"pi={pi_status}"

    step("1. healthz with pi check", check_health)

    # -----------------------------------------------------------------------
    # Step 2: Capabilities
    # -----------------------------------------------------------------------
    def check_capabilities():
        resp = client.get("/api/capabilities")
        assert resp.status_code == 200, f"status={resp.status_code}"
        data = resp.json()
        assert data.get("agent_mode") == "backend", f"agent_mode={data.get('agent_mode')}"
        assert "pi" in data.get("agents", []), f"agents={data.get('agents')}"
        features = data.get("features", {})
        assert features.get("pi") is True or features.get("pi") is False, "pi feature missing"
        # Control plane disabled in workspace-VM role
        assert features.get("control_plane") is False, f"control_plane={features.get('control_plane')}"
        assert "workspace_runtime" in data, "missing workspace_runtime"
        assert data["workspace_runtime"]["agent_mode"] == "backend"

    step("2. capabilities: backend mode + pi agent", check_capabilities)

    # -----------------------------------------------------------------------
    # Step 3: File write + read roundtrip
    # -----------------------------------------------------------------------
    file_content = f"smoke-backend-{run_tag}"
    file_path = f"smoke-{run_tag}.txt"

    def check_file_roundtrip():
        # Write
        write_resp = client.put(
            f"/api/v1/files/write?path={file_path}",
            json={"content": file_content},
        )
        assert write_resp.status_code == 200, f"write status={write_resp.status_code}"

        # Read back
        read_resp = client.get(f"/api/v1/files/read?path={file_path}")
        assert read_resp.status_code == 200, f"read status={read_resp.status_code}"
        data = read_resp.json()
        assert data["content"] == file_content, f"content mismatch: {data['content']!r}"

    step("3. file write + read roundtrip", check_file_roundtrip)

    # -----------------------------------------------------------------------
    # Step 4: File list includes written file
    # -----------------------------------------------------------------------
    def check_file_list():
        resp = client.get("/api/v1/files/list?path=.")
        assert resp.status_code == 200, f"status={resp.status_code}"
        data = resp.json()
        names = [e["name"] for e in data.get("entries", [])]
        assert file_path in names, f"{file_path} not in {names}"

    step("4. file list includes smoke file", check_file_list)

    # -----------------------------------------------------------------------
    # Summary
    # -----------------------------------------------------------------------
    total = passed + failed
    ok = failed == 0
    verdict = "PASS" if ok else "FAIL"

    print(f"\n{verdict}: {passed} passed, {failed} failed (total {total})")

    if args.evidence_out:
        evidence = {
            "suite": "backend-agent-smoke",
            "base_url": args.base_url,
            "tag": run_tag,
            "ok": ok,
            "passed": passed,
            "failed": failed,
            "total": total,
            "steps": results,
        }
        with open(args.evidence_out, "w") as f:
            json.dump(evidence, f, indent=2)
        print(f"[smoke] Evidence written to {args.evidence_out}")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

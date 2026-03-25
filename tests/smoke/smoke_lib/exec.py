"""Exec smoke helpers for short commands and long-running jobs."""
from __future__ import annotations

import time

from .client import SmokeClient


def run_exec(client: SmokeClient, *, command: str, cwd: str | None = None) -> dict:
    """POST /api/v1/exec — run a short command synchronously."""
    client.set_phase("exec-run")
    body = {"command": command}
    if cwd:
        body["cwd"] = cwd
    resp = client.post("/api/v1/exec", json=body, expect_status=(200,))
    if resp.status_code != 200:
        raise RuntimeError(f"Exec failed: {resp.status_code} {resp.text[:300]}")
    data = resp.json()
    print(f"[smoke] Exec OK: exit_code={data.get('exit_code')}")
    return data


def start_exec_job(client: SmokeClient, *, command: str, cwd: str | None = None) -> dict:
    """POST /api/v1/exec/start — start a long-running command job."""
    client.set_phase("exec-job-start")
    body = {"command": command}
    if cwd:
        body["cwd"] = cwd
    resp = client.post("/api/v1/exec/start", json=body, expect_status=(200,))
    if resp.status_code != 200:
        raise RuntimeError(f"Exec job start failed: {resp.status_code} {resp.text[:300]}")
    data = resp.json()
    if not data.get("job_id"):
        raise RuntimeError(f"Exec job start returned no job_id: {data}")
    print(f"[smoke] Exec job started: {data['job_id']}")
    return data


def read_exec_job(client: SmokeClient, job_id: str, *, after: int | None = None) -> dict:
    """GET /api/v1/exec/jobs/{job_id} — read job chunks."""
    client.set_phase("exec-job-read")
    params = {"after": str(after)} if after is not None else None
    resp = client.get(f"/api/v1/exec/jobs/{job_id}", params=params, expect_status=(200,))
    if resp.status_code != 200:
        raise RuntimeError(f"Exec job read failed: {resp.status_code} {resp.text[:300]}")
    return resp.json()


def collect_job_output(chunks: list[object] | None) -> str:
    text_parts: list[str] = []
    for chunk in chunks or []:
        if isinstance(chunk, str):
            text_parts.append(chunk)
            continue
        if not isinstance(chunk, dict):
            continue
        data = chunk.get("data")
        if isinstance(data, str):
            text_parts.append(data)
    return "".join(text_parts)


def wait_for_exec_job(
    client: SmokeClient,
    job_id: str,
    *,
    timeout_seconds: float = 30.0,
    poll_interval: float = 0.5,
) -> dict:
    """Poll an exec job until done, returning the final payload plus combined output."""
    deadline = time.monotonic() + timeout_seconds
    cursor: int | None = None
    combined_chunks: list[dict] = []

    while time.monotonic() < deadline:
        data = read_exec_job(client, job_id, after=cursor)
        combined_chunks.extend(data.get("chunks", []))
        cursor = data.get("cursor", cursor)
        if data.get("done"):
            return {
                **data,
                "combined_output": collect_job_output(combined_chunks),
                "chunks": combined_chunks,
            }
        time.sleep(poll_interval)

    raise RuntimeError(f"Exec job {job_id} did not finish within {timeout_seconds}s")

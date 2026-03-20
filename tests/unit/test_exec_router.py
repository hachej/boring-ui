"""Tests for the exec router — command execution, path traversal, timeout, truncation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from boring_ui.api.modules.exec.router import create_exec_router, _MAX_OUTPUT_BYTES


@dataclass
class _FakeConfig:
    workspace_root: Path


def _make_app(tmp_path: Path) -> FastAPI:
    config = _FakeConfig(workspace_root=tmp_path)
    app = FastAPI()
    app.include_router(create_exec_router(config))
    return app


def test_basic_command_execution(tmp_path: Path):
    client = TestClient(_make_app(tmp_path))
    resp = client.post(
        "/api/v1/sandbox/exec",
        json={"command": "echo hello"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["exit_code"] == 0
    assert data["stdout"].strip() == "hello"
    assert data["stderr"] == ""
    assert data["truncated"] is False
    assert data["duration_ms"] >= 0


def test_command_with_nonzero_exit(tmp_path: Path):
    client = TestClient(_make_app(tmp_path))
    resp = client.post(
        "/api/v1/sandbox/exec",
        json={"command": "exit 42"},
    )
    assert resp.status_code == 200
    assert resp.json()["exit_code"] == 42


def test_timeout_handling(tmp_path: Path):
    client = TestClient(_make_app(tmp_path))
    resp = client.post(
        "/api/v1/sandbox/exec",
        json={"command": "sleep 60", "timeout_seconds": 1},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["exit_code"] == 124
    assert "timed out" in data["stderr"]


def test_output_truncation(tmp_path: Path):
    client = TestClient(_make_app(tmp_path))
    # Generate output larger than _MAX_OUTPUT_BYTES (512 KB)
    byte_count = _MAX_OUTPUT_BYTES + 1024
    resp = client.post(
        "/api/v1/sandbox/exec",
        json={"command": f"head -c {byte_count} /dev/zero | tr '\\0' 'A'"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["truncated"] is True
    assert len(data["stdout"]) <= _MAX_OUTPUT_BYTES


def test_cwd_path_traversal_rejection(tmp_path: Path):
    client = TestClient(_make_app(tmp_path))
    resp = client.post(
        "/api/v1/sandbox/exec",
        json={"command": "pwd", "cwd": "../../etc"},
    )
    assert resp.status_code == 400
    assert "workspace root" in resp.json()["detail"]


def test_cwd_absolute_traversal_rejection(tmp_path: Path):
    client = TestClient(_make_app(tmp_path))
    resp = client.post(
        "/api/v1/sandbox/exec",
        json={"command": "pwd", "cwd": "/etc"},
    )
    assert resp.status_code == 400
    assert "workspace root" in resp.json()["detail"]


def test_cwd_within_workspace_allowed(tmp_path: Path):
    subdir = tmp_path / "subdir"
    subdir.mkdir()
    client = TestClient(_make_app(tmp_path))
    resp = client.post(
        "/api/v1/sandbox/exec",
        json={"command": "pwd", "cwd": "subdir"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["exit_code"] == 0
    assert "subdir" in data["stdout"]

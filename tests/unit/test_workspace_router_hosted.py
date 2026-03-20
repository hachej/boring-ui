from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from boring_ui.api.config import APIConfig
from boring_ui.api.modules.control_plane.workspace_router_hosted import (
    _provision_workspace,
    _wait_for_machine_started,
)
from boring_ui.api.workspace.provisioner import ProvisionResult


class _FakeProvisioner:
    def __init__(self, states: list[str], result: ProvisionResult | None = None) -> None:
        self._states = iter(states)
        self.result = result or ProvisionResult(
            machine_id="mach-1",
            volume_id="vol-1",
            region="cdg",
        )
        self.status_calls: list[str] = []
        self.create_calls: list[tuple[str, str, int]] = []
        self.machine_info_calls: list[str] = []

    async def create(self, workspace_id: str, region: str, size_gb: int) -> ProvisionResult:
        self.create_calls.append((workspace_id, region, size_gb))
        return self.result

    async def status(self, machine_id: str) -> str:
        self.status_calls.append(machine_id)
        try:
            return next(self._states)
        except StopIteration:
            return "started"

    async def machine_info(self, machine_id: str) -> dict[str, object]:
        self.machine_info_calls.append(machine_id)
        return {
            "state": await self.status(machine_id),
            "checks": [{"status": "passing"}] if len(self.machine_info_calls) > 1 else [{"status": "warning"}],
        }


class _FakeConn:
    def __init__(self) -> None:
        self.executed: list[tuple[str, tuple[object, ...]]] = []

    async def execute(self, sql: str, *args) -> None:
        self.executed.append((sql, args))


class _FakeAcquire:
    def __init__(self, conn: _FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> _FakeConn:
        return self._conn

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


class _FakePool:
    def __init__(self) -> None:
        self.conn = _FakeConn()

    def acquire(self) -> _FakeAcquire:
        return _FakeAcquire(self.conn)


@pytest.mark.asyncio
async def test_wait_for_machine_started_polls_until_started(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provisioner = _FakeProvisioner(["pending", "starting", "started"])
    sleeps: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    await _wait_for_machine_started(
        provisioner,
        "mach-1",
        timeout_seconds=5.0,
        poll_interval_seconds=0.25,
    )

    assert provisioner.status_calls == ["mach-1", "mach-1", "mach-1"]
    assert provisioner.machine_info_calls == ["mach-1", "mach-1", "mach-1"]
    assert sleeps == [0.25, 0.25]


@pytest.mark.asyncio
async def test_wait_for_machine_started_times_out_on_pending(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provisioner = _FakeProvisioner(["pending", "pending", "pending"])

    async def fake_sleep(_delay: float) -> None:
        return None

    monotonic_values = iter([0.0, 0.1, 0.2, 0.31])

    class _Loop:
        def time(self) -> float:
            return next(monotonic_values)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(asyncio, "get_running_loop", lambda: _Loop())

    with pytest.raises(RuntimeError, match="did not reach 'started'"):
        await _wait_for_machine_started(
            provisioner,
            "mach-1",
            timeout_seconds=0.3,
            poll_interval_seconds=0.1,
        )


@pytest.mark.asyncio
async def test_provision_workspace_marks_ready_only_after_machine_starts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provisioner = _FakeProvisioner(["pending", "started"])
    pool = _FakePool()
    config = APIConfig(workspace_root=tmp_path)
    sleeps: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    await _provision_workspace(provisioner, pool, "11111111-1111-1111-1111-111111111111", config)

    assert provisioner.create_calls == [("11111111-1111-1111-1111-111111111111", "cdg", 10)]
    assert provisioner.status_calls == ["mach-1", "mach-1"]
    assert provisioner.machine_info_calls == ["mach-1", "mach-1"]
    assert sleeps == [1.0]
    assert len(pool.conn.executed) == 2
    assert "UPDATE workspaces SET machine_id" in pool.conn.executed[0][0]
    assert pool.conn.executed[0][1][:3] == ("mach-1", "vol-1", "cdg")
    assert "UPDATE workspace_runtimes SET state = 'ready'" in pool.conn.executed[1][0]

from __future__ import annotations

import asyncio
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from boring_ui.api.agents import HarnessHealth
from boring_ui.api.agents.pi_harness import PiHarness
from boring_ui.api.capabilities import create_capabilities_router
from boring_ui.api.config import APIConfig, AgentRuntimeConfig


class FakeProcess:
    def __init__(self, returncode: int | None = None) -> None:
        self.returncode = returncode
        self.pid = 321
        self.terminated = False
        self.killed = False
        self.stderr = None

    def terminate(self) -> None:
        self.terminated = True
        if self.returncode is None:
            self.returncode = 0

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9

    async def wait(self) -> int:
        return 0 if self.returncode is None else self.returncode


@pytest.mark.asyncio
async def test_pi_harness_start_uses_agent_config_command(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    captured: dict[str, object] = {}

    async def fake_create_subprocess_exec(*cmd, **kwargs):
        captured["cmd"] = cmd
        captured["env"] = kwargs["env"]
        captured["cwd"] = kwargs["cwd"]
        return FakeProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    config = APIConfig(
        workspace_root=tmp_path,
        agents_mode="backend",
        agents={
            "pi": AgentRuntimeConfig(
                enabled=True,
                port=9911,
                command=("node", "custom-pi.mjs"),
                env={"PI_SERVICE_MODEL": "test-model"},
            )
        },
    )
    harness = PiHarness(config, healthcheck_interval=60.0)

    await harness.start()
    await harness.stop()

    assert captured["cmd"] == ("node", "custom-pi.mjs")
    env = captured["env"]
    assert isinstance(env, dict)
    assert env["PI_SERVICE_PORT"] == "9911"
    assert env["PI_SERVICE_MODEL"] == "test-model"
    assert str(captured["cwd"]).endswith("boring-ui")


def test_pi_harness_proxy_routes_forward_workspace_context(tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        return httpx.Response(201, json={"session": {"id": "sess-1"}})

    transport = httpx.MockTransport(handler)
    config = APIConfig(
        workspace_root=tmp_path,
        agents_mode="backend",
        control_plane_provider="neon",
        agents={"pi": AgentRuntimeConfig(enabled=True, port=8789)},
    )
    harness = PiHarness(
        config,
        client_factory=lambda: httpx.AsyncClient(transport=transport),
    )
    harness.ensure_ready = lambda **kwargs: asyncio.sleep(0)

    app = FastAPI()
    for router in harness.routes():
        app.include_router(router)

    client = TestClient(app)
    response = client.post(
        "/api/v1/agent/pi/sessions/create",
        json={},
        headers={"x-request-id": "req-pi-1", "x-workspace-id": "ws-1"},
    )

    assert response.status_code == 201
    assert captured["url"] == "http://127.0.0.1:8789/api/v1/agent/pi/sessions/create"
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert headers["x-request-id"] == "req-pi-1"
    assert headers["x-workspace-id"] == "ws-1"
    assert headers["x-boring-workspace-root"] == str((tmp_path / "ws-1").resolve())
    assert headers["authorization"].startswith("Bearer ")


def test_pi_harness_local_workspace_forward_keeps_base_root(tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        return httpx.Response(201, json={"session": {"id": "sess-local"}})

    transport = httpx.MockTransport(handler)
    config = APIConfig(
        workspace_root=tmp_path,
        agents_mode="backend",
        control_plane_provider="neon",
        agents={"pi": AgentRuntimeConfig(enabled=True, port=8789)},
    )
    harness = PiHarness(
        config,
        client_factory=lambda: httpx.AsyncClient(transport=transport),
    )
    harness.ensure_ready = lambda **kwargs: asyncio.sleep(0)

    app = FastAPI()
    for router in harness.routes():
        app.include_router(router)

    client = TestClient(app)
    response = client.post(
        "/api/v1/agent/pi/sessions/create",
        json={},
        headers={
            "x-request-id": "req-pi-local",
            "x-workspace-id": "ws-1",
            "x-boring-local-workspace": "1",
        },
    )

    assert response.status_code == 201
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert headers["x-workspace-id"] == "ws-1"
    assert headers["x-boring-workspace-root"] == str(tmp_path.resolve())
    assert headers["authorization"].startswith("Bearer ")


def test_pi_harness_stream_route_proxies_sse_payload(tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        assert str(request.url) == "http://127.0.0.1:8789/api/v1/agent/pi/sessions/sess-1/stream"
        return httpx.Response(
            200,
            text='event: done\ndata: {"text":"hello"}\n\n',
            headers={"content-type": "text/event-stream; charset=utf-8"},
        )

    transport = httpx.MockTransport(handler)
    config = APIConfig(
        workspace_root=tmp_path,
        agents_mode="backend",
        agents={"pi": AgentRuntimeConfig(enabled=True, port=8789)},
    )
    harness = PiHarness(
        config,
        client_factory=lambda: httpx.AsyncClient(transport=transport),
    )
    harness.ensure_ready = lambda **kwargs: asyncio.sleep(0)

    app = FastAPI()
    for router in harness.routes():
        app.include_router(router)

    client = TestClient(app)
    response = client.post("/api/v1/agent/pi/sessions/sess-1/stream", json={"message": "hello"})

    assert response.status_code == 200
    assert response.text == 'event: done\ndata: {"text":"hello"}\n\n'
    assert response.headers["content-type"].startswith("text/event-stream")
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert "authorization" not in headers
    assert "x-boring-internal-token" not in headers
    assert "x-workspace-id" not in headers
    assert headers["x-boring-workspace-root"] == str(tmp_path.resolve())


def test_capabilities_reflect_pi_harness_health_and_backend_url(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    config = APIConfig(
        workspace_root=tmp_path,
        agents_mode="backend",
        agents={"pi": AgentRuntimeConfig(enabled=True)},
    )
    harness = PiHarness(config)

    async def fake_healthy() -> HarnessHealth:
        return HarnessHealth(ok=True)

    monkeypatch.setattr(harness, "healthy", fake_healthy)

    app = FastAPI()
    app.state.pi_harness = harness
    app.include_router(
        create_capabilities_router({"pi": False}, config=config),
        prefix="/api",
    )

    client = TestClient(app)
    response = client.get("/api/capabilities", headers={"x-workspace-id": "ws-1"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["features"]["pi"] is True
    assert payload["services"]["pi"]["mode"] == "backend"
    assert payload["services"]["pi"]["url"] == "/w/ws-1"


@pytest.mark.asyncio
async def test_pi_harness_monitor_once_restarts_exited_process(tmp_path: Path) -> None:
    config = APIConfig(
        workspace_root=tmp_path,
        agents_mode="backend",
        agents={"pi": AgentRuntimeConfig(enabled=True)},
    )
    harness = PiHarness(config)
    harness._process = FakeProcess(returncode=1)

    events: list[object] = []

    async def fake_spawn() -> None:
        events.append("spawn")
        harness._process = FakeProcess()

    async def fake_sleep(delay: float) -> None:
        events.append(delay)

    harness._spawn_process = fake_spawn
    harness._sleep = fake_sleep

    await harness._monitor_once()

    assert events == [1.0, "spawn"]


@pytest.mark.asyncio
async def test_pi_harness_ensure_ready_waits_for_sessions_probe(tmp_path: Path) -> None:
    config = APIConfig(
        workspace_root=tmp_path,
        agents_mode="backend",
        agents={"pi": AgentRuntimeConfig(enabled=True)},
    )
    harness = PiHarness(config)
    harness._process = FakeProcess()
    harness._started = True

    probe_states = [
        HarnessHealth(ok=False, detail="probe pending"),
        HarnessHealth(ok=True),
    ]
    sleeps: list[float] = []

    async def fake_healthy() -> HarnessHealth:
        return HarnessHealth(ok=True)

    async def fake_probe_ready() -> HarnessHealth:
        return probe_states.pop(0)

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    harness.healthy = fake_healthy
    harness._probe_ready = fake_probe_ready
    harness._sleep = fake_sleep

    await harness.ensure_ready(timeout=1.0, poll_interval=0.25)

    assert sleeps == [0.25]


def test_pi_harness_proxy_retries_once_on_transport_error(tmp_path: Path) -> None:
    attempts = {"count": 0}
    restarts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise httpx.ConnectError("connect failed", request=request)
        return httpx.Response(201, json={"session": {"id": "sess-retry"}})

    transport = httpx.MockTransport(handler)
    config = APIConfig(
        workspace_root=tmp_path,
        agents_mode="backend",
        control_plane_provider="neon",
        agents={"pi": AgentRuntimeConfig(enabled=True, port=8789)},
    )
    harness = PiHarness(
        config,
        client_factory=lambda: httpx.AsyncClient(transport=transport),
    )
    harness.ensure_ready = lambda **kwargs: asyncio.sleep(0)

    async def fake_restart(reason: str) -> None:
        restarts.append(reason)

    harness._restart = fake_restart

    app = FastAPI()
    for router in harness.routes():
        app.include_router(router)

    client = TestClient(app)
    response = client.post(
        "/api/v1/agent/pi/sessions/create",
        json={},
        headers={"x-request-id": "req-pi-retry", "x-workspace-id": "ws-1"},
    )

    assert response.status_code == 201
    assert attempts["count"] == 2
    assert len(restarts) == 1


@pytest.mark.asyncio
async def test_pi_harness_ensure_ready_waits_for_health(tmp_path: Path) -> None:
    config = APIConfig(
        workspace_root=tmp_path,
        agents_mode="backend",
        agents={"pi": AgentRuntimeConfig(enabled=True)},
    )
    harness = PiHarness(config)

    calls = {"count": 0}
    sleeps: list[float] = []

    async def fake_ensure_started() -> None:
        return None

    async def fake_healthy() -> HarnessHealth:
        calls["count"] += 1
        if calls["count"] == 1:
            return HarnessHealth(ok=False, detail="All connection attempts failed")
        return HarnessHealth(ok=True)

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    harness.ensure_started = fake_ensure_started
    harness.healthy = fake_healthy
    harness._probe_ready = lambda: asyncio.sleep(0, result=HarnessHealth(ok=True))
    harness._sleep = fake_sleep
    harness._process = FakeProcess()

    await harness.ensure_ready(timeout=1.0, poll_interval=0.01)

    assert calls["count"] == 2
    assert sleeps == [0.01]

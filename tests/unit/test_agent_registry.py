from __future__ import annotations

from fastapi import APIRouter

from boring_ui.api.agents import AgentRegistry, HarnessHealth, SessionInfo, SessionRequest
from boring_ui.api.config import APIConfig, AgentRuntimeConfig


class StubHarness:
    def __init__(self, name: str) -> None:
        self._name = name
        self._router = APIRouter()

        @self._router.get(f"/{name}/health")
        async def _health():
            return {"ok": True}

    @property
    def name(self) -> str:
        return self._name

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    async def healthy(self) -> HarnessHealth:
        return HarnessHealth(ok=True)

    def routes(self) -> list[APIRouter]:
        return [self._router]

    async def create_session(self, ctx, req: SessionRequest) -> SessionInfo:
        return SessionInfo(session_id="session-1", agent_name=self._name, workspace_id=ctx.workspace_id)

    async def stream(self, ctx, session_id: str):
        if False:
            yield {"ctx": ctx, "session_id": session_id}

    async def send_user_message(self, ctx, session_id: str, message: str) -> None:
        return None

    async def terminate_session(self, ctx, session_id: str) -> None:
        return None


def test_agent_registry_reads_agent_config_from_api_config(tmp_path):
    config = APIConfig(
        workspace_root=tmp_path,
        agents_mode="backend",
        agents_default="pi",
        agents={
            "pi": AgentRuntimeConfig(enabled=True, port=8789, transport="http"),
            "claude": AgentRuntimeConfig(enabled=False, transport="websocket"),
        },
    )

    registry = AgentRegistry.from_config(config)

    assert registry.mode == "backend"
    assert registry.enabled_names() == ["pi"]
    assert registry.default_name == "pi"

    pi = registry.get("pi")
    assert pi is not None
    assert pi.config.port == 8789
    assert registry.get("claude") is None

    runtime = registry.runtime_config()
    assert runtime["mode"] == "backend"
    assert runtime["default"] == "pi"
    assert runtime["available"] == ["pi"]
    assert runtime["definitions"][0]["name"] == "pi"


def test_agent_registry_tracks_registered_harness_routes(tmp_path):
    registry = AgentRegistry.from_config(APIConfig(workspace_root=tmp_path))
    harness = StubHarness("pi")

    registry.register_harness(harness)

    assert registry.harness("pi") is harness
    routes = registry.routes()
    assert len(routes) == 1
    assert routes[0].routes[0].path == "/pi/health"

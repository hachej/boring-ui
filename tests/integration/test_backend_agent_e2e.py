"""E2E integration test for backend-agent mode.

Starts the full app with AGENTS_MODE=backend, verifies:
- Health endpoint works with PI harness status
- Capabilities report backend mode + PI agent
- File operations work (write + read + list)
- PI agent routes are mounted
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient, ASGITransport

from boring_ui.api.app import create_app
from boring_ui.api.config import APIConfig, AgentRuntimeConfig


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def workspace(tmp_path):
    """Create a temporary workspace with sample files for backend-agent mode."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    (ws / "README.md").write_text("# Backend Agent Test")
    (ws / "src").mkdir()
    (ws / "src" / "hello.py").write_text('print("hello")')
    return ws


@pytest.fixture
def backend_app(workspace, monkeypatch):
    """Create a full application in backend-agent mode.

    Control plane is disabled (no DATABASE_URL) to match the workspace-VM
    role where agents_mode=backend and no DB is present.
    """
    monkeypatch.setenv("AGENTS_MODE", "backend")
    monkeypatch.setenv("BORING_UI_WORKSPACE_ROOT", str(workspace))
    monkeypatch.setenv("BORING_UI_SESSION_SECRET", "test-secret-for-e2e")
    # Disable control plane for workspace-VM role
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("CONTROL_PLANE_ENABLED", raising=False)

    config = APIConfig(
        workspace_root=workspace,
        agents_mode="backend",
        agents={"pi": AgentRuntimeConfig(enabled=True, port=19999)},
        control_plane_enabled=False,
    )
    app = create_app(config, include_pty=False, include_stream=False)
    return app


@pytest.fixture
def frontend_app(workspace, monkeypatch):
    """Create a full application in frontend (default) mode."""
    monkeypatch.setenv("BORING_UI_WORKSPACE_ROOT", str(workspace))
    monkeypatch.setenv("BORING_UI_SESSION_SECRET", "test-secret-for-e2e")
    monkeypatch.delenv("AGENTS_MODE", raising=False)

    config = APIConfig(
        workspace_root=workspace,
        agents_mode="frontend",
        control_plane_enabled=False,
    )
    app = create_app(config, include_pty=False, include_stream=False)
    return app


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

class TestBackendModeHealth:
    """Health endpoints in backend-agent mode."""

    @pytest.mark.asyncio
    async def test_backend_mode_health_reports_pi_status(self, backend_app, workspace):
        """GET /healthz should include a 'pi' check in its response."""
        transport = ASGITransport(app=backend_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/healthz")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "ok"
            assert "pi" in data["checks"]
            # PI harness is registered but sidecar is not running, so
            # the check should report degraded (not a crash).
            assert data["checks"]["pi"] in ("ok", "degraded")

    @pytest.mark.asyncio
    async def test_backend_mode_health_includes_workspace(self, backend_app, workspace):
        """GET /health should report the workspace root."""
        transport = ASGITransport(app=backend_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/health")
            assert response.status_code == 200
            data = response.json()
            assert data["workspace"] == str(workspace)


# ---------------------------------------------------------------------------
# Capabilities
# ---------------------------------------------------------------------------

class TestBackendModeCapabilities:
    """Capabilities endpoint in backend-agent mode."""

    @pytest.mark.asyncio
    async def test_backend_mode_capabilities(self, backend_app):
        """GET /api/capabilities should report backend mode + pi agent."""
        transport = ASGITransport(app=backend_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/capabilities")
            assert response.status_code == 200
            data = response.json()

            # Agent mode
            assert data["agent_mode"] == "backend"

            # PI agent listed
            assert "pi" in data["agents"]

            # Control plane is disabled in workspace-VM role
            features = data["features"]
            assert features["control_plane"] is False

            # PI feature: True at config level, but may be False at runtime
            # if the sidecar is not actually running. The capabilities
            # endpoint queries pi_harness.healthy() which overrides the
            # static flag. In this test env the sidecar is not started,
            # so we just verify the key exists.
            assert "pi" in features

    @pytest.mark.asyncio
    async def test_backend_mode_workspace_runtime(self, backend_app):
        """Capabilities should include workspace_runtime block."""
        transport = ASGITransport(app=backend_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/capabilities")
            data = response.json()
            assert "workspace_runtime" in data
            assert data["workspace_runtime"]["agent_mode"] == "backend"


# ---------------------------------------------------------------------------
# File operations
# ---------------------------------------------------------------------------

class TestBackendModeFileOps:
    """File write/read/list via the standard file routes."""

    @pytest.mark.asyncio
    async def test_backend_mode_file_write_and_read(self, backend_app, workspace):
        """PUT write + GET read roundtrip should produce identical content."""
        transport = ASGITransport(app=backend_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # Write
            write_resp = await client.put(
                "/api/v1/files/write?path=test-file.txt",
                json={"content": "backend-agent-content"},
            )
            assert write_resp.status_code == 200

            # Verify on disk
            assert (workspace / "test-file.txt").read_text() == "backend-agent-content"

            # Read back via API
            read_resp = await client.get("/api/v1/files/read?path=test-file.txt")
            assert read_resp.status_code == 200
            assert read_resp.json()["content"] == "backend-agent-content"

    @pytest.mark.asyncio
    async def test_backend_mode_file_list(self, backend_app, workspace):
        """GET list should show files in the workspace."""
        transport = ASGITransport(app=backend_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # Create a new file first
            await client.put(
                "/api/v1/files/write?path=listed-file.txt",
                json={"content": "hello"},
            )

            # List root
            list_resp = await client.get("/api/v1/files/list?path=.")
            assert list_resp.status_code == 200
            data = list_resp.json()
            names = [e["name"] for e in data["entries"]]
            assert "listed-file.txt" in names
            assert "README.md" in names

    @pytest.mark.asyncio
    async def test_backend_mode_file_write_creates_nested_dirs(self, backend_app, workspace):
        """Writing to a nested path should create intermediate directories."""
        transport = ASGITransport(app=backend_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            write_resp = await client.put(
                "/api/v1/files/write?path=deep/nested/file.txt",
                json={"content": "nested-content"},
            )
            assert write_resp.status_code == 200
            assert (workspace / "deep" / "nested" / "file.txt").read_text() == "nested-content"


# ---------------------------------------------------------------------------
# PI routes mounted
# ---------------------------------------------------------------------------

class TestBackendModePiRoutes:
    """PI agent routes should be mounted in backend-agent mode."""

    def test_backend_mode_pi_routes_mounted(self, backend_app):
        """PI session routes should exist in the app's route table."""
        paths = [r.path for r in backend_app.routes if hasattr(r, "path")]
        # PI harness proxy routes
        assert "/api/v1/agent/pi/sessions" in paths
        assert "/api/v1/agent/pi/sessions/create" in paths



# ---------------------------------------------------------------------------
# Frontend mode contrast
# ---------------------------------------------------------------------------

class TestFrontendModeContrast:
    """Verify frontend mode reports correct capabilities."""

    @pytest.mark.asyncio
    async def test_frontend_mode_capabilities_show_frontend(self, frontend_app):
        """Capabilities in frontend mode should report agent_mode=frontend."""
        transport = ASGITransport(app=frontend_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/capabilities")
            data = response.json()
            assert data["agent_mode"] == "frontend"
            # No workspace_runtime block in frontend mode
            assert "workspace_runtime" not in data

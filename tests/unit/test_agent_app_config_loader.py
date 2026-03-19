from __future__ import annotations

from fastapi.testclient import TestClient

from boring_ui.app_config_loader import create_app_from_toml


def test_agent_loader_hydrates_agents_and_runtime_config(tmp_path):
    config_path = tmp_path / "boring.app.toml"
    config_path.write_text(
        """
[app]
name = "Child App"
id = "child-app"

[frontend.branding]
name = "Child UI"
logo = "C"

[frontend.features]
agentRailMode = "pi"

[frontend.data]
backend = "lightningfs"

[agents]
mode = "backend"
default = "pi"

[agents.pi]
enabled = true
port = 8789
transport = "http"
        """.strip()
        + "\n",
        encoding="utf-8",
    )

    app = create_app_from_toml(str(config_path))

    api_config = app.state.app_config
    assert api_config.workspace_root == tmp_path
    assert api_config.agents_mode == "backend"
    assert api_config.default_agent_name == "pi"
    assert api_config.available_agents == ["pi"]
    assert api_config.frontend_config["branding"]["name"] == "Child UI"

    client = TestClient(app)

    capabilities = client.get("/api/capabilities").json()
    assert capabilities["agents"] == ["pi"]
    assert capabilities["agent_mode"] == "backend"
    assert capabilities["agent_default"] == "pi"

    runtime = client.get("/__bui/config").json()
    assert runtime["app"]["id"] == "child-app"
    assert runtime["frontend"]["branding"]["name"] == "Child UI"
    assert runtime["frontend"]["data"]["backend"] == "lightningfs"
    assert runtime["agents"]["mode"] == "backend"
    assert runtime["agents"]["default"] == "pi"
    assert runtime["agents"]["available"] == ["pi"]
    assert runtime["agents"]["definitions"][0]["name"] == "pi"
    assert runtime["agents"]["definitions"][0]["port"] == 8789


def test_agent_loader_env_overrides_mode_default_and_blank_port(tmp_path, monkeypatch):
    config_path = tmp_path / "boring.app.toml"
    config_path.write_text(
        """
[app]
name = "Child App"
id = "child-app"

[agents]
mode = "frontend"
default = "pi"

[agents.pi]
enabled = true
port = ""
transport = "http"

[agents.worker]
enabled = true
port = 9001
transport = "http"
        """.strip()
        + "\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("BUI_AGENTS_MODE", "backend")
    monkeypatch.setenv("BUI_DEFAULT_AGENT", "worker")

    app = create_app_from_toml(str(config_path))

    api_config = app.state.app_config
    assert api_config.agents_mode == "backend"
    assert api_config.default_agent_name == "worker"
    assert api_config.available_agents == ["pi", "worker"]
    assert api_config.agents["pi"].port is None
    assert api_config.agents["worker"].port == 9001

    runtime = TestClient(app).get("/__bui/config").json()
    assert runtime["agents"]["mode"] == "backend"
    assert runtime["agents"]["default"] == "worker"
    definitions = {definition["name"]: definition for definition in runtime["agents"]["definitions"]}
    assert definitions["pi"]["port"] is None
    assert definitions["worker"]["port"] == 9001

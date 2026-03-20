from pathlib import Path

from fastapi.testclient import TestClient

from boring_ui.app_config_loader import create_app_from_toml


def test_create_app_from_toml_sets_workspace_root_and_runtime_config(tmp_path: Path) -> None:
    config_path = tmp_path / 'boring.app.toml'
    config_path.write_text(
        """
[app]
name = "Child App"
logo = "C"
id = "child-app"

[backend]
entry = "boring_ui.api.app:create_app"
routers = []

[frontend.branding]
name = "Child App"

[frontend.features]
agentRailMode = "pi"

[frontend.data]
backend = "http"

[frontend.panels.chart]
component = "chart-panel"
title = "Chart"
placement = "center"

[agents]
mode = "backend"

[agents.pi]
enabled = true
""".strip(),
        encoding='utf-8',
    )

    app = create_app_from_toml(str(config_path))
    client = TestClient(app)

    response = client.get('/__bui/config')
    data = response.json()

    assert app.state.app_config.workspace_root == tmp_path
    assert app.state.bui_runtime_config_path == str(config_path.resolve())
    assert response.status_code == 200
    assert data['app']['id'] == 'child-app'
    assert data['frontend']['branding']['name'] == 'Child App'
    assert data['frontend']['panels']['chart']['component'] == 'chart-panel'
    assert data['agents']['mode'] == 'backend'
    assert data['agents']['available'] == ['pi']

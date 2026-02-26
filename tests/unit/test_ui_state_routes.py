"""Unit tests for workspace-core UI state routes."""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from boring_ui.api.modules.ui_state import create_ui_state_router, get_ui_state_service


def _scope_headers(claims: list[str]) -> dict[str, str]:
    return {
        "X-Scope-Context": json.dumps(
            {
                "request_id": "req-ui-state",
                "workspace_id": "ws-ui-state",
                "actor": {"user_id": "u-test", "service": "agent-normal", "role": "runtime"},
                "capability_claims": claims,
                "cwd_or_worktree": ".",
            }
        )
    }


@pytest.fixture(autouse=True)
def clear_ui_state_service() -> None:
    service = get_ui_state_service()
    service.clear()
    yield
    service.clear()


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(create_ui_state_router(), prefix="/api/v1/ui")
    return TestClient(app)


def test_ui_state_upsert_and_get_latest_supports_generic_panes(client: TestClient) -> None:
    payload = {
        "client_id": "client-1",
        "project_root": "/workspace/demo",
        "active_panel_id": "pane-orders",
        "open_panels": [
            {
                "id": "pane-orders",
                "component": "orders-grid",
                "title": "Orders",
                "params": {"filters": ["open", "priority"], "sort": {"key": "updated_at", "dir": "desc"}},
                "pane_type": "list",
            },
            {
                "id": "pane-chart",
                "component": "custom-ohlc-pane",
                "title": "OHLC",
                "params": {"symbol": "AAPL", "range": "1M"},
                "pane_type": "chart",
            },
        ],
        "meta": {"pane_count": 2, "source": "web-ui"},
        "captured_at_ms": 1730000000000,
        "custom_payload": {"opaque": {"enabled": True}},
    }

    put_response = client.put("/api/v1/ui/state", json=payload)
    assert put_response.status_code == 200
    put_data = put_response.json()
    assert put_data["ok"] is True
    assert put_data["state"]["client_id"] == "client-1"
    assert put_data["state"]["custom_payload"] == {"opaque": {"enabled": True}}
    assert put_data["state"]["open_panels"][0]["pane_type"] == "list"

    latest_response = client.get("/api/v1/ui/state/latest")
    assert latest_response.status_code == 200
    latest = latest_response.json()["state"]
    assert latest["client_id"] == "client-1"
    assert latest["active_panel_id"] == "pane-orders"
    assert latest["open_panels"][1]["component"] == "custom-ohlc-pane"


def test_ui_state_upsert_accepts_post_for_beacon_publish(client: TestClient) -> None:
    payload = {
        "client_id": "client-beacon",
        "active_panel_id": "pane-a",
        "open_panels": [{"id": "pane-a", "component": "chart-canvas"}],
    }

    post_response = client.post("/api/v1/ui/state", json=payload)
    assert post_response.status_code == 200
    assert post_response.json()["state"]["client_id"] == "client-beacon"

    latest_response = client.get("/api/v1/ui/state/latest")
    assert latest_response.status_code == 200
    assert latest_response.json()["state"]["active_panel_id"] == "pane-a"


def test_ui_state_get_delete_and_clear(client: TestClient) -> None:
    first = {"client_id": "client-a", "open_panels": [{"id": "pane-a"}]}
    second = {"client_id": "client-b", "open_panels": [{"id": "pane-b"}]}

    assert client.put("/api/v1/ui/state", json=first).status_code == 200
    assert client.put("/api/v1/ui/state", json=second).status_code == 200

    get_response = client.get("/api/v1/ui/state/client-a")
    assert get_response.status_code == 200
    assert get_response.json()["state"]["open_panels"][0]["id"] == "pane-a"

    list_response = client.get("/api/v1/ui/state")
    assert list_response.status_code == 200
    listed_ids = {state["client_id"] for state in list_response.json()["states"]}
    assert listed_ids == {"client-a", "client-b"}

    delete_response = client.delete("/api/v1/ui/state/client-a")
    assert delete_response.status_code == 200
    assert delete_response.json()["deleted"] == "client-a"

    missing_response = client.get("/api/v1/ui/state/client-a")
    assert missing_response.status_code == 404

    clear_response = client.delete("/api/v1/ui/state")
    assert clear_response.status_code == 200
    assert clear_response.json()["cleared"] == 1

    latest_after_clear = client.get("/api/v1/ui/state/latest")
    assert latest_after_clear.status_code == 404


def test_ui_state_lists_open_panes_and_enqueues_generic_commands(client: TestClient) -> None:
    payload = {
        "client_id": "client-cmd",
        "active_panel_id": "pane-orders",
        "open_panels": [
            {"id": "pane-orders", "component": "orders-grid", "params": {"sort": "desc"}},
            {"id": "chart-FEDFUNDS", "component": "chart-canvas", "params": {"seriesId": "FEDFUNDS"}},
        ],
    }
    assert client.put("/api/v1/ui/state", json=payload).status_code == 200

    latest_panes = client.get("/api/v1/ui/panes")
    assert latest_panes.status_code == 200
    latest_data = latest_panes.json()
    assert latest_data["client_id"] == "client-cmd"
    assert latest_data["active_panel_id"] == "pane-orders"
    assert latest_data["count"] == 2

    client_panes = client.get("/api/v1/ui/panes/client-cmd")
    assert client_panes.status_code == 200
    pane_ids = [pane["id"] for pane in client_panes.json()["open_panels"]]
    assert pane_ids == ["pane-orders", "chart-FEDFUNDS"]

    focus_response = client.post(
        "/api/v1/ui/focus",
        json={"client_id": "client-cmd", "panel_id": "chart-FEDFUNDS"},
    )
    assert focus_response.status_code == 200
    assert focus_response.json()["command"]["command"]["kind"] == "focus_panel"

    enqueue_response = client.post(
        "/api/v1/ui/commands",
        json={
            "client_id": "client-cmd",
            "command": {
                "kind": "open_panel",
                "panel_id": "chart-CPIAUCSL",
                "component": "chart-canvas",
                "title": "CPI",
                "params": {"seriesId": "CPIAUCSL", "mode": "chart"},
            },
        },
    )
    assert enqueue_response.status_code == 200
    command_payload = enqueue_response.json()["command"]["command"]
    assert command_payload["kind"] == "open_panel"
    assert command_payload["component"] == "chart-canvas"

    first_next = client.get("/api/v1/ui/commands/next?client_id=client-cmd")
    assert first_next.status_code == 200
    assert first_next.json()["command"]["command"]["kind"] == "focus_panel"

    second_next = client.get("/api/v1/ui/commands/next?client_id=client-cmd")
    assert second_next.status_code == 200
    assert second_next.json()["command"]["command"]["kind"] == "open_panel"

    third_next = client.get("/api/v1/ui/commands/next?client_id=client-cmd")
    assert third_next.status_code == 200
    assert third_next.json()["command"] is None


def test_ui_state_command_validation_errors(client: TestClient) -> None:
    missing_state = client.post(
        "/api/v1/ui/commands",
        json={
            "command": {
                "kind": "open_panel",
                "component": "chart-canvas",
            }
        },
    )
    assert missing_state.status_code == 404

    seed = {
        "client_id": "client-validate",
        "active_panel_id": "pane-1",
        "open_panels": [{"id": "pane-1", "component": "editor"}],
    }
    assert client.put("/api/v1/ui/state", json=seed).status_code == 200

    bad_focus = client.post(
        "/api/v1/ui/commands",
        json={
            "client_id": "client-validate",
            "command": {"kind": "focus_panel", "panel_id": "missing-pane"},
        },
    )
    assert bad_focus.status_code == 409

    bad_open = client.post(
        "/api/v1/ui/commands",
        json={
            "client_id": "client-validate",
            "command": {"kind": "open_panel"},
        },
    )
    assert bad_open.status_code == 400

    bad_kind = client.post(
        "/api/v1/ui/commands",
        json={
            "client_id": "client-validate",
            "command": {"kind": "unknown_kind"},
        },
    )
    assert bad_kind.status_code == 400


def test_ui_state_delegated_policy_enforces_read_vs_write_claims(client: TestClient) -> None:
    payload = {"client_id": "client-policy", "open_panels": [{"id": "pane"}]}

    denied_write = client.put(
        "/api/v1/ui/state",
        headers=_scope_headers(["workspace.files.read"]),
        json=payload,
    )
    assert denied_write.status_code == 403
    assert denied_write.json()["code"] == "capability_denied"

    allowed_write = client.put(
        "/api/v1/ui/state",
        headers=_scope_headers(["workspace.files.write"]),
        json=payload,
    )
    assert allowed_write.status_code == 200

    denied_read = client.get(
        "/api/v1/ui/state",
        headers=_scope_headers(["workspace.files.write"]),
    )
    assert denied_read.status_code == 403
    assert denied_read.json()["code"] == "capability_denied"

    allowed_read = client.get(
        "/api/v1/ui/state",
        headers=_scope_headers(["workspace.files.read"]),
    )
    assert allowed_read.status_code == 200
    assert allowed_read.json()["count"] == 1

    denied_panes = client.get(
        "/api/v1/ui/panes",
        headers=_scope_headers(["workspace.files.write"]),
    )
    assert denied_panes.status_code == 403
    assert denied_panes.json()["code"] == "capability_denied"

    allowed_panes = client.get(
        "/api/v1/ui/panes",
        headers=_scope_headers(["workspace.files.read"]),
    )
    assert allowed_panes.status_code == 200
    assert allowed_panes.json()["count"] == 1

    denied_commands = client.post(
        "/api/v1/ui/commands",
        headers=_scope_headers(["workspace.files.read"]),
        json={
            "client_id": "client-policy",
            "command": {"kind": "focus_panel", "panel_id": "pane"},
        },
    )
    assert denied_commands.status_code == 403
    assert denied_commands.json()["code"] == "capability_denied"

    allowed_commands = client.post(
        "/api/v1/ui/commands",
        headers=_scope_headers(["workspace.files.write"]),
        json={
            "client_id": "client-policy",
            "command": {"kind": "focus_panel", "panel_id": "pane"},
        },
    )
    assert allowed_commands.status_code == 200

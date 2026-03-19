"""Guards for bd-3g1g.5.3 capabilities/registry metadata alignment."""

from fastapi.testclient import TestClient

from boring_ui.api import create_app
from boring_ui.api.capabilities import create_default_registry


def _routers_by_name(payload: dict) -> dict[str, dict]:
    routers = payload.get("routers", [])
    assert isinstance(routers, list)
    by_name: dict[str, dict] = {}
    for entry in routers:
        assert isinstance(entry, dict)
        name = entry.get("name")
        assert isinstance(name, str) and name
        assert name not in by_name, f"Duplicate router name in capabilities payload: {name}"
        by_name[name] = entry
    return by_name


def test_capabilities_router_descriptions_encode_owner_and_canonical_contract(monkeypatch) -> None:
    monkeypatch.setenv("CAPABILITIES_INCLUDE_CONTRACT_METADATA", "1")
    app = create_app()
    client = TestClient(app)

    response = client.get("/api/capabilities")
    assert response.status_code == 200
    payload = response.json()

    by_name = _routers_by_name(payload)

    # Ownership markers (machine-checkable) embedded in existing description field.
    assert by_name["files"]["description"].startswith("[owner=workspace-core] [canonical=/api/v1/files/*] ")
    assert by_name["git"]["description"].startswith("[owner=workspace-core] [canonical=/api/v1/git/*] ")
    assert by_name["ui_state"]["description"].startswith("[owner=workspace-core] [canonical=/api/v1/ui/*] ")
    assert by_name["control_plane"]["description"].startswith(
        "[owner=boring-ui] [canonical=/api/v1/control-plane/*] "
    )
    assert by_name["pty"]["description"].startswith("[owner=pty-service] [canonical=/ws/pty,/api/v1/pty/*] ")
    assert by_name["chat_claude_code"]["description"].startswith(
        "[owner=agent-normal] [canonical=/ws/agent/normal/*,/api/v1/agent/normal/*] "
    )
    assert by_name["stream"]["description"].startswith(
        "[owner=agent-normal] [canonical=/ws/agent/normal/*,/api/v1/agent/normal/*] "
    )
    assert by_name["approval"]["description"].startswith("[owner=boring-ui] [canonical=/api/approval/*] ")


def test_capabilities_contract_metadata_is_gated_and_schema_stable(monkeypatch) -> None:
    # Default: metadata keys exist but content is not included.
    monkeypatch.delenv("CAPABILITIES_INCLUDE_CONTRACT_METADATA", raising=False)
    app = create_app()
    client = TestClient(app)
    payload = client.get("/api/capabilities").json()
    by_name = _routers_by_name(payload)

    for entry in by_name.values():
        assert entry["contract_metadata_included"] is False
        assert entry["contract_metadata"] is None
        assert not entry["description"].startswith("[owner=")

    # Enabled: metadata content is present and matches expected ownership/canonical families.
    monkeypatch.setenv("CAPABILITIES_INCLUDE_CONTRACT_METADATA", "1")
    registry = create_default_registry()
    # Add a router without contract_by_router metadata to prove per-entry semantics stay stable.
    registry.register("unknown_router", "/api", lambda *_args, **_kwargs: None, description="Unknown router")
    app2 = create_app(registry=registry)
    client2 = TestClient(app2)
    payload2 = client2.get("/api/capabilities").json()
    by_name2 = _routers_by_name(payload2)

    for entry in by_name2.values():
        # Not all routers necessarily have contract metadata, but all must be structurally valid.
        meta = entry["contract_metadata"]
        assert entry["contract_metadata_included"] is (meta is not None)
        if meta is None:
            continue
        assert "owner_service" in meta
        assert "canonical_families" in meta
        assert isinstance(meta["canonical_families"], list)

    assert by_name2["files"]["contract_metadata"]["owner_service"] == "workspace-core"
    assert by_name2["files"]["contract_metadata"]["canonical_families"] == ["/api/v1/files/*"]
    assert by_name2["git"]["contract_metadata"]["owner_service"] == "workspace-core"
    assert by_name2["git"]["contract_metadata"]["canonical_families"] == ["/api/v1/git/*"]
    assert by_name2["ui_state"]["contract_metadata"]["owner_service"] == "workspace-core"
    assert by_name2["ui_state"]["contract_metadata"]["canonical_families"] == ["/api/v1/ui/*"]
    assert by_name2["control_plane"]["contract_metadata"]["owner_service"] == "boring-ui"
    assert by_name2["control_plane"]["contract_metadata"]["canonical_families"] == ["/api/v1/control-plane/*"]
    assert by_name2["pty"]["contract_metadata"]["owner_service"] == "pty-service"
    assert "/ws/pty" in by_name2["pty"]["contract_metadata"]["canonical_families"]
    assert "/api/v1/pty/*" in by_name2["pty"]["contract_metadata"]["canonical_families"]
    assert by_name2["chat_claude_code"]["contract_metadata"]["owner_service"] == "agent-normal"
    assert "/ws/agent/normal/*" in by_name2["chat_claude_code"]["contract_metadata"]["canonical_families"]
    assert "/api/v1/agent/normal/*" in by_name2["chat_claude_code"]["contract_metadata"]["canonical_families"]
    assert by_name2["stream"]["contract_metadata"] == by_name2["chat_claude_code"]["contract_metadata"]

    assert by_name2["unknown_router"]["contract_metadata_included"] is False
    assert by_name2["unknown_router"]["contract_metadata"] is None

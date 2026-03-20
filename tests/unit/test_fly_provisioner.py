"""Tests for FlyProvisioner (Fly Machines API client)."""

import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock

from boring_ui.api.workspace.provisioner import ProvisionResult, WorkspaceProvisioner
from boring_ui.api.workspace.fly_provisioner import FlyProvisioner


def _mock_response(json_data, status_code=200):
    resp = MagicMock()
    resp.json.return_value = json_data
    resp.status_code = status_code
    resp.raise_for_status = MagicMock()
    return resp


def _make_provisioner(client=None):
    return FlyProvisioner(
        api_token="test-token",
        workspace_app="test-workspaces",
        image="registry.fly.io/test:latest",
        http_client=client,
    )


def test_satisfies_protocol():
    p = _make_provisioner()
    assert isinstance(p, WorkspaceProvisioner)


@pytest.mark.asyncio
async def test_create_calls_volume_then_machine():
    mock_client = AsyncMock()
    vol_resp = _mock_response({"id": "vol_abc"})
    machine_resp = _mock_response({"id": "mach_xyz"})
    mock_client.post = AsyncMock(side_effect=[vol_resp, machine_resp])
    mock_client.get = AsyncMock(return_value=_mock_response([]))

    p = _make_provisioner(client=mock_client)
    result = await p.create("ws-123", region="cdg", size_gb=10)

    assert result == ProvisionResult(machine_id="mach_xyz", volume_id="vol_abc", region="cdg")
    calls = mock_client.post.call_args_list
    assert len(calls) == 2
    assert "/volumes" in str(calls[0])
    assert "/machines" in str(calls[1])


@pytest.mark.asyncio
async def test_create_cleans_up_volume_on_machine_failure():
    mock_client = AsyncMock()
    vol_resp = _mock_response({"id": "vol_orphan"})
    mock_client.post = AsyncMock(side_effect=[
        vol_resp,
        httpx.HTTPStatusError("500", request=httpx.Request("POST", "http://x"), response=httpx.Response(500)),
    ])
    mock_client.delete = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response([]))

    p = _make_provisioner(client=mock_client)
    with pytest.raises(httpx.HTTPStatusError):
        await p.create("ws-fail", region="cdg", size_gb=10)

    mock_client.delete.assert_called_once()
    assert "vol_orphan" in str(mock_client.delete.call_args)


@pytest.mark.asyncio
async def test_delete_stops_then_deletes():
    mock_client = AsyncMock()
    mock_client.post = AsyncMock()
    mock_client.delete = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response([]))

    p = _make_provisioner(client=mock_client)
    await p.delete("mach_1", "vol_1")

    mock_client.post.assert_called_once()  # stop
    assert mock_client.delete.call_count == 2  # machine + volume


@pytest.mark.asyncio
async def test_status_returns_state():
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response({"state": "suspended"}))

    p = _make_provisioner(client=mock_client)
    assert await p.status("mach_1") == "suspended"


@pytest.mark.asyncio
async def test_resume_calls_start():
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=_mock_response({}))
    mock_client.get = AsyncMock(return_value=_mock_response([]))

    p = _make_provisioner(client=mock_client)
    await p.resume("mach_1")

    assert "start" in str(mock_client.post.call_args)


@pytest.mark.asyncio
async def test_resolve_workspace_image_prefers_newest_non_workspace_machine():
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response([
        {
            "id": "ws_1",
            "name": "ws_abcd1234",
            "created_at": "2026-03-20T15:00:00Z",
            "config": {"image": "registry.fly.io/test:workspace"},
        },
        {
            "id": "app_old",
            "name": "boring-ui-backend-agent",
            "created_at": "2026-03-20T15:01:00Z",
            "config": {"image": "registry.fly.io/test:old"},
        },
        {
            "id": "app_new",
            "name": "boring-ui-backend-agent",
            "created_at": "2026-03-20T15:02:00Z",
            "config": {"image": "registry.fly.io/test:new"},
        },
    ]))

    p = _make_provisioner(client=mock_client)

    assert await p._resolve_workspace_image() == "registry.fly.io/test:new"


@pytest.mark.asyncio
async def test_resolve_workspace_image_falls_back_to_current_machine(monkeypatch: pytest.MonkeyPatch):
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=[
        httpx.HTTPStatusError("500", request=httpx.Request("GET", "http://x"), response=httpx.Response(500)),
        _mock_response({"config": {"image": "registry.fly.io/test:current"}}),
    ])
    monkeypatch.setenv("FLY_MACHINE_ID", "app_current")

    p = _make_provisioner(client=mock_client)

    assert await p._resolve_workspace_image() == "registry.fly.io/test:current"

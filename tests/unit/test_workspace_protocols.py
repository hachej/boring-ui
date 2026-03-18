"""Tests for WorkspaceProvisioner and WorkspaceRouter protocol interfaces."""

from boring_ui.api.workspace.provisioner import ProvisionResult, WorkspaceProvisioner
from boring_ui.api.workspace.router_protocol import WorkspaceRouter
from starlette.responses import Response


class MockProvisioner:
    async def create(self, workspace_id: str, region: str, size_gb: int) -> ProvisionResult:
        return ProvisionResult(machine_id="m-1", volume_id="v-1", region=region)

    async def delete(self, machine_id: str, volume_id: str) -> None:
        pass

    async def status(self, machine_id: str) -> str:
        return "running"

    async def resume(self, machine_id: str) -> None:
        pass


class MockRouter:
    async def route(self, workspace_id: str, request) -> Response:
        return Response(status_code=200)


def test_provision_result_fields():
    result = ProvisionResult(machine_id="m-abc", volume_id="v-xyz", region="cdg")
    assert result.machine_id == "m-abc"
    assert result.volume_id == "v-xyz"
    assert result.region == "cdg"


def test_mock_provisioner_satisfies_protocol():
    assert isinstance(MockProvisioner(), WorkspaceProvisioner)


def test_mock_router_satisfies_protocol():
    assert isinstance(MockRouter(), WorkspaceRouter)


def test_provisioner_protocol_rejects_incomplete():
    class Incomplete:
        async def create(self, workspace_id, region, size_gb):
            pass

    assert not isinstance(Incomplete(), WorkspaceProvisioner)


def test_router_protocol_rejects_incomplete():
    class Incomplete:
        pass

    assert not isinstance(Incomplete(), WorkspaceRouter)

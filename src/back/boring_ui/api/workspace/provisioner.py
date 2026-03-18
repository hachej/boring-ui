"""Provider-agnostic workspace provisioning interfaces."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass
class ProvisionResult:
    machine_id: str
    volume_id: str
    region: str


@runtime_checkable
class WorkspaceProvisioner(Protocol):
    """Provisioner interface for workspace runtime infrastructure."""

    async def create(self, workspace_id: str, region: str, size_gb: int) -> ProvisionResult:
        """Create or allocate a workspace runtime."""
        ...

    async def delete(self, machine_id: str, volume_id: str) -> None:
        """Delete a workspace runtime and any associated storage."""
        ...

    async def status(self, machine_id: str) -> str:
        """Return status: running, suspended, stopped, or deleted."""
        ...

    async def resume(self, machine_id: str) -> None:
        """Resume a suspended runtime (best-effort)."""
        ...

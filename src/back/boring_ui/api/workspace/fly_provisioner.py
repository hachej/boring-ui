"""Fly.io Machines API implementation of WorkspaceProvisioner."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import httpx

from .provisioner import ProvisionResult, WorkspaceProvisioner

logger = logging.getLogger(__name__)

FLY_API_BASE = "https://api.machines.dev/v1"


@dataclass
class FlyMachineConfig:
    """Configuration for workspace Machines created by FlyProvisioner."""

    cpu_kind: str = "shared"
    cpus: int = 1
    memory_mb: int = 512
    env: dict[str, str] = field(default_factory=dict)
    internal_port: int = 8000


class FlyProvisioner:
    """WorkspaceProvisioner backed by Fly.io Machines API.

    Creates one Fly Volume + one Fly Machine per workspace.
    Machines auto-suspend on idle and auto-start on incoming requests.
    """

    def __init__(
        self,
        *,
        api_token: str,
        workspace_app: str,
        image: str,
        machine_config: FlyMachineConfig | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.workspace_app = workspace_app
        self.image = image
        self.machine_config = machine_config or FlyMachineConfig()
        self._client = http_client or httpx.AsyncClient(
            base_url=FLY_API_BASE,
            headers={"Authorization": f"Bearer {api_token}"},
            timeout=30.0,
        )
        self._owns_client = http_client is None

    async def create(
        self, workspace_id: str, region: str = "cdg", size_gb: int = 10
    ) -> ProvisionResult:
        """Create a Fly Volume + Machine for a workspace."""
        app = self.workspace_app

        # 1. Create volume
        vol_resp = await self._client.post(
            f"/apps/{app}/volumes",
            json={
                "name": f"ws-{workspace_id[:8]}",
                "region": region,
                "size_gb": size_gb,
                "encrypted": True,
            },
        )
        vol_resp.raise_for_status()
        volume_id = vol_resp.json()["id"]

        # 2. Create Machine with volume attached
        cfg = self.machine_config
        try:
            machine_resp = await self._client.post(
                f"/apps/{app}/machines",
                json={
                    "name": f"ws-{workspace_id[:8]}",
                    "region": region,
                    "config": {
                        "image": self.image,
                        "env": cfg.env,
                        "mounts": [{"volume": volume_id, "path": "/workspace"}],
                        "services": [
                            {
                                "protocol": "tcp",
                                "internal_port": cfg.internal_port,
                                "ports": [
                                    {"port": 443, "handlers": ["tls", "http"]}
                                ],
                                "autostop": "suspend",
                                "autostart": True,
                            }
                        ],
                        "guest": {
                            "cpu_kind": cfg.cpu_kind,
                            "cpus": cfg.cpus,
                            "memory_mb": cfg.memory_mb,
                        },
                    },
                },
            )
            machine_resp.raise_for_status()
        except Exception:
            # Clean up orphan volume if machine creation fails
            logger.warning("Machine creation failed, cleaning up volume %s", volume_id)
            await self._client.delete(f"/apps/{app}/volumes/{volume_id}")
            raise

        machine_id = machine_resp.json()["id"]
        logger.info(
            "Created workspace %s: machine=%s volume=%s region=%s",
            workspace_id, machine_id, volume_id, region,
        )
        return ProvisionResult(
            machine_id=machine_id, volume_id=volume_id, region=region
        )

    async def delete(self, machine_id: str, volume_id: str) -> None:
        """Stop and delete a Machine, then delete its Volume."""
        app = self.workspace_app

        # Stop first (ignore errors — might already be stopped)
        try:
            await self._client.post(f"/apps/{app}/machines/{machine_id}/stop")
        except httpx.HTTPStatusError:
            pass

        await self._client.delete(f"/apps/{app}/machines/{machine_id}")
        await self._client.delete(f"/apps/{app}/volumes/{volume_id}")
        logger.info("Deleted machine=%s volume=%s", machine_id, volume_id)

    async def status(self, machine_id: str) -> str:
        """Return machine state: started, suspended, stopped, etc."""
        app = self.workspace_app
        resp = await self._client.get(f"/apps/{app}/machines/{machine_id}")
        resp.raise_for_status()
        return resp.json().get("state", "unknown")

    async def resume(self, machine_id: str) -> None:
        """Wake a suspended/stopped Machine."""
        app = self.workspace_app
        resp = await self._client.post(f"/apps/{app}/machines/{machine_id}/start")
        resp.raise_for_status()
        logger.info("Resumed machine=%s", machine_id)

    async def close(self) -> None:
        """Close the HTTP client if we own it."""
        if self._owns_client:
            await self._client.aclose()

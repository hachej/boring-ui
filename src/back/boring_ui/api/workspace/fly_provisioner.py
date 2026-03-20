"""Fly.io Machines API implementation of WorkspaceProvisioner."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

from .provisioner import ProvisionResult, WorkspaceProvisioner

logger = logging.getLogger(__name__)

FLY_API_BASE = "https://api.machines.dev/v1"


def _default_machine_env() -> dict[str, str]:
    """Build default env vars for workspace Machines.

    IMPORTANT: In the Fly Machines API, ``config.env`` completely replaces
    the environment for the Machine -- app-level secrets are NOT inherited.
    We must forward every secret the workspace process needs from the
    control-plane's own environment.
    """
    env = {
        "AGENTS_MODE": "backend",
        "BORING_UI_WORKSPACE_ROOT": "/workspace",
    }
    # Forward essential secrets from the control plane environment.
    # The workspace Machine needs these to validate cookies, talk to the DB,
    # verify JWTs, encrypt settings, and call the Claude API.
    for key in (
        "BORING_SESSION_SECRET",
        "BORING_UI_SESSION_SECRET",
        "ANTHROPIC_API_KEY",
        "BORING_SETTINGS_KEY",
        "DATABASE_URL",
        "NEON_AUTH_BASE_URL",
        "NEON_AUTH_JWKS_URL",
        "CONTROL_PLANE_PROVIDER",
        "CONTROL_PLANE_APP_ID",
        "AUTH_SESSION_SECURE_COOKIE",
        "RESEND_API_KEY",
        "GITHUB_APP_ID",
        "GITHUB_APP_CLIENT_ID",
        "GITHUB_APP_CLIENT_SECRET",
        "GITHUB_APP_PRIVATE_KEY",
        "GITHUB_APP_SLUG",
        "APP_ENV",
    ):
        val = os.environ.get(key)
        if val:
            env[key] = val
    return env


@dataclass
class FlyMachineConfig:
    """Configuration for workspace Machines created by FlyProvisioner."""

    cpu_kind: str = "shared"
    cpus: int = 1
    memory_mb: int = 512
    env: dict[str, str] = field(default_factory=_default_machine_env)
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

    async def machine_info(self, machine_id: str) -> dict[str, Any]:
        """Return the raw Fly Machines API payload for a machine."""
        app = self.workspace_app
        resp = await self._client.get(f"/apps/{app}/machines/{machine_id}")
        resp.raise_for_status()
        return resp.json()

    async def list_machines(self) -> list[dict[str, Any]]:
        """Return the raw Fly Machines API payloads for all app machines."""
        app = self.workspace_app
        resp = await self._client.get(f"/apps/{app}/machines")
        resp.raise_for_status()
        payload = resp.json()
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if isinstance(payload, dict):
            for key in ("machines", "instances", "nodes"):
                value = payload.get(key)
                if isinstance(value, list):
                    return [item for item in value if isinstance(item, dict)]
        return []

    @staticmethod
    def _machine_timestamp(machine: dict[str, Any]) -> datetime:
        """Return a comparable timestamp for machine freshness ordering."""
        for key in ("updated_at", "created_at"):
            value = str(machine.get(key) or "").strip()
            if not value:
                continue
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                continue
        return datetime.min.replace(tzinfo=timezone.utc)

    async def _resolve_workspace_image(self) -> str:
        """Resolve the image used for newly provisioned workspace machines.

        Prefer the newest non-workspace app machine image. This avoids stale
        workspace provisioning when an older app machine is still serving a
        subset of requests during or after a deploy rollout.
        """
        try:
            machines = await self.list_machines()
        except Exception:
            logger.warning("Failed to list Fly machines for image resolution", exc_info=True)
            machines = []

        app_candidates = [
            machine
            for machine in machines
            if not str(machine.get("name") or "").strip().startswith("ws_")
        ]
        if app_candidates:
            newest = max(app_candidates, key=self._machine_timestamp)
            resolved = str((newest.get("config") or {}).get("image") or "").strip()
            if resolved:
                logger.info(
                    "Resolved workspace image from newest app machine %s: %s",
                    newest.get("id"),
                    resolved,
                )
                self.image = resolved
                return self.image

        current_machine_id = str(os.environ.get("FLY_MACHINE_ID", "")).strip()
        if not current_machine_id:
            return self.image

        try:
            info = await self.machine_info(current_machine_id)
        except Exception:
            logger.warning(
                "Failed to resolve current Fly image from machine %s",
                current_machine_id,
                exc_info=True,
            )
            return self.image

        resolved = str((info.get("config") or {}).get("image") or "").strip()
        if resolved:
            logger.info("Resolved workspace image from current machine %s: %s", current_machine_id, resolved)
            self.image = resolved
        return self.image

    async def create(
        self, workspace_id: str, region: str = "cdg", size_gb: int = 10
    ) -> ProvisionResult:
        """Create a Fly Volume + Machine for a workspace."""
        app = self.workspace_app
        image = await self._resolve_workspace_image()

        # 1. Create volume
        vol_resp = await self._client.post(
            f"/apps/{app}/volumes",
            json={
                "name": f"ws_{workspace_id[:8].replace('-', '_')}",
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
                    "name": f"ws_{workspace_id[:8].replace('-', '_')}",
                    "region": region,
                    "config": {
                        "image": image,
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
                                "checks": [
                                    {
                                        "type": "http",
                                        "interval": "15s",
                                        "timeout": "5s",
                                        "grace_period": "30s",
                                        "method": "GET",
                                        "path": "/health",
                                    }
                                ],
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
        return (await self.machine_info(machine_id)).get("state", "unknown")

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

"""Domain models for the control-plane foundation module."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


def _mapping(payload: dict[str, Any], key: str) -> dict[str, dict[str, Any]]:
    raw = payload.get(key, {})
    if not isinstance(raw, dict):
        return {}

    normalized: dict[str, dict[str, Any]] = {}
    for item_id, item in raw.items():
        if not isinstance(item_id, str) or not item_id.strip():
            continue
        if not isinstance(item, dict):
            continue
        normalized[item_id] = dict(item)
    return normalized


@dataclass(slots=True)
class ControlPlaneState:
    """Persisted control-plane state grouped by aggregate type."""

    users: dict[str, dict[str, Any]] = field(default_factory=dict)
    workspaces: dict[str, dict[str, Any]] = field(default_factory=dict)
    memberships: dict[str, dict[str, Any]] = field(default_factory=dict)
    invites: dict[str, dict[str, Any]] = field(default_factory=dict)
    workspace_settings: dict[str, dict[str, Any]] = field(default_factory=dict)
    workspace_runtime: dict[str, dict[str, Any]] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize state for durable storage."""
        return {
            "users": self.users,
            "workspaces": self.workspaces,
            "memberships": self.memberships,
            "invites": self.invites,
            "workspace_settings": self.workspace_settings,
            "workspace_runtime": self.workspace_runtime,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "ControlPlaneState":
        """Build normalized state from an arbitrary decoded JSON payload."""
        source = payload if isinstance(payload, dict) else {}
        return cls(
            users=_mapping(source, "users"),
            workspaces=_mapping(source, "workspaces"),
            memberships=_mapping(source, "memberships"),
            invites=_mapping(source, "invites"),
            workspace_settings=_mapping(source, "workspace_settings"),
            workspace_runtime=_mapping(source, "workspace_runtime"),
        )


"""Persistence interface and local implementation for control-plane metadata."""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from .models import ControlPlaneState

VALID_MEMBER_ROLES = {"owner", "editor", "viewer"}
VALID_INVITE_ROLES = {"owner", "editor", "viewer"}
VALID_RUNTIME_STATES = {"pending", "provisioning", "ready", "error"}
LOGGER = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_record_id(record_id: str) -> str:
    normalized = str(record_id or "").strip()
    if not normalized:
        raise ValueError("record_id is required")
    return normalized


def _normalize_role(
    raw_role: str,
    *,
    allowed_roles: set[str],
    fallback: str = "editor",
    context: str,
) -> str:
    role = str(raw_role or "").strip().lower()
    if role in allowed_roles:
        return role
    if role:
        LOGGER.warning("control-plane %s role '%s' is invalid; using '%s'", context, role, fallback)
    return fallback


def _normalize_runtime_state(raw_state: str, *, fallback: str = "pending") -> str:
    state = str(raw_state or "").strip().lower()
    if state in VALID_RUNTIME_STATES:
        return state
    if state:
        LOGGER.warning("control-plane runtime state '%s' is invalid; using '%s'", state, fallback)
    return fallback


class ControlPlaneRepository(ABC):
    """Repository contract for control-plane domain aggregates."""

    @abstractmethod
    def snapshot(self) -> dict[str, Any]:
        """Return the full stored control-plane state."""
        ...

    @abstractmethod
    def list_users(self) -> list[dict[str, Any]]:
        ...

    @abstractmethod
    def upsert_user(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        ...

    @abstractmethod
    def list_workspaces(self) -> list[dict[str, Any]]:
        ...

    @abstractmethod
    def upsert_workspace(self, workspace_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        ...

    @abstractmethod
    def list_memberships(self) -> list[dict[str, Any]]:
        ...

    @abstractmethod
    def upsert_membership(self, membership_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        ...

    @abstractmethod
    def list_invites(self) -> list[dict[str, Any]]:
        ...

    @abstractmethod
    def upsert_invite(self, invite_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        ...

    @abstractmethod
    def get_workspace_settings(self, workspace_id: str) -> dict[str, Any] | None:
        ...

    @abstractmethod
    def set_workspace_settings(self, workspace_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        ...

    @abstractmethod
    def get_workspace_runtime(self, workspace_id: str) -> dict[str, Any] | None:
        ...

    @abstractmethod
    def set_workspace_runtime(self, workspace_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        ...


class LocalControlPlaneRepository(ControlPlaneRepository):
    """JSON-file-backed control-plane repository rooted in workspace storage."""

    def __init__(self, state_path: Path):
        self.state_path = Path(state_path)
        self._lock = Lock()

    def _load_unlocked(self) -> ControlPlaneState:
        if not self.state_path.exists():
            LOGGER.info("control-plane state file '%s' does not exist, returning empty", self.state_path)
            return ControlPlaneState()
        try:
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
        except OSError as exc:
            LOGGER.warning(
                "control-plane failed reading state file '%s': %s",
                self.state_path,
                exc,
            )
            return ControlPlaneState()
        except json.JSONDecodeError as exc:
            backup = self.state_path.with_suffix(
                f"{self.state_path.suffix}.corrupt-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
            )
            try:
                self.state_path.replace(backup)
                LOGGER.warning(
                    "control-plane state file '%s' was invalid JSON and moved to '%s': %s",
                    self.state_path,
                    backup,
                    exc,
                )
            except OSError:
                LOGGER.warning(
                    "control-plane state file '%s' invalid JSON and backup move failed: %s",
                    self.state_path,
                    exc,
                )
            return ControlPlaneState()
        return ControlPlaneState.from_dict(payload)

    def _write_unlocked(self, state: ControlPlaneState) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.state_path.with_suffix(f"{self.state_path.suffix}.tmp")
        payload = json.dumps(state.to_dict(), indent=2, sort_keys=True)
        tmp_path.write_text(payload, encoding="utf-8")
        tmp_path.replace(self.state_path)
        LOGGER.info(
            "control-plane state written to '%s' (%d bytes, %d users)",
            self.state_path,
            len(payload),
            len(state.users),
        )

    @staticmethod
    def _sorted_values(bucket: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        values = [dict(item) for item in bucket.values()]
        values.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
        return values

    def _upsert_bucket_record(
        self,
        state: ControlPlaneState,
        bucket_name: str,
        record_id: str,
        record_key: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        normalized_id = _normalize_record_id(record_id)
        bucket = getattr(state, bucket_name)
        existing = dict(bucket.get(normalized_id, {}))
        now = _now_iso()
        payload_data = dict(payload)
        payload_data.pop("created_at", None)
        created_at = existing.get("created_at", now)

        merged = {
            **existing,
            **payload_data,
            record_key: normalized_id,
            "created_at": created_at,
            "updated_at": now,
        }
        bucket[normalized_id] = merged
        return dict(merged)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            state = self._load_unlocked()
            return state.to_dict()

    def list_users(self) -> list[dict[str, Any]]:
        with self._lock:
            state = self._load_unlocked()
            return self._sorted_values(state.users)

    def upsert_user(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            state = self._load_unlocked()
            stored = self._upsert_bucket_record(state, "users", user_id, "user_id", payload)
            self._write_unlocked(state)
            return stored

    def list_workspaces(self) -> list[dict[str, Any]]:
        with self._lock:
            state = self._load_unlocked()
            return self._sorted_values(state.workspaces)

    def upsert_workspace(self, workspace_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            state = self._load_unlocked()
            normalized_payload = dict(payload)
            normalized_payload.setdefault("app_id", "boring-ui")
            normalized_payload.setdefault("deleted_at", None)
            stored = self._upsert_bucket_record(
                state,
                "workspaces",
                workspace_id,
                "workspace_id",
                normalized_payload,
            )
            self._write_unlocked(state)
            return stored

    def list_memberships(self) -> list[dict[str, Any]]:
        with self._lock:
            state = self._load_unlocked()
            return self._sorted_values(state.memberships)

    def upsert_membership(self, membership_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            state = self._load_unlocked()
            normalized_payload = dict(payload)
            normalized_payload["role"] = _normalize_role(
                normalized_payload.get("role", "editor"),
                allowed_roles=VALID_MEMBER_ROLES,
                fallback="editor",
                context="membership",
            )
            stored = self._upsert_bucket_record(
                state,
                "memberships",
                membership_id,
                "membership_id",
                normalized_payload,
            )
            self._write_unlocked(state)
            return stored

    def list_invites(self) -> list[dict[str, Any]]:
        with self._lock:
            state = self._load_unlocked()
            return self._sorted_values(state.invites)

    def upsert_invite(self, invite_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            state = self._load_unlocked()
            normalized_payload = dict(payload)
            normalized_payload["role"] = _normalize_role(
                normalized_payload.get("role", "editor"),
                allowed_roles=VALID_INVITE_ROLES,
                fallback="editor",
                context="invite",
            )
            normalized_payload.setdefault("accepted_at", None)
            stored = self._upsert_bucket_record(
                state,
                "invites",
                invite_id,
                "invite_id",
                normalized_payload,
            )
            self._write_unlocked(state)
            return stored

    def get_workspace_settings(self, workspace_id: str) -> dict[str, Any] | None:
        normalized_id = _normalize_record_id(workspace_id)
        with self._lock:
            state = self._load_unlocked()
            stored = state.workspace_settings.get(normalized_id)
            return dict(stored) if stored is not None else None

    def set_workspace_settings(self, workspace_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            state = self._load_unlocked()
            stored = self._upsert_bucket_record(
                state,
                "workspace_settings",
                workspace_id,
                "workspace_id",
                payload,
            )
            self._write_unlocked(state)
            return stored

    def get_workspace_runtime(self, workspace_id: str) -> dict[str, Any] | None:
        normalized_id = _normalize_record_id(workspace_id)
        with self._lock:
            state = self._load_unlocked()
            stored = state.workspace_runtime.get(normalized_id)
            return dict(stored) if stored is not None else None

    def set_workspace_runtime(self, workspace_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            state = self._load_unlocked()
            normalized_payload = dict(payload)
            normalized_payload["state"] = _normalize_runtime_state(normalized_payload.get("state", "pending"))
            stored = self._upsert_bucket_record(
                state,
                "workspace_runtime",
                workspace_id,
                "workspace_id",
                normalized_payload,
            )
            self._write_unlocked(state)
            return stored

"""In-memory UI state snapshot service for workspace-core."""

from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock
from typing import Any


class UIStateService:
    """Store and query frontend UI snapshots by client id."""

    def __init__(self) -> None:
        self._states: dict[str, dict[str, Any]] = {}
        self._commands: dict[str, list[dict[str, Any]]] = {}
        self._command_seq = 0
        self._lock = Lock()

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    def upsert(self, payload: dict[str, Any]) -> dict[str, Any]:
        client_id = str(payload.get("client_id", "")).strip()
        if not client_id:
            raise ValueError("client_id is required")

        stored = {
            **payload,
            "client_id": client_id,
            "updated_at": self._now_iso(),
        }
        with self._lock:
            self._states[client_id] = stored
        return stored

    def resolve_client_id(self, client_id: str | None = None) -> str | None:
        normalized = str(client_id or "").strip()
        with self._lock:
            if normalized:
                return normalized if normalized in self._states else None
            if not self._states:
                return None
            latest = max(self._states.values(), key=lambda item: item.get("updated_at", ""))
            resolved = str(latest.get("client_id", "")).strip()
            return resolved or None

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            states = list(self._states.values())
        states.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
        return states

    def get(self, client_id: str) -> dict[str, Any] | None:
        client_id = str(client_id).strip()
        if not client_id:
            return None
        with self._lock:
            return self._states.get(client_id)

    def get_latest(self) -> dict[str, Any] | None:
        states = self.list()
        if not states:
            return None
        return states[0]

    def list_open_panels(self, client_id: str | None = None) -> dict[str, Any] | None:
        resolved = self.resolve_client_id(client_id)
        if not resolved:
            return None
        state = self.get(resolved)
        if not state:
            return None
        panels = state.get("open_panels") or []
        if not isinstance(panels, list):
            panels = []
        return {
            "client_id": resolved,
            "active_panel_id": state.get("active_panel_id"),
            "open_panels": panels,
            "count": len(panels),
            "updated_at": state.get("updated_at"),
        }

    def enqueue_command(self, command: dict[str, Any], client_id: str | None = None) -> dict[str, Any] | None:
        resolved = self.resolve_client_id(client_id)
        if not resolved:
            return None

        stored = {
            "id": "",
            "client_id": resolved,
            "command": command,
            "queued_at": self._now_iso(),
        }
        with self._lock:
            self._command_seq += 1
            stored["id"] = f"cmd-{self._command_seq}"
            queue = self._commands.setdefault(resolved, [])
            queue.append(stored)
        return stored

    def pop_next_command(self, client_id: str) -> dict[str, Any] | None:
        normalized = str(client_id or "").strip()
        if not normalized:
            return None
        with self._lock:
            queue = self._commands.get(normalized)
            if not queue:
                return None
            item = queue.pop(0)
            if not queue:
                self._commands.pop(normalized, None)
            return item

    def delete(self, client_id: str) -> bool:
        client_id = str(client_id).strip()
        if not client_id:
            return False
        with self._lock:
            self._commands.pop(client_id, None)
            return self._states.pop(client_id, None) is not None

    def clear(self) -> int:
        with self._lock:
            count = len(self._states)
            self._states.clear()
            self._commands.clear()
        return count

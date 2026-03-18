"""Session persistence primitives for agent harnesses."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class AgentSessionRecord:
    """Normalized persisted session state."""

    session_id: str
    agent_name: str
    workspace_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)


class SessionStore(Protocol):
    """Persistence contract shared by hosted and filesystem-backed harnesses."""

    def save(self, record: AgentSessionRecord) -> AgentSessionRecord:
        """Persist a session record."""

    def get(self, session_id: str) -> AgentSessionRecord | None:
        """Load one session record."""

    def list(self, *, workspace_id: str | None = None) -> list[AgentSessionRecord]:
        """List persisted sessions."""

    def delete(self, session_id: str) -> None:
        """Delete one session record."""


class InMemorySessionStore:
    """Simple store used by tests and process-local harnesses."""

    def __init__(self) -> None:
        self._records: dict[str, AgentSessionRecord] = {}

    def save(self, record: AgentSessionRecord) -> AgentSessionRecord:
        record.updated_at = _utc_now()
        self._records[record.session_id] = record
        return record

    def get(self, session_id: str) -> AgentSessionRecord | None:
        return self._records.get(session_id)

    def list(self, *, workspace_id: str | None = None) -> list[AgentSessionRecord]:
        records = list(self._records.values())
        if workspace_id is None:
            return records
        return [record for record in records if record.workspace_id == workspace_id]

    def delete(self, session_id: str) -> None:
        self._records.pop(session_id, None)


class FilesystemSessionStore:
    """Filesystem-backed session store for CLI/dev harnesses."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path_for(self, session_id: str) -> Path:
        return self.root / f"{session_id}.json"

    def save(self, record: AgentSessionRecord) -> AgentSessionRecord:
        record.updated_at = _utc_now()
        self._path_for(record.session_id).write_text(
            json.dumps(asdict(record), indent=2, sort_keys=True),
            encoding="utf-8",
        )
        return record

    def get(self, session_id: str) -> AgentSessionRecord | None:
        path = self._path_for(session_id)
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return AgentSessionRecord(**data)

    def list(self, *, workspace_id: str | None = None) -> list[AgentSessionRecord]:
        records: list[AgentSessionRecord] = []
        for path in sorted(self.root.glob("*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            record = AgentSessionRecord(**data)
            if workspace_id is not None and record.workspace_id != workspace_id:
                continue
            records.append(record)
        return records

    def delete(self, session_id: str) -> None:
        path = self._path_for(session_id)
        if path.exists():
            path.unlink()

"""Shared protocol for pluggable agent harnesses."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol

from fastapi import APIRouter

from ..workspace import WorkspaceContext


@dataclass(frozen=True)
class HarnessHealth:
    """Health result exposed by a harness."""

    ok: bool
    detail: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SessionRequest:
    """Normalized request to create an agent session."""

    user_id: str | None = None
    prompt: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SessionInfo:
    """Serializable session metadata returned by a harness."""

    session_id: str
    agent_name: str
    workspace_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class AgentHarness(Protocol):
    """Pluggable agent harness contract."""

    @property
    def name(self) -> str:
        """Stable harness name exposed to config and capabilities."""

    async def start(self) -> None:
        """Start background resources owned by this harness."""

    async def stop(self) -> None:
        """Stop background resources owned by this harness."""

    async def healthy(self) -> HarnessHealth:
        """Report current health."""

    def routes(self) -> list[APIRouter]:
        """Return FastAPI routers mounted for this harness."""

    async def create_session(self, ctx: WorkspaceContext, req: SessionRequest) -> SessionInfo:
        """Create a new session."""

    async def stream(self, ctx: WorkspaceContext, session_id: str) -> AsyncIterator[Any]:
        """Stream session events."""

    async def send_user_message(
        self,
        ctx: WorkspaceContext,
        session_id: str,
        message: str,
    ) -> None:
        """Append a user message to an existing session."""

    async def terminate_session(self, ctx: WorkspaceContext, session_id: str) -> None:
        """Terminate an existing session."""

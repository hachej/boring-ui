"""Provider-agnostic workspace request routing interface."""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from fastapi import Request
from starlette.responses import Response


@runtime_checkable
class WorkspaceRouter(Protocol):
    """Router interface for workspace-scoped request handling."""

    async def route(self, workspace_id: str, request: Request) -> Response:
        """Route an incoming request to the workspace runtime."""
        ...

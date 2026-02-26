"""UI state routes for workspace-core."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ...policy import enforce_delegated_policy_or_none
from .service import UIStateService


class UIStatePayload(BaseModel):
    """Frontend snapshot payload."""

    client_id: str = Field(..., min_length=1, max_length=256)
    active_panel_id: str | None = None
    open_panels: list[dict[str, Any]] = Field(default_factory=list)
    project_root: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)
    captured_at_ms: int | None = None

    model_config = {"extra": "allow"}


class UICommandPayload(BaseModel):
    """Generic UI command payload consumed by the frontend."""

    kind: str = Field(..., min_length=1, max_length=64)
    panel_id: str | None = Field(default=None, max_length=512)
    component: str | None = Field(default=None, max_length=128)
    title: str | None = Field(default=None, max_length=256)
    params: dict[str, Any] = Field(default_factory=dict)
    prefer_existing: bool = True
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class UICommandEnvelope(BaseModel):
    """Top-level request for enqueuing a UI command."""

    client_id: str | None = Field(default=None, max_length=256)
    command: UICommandPayload


class UIFocusRequest(BaseModel):
    """Convenience focus request wrapper."""

    panel_id: str = Field(..., min_length=1, max_length=512)
    client_id: str | None = Field(default=None, max_length=256)


_SERVICE = UIStateService()


def get_ui_state_service() -> UIStateService:
    """Return module-level UI state service singleton."""

    return _SERVICE


def create_ui_state_router() -> APIRouter:
    """Create workspace-core UI state router."""

    router = APIRouter(tags=["ui"])

    def _resolve_client_or_404(client_id: str | None = None) -> str:
        resolved = _SERVICE.resolve_client_id(client_id)
        if not resolved:
            raise HTTPException(404, "No frontend state client is available")
        return resolved

    def _validate_command_or_raise(command: dict[str, Any], target_client_id: str) -> dict[str, Any]:
        kind = str(command.get("kind", "")).strip()
        if kind not in {"focus_panel", "open_panel"}:
            raise HTTPException(400, "Unsupported command kind. Supported: focus_panel, open_panel")

        if kind == "focus_panel":
            panel_id = str(command.get("panel_id", "")).strip()
            if not panel_id:
                raise HTTPException(400, "focus_panel requires panel_id")
            pane_state = _SERVICE.list_open_panels(target_client_id)
            panel_ids = {
                str(panel.get("id", "")).strip()
                for panel in (pane_state or {}).get("open_panels", [])
                if isinstance(panel, dict)
            }
            if panel_id not in panel_ids:
                raise HTTPException(
                    409,
                    f"Panel '{panel_id}' is not currently open for client_id '{target_client_id}'",
                )
            command["panel_id"] = panel_id

        if kind == "open_panel":
            component = str(command.get("component", "")).strip()
            if not component:
                raise HTTPException(400, "open_panel requires component")
            command["component"] = component

        command["kind"] = kind
        return command

    @router.put("/state")
    @router.post("/state")
    async def upsert_ui_state(request: Request, body: UIStatePayload):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.ui-state.write",
        )
        if deny is not None:
            return deny
        stored = _SERVICE.upsert(body.model_dump())
        return {"ok": True, "state": stored}

    @router.get("/state")
    async def list_ui_states(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.ui-state.list",
        )
        if deny is not None:
            return deny
        states = _SERVICE.list()
        return {"ok": True, "states": states, "count": len(states)}

    @router.get("/state/latest")
    async def latest_ui_state(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.ui-state.latest",
        )
        if deny is not None:
            return deny
        state = _SERVICE.get_latest()
        if state is None:
            raise HTTPException(404, "No frontend state has been published")
        return {"ok": True, "state": state}

    @router.get("/state/{client_id}")
    async def get_ui_state(client_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.ui-state.get",
        )
        if deny is not None:
            return deny
        state = _SERVICE.get(client_id)
        if state is None:
            raise HTTPException(404, f"State for client_id '{client_id}' not found")
        return {"ok": True, "state": state}

    @router.get("/panes")
    async def list_latest_open_panes(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.ui-state.panes.latest",
        )
        if deny is not None:
            return deny
        panes = _SERVICE.list_open_panels()
        if panes is None:
            raise HTTPException(404, "No frontend state has been published")
        return {"ok": True, **panes}

    @router.get("/panes/{client_id}")
    async def list_open_panes_for_client(client_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.ui-state.panes.get",
        )
        if deny is not None:
            return deny
        panes = _SERVICE.list_open_panels(client_id)
        if panes is None:
            raise HTTPException(404, f"State for client_id '{client_id}' not found")
        return {"ok": True, **panes}

    @router.post("/commands")
    async def enqueue_ui_command(request: Request, body: UICommandEnvelope):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.ui-state.command.enqueue",
        )
        if deny is not None:
            return deny

        target_client_id = _resolve_client_or_404(body.client_id)
        command = _validate_command_or_raise(
            body.command.model_dump(exclude_none=True),
            target_client_id,
        )
        queued = _SERVICE.enqueue_command(command, target_client_id)
        if queued is None:
            raise HTTPException(404, f"State for client_id '{target_client_id}' not found")
        return {"ok": True, "command": queued}

    @router.get("/commands/next")
    async def next_ui_command(client_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.ui-state.command.next",
        )
        if deny is not None:
            return deny
        command = _SERVICE.pop_next_command(client_id)
        return {"ok": True, "command": command}

    @router.post("/focus")
    async def enqueue_focus_command(request: Request, body: UIFocusRequest):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.ui-state.focus",
        )
        if deny is not None:
            return deny

        target_client_id = _resolve_client_or_404(body.client_id)
        command = _validate_command_or_raise(
            {"kind": "focus_panel", "panel_id": body.panel_id},
            target_client_id,
        )
        queued = _SERVICE.enqueue_command(command, target_client_id)
        if queued is None:
            raise HTTPException(404, f"State for client_id '{target_client_id}' not found")
        return {"ok": True, "command": queued}

    @router.delete("/state/{client_id}")
    async def delete_ui_state(client_id: str, request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.ui-state.delete",
        )
        if deny is not None:
            return deny
        deleted = _SERVICE.delete(client_id)
        if not deleted:
            raise HTTPException(404, f"State for client_id '{client_id}' not found")
        return {"ok": True, "deleted": client_id}

    @router.delete("/state")
    async def clear_ui_states(request: Request):
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.ui-state.clear",
        )
        if deny is not None:
            return deny
        cleared = _SERVICE.clear()
        return {"ok": True, "cleared": cleared}

    return router

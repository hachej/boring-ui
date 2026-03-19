"""FastAPI dependencies for request-scoped workspace resolution."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import HTTPException, Request, WebSocket

from ..config import APIConfig
from ..git_backend import GitBackend
from ..middleware.request_id import ensure_request_id
from ..observability import log_event
from ..storage import LocalStorage, Storage
from ..subprocess_git import SubprocessGitBackend
from .context import WorkspaceContext, WorkspaceContextResolver

logger = logging.getLogger("boring_ui.workspace")


def _default_single_mode(config: APIConfig) -> bool:
    return config.control_plane_provider == "local"


def _build_storage_factory(config: APIConfig, storage: Storage | None):
    resolved_base = config.workspace_root.resolve()

    def factory(root_path: Path) -> Storage:
        resolved_root = Path(root_path).resolve()
        if storage is not None and resolved_root == resolved_base:
            return storage
        return LocalStorage(resolved_root)

    return factory


def _build_git_backend_factory(config: APIConfig, git_backend: GitBackend | None):
    resolved_base = config.workspace_root.resolve()

    def factory(root_path: Path) -> GitBackend:
        resolved_root = Path(root_path).resolve()
        if git_backend is not None and resolved_root == resolved_base:
            return git_backend
        return SubprocessGitBackend(resolved_root)

    return factory


def build_workspace_context_resolver(
    config: APIConfig,
    *,
    storage: Storage | None = None,
    git_backend: GitBackend | None = None,
    single_mode: bool | None = None,
) -> WorkspaceContextResolver:
    """Create a resolver from application configuration."""

    return WorkspaceContextResolver(
        config.workspace_root,
        single_mode=_default_single_mode(config) if single_mode is None else single_mode,
        storage_factory=_build_storage_factory(config, storage),
        git_backend_factory=_build_git_backend_factory(config, git_backend),
        execution_backend_factory=lambda _root: config.create_execution_backend(),
    )


def _workspace_id_from_scope(path_params: dict, headers) -> str | None:
    workspace_id = path_params.get("workspace_id")
    if workspace_id is not None and str(workspace_id).strip():
        return str(workspace_id).strip()
    header_id = headers.get("x-workspace-id")
    if header_id is not None and str(header_id).strip():
        return str(header_id).strip()
    return None


def _resolver_for_request(
    *,
    config: APIConfig | None,
    storage: Storage | None,
    git_backend: GitBackend | None,
    app,
) -> WorkspaceContextResolver:
    if config is not None:
        return build_workspace_context_resolver(
            config,
            storage=storage,
            git_backend=git_backend,
        )
    resolver = getattr(app.state, "workspace_context_resolver", None)
    if resolver is not None:
        return resolver
    app_config = getattr(app.state, "app_config", None)
    if app_config is None:
        raise RuntimeError("Workspace context resolver is not configured")
    resolver = build_workspace_context_resolver(app_config)
    app.state.workspace_context_resolver = resolver
    return resolver


async def resolve_workspace_context(
    request: Request,
    *,
    config: APIConfig | None = None,
    storage: Storage | None = None,
    git_backend: GitBackend | None = None,
) -> WorkspaceContext:
    """Resolve workspace context for an HTTP request."""

    request_id = ensure_request_id(request)
    resolver = _resolver_for_request(
        config=config,
        storage=storage,
        git_backend=git_backend,
        app=request.app,
    )
    workspace_id = _workspace_id_from_scope(request.path_params, request.headers)
    try:
        ctx = resolver.resolve(workspace_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    log_event(
        logger,
        "workspace_context_resolved",
        request_id=request_id,
        workspace_id=ctx.workspace_id or "",
        root_path=str(ctx.root_path),
        transport="http",
    )
    return ctx


async def get_workspace_context(request: Request) -> WorkspaceContext:
    """Public FastAPI dependency for HTTP routes."""

    return await resolve_workspace_context(request)


async def resolve_websocket_workspace_context(
    websocket: WebSocket,
    *,
    config: APIConfig | None = None,
    storage: Storage | None = None,
    git_backend: GitBackend | None = None,
) -> WorkspaceContext:
    """Resolve workspace context for a WebSocket connection."""

    request_id = ensure_request_id(websocket)
    resolver = _resolver_for_request(
        config=config,
        storage=storage,
        git_backend=git_backend,
        app=websocket.app,
    )
    workspace_id = _workspace_id_from_scope(websocket.path_params, websocket.headers)
    ctx = resolver.resolve(workspace_id)
    log_event(
        logger,
        "workspace_context_resolved",
        request_id=request_id,
        workspace_id=ctx.workspace_id or "",
        root_path=str(ctx.root_path),
        transport="websocket",
    )
    return ctx


async def get_websocket_workspace_context(websocket: WebSocket) -> WorkspaceContext:
    """Public FastAPI dependency for WebSocket routes."""

    return await resolve_websocket_workspace_context(websocket)

"""Workspace routing, provisioning protocols, and request context helpers."""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING

# Eager imports — small protocol modules, no circular-dep risk.
from .provisioner import ProvisionResult, WorkspaceProvisioner
from .router_protocol import WorkspaceRouter

if TYPE_CHECKING:
    from .context import WorkspaceContext, WorkspaceContextResolver
    from .paths import openat2_available, resolve_path_beneath, resolve_workspace_root, safe_open
    from .resolver import (
        build_workspace_context_resolver,
        get_websocket_workspace_context,
        get_workspace_context,
        resolve_websocket_workspace_context,
        resolve_workspace_context,
    )

__all__ = [
    # provisioner / router (eager)
    "ProvisionResult",
    "WorkspaceProvisioner",
    "WorkspaceRouter",
    # context helpers (lazy)
    "WorkspaceContext",
    "WorkspaceContextResolver",
    "build_workspace_context_resolver",
    "get_workspace_context",
    "get_websocket_workspace_context",
    "openat2_available",
    "resolve_path_beneath",
    "resolve_workspace_context",
    "resolve_websocket_workspace_context",
    "resolve_workspace_root",
    "safe_open",
]


def __getattr__(name: str):
    if name in {"WorkspaceContext", "WorkspaceContextResolver"}:
        module = import_module(".context", __name__)
    elif name in {
        "build_workspace_context_resolver",
        "get_websocket_workspace_context",
        "get_workspace_context",
        "resolve_websocket_workspace_context",
        "resolve_workspace_context",
    }:
        module = import_module(".resolver", __name__)
    elif name in {
        "openat2_available",
        "resolve_path_beneath",
        "resolve_workspace_root",
        "safe_open",
    }:
        module = import_module(".paths", __name__)
    else:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    return getattr(module, name)

"""Workspace context primitives."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from ..git_backend import GitBackend
from ..storage import LocalStorage, Storage
from ..subprocess_git import SubprocessGitBackend
from .paths import resolve_workspace_root


@dataclass(frozen=True)
class WorkspaceContext:
    """Per-request workspace context."""

    workspace_id: str | None
    root_path: Path
    storage: Storage
    git_backend: GitBackend
    execution_backend: Any | None = None


class WorkspaceContextResolver:
    """Resolve workspace-scoped dependencies per request."""

    def __init__(
        self,
        base_root: Path,
        *,
        single_mode: bool,
        storage_factory: Callable[[Path], Storage] | None = None,
        git_backend_factory: Callable[[Path], GitBackend] | None = None,
        execution_backend_factory: Callable[[Path], Any | None] | None = None,
    ) -> None:
        self.base_root = Path(base_root).resolve()
        self.single_mode = single_mode
        self._storage_factory = storage_factory or LocalStorage
        self._git_backend_factory = git_backend_factory or SubprocessGitBackend
        self._execution_backend_factory = execution_backend_factory

    def resolve_root(self, workspace_id: str | None) -> Path:
        return resolve_workspace_root(
            self.base_root,
            workspace_id,
            single_mode=self.single_mode,
        )

    def resolve(self, workspace_id: str | None) -> WorkspaceContext:
        root_path = self.resolve_root(workspace_id)
        execution_backend = None
        if self._execution_backend_factory is not None:
            execution_backend = self._execution_backend_factory(root_path)
        return WorkspaceContext(
            workspace_id=(str(workspace_id).strip() or None) if workspace_id is not None else None,
            root_path=root_path,
            storage=self._storage_factory(root_path),
            git_backend=self._git_backend_factory(root_path),
            execution_backend=execution_backend,
        )

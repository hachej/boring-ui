"""File operation routes for boring-ui API."""
import asyncio
from dataclasses import replace

from fastapi import APIRouter, Depends, Query, Request

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from ...storage import Storage
from ...workspace import WorkspaceContext, resolve_workspace_context
from .schemas import FileContent, RenameRequest, MoveRequest
from .service import FileService


def create_file_router(config: APIConfig, storage: Storage) -> APIRouter:
    """Create file operations router.

    Args:
        config: API configuration (for path validation)
        storage: Storage backend

    Returns:
        Configured APIRouter with file endpoints
    """
    router = APIRouter(tags=['files'])

    async def _workspace_context(request: Request) -> WorkspaceContext:
        return await resolve_workspace_context(request, config=config, storage=storage)

    def _service_for_context(ctx: WorkspaceContext) -> FileService:
        request_config = replace(config, workspace_root=ctx.root_path)
        return FileService(request_config, ctx.storage)

    @router.get('/list')
    async def list_files(
        request: Request,
        path: str = '.',
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """List directory contents."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.files.list",
        )
        if deny is not None:
            return deny
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.list_directory, path)

    @router.get('/read')
    async def read_file(
        request: Request,
        path: str,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """Read file contents."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.files.read",
        )
        if deny is not None:
            return deny
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.read_file, path)

    @router.put('/write')
    async def write_file(
        request: Request,
        path: str,
        body: FileContent,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """Write file contents."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.files.write",
        )
        if deny is not None:
            return deny
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.write_file, path, body.content)

    @router.delete('/delete')
    async def delete_file(
        request: Request,
        path: str,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """Delete file."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.files.delete",
        )
        if deny is not None:
            return deny
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.delete_file, path)

    @router.post('/rename')
    async def rename_file(
        request: Request,
        body: RenameRequest,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """Rename file."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.files.rename",
        )
        if deny is not None:
            return deny
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.rename_file, body.old_path, body.new_path)

    @router.post('/move')
    async def move_file(
        request: Request,
        body: MoveRequest,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """Move file to a different directory."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.write"},
            operation="workspace-core.files.move",
        )
        if deny is not None:
            return deny
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.move_file, body.src_path, body.dest_dir)

    @router.get('/search')
    async def search_files(
        request: Request,
        q: str = Query(..., min_length=1, description='Search pattern (glob-style)'),
        path: str = Query('.', description='Directory to search in'),
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """Search files by name pattern."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.files.read"},
            operation="workspace-core.files.search",
        )
        if deny is not None:
            return deny
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.search_files, q, path)

    return router

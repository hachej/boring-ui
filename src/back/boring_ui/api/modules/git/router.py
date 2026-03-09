"""Git operation routes for boring-ui API."""
import asyncio

from fastapi import APIRouter, Request

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from .service import GitService


def create_git_router(config: APIConfig) -> APIRouter:
    """Create git operations router.

    Args:
        config: API configuration with workspace_root

    Returns:
        FastAPI router with git endpoints
    """
    router = APIRouter(tags=['git'])
    service = GitService(config)

    @router.get('/status')
    async def get_status(request: Request):
        """Get git repository status.

        Returns:
            dict with is_repo (bool) and files (dict of status entries)
        """
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.read"},
            operation="workspace-core.git.status",
        )
        if deny is not None:
            return deny
        return await asyncio.to_thread(service.get_status)

    @router.get('/diff')
    async def get_diff(request: Request, path: str):
        """Get diff for a specific file against HEAD.

        Args:
            path: File path relative to workspace root

        Returns:
            dict with diff content and path
        """
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.read"},
            operation="workspace-core.git.diff",
        )
        if deny is not None:
            return deny
        return await asyncio.to_thread(service.get_diff, path)

    @router.get('/show')
    async def get_show(request: Request, path: str):
        """Get file contents at HEAD.

        Args:
            path: File path relative to workspace root

        Returns:
            dict with content at HEAD (or null if not tracked)
        """
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.read"},
            operation="workspace-core.git.show",
        )
        if deny is not None:
            return deny
        return await asyncio.to_thread(service.get_show, path)

    # -------------------------------------------------------------------
    # Write operations
    # -------------------------------------------------------------------

    @router.post('/init')
    async def init_repo(request: Request):
        """Initialize a git repository."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.write"},
            operation="workspace-core.git.init",
        )
        if deny is not None:
            return deny
        return await asyncio.to_thread(service.init_repo)

    @router.post('/add')
    async def add_files(request: Request):
        """Stage files for commit."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.write"},
            operation="workspace-core.git.add",
        )
        if deny is not None:
            return deny
        body = await request.json()
        paths = body.get('paths')
        return await asyncio.to_thread(service.add_files, paths)

    @router.post('/commit')
    async def commit(request: Request):
        """Create a commit."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.write"},
            operation="workspace-core.git.commit",
        )
        if deny is not None:
            return deny
        body = await request.json()
        message = body.get('message', 'auto commit')
        author = body.get('author') or {}
        return await asyncio.to_thread(
            service.commit, message,
            author.get('name'), author.get('email'),
        )

    @router.post('/push')
    async def push(request: Request):
        """Push to remote."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.write"},
            operation="workspace-core.git.push",
        )
        if deny is not None:
            return deny
        body = await request.json()
        return await asyncio.to_thread(
            service.push,
            body.get('remote', 'origin'),
            body.get('branch'),
        )

    @router.post('/pull')
    async def pull(request: Request):
        """Pull from remote."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.write"},
            operation="workspace-core.git.pull",
        )
        if deny is not None:
            return deny
        body = await request.json()
        return await asyncio.to_thread(
            service.pull,
            body.get('remote', 'origin'),
            body.get('branch'),
        )

    @router.post('/clone')
    async def clone_repo(request: Request):
        """Clone a repository."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.write"},
            operation="workspace-core.git.clone",
        )
        if deny is not None:
            return deny
        body = await request.json()
        url = body.get('url')
        if not url:
            from fastapi import HTTPException as HE
            raise HE(status_code=400, detail='url is required')
        return await asyncio.to_thread(service.clone_repo, url, body.get('branch'))

    @router.post('/remote')
    async def add_remote(request: Request):
        """Add or update a remote."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.write"},
            operation="workspace-core.git.remote.add",
        )
        if deny is not None:
            return deny
        body = await request.json()
        name = body.get('name')
        url = body.get('url')
        if not name or not url:
            from fastapi import HTTPException as HE
            raise HE(status_code=400, detail='name and url are required')
        return await asyncio.to_thread(service.add_remote, name, url)

    @router.get('/remotes')
    async def list_remotes(request: Request):
        """List configured remotes."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.read"},
            operation="workspace-core.git.remotes",
        )
        if deny is not None:
            return deny
        return await asyncio.to_thread(service.list_remotes)

    return router

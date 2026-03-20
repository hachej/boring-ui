"""Git operation routes for boring-ui API."""
import asyncio
import logging
from dataclasses import replace

from fastapi import APIRouter, Depends, HTTPException, Request

from ...config import APIConfig
from ...policy import enforce_delegated_policy_or_none
from ...git_backend import GitBackend
from ...workspace import WorkspaceContext, resolve_workspace_context
from .service import GitService

logger = logging.getLogger(__name__)


async def _resolve_credentials_async(config: APIConfig, request: Request) -> dict | None:
    """Resolve git credentials for push/pull/clone.

    Resolution order:
    1. GitHub App connection (cache + DB via github_auth router)
    2. GitHub App via provisioning settings (repo_url + installation_id from DB)
    3. GIT_AUTH_TOKEN env var (PAT fallback for simple deployments)
    4. None (git uses its own credential resolution)
    """
    import os

    workspace_id = request.headers.get('x-workspace-id')

    if config.github_app_id and config.github_app_private_key and workspace_id:
        # 1. GitHub connection (manual connect via settings page)
        #    Checks in-memory cache first, then DB workspace_settings
        try:
            from ..github_auth.router import _resolve_connection
            from ..github_auth.service import GitHubAppService
            conn = await _resolve_connection(config, workspace_id)
            if conn and conn.get('installation_id'):
                gh = GitHubAppService(config)
                return gh.get_git_credentials(conn['installation_id'])
        except Exception as exc:
            logger.warning('Could not resolve credentials from GitHub connection: %s', exc)

        # 2. Provisioning settings (auto-provisioned repo with repo_url)
        try:
            from ..github_auth.provisioning import read_workspace_git_settings
            from ..github_auth.service import GitHubAppService
            from ...modules.control_plane.db_client import get_pool
            pool = get_pool()
            settings_key = config.settings_encryption_key or os.environ.get('BORING_SETTINGS_KEY', '')
            if pool and settings_key:
                git_settings = await read_workspace_git_settings(pool, workspace_id, settings_key)
                if git_settings and git_settings.get('installation_id'):
                    gh = GitHubAppService(config)
                    return gh.get_git_credentials(git_settings['installation_id'])
        except Exception as exc:
            logger.warning('Could not resolve credentials from workspace settings: %s', exc)

    # 3. PAT fallback
    pat = os.environ.get('GIT_AUTH_TOKEN')
    if pat:
        return {'username': 'x-access-token', 'password': pat}

    return None


def create_git_router(config: APIConfig, git_backend: GitBackend | None = None) -> APIRouter:
    """Create git operations router.

    Args:
        config: API configuration with workspace_root
        git_backend: Git backend. Defaults to SubprocessGitBackend.

    Returns:
        FastAPI router with git endpoints
    """
    router = APIRouter(tags=['git'])

    async def _workspace_context(request: Request) -> WorkspaceContext:
        return await resolve_workspace_context(request, config=config, git_backend=git_backend)

    def _service_for_context(ctx: WorkspaceContext) -> GitService:
        request_config = replace(config, workspace_root=ctx.root_path)
        return GitService(request_config, backend=ctx.git_backend)

    @router.get('/status')
    async def get_status(
        request: Request,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
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
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.get_status)

    @router.get('/diff')
    async def get_diff(
        request: Request,
        path: str,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
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
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.get_diff, path)

    @router.get('/show')
    async def get_show(
        request: Request,
        path: str,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
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
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.get_show, path)

    # -------------------------------------------------------------------
    # Write operations
    # -------------------------------------------------------------------

    @router.post('/init')
    async def init_repo(
        request: Request,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """Initialize a git repository."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.write"},
            operation="workspace-core.git.init",
        )
        if deny is not None:
            return deny
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.init_repo)

    @router.post('/add')
    async def add_files(
        request: Request,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
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
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.add_files, paths)

    @router.post('/commit')
    async def commit(
        request: Request,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
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
        service = _service_for_context(ctx)
        return await asyncio.to_thread(
            service.commit, message,
            author.get('name'), author.get('email'),
        )

    @router.post('/push')
    async def push(
        request: Request,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """Push to remote."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.write"},
            operation="workspace-core.git.push",
        )
        if deny is not None:
            return deny
        body = await request.json()
        creds = await _resolve_credentials_async(config, request)
        service = _service_for_context(ctx)
        return await asyncio.to_thread(
            service.push,
            body.get('remote', 'origin'),
            body.get('branch'),
            creds,
        )

    @router.post('/pull')
    async def pull(
        request: Request,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """Pull from remote."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.write"},
            operation="workspace-core.git.pull",
        )
        if deny is not None:
            return deny
        body = await request.json()
        creds = await _resolve_credentials_async(config, request)
        service = _service_for_context(ctx)
        return await asyncio.to_thread(
            service.pull,
            body.get('remote', 'origin'),
            body.get('branch'),
            creds,
        )

    @router.post('/clone')
    async def clone_repo(
        request: Request,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
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
        creds = await _resolve_credentials_async(config, request)
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.clone_repo, url, body.get('branch'), creds)

    @router.post('/remote')
    async def add_remote(
        request: Request,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
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
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.add_remote, name, url)

    # -------------------------------------------------------------------
    # Branch operations
    # -------------------------------------------------------------------

    @router.get('/branches')
    async def list_branches(
        request: Request,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """List local branches and current branch."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.read"},
            operation="workspace-core.git.branches",
        )
        if deny is not None:
            return deny
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.list_branches)

    @router.get('/branch')
    async def current_branch(
        request: Request,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """Get the current branch name."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.read"},
            operation="workspace-core.git.branch",
        )
        if deny is not None:
            return deny
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.current_branch)

    @router.post('/branch')
    async def create_branch(
        request: Request,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """Create a new branch."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.write"},
            operation="workspace-core.git.branch.create",
        )
        if deny is not None:
            return deny
        body = await request.json()
        name = body.get('name')
        if not name:
            raise HTTPException(status_code=400, detail='name is required')
        checkout = body.get('checkout', True)
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.create_branch, name, checkout)

    @router.post('/checkout')
    async def checkout(
        request: Request,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """Checkout a branch."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.write"},
            operation="workspace-core.git.checkout",
        )
        if deny is not None:
            return deny
        body = await request.json()
        name = body.get('name')
        if not name:
            raise HTTPException(status_code=400, detail='name is required')
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.checkout_branch, name)

    @router.post('/merge')
    async def merge(
        request: Request,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """Merge a branch into the current branch."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.write"},
            operation="workspace-core.git.merge",
        )
        if deny is not None:
            return deny
        body = await request.json()
        source = body.get('source')
        if not source:
            raise HTTPException(status_code=400, detail='source is required')
        message = body.get('message')
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.merge_branch, source, message)

    @router.get('/remotes')
    async def list_remotes(
        request: Request,
        ctx: WorkspaceContext = Depends(_workspace_context),
    ):
        """List configured remotes."""
        deny = enforce_delegated_policy_or_none(
            request,
            {"workspace.git.read"},
            operation="workspace-core.git.remotes",
        )
        if deny is not None:
            return deny
        service = _service_for_context(ctx)
        return await asyncio.to_thread(service.list_remotes)

    return router

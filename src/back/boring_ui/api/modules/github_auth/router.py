"""GitHub App OAuth routes for boring-ui API."""
import asyncio
import secrets

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from ...config import APIConfig
from .service import GitHubAppService


def create_github_auth_router(config: APIConfig) -> APIRouter:
    """Create GitHub App auth router.

    Endpoints:
      GET  /authorize     — Redirect to GitHub OAuth
      GET  /callback      — Exchange code for token
      GET  /status        — Check GitHub connection for workspace
      POST /disconnect    — Remove stored GitHub connection
      GET  /installations — List accessible installations
      GET  /repos         — List repos for an installation
      GET  /git-credentials — Get git credentials for an installation
    """
    router = APIRouter(tags=['github-auth'])
    service = GitHubAppService(config)

    # In-memory store: maps state -> redirect_uri for CSRF validation
    _pending_states: dict[str, str] = {}
    # In-memory store: workspace connections (workspace -> installation_id)
    # In production, persist to DB or workspace config
    _connections: dict[str, dict] = {}

    @router.get('/authorize')
    async def authorize(request: Request, redirect_uri: str | None = None):
        """Start GitHub OAuth flow. Redirects to GitHub."""
        if not service.is_configured:
            raise HTTPException(status_code=503, detail='GitHub App not configured')

        state = secrets.token_urlsafe(32)
        callback = redirect_uri or str(request.url_for('callback'))
        _pending_states[state] = callback

        url = service.get_authorize_url(callback, state)
        return RedirectResponse(url)

    @router.get('/callback')
    async def callback(code: str, state: str | None = None):
        """Handle GitHub OAuth callback. Exchanges code for token."""
        if not service.is_configured:
            raise HTTPException(status_code=503, detail='GitHub App not configured')

        if state and state not in _pending_states:
            raise HTTPException(status_code=400, detail='Invalid or expired state')
        if state:
            _pending_states.pop(state, None)

        data = await asyncio.to_thread(service.exchange_code, code)
        access_token = data.get('access_token')
        if not access_token:
            raise HTTPException(status_code=400, detail='No access token received')

        user = await asyncio.to_thread(service.get_user_info, access_token)
        installations = await asyncio.to_thread(
            service.get_user_installations, access_token,
        )

        return {
            'user': {
                'login': user.get('login'),
                'email': user.get('email'),
                'avatar_url': user.get('avatar_url'),
            },
            'access_token': access_token,
            'installations': [
                {
                    'id': i['id'],
                    'account': i['account']['login'],
                    'account_type': i['account']['type'],
                }
                for i in installations
            ],
        }

    @router.post('/connect')
    async def connect(request: Request):
        """Connect a workspace to a GitHub installation."""
        body = await request.json()
        workspace_id = body.get('workspace_id')
        installation_id = body.get('installation_id')
        if not workspace_id or not installation_id:
            raise HTTPException(
                status_code=400,
                detail='workspace_id and installation_id are required',
            )

        # Verify the installation is valid
        try:
            await asyncio.to_thread(
                service.get_installation_token, int(installation_id),
            )
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f'Invalid installation: {e}',
            )

        _connections[workspace_id] = {
            'installation_id': int(installation_id),
        }
        return {'connected': True, 'installation_id': int(installation_id)}

    @router.get('/status')
    async def status(workspace_id: str | None = None):
        """Check GitHub connection status for a workspace."""
        if not service.is_configured:
            return {'configured': False, 'connected': False}

        if not workspace_id:
            return {'configured': True, 'connected': False}

        conn = _connections.get(workspace_id)
        if not conn:
            return {'configured': True, 'connected': False}

        return {
            'configured': True,
            'connected': True,
            'installation_id': conn['installation_id'],
        }

    @router.post('/disconnect')
    async def disconnect(request: Request):
        """Disconnect a workspace from GitHub."""
        body = await request.json()
        workspace_id = body.get('workspace_id')
        if not workspace_id:
            raise HTTPException(status_code=400, detail='workspace_id is required')

        _connections.pop(workspace_id, None)
        return {'disconnected': True}

    @router.get('/installations')
    async def list_installations():
        """List all app installations."""
        if not service.is_configured:
            raise HTTPException(status_code=503, detail='GitHub App not configured')
        installations = await asyncio.to_thread(service.list_installations)
        return {
            'installations': [
                {
                    'id': i['id'],
                    'account': i['account']['login'],
                    'account_type': i['account']['type'],
                }
                for i in installations
            ],
        }

    @router.get('/repos')
    async def list_repos(installation_id: int):
        """List repos accessible to an installation."""
        if not service.is_configured:
            raise HTTPException(status_code=503, detail='GitHub App not configured')
        repos = await asyncio.to_thread(service.list_repos, installation_id)
        return {
            'repos': [
                {
                    'full_name': r['full_name'],
                    'private': r['private'],
                    'clone_url': r['clone_url'],
                    'ssh_url': r['ssh_url'],
                }
                for r in repos
            ],
        }

    @router.get('/git-credentials')
    async def git_credentials(workspace_id: str):
        """Get git credentials for a connected workspace."""
        if not service.is_configured:
            raise HTTPException(status_code=503, detail='GitHub App not configured')

        conn = _connections.get(workspace_id)
        if not conn:
            raise HTTPException(
                status_code=404,
                detail='Workspace not connected to GitHub',
            )

        creds = await asyncio.to_thread(
            service.get_git_credentials, conn['installation_id'],
        )
        return creds

    return router

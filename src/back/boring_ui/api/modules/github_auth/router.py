"""GitHub App OAuth routes for boring-ui API."""
import asyncio
import json
import logging
import os
import secrets

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from ...config import APIConfig
from .service import GitHubAppService

logger = logging.getLogger(__name__)

# Module-level in-memory cache (populated from DB on first access).
_workspace_connections: dict[str, dict] = {}


# ── DB persistence helpers ──────────────────────────────────────────────

def _get_pool_and_key(config: APIConfig):
    """Get DB pool and settings encryption key (if available)."""
    try:
        from ..control_plane.supabase import db_client
        pool = db_client.get_pool_or_none()
    except Exception:
        pool = None
    settings_key = config.settings_encryption_key or os.environ.get('BORING_SETTINGS_KEY', '')
    return pool, settings_key


async def _db_read_connection(pool, settings_key: str, workspace_id: str) -> dict | None:
    """Read github_installation_id from workspace_settings table."""
    if not pool or not settings_key:
        return None
    try:
        import uuid as _uuid
        ws_uuid = _uuid.UUID(str(workspace_id))
    except (ValueError, AttributeError):
        return None
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT pgp_sym_decrypt(value, $2) AS val
                FROM workspace_settings
                WHERE workspace_id = $1 AND key = 'github_installation_id'
                """,
                ws_uuid, settings_key,
            )
        if row and row['val']:
            return {'installation_id': int(row['val'])}
    except Exception as exc:
        logger.warning('Failed to read GitHub connection for workspace %s: %s', workspace_id, exc)
    return None


async def _db_write_connection(pool, settings_key: str, workspace_id: str, installation_id: int) -> None:
    """Persist github_installation_id to workspace_settings table."""
    if not pool or not settings_key:
        return
    try:
        import uuid as _uuid
        ws_uuid = _uuid.UUID(str(workspace_id))
    except (ValueError, AttributeError):
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO workspace_settings (workspace_id, key, value)
                VALUES ($1, 'github_installation_id', pgp_sym_encrypt($2, $3))
                ON CONFLICT (workspace_id, key)
                DO UPDATE SET value = pgp_sym_encrypt($2, $3), updated_at = now()
                """,
                ws_uuid, str(installation_id), settings_key,
            )
    except Exception as exc:
        logger.error('Failed to persist GitHub connection for workspace %s: %s', workspace_id, exc)


async def _db_delete_connection(pool, settings_key: str, workspace_id: str) -> None:
    """Remove github_installation_id from workspace_settings table."""
    if not pool or not settings_key:
        return
    try:
        import uuid as _uuid
        ws_uuid = _uuid.UUID(str(workspace_id))
    except (ValueError, AttributeError):
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                DELETE FROM workspace_settings
                WHERE workspace_id = $1 AND key = 'github_installation_id'
                """,
                ws_uuid,
            )
    except Exception as exc:
        logger.error('Failed to delete GitHub connection for workspace %s: %s', workspace_id, exc)


async def _resolve_connection(config: APIConfig, workspace_id: str) -> dict | None:
    """Look up connection: in-memory cache first, then DB."""
    conn = _workspace_connections.get(workspace_id)
    if conn:
        return conn
    pool, settings_key = _get_pool_and_key(config)
    conn = await _db_read_connection(pool, settings_key, workspace_id)
    if conn:
        _workspace_connections[workspace_id] = conn  # populate cache
    return conn


async def _store_connection(config: APIConfig, workspace_id: str, installation_id: int) -> None:
    """Store connection in cache + DB."""
    _workspace_connections[workspace_id] = {'installation_id': installation_id}
    pool, settings_key = _get_pool_and_key(config)
    await _db_write_connection(pool, settings_key, workspace_id, installation_id)


async def _remove_connection(config: APIConfig, workspace_id: str) -> None:
    """Remove connection from cache + DB."""
    _workspace_connections.pop(workspace_id, None)
    pool, settings_key = _get_pool_and_key(config)
    await _db_delete_connection(pool, settings_key, workspace_id)


# ── Router factory ──────────────────────────────────────────────────────

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

    # In-memory store: maps state -> {callback, workspace_id} for CSRF validation
    _pending_states: dict[str, dict] = {}

    @router.get('/authorize')
    async def authorize(
        request: Request,
        redirect_uri: str | None = None,
        workspace_id: str | None = None,
    ):
        """Start GitHub OAuth flow. Redirects to GitHub."""
        if not service.is_configured:
            raise HTTPException(status_code=503, detail='GitHub App not configured')

        state = secrets.token_urlsafe(32)
        if redirect_uri:
            callback = redirect_uri
        else:
            # Build callback URL from the incoming request's scheme/host
            # so GitHub redirects back to the correct public URL
            scheme = request.headers.get('x-forwarded-proto', request.url.scheme)
            host = request.headers.get('x-forwarded-host', request.headers.get('host', request.url.netloc))
            path = str(request.url.path).rsplit('/authorize', 1)[0] + '/callback'
            callback = f'{scheme}://{host}{path}'

        _pending_states[state] = {
            'callback': callback,
            'workspace_id': workspace_id,
        }

        url = service.get_authorize_url(callback, state)
        return RedirectResponse(url)

    @router.get('/callback')
    async def callback(
        request: Request,
        code: str | None = None,
        state: str | None = None,
        installation_id: int | None = None,
        setup_action: str | None = None,
    ):
        """Handle GitHub OAuth callback.

        Supports both OAuth code exchange and GitHub App installation flow.
        Returns an HTML page that posts a message to the opener window.
        """
        if not service.is_configured:
            raise HTTPException(status_code=503, detail='GitHub App not configured')

        pending = None
        if state:
            pending = _pending_states.pop(state, None)

        workspace_id = pending.get('workspace_id') if pending else None
        # Also check query param (for installation flow)
        if not workspace_id:
            workspace_id = request.query_params.get('workspace_id')

        result = {'success': False, 'error': None}

        try:
            if code:
                # OAuth code exchange flow
                data = await asyncio.to_thread(service.exchange_code, code)
                access_token = data.get('access_token')
                if not access_token:
                    result['error'] = 'No access token received'
                else:
                    installations = await asyncio.to_thread(
                        service.get_user_installations, access_token,
                    )

                    if installations and workspace_id:
                        # Auto-connect to first installation
                        inst_id = installations[0]['id']
                        await _store_connection(config, workspace_id, inst_id)
                        result['success'] = True
                        result['installation_id'] = inst_id
                    elif installations:
                        result['success'] = True
                        result['installations'] = [
                            {
                                'id': i['id'],
                                'account': i['account']['login'],
                            }
                            for i in installations
                        ]
                    else:
                        result['error'] = 'No installations found. Please install the GitHub App first.'

            elif installation_id and setup_action:
                # GitHub App installation flow (install callback)
                if workspace_id:
                    await _store_connection(config, workspace_id, installation_id)
                result['success'] = True
                result['installation_id'] = installation_id
            else:
                result['error'] = 'Missing code or installation_id'
        except Exception as e:
            result['error'] = str(e)

        result_json = json.dumps(result)

        # Build redirect back to the app (workspace settings page)
        scheme = request.headers.get('x-forwarded-proto', request.url.scheme)
        host = request.headers.get(
            'x-forwarded-host',
            request.headers.get('host', request.url.netloc),
        )
        base = f'{scheme}://{host}'
        if workspace_id:
            redirect_to = f'{base}/w/{workspace_id}/settings'
        else:
            redirect_to = base

        html = f"""<!DOCTYPE html>
<html><head><title>GitHub Authorization</title></head>
<body>
<p>{'Connected successfully!' if result['success'] else result.get('error', 'Authorization failed.')}</p>
<p>Redirecting...</p>
<script>
  // Notify opener if this was opened as a popup
  try {{
    if (window.opener) {{
      window.opener.postMessage({{
        type: 'github-callback',
        ...{result_json}
      }}, window.location.origin);
      setTimeout(function() {{ window.close(); }}, 1000);
    }} else {{
      // Opened as a tab — redirect back to the app
      window.location.href = '{redirect_to}';
    }}
  }} catch(e) {{
    window.location.href = '{redirect_to}';
  }}
</script>
</body></html>"""
        return HTMLResponse(content=html)

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

        await _store_connection(config, workspace_id, int(installation_id))
        return {'connected': True, 'installation_id': int(installation_id)}

    @router.get('/status')
    async def status(workspace_id: str | None = None):
        """Check GitHub connection status for a workspace."""
        if not service.is_configured:
            return {'configured': False, 'connected': False}

        if not workspace_id:
            return {'configured': True, 'connected': False}

        conn = await _resolve_connection(config, workspace_id)
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

        await _remove_connection(config, workspace_id)
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

        conn = await _resolve_connection(config, workspace_id)
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

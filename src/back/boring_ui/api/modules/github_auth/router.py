"""GitHub App OAuth routes for boring-ui API."""
import asyncio
import base64
import json
import logging
import os
import secrets
from urllib.parse import urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from ...config import APIConfig
from ..control_plane.auth_session import SessionExpired, SessionInvalid, parse_session_cookie
from ..control_plane.repository import LocalControlPlaneRepository
from ..control_plane.service import ControlPlaneService
from ..control_plane.user_settings_state import (
    read_user_github_link,
    user_state_service,
    write_user_github_link,
)
from .service import GitHubAppService

logger = logging.getLogger(__name__)
_ALLOWED_GIT_PROXY_HOSTS = {'github.com', 'www.github.com'}

# Module-level in-memory cache (populated from DB on first access).
_workspace_connections: dict[str, dict] = {}


# ── DB persistence helpers ──────────────────────────────────────────────

def _get_pool_and_key(config: APIConfig):
    """Get DB pool and settings encryption key (if available)."""
    try:
        from ..control_plane import db_client
        pool = db_client.get_pool_or_none()
    except Exception:
        pool = None
    settings_key = config.settings_encryption_key or os.environ.get('BORING_SETTINGS_KEY', '')
    return pool, settings_key


def _local_control_plane_service(config: APIConfig) -> ControlPlaneService:
    state_path = config.validate_path(config.control_plane_state_relpath)
    repo = LocalControlPlaneRepository(state_path)
    return ControlPlaneService(repo, workspace_root=config.workspace_root)


def _load_session_optional(request: Request, config: APIConfig):
    token = request.cookies.get(config.auth_session_cookie_name, '')
    if not token:
        return None
    try:
        return parse_session_cookie(token, secret=config.auth_session_secret)
    except (SessionExpired, SessionInvalid):
        return None


def _normalize_repo_url(value: str | None) -> str:
    raw = str(value or '').strip()
    if not raw:
        return ''
    if raw.startswith('git@github.com:'):
        repo = raw.split(':', 1)[1]
        return f'https://github.com/{repo.removesuffix(".git")}'.rstrip('/').lower()
    parsed = urlsplit(raw)
    if parsed.scheme and parsed.netloc:
        path = parsed.path.removesuffix('.git').rstrip('/')
        return f'{parsed.scheme}://{parsed.netloc}{path}'.lower()
    return raw.removesuffix('.git').rstrip('/').lower()


def _build_git_proxy_target(target: str, request: Request) -> str:
    raw = str(target or '').strip()
    if not raw:
        raise HTTPException(status_code=400, detail='target is required')

    parsed = urlsplit(raw)
    if not parsed.scheme:
        parsed = urlsplit(f'https://{raw}')

    if parsed.scheme != 'https' or parsed.netloc.lower() not in _ALLOWED_GIT_PROXY_HOSTS:
        raise HTTPException(status_code=400, detail='Only https://github.com targets are allowed')

    return urlunsplit((
        parsed.scheme,
        parsed.netloc,
        parsed.path,
        request.url.query,
        '',
    ))


def _basic_auth_header(credentials: dict | None) -> str:
    if not credentials:
        return ''
    username = str(credentials.get('username') or '')
    password = str(credentials.get('password') or '')
    if not username and not password:
        return ''
    token = base64.b64encode(f'{username}:{password}'.encode('utf-8')).decode('ascii')
    return f'Basic {token}'


def _local_read_connection(config: APIConfig, workspace_id: str) -> dict | None:
    """Read GitHub installation + selected repo from local workspace settings."""
    if config.use_neon_control_plane:
        return None
    try:
        service = _local_control_plane_service(config)
        settings = service.get_workspace_settings(workspace_id) or {}
        raw_installation = settings.get('github_installation_id')
        raw_repo = settings.get('github_repo_url')
        if raw_installation is None and raw_repo is None:
            return None
        result: dict[str, object] = {}
        if raw_installation is not None:
            result['installation_id'] = int(raw_installation)
        if raw_repo:
            result['repo_url'] = str(raw_repo)
        return result or None
    except Exception as exc:
        logger.warning('Failed to read local GitHub connection for workspace %s: %s', workspace_id, exc)
        return None


def _local_write_connection(
    config: APIConfig,
    workspace_id: str,
    installation_id: int | None = None,
    repo_url: str | None = None,
) -> None:
    """Persist GitHub installation + selected repo in local workspace settings."""
    if config.use_neon_control_plane:
        return
    try:
        service = _local_control_plane_service(config)
        settings = dict(service.get_workspace_settings(workspace_id) or {})
        if installation_id is not None:
            settings['github_installation_id'] = str(installation_id)
        if repo_url is not None:
            settings['github_repo_url'] = str(repo_url)
        service.set_workspace_settings(workspace_id, settings)
    except Exception as exc:
        logger.error('Failed to persist local GitHub connection for workspace %s: %s', workspace_id, exc)


def _local_delete_connection(config: APIConfig, workspace_id: str) -> None:
    """Remove GitHub installation + selected repo from local workspace settings."""
    if config.use_neon_control_plane:
        return
    try:
        service = _local_control_plane_service(config)
        settings = dict(service.get_workspace_settings(workspace_id) or {})
        if settings:
            # Local control-plane upserts merge payloads, so explicit None values are
            # the safe way to clear previous GitHub linkage keys.
            settings['github_installation_id'] = None
            settings['github_repo_url'] = None
            service.set_workspace_settings(workspace_id, settings)
    except Exception as exc:
        logger.error('Failed to delete local GitHub connection for workspace %s: %s', workspace_id, exc)


async def _db_read_connection(pool, settings_key: str, workspace_id: str) -> dict | None:
    """Read GitHub installation + selected repo from workspace_settings table."""
    if not pool or not settings_key:
        return None
    try:
        import uuid as _uuid
        ws_uuid = _uuid.UUID(str(workspace_id))
    except (ValueError, AttributeError):
        return None
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT key, pgp_sym_decrypt(value, $2) AS val
                FROM workspace_settings
                WHERE workspace_id = $1 AND key IN ('github_installation_id', 'github_repo_url')
                """,
                ws_uuid, settings_key,
            )
        result: dict[str, object] = {}
        for row in rows:
            if row['key'] == 'github_installation_id' and row['val']:
                result['installation_id'] = int(row['val'])
            if row['key'] == 'github_repo_url' and row['val']:
                result['repo_url'] = str(row['val'])
        return result or None
    except Exception as exc:
        logger.warning('Failed to read GitHub connection for workspace %s: %s', workspace_id, exc)
    return None


async def _db_write_connection(
    pool,
    settings_key: str,
    workspace_id: str,
    installation_id: int | None = None,
    repo_url: str | None = None,
) -> None:
    """Persist GitHub installation + selected repo to workspace_settings table."""
    if not pool or not settings_key:
        return
    try:
        import uuid as _uuid
        ws_uuid = _uuid.UUID(str(workspace_id))
    except (ValueError, AttributeError):
        return
    try:
        async with pool.acquire() as conn:
            if installation_id is not None:
                await conn.execute(
                    """
                    INSERT INTO workspace_settings (workspace_id, key, value)
                    VALUES ($1, 'github_installation_id', pgp_sym_encrypt($2, $3))
                    ON CONFLICT (workspace_id, key)
                    DO UPDATE SET value = pgp_sym_encrypt($2, $3), updated_at = now()
                    """,
                    ws_uuid, str(installation_id), settings_key,
                )
            if repo_url is not None:
                await conn.execute(
                    """
                    INSERT INTO workspace_settings (workspace_id, key, value)
                    VALUES ($1, 'github_repo_url', pgp_sym_encrypt($2, $3))
                    ON CONFLICT (workspace_id, key)
                    DO UPDATE SET value = pgp_sym_encrypt($2, $3), updated_at = now()
                    """,
                    ws_uuid, str(repo_url), settings_key,
                )
    except Exception as exc:
        logger.error('Failed to persist GitHub connection for workspace %s: %s', workspace_id, exc)


async def _db_delete_connection(pool, settings_key: str, workspace_id: str) -> None:
    """Remove GitHub installation + selected repo from workspace_settings table."""
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
                WHERE workspace_id = $1 AND key IN ('github_installation_id', 'github_repo_url')
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
    if not conn:
        conn = _local_read_connection(config, workspace_id)
    if conn:
        _workspace_connections[workspace_id] = conn  # populate cache
    return conn


async def _store_connection(config: APIConfig, workspace_id: str, installation_id: int) -> None:
    """Store connection in cache + DB."""
    existing = await _resolve_connection(config, workspace_id) or {}
    updated = dict(existing)
    updated['installation_id'] = installation_id
    _workspace_connections[workspace_id] = updated
    pool, settings_key = _get_pool_and_key(config)
    await _db_write_connection(pool, settings_key, workspace_id, installation_id)
    _local_write_connection(config, workspace_id, installation_id)


async def _remove_connection(config: APIConfig, workspace_id: str) -> None:
    """Remove connection from cache + DB."""
    _workspace_connections.pop(workspace_id, None)
    pool, settings_key = _get_pool_and_key(config)
    await _db_delete_connection(pool, settings_key, workspace_id)
    _local_delete_connection(config, workspace_id)


async def _store_repo_selection(config: APIConfig, workspace_id: str, repo_url: str) -> None:
    """Persist selected workspace repo without altering installation linkage."""
    existing = _workspace_connections.get(workspace_id, {}).copy()
    existing['repo_url'] = repo_url
    _workspace_connections[workspace_id] = existing
    pool, settings_key = _get_pool_and_key(config)
    await _db_write_connection(pool, settings_key, workspace_id, repo_url=repo_url)
    _local_write_connection(config, workspace_id, repo_url=repo_url)


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
    user_service = user_state_service(config)

    # In-memory store: maps state -> {callback, workspace_id} for CSRF validation
    _pending_states: dict[str, dict] = {}

    def _current_user_github_link(request: Request) -> dict[str, object]:
        session = _load_session_optional(request, config)
        if session is None:
            return {'account_linked': False, 'default_installation_id': None}
        return read_user_github_link(user_service, session.user_id)

    def _persist_user_github_link(
        request: Request,
        *,
        account_linked: bool,
        default_installation_id: int | None = None,
    ) -> None:
        session = _load_session_optional(request, config)
        if session is None:
            return
        write_user_github_link(
            user_service,
            user_id=session.user_id,
            email=session.email,
            account_linked=account_linked,
            default_installation_id=default_installation_id,
        )

    @router.get('/authorize')
    async def authorize(
        request: Request,
        redirect_uri: str | None = None,
        workspace_id: str | None = None,
        force_install: bool = False,
    ):
        """Start GitHub OAuth flow. Redirects to GitHub."""
        if not service.can_authorize:
            raise HTTPException(status_code=503, detail='GitHub App authorize flow not configured')

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

        use_oauth_detection = bool(workspace_id and service.client_id and not force_install)
        if use_oauth_detection:
            url = service.get_oauth_authorize_url(callback, state)
        else:
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
                if not service.is_configured:
                    raise HTTPException(status_code=503, detail='GitHub App not configured for OAuth callback')
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
                        default_installation_id = inst_id if len(installations) == 1 else None
                        _persist_user_github_link(
                            request,
                            account_linked=True,
                            default_installation_id=default_installation_id,
                        )
                        result['success'] = True
                        result['installation_id'] = inst_id
                    elif installations:
                        default_installation_id = installations[0]['id'] if len(installations) == 1 else None
                        _persist_user_github_link(
                            request,
                            account_linked=True,
                            default_installation_id=default_installation_id,
                        )
                        result['success'] = True
                        result['installations'] = [
                            {
                                'id': i['id'],
                                'account': i['account']['login'],
                            }
                            for i in installations
                        ]
                    elif workspace_id and service._slug:
                        install_state = secrets.token_urlsafe(32)
                        _pending_states[install_state] = {
                            'callback': pending.get('callback') if pending else None,
                            'workspace_id': workspace_id,
                        }
                        result['install_url'] = service.get_installation_url(install_state)
                        result['message'] = 'Install the GitHub App to continue.'
                    else:
                        result['error'] = 'No installations found. Please install the GitHub App first.'

            elif installation_id and setup_action:
                # GitHub App installation flow (install callback)
                if workspace_id:
                    await _store_connection(config, workspace_id, installation_id)
                _persist_user_github_link(
                    request,
                    account_linked=True,
                    default_installation_id=installation_id,
                )
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
<p>{'Connected successfully!' if result.get('installation_id') or result.get('success') else result.get('message') or result.get('error') or 'Authorization failed.'}</p>
<p>Redirecting...</p>
<script>
  const result = {result_json};
  // Notify opener if this was opened as a popup
  try {{
    if (result.install_url) {{
      window.location.href = result.install_url;
    }} else if (window.opener) {{
      window.opener.postMessage({{
        type: 'github-callback',
        ...result
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
        _persist_user_github_link(
            request,
            account_linked=True,
            default_installation_id=int(installation_id),
        )
        return {'connected': True, 'installation_id': int(installation_id)}

    @router.get('/status')
    async def status(request: Request, workspace_id: str | None = None):
        """Check GitHub connection status for a workspace."""
        account_state = _current_user_github_link(request)
        if not service.can_authorize:
            return {
                'configured': False,
                'account_linked': bool(account_state.get('account_linked')),
                'default_installation_id': account_state.get('default_installation_id'),
                'connected': False,
                'installation_connected': False,
                'repo_selected': False,
                'repo_url': None,
            }

        if not workspace_id:
            return {
                'configured': True,
                'account_linked': bool(account_state.get('account_linked')),
                'default_installation_id': account_state.get('default_installation_id'),
                'connected': False,
                'installation_connected': False,
                'repo_selected': False,
                'repo_url': None,
            }

        conn = await _resolve_connection(config, workspace_id)
        if not conn:
            return {
                'configured': True,
                'account_linked': bool(account_state.get('account_linked')),
                'default_installation_id': account_state.get('default_installation_id'),
                'connected': False,
                'installation_connected': False,
                'repo_selected': False,
                'repo_url': None,
            }

        installation_id = conn.get('installation_id')
        repo_url = conn.get('repo_url')
        repo_selected = bool(installation_id and repo_url)

        return {
            'configured': True,
            'account_linked': bool(account_state.get('account_linked')) or bool(installation_id),
            'default_installation_id': account_state.get('default_installation_id'),
            'connected': bool(installation_id),
            'installation_connected': bool(installation_id),
            'installation_id': installation_id,
            'repo_selected': repo_selected,
            'repo_url': repo_url if repo_selected else None,
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

    @router.post('/repo')
    async def select_repo(request: Request):
        """Persist the selected GitHub repo for a workspace."""
        body = await request.json()
        workspace_id = body.get('workspace_id')
        repo_url = _normalize_repo_url(body.get('repo_url'))
        if not workspace_id or not repo_url:
            raise HTTPException(
                status_code=400,
                detail='workspace_id and repo_url are required',
            )
        conn = await _resolve_connection(config, workspace_id)
        if not conn or not conn.get('installation_id'):
            raise HTTPException(
                status_code=400,
                detail='Workspace must be connected to a GitHub installation first',
            )
        if not service.is_configured:
            raise HTTPException(status_code=503, detail='GitHub App not configured')

        repos = await asyncio.to_thread(service.list_repos, int(conn['installation_id']))
        selected_repo = next(
            (
                repo for repo in repos
                if repo_url in {
                    _normalize_repo_url(repo.get('clone_url')),
                    _normalize_repo_url(repo.get('ssh_url')),
                }
            ),
            None,
        )
        if not selected_repo:
            raise HTTPException(
                status_code=400,
                detail='Selected repo is not available to this GitHub installation',
            )

        canonical_repo_url = selected_repo.get('clone_url') or selected_repo.get('ssh_url') or repo_url
        await _store_repo_selection(config, workspace_id, canonical_repo_url)
        return {
            'selected': True,
            'repo_url': canonical_repo_url,
            'full_name': selected_repo.get('full_name'),
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

    async def _forward_git_proxy_request(target: str, request: Request, workspace_id: str | None = None):
        target_url = _build_git_proxy_target(target, request)
        forwarded_headers = {}
        for header_name in ('accept', 'authorization', 'content-type', 'git-protocol', 'user-agent'):
            value = request.headers.get(header_name)
            if value:
                forwarded_headers[header_name] = value

        if 'authorization' not in forwarded_headers and workspace_id:
            conn = await _resolve_connection(config, workspace_id)
            installation_id = conn.get('installation_id') if conn else None
            if installation_id:
                credentials = await asyncio.to_thread(
                    service.get_git_credentials, int(installation_id),
                )
                auth_header = _basic_auth_header(credentials)
                if auth_header:
                    forwarded_headers['authorization'] = auth_header

        body = await request.body()
        async with httpx.AsyncClient(follow_redirects=True, timeout=120) as client:
            upstream = await client.request(
                request.method,
                target_url,
                headers=forwarded_headers,
                content=body if body else None,
            )

        response_headers = {}
        for header_name in ('cache-control', 'content-type', 'etag', 'expires', 'last-modified', 'www-authenticate'):
            value = upstream.headers.get(header_name)
            if value:
                response_headers[header_name] = value

        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            headers=response_headers,
            media_type=upstream.headers.get('content-type'),
        )

    @router.api_route('/git-proxy/ws/{workspace_id}/{target:path}', methods=['GET', 'POST'])
    async def git_proxy_workspace(workspace_id: str, target: str, request: Request):
        """Workspace-aware same-origin proxy for browser git smart-HTTP traffic."""
        return await _forward_git_proxy_request(target, request, workspace_id)

    @router.api_route('/git-proxy/{target:path}', methods=['GET', 'POST'])
    async def git_proxy(target: str, request: Request):
        """Fallback proxy for browser git smart-HTTP requests to GitHub."""
        return await _forward_git_proxy_request(target, request)

    return router

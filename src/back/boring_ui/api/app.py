"""Application factory for boring-ui API."""
from contextlib import asynccontextmanager
import logging
import os
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from .config import APIConfig
from .git_backend import GitBackend
from .approval import ApprovalStore, InMemoryApprovalStore
from .agents import AgentRegistry, PiHarness
from .capabilities import (
    RouterRegistry,
    create_default_registry,
    create_capabilities_router,
    create_runtime_config_router,
)
from .middleware.request_id import RequestIDMiddleware, ensure_request_id
from .modules.agent_normal import create_agent_normal_router
from .modules.control_plane import create_auth_session_router
from .modules.control_plane import create_me_router
from .modules.control_plane import create_workspace_router
from .modules.control_plane import create_collaboration_router
from .modules.control_plane import create_workspace_boundary_router
from .modules.control_plane import db_client as control_plane_db_client
from .modules.pty.lifecycle import create_pty_lifecycle_router
from .observability import configure_structured_logging, ensure_metrics_registry
from .storage import Storage, LocalStorage
from .workspace import build_workspace_context_resolver
from .workspace_plugins import WorkspacePluginManager

logger = logging.getLogger(__name__)


def create_app(
    config: APIConfig | None = None,
    storage: Storage | None = None,
    approval_store: ApprovalStore | None = None,
    include_pty: bool = True,
    include_stream: bool = True,
    include_approval: bool = True,
    routers: list[str] | None = None,
    registry: RouterRegistry | None = None,
    *,
    git_backend: GitBackend | None = None,
) -> FastAPI:
    """Create a pre-wired FastAPI application.

    This is the primary entry point for using boring-ui backend.
    All dependencies are injectable for testing and customization.

    Args:
        config: API configuration. Defaults to current directory as workspace.
        storage: Storage backend. Defaults to LocalStorage.
        approval_store: Approval store. Defaults to InMemoryApprovalStore.
        include_pty: Include PTY WebSocket router (default: True)
        include_stream: Include Claude stream WebSocket router (default: True)
        include_approval: Include approval workflow router (default: True)
        routers: List of router names to include. If None, uses include_* flags.
            Valid names: 'files', 'git', 'ui_state', 'control_plane',
            'pty', 'stream', 'approval'
        registry: Custom router registry. Defaults to create_default_registry().

    Returns:
        Configured FastAPI application with all routes mounted.

    Example:
        # Minimal usage
        app = create_app()

        # Custom configuration
        config = APIConfig(
            workspace_root=Path('/my/project'),
            cors_origins=['https://myapp.com'],
        )
        app = create_app(config)

        # With custom storage
        from myapp.storage import RedisStorage
        app = create_app(storage=RedisStorage())

        # Minimal app (no WebSockets)
        app = create_app(include_pty=False, include_stream=False)

        # Using router list (alternative to include_* flags)
        app = create_app(routers=['files', 'git'])  # Only file and git routes
    """
    # Apply defaults
    config = config or APIConfig(
        workspace_root=Path(os.environ.get('BORING_UI_WORKSPACE_ROOT', str(Path.cwd()))),
    )
    storage = storage or LocalStorage(config.workspace_root)
    approval_store = approval_store or InMemoryApprovalStore()
    registry = registry or create_default_registry()

    # Determine which routers to include
    # If routers list is provided, use it; otherwise use include_* flags
    if routers is not None:
        enabled_routers = set(routers)
    else:
        enabled_routers = {'files', 'git', 'ui_state'}  # Core routers always included
        if config.control_plane_enabled:
            enabled_routers.add('control_plane')
        if include_pty:
            enabled_routers.add('pty')
        if include_stream:
            # Use new canonical name, but 'stream' also works via registry alias
            enabled_routers.add('chat_claude_code')
        if include_approval:
            enabled_routers.add('approval')

    # Support 'stream' alias -> 'chat_claude_code' for backward compatibility
    if 'stream' in enabled_routers:
        enabled_routers.add('chat_claude_code')

    # Build enabled features map for capabilities endpoint
    # Include both names for backward compatibility
    chat_enabled = 'chat_claude_code' in enabled_routers or 'stream' in enabled_routers
    pi_enabled = 'pi' in config.available_agents or config.agents_mode == 'backend'

    # In local-dev auto-login mode, surface GitHub UI even if app creds are not
    # configured yet so onboarding/settings can show the GitHub component.
    github_enabled = config.github_configured or config.auth_dev_auto_login

    enabled_features = {
        'files': 'files' in enabled_routers,
        'git': 'git' in enabled_routers,
        'ui_state': 'ui_state' in enabled_routers,
        'control_plane': 'control_plane' in enabled_routers,
        'pty': 'pty' in enabled_routers,
        'chat_claude_code': chat_enabled,
        'stream': chat_enabled,  # Backward compatibility alias
        'approval': 'approval' in enabled_routers,
        'pi': pi_enabled,
        # GitHub App integration (opt-in, requires GITHUB_APP_ID + private key)
        'github': github_enabled,
    }

    configure_structured_logging()

    pi_harness = None
    plugin_manager = None
    _db_pool_url: str | None = None
    _provisioner = None

    # Create Fly.io workspace provisioner when credentials are available.
    if config.fly_api_token and config.fly_workspace_app:
        from .workspace.fly_provisioner import FlyProvisioner

        _fly_image = os.environ.get(
            'FLY_IMAGE_REF',
            f'registry.fly.io/{config.fly_workspace_app}:latest',
        )
        _provisioner = FlyProvisioner(
            api_token=config.fly_api_token,
            workspace_app=config.fly_workspace_app,
            image=_fly_image,
        )
        logger.info(
            'FlyProvisioner configured: app=%s image=%s',
            config.fly_workspace_app,
            _fly_image,
        )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        # Auto git-init workspace on backend-agent Machines
        if config.agents_mode == 'backend':
            ws_root = config.workspace_root
            git_dir = ws_root / '.git'
            if not git_dir.exists():
                import subprocess
                try:
                    subprocess.run(['git', 'init'], cwd=str(ws_root), check=True, capture_output=True)
                    subprocess.run(['git', 'config', 'user.email', 'agent@boring.dev'], cwd=str(ws_root), check=True, capture_output=True)
                    subprocess.run(['git', 'config', 'user.name', 'Boring Agent'], cwd=str(ws_root), check=True, capture_output=True)
                    logger.info('Auto git-init workspace at %s', ws_root)
                except Exception:
                    logger.warning('Failed to auto git-init workspace', exc_info=True)

        if plugin_manager is not None:
            plugin_manager.start_watcher()
        if pi_harness is not None:
            try:
                await pi_harness.start()
            except Exception:
                logger.exception('Failed to start PiHarness')
        if _db_pool_url:
            await control_plane_db_client.create_pool(_db_pool_url)

        try:
            yield
        finally:
            if pi_harness is not None:
                await pi_harness.stop()
            if _provisioner is not None:
                await _provisioner.close()
            if _db_pool_url:
                await control_plane_db_client.close_pool()

    # Create app
    app = FastAPI(
        title='Boring UI API',
        description='A composition-based web IDE backend',
        version='0.1.0',
        lifespan=lifespan,
    )
    app.state.app_config = config
    app.state.provisioner = _provisioner
    app.state.enabled_features = dict(enabled_features)
    metrics_registry = ensure_metrics_registry(app)
    metrics_registry.set_gauge('pi_sessions_active', 0.0)
    agent_registry = AgentRegistry.from_config(config)
    app.state.agent_registry = agent_registry
    app.state.workspace_context_resolver = build_workspace_context_resolver(
        config,
        storage=storage,
        git_backend=git_backend,
    )
    if config.agents_mode == 'backend' and 'pi' in config.available_agents:
        pi_harness = PiHarness(config)
        agent_registry.register_harness(pi_harness)
        app.state.pi_harness = pi_harness

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=True,
        allow_methods=['*'],
        allow_headers=['*'],
    )
    app.add_middleware(RequestIDMiddleware)

    # Auto-login middleware for local dev: injects a session cookie when
    # AUTH_DEV_LOGIN_ENABLED=true and no session cookie is present.
    if config.auth_dev_auto_login and 'control_plane' in enabled_routers:
        from .modules.control_plane.auth_session import create_session_cookie

        _DEV_USER_ID = (
            os.environ.get('AUTH_DEV_USER_ID')
            or (
                '00000000-0000-0000-0000-000000000001'
                if config.use_neon_control_plane
                else 'dev-user'
            )
        )
        _DEV_EMAIL = os.environ.get('AUTH_DEV_EMAIL', 'dev@localhost')
        _cookie_name = config.auth_session_cookie_name
        _cookie_name_bytes = _cookie_name.encode()

        def _make_dev_token() -> str:
            return create_session_cookie(
                _DEV_USER_ID, _DEV_EMAIL,
                secret=config.auth_session_secret,
                ttl_seconds=config.auth_session_ttl_seconds,
            )

        def _has_valid_session_cookie(scope) -> bool:
            from .modules.control_plane.auth_session import parse_session_cookie, SessionError
            for key, val in scope.get('headers', []):
                if key == b'cookie' and _cookie_name_bytes in val:
                    # Extract the cookie value and validate it
                    for part in val.decode(errors='replace').split(';'):
                        part = part.strip()
                        if part.startswith(_cookie_name + '='):
                            token = part[len(_cookie_name) + 1:]
                            try:
                                payload = parse_session_cookie(token, secret=config.auth_session_secret)
                                if config.use_neon_control_plane:
                                    try:
                                        uuid.UUID(str(payload.user_id))
                                    except ValueError:
                                        return False
                                return True
                            except SessionError:
                                return False
                    return False
            return False

        _inner_app = app.router

        # Paths that manage their own session lifecycle — skip auto-login.
        _SKIP_PREFIXES = ('/auth/',)

        @app.middleware('http')
        async def dev_auto_login(request: Request, call_next):
            path = request.scope.get('path', '')
            if any(path.startswith(p) for p in _SKIP_PREFIXES):
                return await call_next(request)

            needs_cookie = not _has_valid_session_cookie(request.scope)
            if needs_cookie:
                token = _make_dev_token()
                # Rewrite headers so downstream sees the cookie.
                existing = request.headers.get('cookie', '')
                new_cookie = f'{existing}; {_cookie_name}={token}' if existing else f'{_cookie_name}={token}'
                new_headers = [
                    (k, v) for k, v in request.scope['headers'] if k != b'cookie'
                ]
                new_headers.append((b'cookie', new_cookie.encode()))
                request.scope['headers'] = new_headers

            response = await call_next(request)

            if needs_cookie:
                cookie_val = f'{_cookie_name}={token}; HttpOnly; Max-Age={config.auth_session_ttl_seconds}; Path=/; SameSite=Lax'
                response.headers.append('set-cookie', cookie_val)
            return response

    # Mount routers from registry based on enabled set.
    router_args = {
        'files': (config, storage),
        'git': (config, git_backend),
        'ui_state': (),
        'control_plane': (config,),
        'pty': (config,),
        'chat_claude_code': (config,),
        'stream': (config,),  # Alias
        'approval': (approval_store,),
    }

    # Track mounted factories to avoid double-mounting aliases
    # (stream and chat_claude_code use the same factory, but pty uses a different one)
    mounted_factories: set[int] = set()

    for router_name in enabled_routers:
        entry = registry.get(router_name)
        if entry:
            info, factory = entry
            # Skip if this factory is already mounted (avoids duplicate alias mounts)
            factory_id = id(factory)
            if factory_id in mounted_factories:
                continue
            mounted_factories.add(factory_id)
            args = router_args.get(router_name, ())
            app.include_router(factory(*args), prefix=info.prefix)

    # Canonical service-owned lifecycle routes that do not fit the router-registry model.
    # PTY WS remains under `/ws/pty`, but lifecycle metadata lives under `/api/v1/pty/*`.
    if 'pty' in enabled_routers:
        app.include_router(create_pty_lifecycle_router(config), prefix='/api/v1/pty')

    # agent-normal owns runtime-only session lifecycle endpoints under canonical prefix.
    app.include_router(
        create_agent_normal_router(config, pty_enabled=('pty' in enabled_routers)),
        prefix='/api/v1/agent/normal',
    )
    for router in agent_registry.routes():
        app.include_router(router)

    # Auth/session is a control-plane-owned surface under /auth/*.
    if 'control_plane' in enabled_routers:
        if config.use_neon_control_plane:
            from .modules.control_plane.auth_router_neon import create_auth_session_router_neon
            from .modules.control_plane.me_router_neon import create_me_router_neon
            from .modules.control_plane.workspace_router_hosted import create_workspace_router_hosted
            from .modules.control_plane.collaboration_router_hosted import (
                create_collaboration_router_hosted,
            )
            from .modules.control_plane.workspace_boundary_router_hosted import (
                create_workspace_boundary_router_hosted,
            )

            app.include_router(create_auth_session_router_neon(config))
            app.include_router(create_me_router_neon(config), prefix='/api/v1')
            app.include_router(create_workspace_router_hosted(config), prefix='/api/v1')
            app.include_router(create_collaboration_router_hosted(config), prefix='/api/v1')
            app.include_router(create_workspace_boundary_router_hosted(config))
        else:
            app.include_router(create_auth_session_router(config))
            app.include_router(create_me_router(config), prefix='/api/v1')
            app.include_router(create_workspace_router(config), prefix='/api/v1')
            app.include_router(create_collaboration_router(config), prefix='/api/v1')
            app.include_router(create_workspace_boundary_router(config))

    # GitHub auth surface:
    # - fully functional when configured
    # - still mounted in local-dev auto-login mode so frontend can show status UI
    if config.github_configured or config.auth_dev_auto_login:
        from .modules.github_auth import create_github_auth_router
        app.include_router(
            create_github_auth_router(config),
            prefix='/api/v1/auth/github',
        )

    # Workspace plugins are optional and disabled by default since they execute
    # workspace-local Python modules in-process.
    if config.workspace_plugins_enabled:
        allowlist = set(config.workspace_plugin_allowlist) if config.workspace_plugin_allowlist else None
        plugin_manager = WorkspacePluginManager(config.workspace_root, allowed_plugins=allowlist)
        app.mount('/api/x', plugin_manager.get_asgi_app())
        app.include_router(plugin_manager.create_ws_router())

    # Always include capabilities router (pass plugin_manager for workspace_panes)
    app.include_router(
        create_runtime_config_router(config, enabled_features),
    )
    app.include_router(
        create_capabilities_router(enabled_features, registry, config, plugin_manager),
        prefix='/api',
    )

    # Core utility endpoints are intentionally inlined here to keep runtime
    # dependencies minimal and avoid coupling to control-plane-era modules.
    @app.get('/health')
    async def health():
        """Health check endpoint."""
        return {
            'status': 'ok',
            'workspace': str(config.workspace_root),
            'features': enabled_features,
        }

    @app.get('/healthz')
    async def healthz(request: Request):
        """Operational health endpoint with correlation and metrics snapshot."""
        request_id = ensure_request_id(request)
        pi_status = 'ok' if enabled_features.get('pi') else 'disabled'
        if pi_harness is not None:
            pi_health = await pi_harness.healthy()
            pi_status = 'ok' if pi_health.ok else 'degraded'
        return {
            'status': 'ok',
            'request_id': request_id,
            'checks': {
                'api': 'ok',
                'pi': pi_status,
            },
            'workspace': str(config.workspace_root),
            'metrics': metrics_registry.snapshot(),
        }

    @app.get('/metrics', response_class=PlainTextResponse)
    async def metrics():
        """Prometheus-compatible metrics output."""
        return metrics_registry.render_prometheus()

    @app.get('/api/config')
    async def get_config():
        """Get API configuration info."""
        return {
            'workspace_root': str(config.workspace_root),
            'pty_providers': list(config.pty_providers.keys()),
            'paths': {
                'files': '.',
            },
        }

    @app.get('/api/project')
    async def get_project():
        """Get project root for the frontend."""
        return {
            'root': str(config.workspace_root),
        }

    if config.control_plane_enabled and config.use_neon_control_plane and config.effective_database_url:
        _db_pool_url = config.effective_database_url

    return app

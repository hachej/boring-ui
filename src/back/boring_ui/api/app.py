"""Application factory for boring-ui API."""
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import APIConfig
from .storage import Storage, LocalStorage
from .approval import ApprovalStore, InMemoryApprovalStore
from .capabilities import (
    RouterRegistry,
    create_default_registry,
    create_capabilities_router,
)
from .modules.agent_normal import create_agent_normal_router
from .modules.control_plane import create_auth_session_router
from .modules.control_plane import create_me_router
from .modules.control_plane import create_workspace_router
from .modules.control_plane import create_collaboration_router
from .modules.control_plane import create_workspace_boundary_router
from .modules.pty.lifecycle import create_pty_lifecycle_router
from .workspace_plugins import WorkspacePluginManager


def create_app(
    config: APIConfig | None = None,
    storage: Storage | None = None,
    approval_store: ApprovalStore | None = None,
    include_pty: bool = True,
    include_stream: bool = True,
    include_approval: bool = True,
    routers: list[str] | None = None,
    registry: RouterRegistry | None = None,
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
            Valid names: 'files', 'git', 'ui_state', 'control_plane', 'pty', 'stream', 'approval'
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
    config = config or APIConfig(workspace_root=Path.cwd())
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
    pi_embedded_mode = config.pi_mode != 'iframe'
    pi_enabled = pi_embedded_mode or bool(config.pi_url)

    enabled_features = {
        'files': 'files' in enabled_routers,
        'git': 'git' in enabled_routers,
        'ui_state': 'ui_state' in enabled_routers,
        'control_plane': 'control_plane' in enabled_routers,
        'pty': 'pty' in enabled_routers,
        'chat_claude_code': chat_enabled,
        'stream': chat_enabled,  # Backward compatibility alias
        'approval': 'approval' in enabled_routers,
        # Companion has a built-in embedded UI mode and does not require a service URL.
        'companion': True,
        # PI is available in embedded mode without PI_URL; iframe mode needs PI_URL.
        'pi': pi_enabled,
    }

    # Create app
    app = FastAPI(
        title='Boring UI API',
        description='A composition-based web IDE backend',
        version='0.1.0',
    )
    app.state.app_config = config

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=True,
        allow_methods=['*'],
        allow_headers=['*'],
    )

    # Mount routers from registry based on enabled set.
    router_args = {
        'files': (config, storage),
        'git': (config,),
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

    # Auth/session is a control-plane-owned surface under /auth/*.
    if 'control_plane' in enabled_routers:
        app.include_router(create_auth_session_router(config))
        app.include_router(create_me_router(config), prefix='/api/v1')
        app.include_router(create_workspace_router(config), prefix='/api/v1')
        app.include_router(create_collaboration_router(config), prefix='/api/v1')
        app.include_router(create_workspace_boundary_router(config))

    # Workspace plugins are optional and disabled by default since they execute
    # workspace-local Python modules in-process.
    plugin_manager = None
    if config.workspace_plugins_enabled:
        allowlist = set(config.workspace_plugin_allowlist) if config.workspace_plugin_allowlist else None
        plugin_manager = WorkspacePluginManager(config.workspace_root, allowed_plugins=allowlist)
        app.mount('/api/x', plugin_manager.get_asgi_app())
        app.include_router(plugin_manager.create_ws_router())

    # Always include capabilities router (pass plugin_manager for workspace_panes)
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

    @app.get('/api/v1/config/provider-keys')
    async def config_provider_keys():
        """Return AI provider API keys from environment for browser-side PI agent.

        Keys are read from standard environment variables so the host app
        can populate them via .env, Vault, or any secret management system.
        """
        import os as _os
        keys = {}
        for env_key, provider in [
            ('OPENAI_API_KEY', 'openai'),
            ('ANTHROPIC_API_KEY', 'anthropic'),
            ('GOOGLE_AI_API_KEY', 'google'),
        ]:
            val = _os.environ.get(env_key, '').strip()
            if val:
                keys[provider] = val
        return keys

    @app.get('/api/project')
    async def get_project():
        """Get project root for the frontend."""
        return {
            'root': str(config.workspace_root),
        }

    if plugin_manager is not None:
        # Start file watcher after startup.
        @app.on_event('startup')
        async def _start_plugin_watcher() -> None:
            plugin_manager.start_watcher()

    return app

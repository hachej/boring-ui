"""Capabilities discovery and router registry for boring-ui API.

This module provides:
- A registry for tracking available routers/features
- A capabilities endpoint for UI feature discovery
"""
import os
from dataclasses import dataclass, field
from typing import Callable, Any, TYPE_CHECKING

if TYPE_CHECKING:
    from .workspace_plugins import WorkspacePluginManager
from fastapi import APIRouter


@dataclass
class RouterInfo:
    """Metadata about a registered router."""
    name: str
    prefix: str
    description: str = ""
    tags: list[str] = field(default_factory=list)
    required_capabilities: list[str] = field(default_factory=list)


class RouterRegistry:
    """Registry for tracking available API routers.

    This allows dynamic router composition and capability discovery.

    Example:
        registry = RouterRegistry()
        registry.register('files', '/api/v1/files', create_file_router,
                         description='File operations')
        registry.register('git', '/api/v1/git', create_git_router,
                         description='Git operations')

        # Get all registered routers
        for info, factory in registry.all():
            app.include_router(factory(config), prefix=info.prefix)
    """

    def __init__(self):
        self._routers: dict[str, tuple[RouterInfo, Callable[..., APIRouter]]] = {}

    def register(
        self,
        name: str,
        prefix: str,
        factory: Callable[..., APIRouter],
        description: str = "",
        tags: list[str] | None = None,
        required_capabilities: list[str] | None = None,
    ) -> None:
        """Register a router factory.

        Args:
            name: Unique identifier for this router
            prefix: URL prefix (e.g., '/api/v1/git')
            factory: Function that creates the router
            description: Human-readable description
            tags: OpenAPI tags for grouping
            required_capabilities: Capabilities this router requires
        """

        def _normalize_str_list(value: list[str] | str | None) -> list[str]:
            # Defensive: prevent accidental `list("foo") -> ["f","o","o"]`.
            if value is None:
                return []
            if isinstance(value, str):
                return [value]
            return list(value)

        info = RouterInfo(
            name=name,
            prefix=prefix,
            description=description,
            tags=_normalize_str_list(tags),
            required_capabilities=_normalize_str_list(required_capabilities),
        )
        self._routers[name] = (info, factory)

    def get(self, name: str) -> tuple[RouterInfo, Callable[..., APIRouter]] | None:
        """Get a router by name."""
        return self._routers.get(name)

    def list_names(self) -> list[str]:
        """List all registered router names."""
        return list(self._routers.keys())

    def all(self) -> list[tuple[RouterInfo, Callable[..., APIRouter]]]:
        """Get all registered routers."""
        return list(self._routers.values())

    def get_info(self, name: str) -> RouterInfo | None:
        """Get router info without the factory."""
        entry = self._routers.get(name)
        return entry[0] if entry else None


def create_default_registry() -> RouterRegistry:
    """Create a registry with the default boring-ui routers.

    This represents the standard router set for a boring-ui application.
    """
    from .modules.files import create_file_router
    from .modules.git import create_git_router
    from .modules.ui_state import create_ui_state_router
    from .modules.control_plane import create_control_plane_router
    from .modules.pty import create_pty_router
    from .modules.stream import create_stream_router
    from .approval import create_approval_router

    registry = RouterRegistry()

    # Core routers (always included in default setup)
    registry.register(
        'files',
        '/api/v1/files',
        create_file_router,
        description='File system operations (read, write, rename, delete)',
        tags=['files'],
    )
    registry.register(
        'git',
        '/api/v1/git',
        create_git_router,
        description='Git operations (status, diff, show)',
        tags=['git'],
    )
    registry.register(
        'ui_state',
        '/api/v1/ui',
        create_ui_state_router,
        description='Workspace UI state snapshots (open panes, active pane)',
        tags=['ui'],
    )
    registry.register(
        'control_plane',
        '/api/v1/control-plane',
        create_control_plane_router,
        description='Workspace/user/membership/invite/settings metadata foundation',
        tags=['control-plane'],
    )

    # Optional routers
    registry.register(
        'pty',
        '/ws',
        create_pty_router,
        description='PTY WebSocket for shell terminals',
        tags=['websocket', 'terminal'],
    )
    registry.register(
        'chat_claude_code',
        '/ws/agent/normal',
        create_stream_router,
        description='Claude stream WebSocket for AI chat',
        tags=['websocket', 'ai'],
    )
    # Backward compatibility alias: 'stream' -> 'chat_claude_code'
    registry.register(
        'stream',
        '/ws/agent/normal',
        create_stream_router,
        description='Claude stream WebSocket for AI chat (alias for chat_claude_code)',
        tags=['websocket', 'ai'],
    )
    registry.register(
        'approval',
        '/api',
        create_approval_router,
        description='Approval workflow endpoints',
        tags=['approval'],
    )

    return registry


def create_capabilities_router(
    enabled_features: dict[str, bool],
    registry: RouterRegistry | None = None,
    config: "APIConfig | None" = None,
    plugin_manager: "Any | None" = None,
) -> APIRouter:
    """Create a router for the capabilities endpoint.

    Args:
        enabled_features: Map of feature name -> enabled status
        registry: Optional router registry for detailed info
        config: Optional APIConfig for services metadata

    Returns:
        Router with /capabilities endpoint
    """
    router = APIRouter(tags=['capabilities'])

    @router.get('/capabilities')
    async def get_capabilities():
        """Get API capabilities and available features.

        Returns a stable JSON structure describing what features
        are enabled in this API instance. The UI uses this to
        conditionally render components.
        """
        capabilities = {
            'version': '0.1.0',
            'features': enabled_features,
        }

        # Add router details if registry provided
        if registry:
            # Read env var at request-time to keep tests simple (monkeypatch),
            # and to allow runtime overrides in dev environments.
            include_contract_metadata = os.environ.get("CAPABILITIES_INCLUDE_CONTRACT_METADATA", "").strip().lower() in {
                "1",
                "true",
                "yes",
                "on",
            }
            contract_by_router: dict[str, dict[str, Any]] = {
                "files": {"owner_service": "workspace-core", "canonical_families": ["/api/v1/files/*"]},
                "git": {"owner_service": "workspace-core", "canonical_families": ["/api/v1/git/*"]},
                "ui_state": {"owner_service": "workspace-core", "canonical_families": ["/api/v1/ui/*"]},
                "control_plane": {
                    "owner_service": "boring-ui",
                    "canonical_families": ["/api/v1/control-plane/*"],
                },
                "pty": {"owner_service": "pty-service", "canonical_families": ["/ws/pty", "/api/v1/pty/*"]},
                "chat_claude_code": {
                    "owner_service": "agent-normal",
                    "canonical_families": ["/ws/agent/normal/*", "/api/v1/agent/normal/*"],
                },
                "stream": {
                    "owner_service": "agent-normal",
                    "canonical_families": ["/ws/agent/normal/*", "/api/v1/agent/normal/*"],
                },
                "approval": {"owner_service": "boring-ui", "canonical_families": ["/api/approval/*"]},
            }

            def _apply_contract_prefix(description: str, contract: dict[str, Any] | None) -> str:
                if not contract:
                    return description
                owner_service = contract.get("owner_service")
                canonical_families = contract.get("canonical_families") or []
                canonical = ",".join(canonical_families)
                return f"[owner={owner_service}] [canonical={canonical}] {description}"

            capabilities['routers'] = [
                {
                    'name': info.name,
                    'prefix': info.prefix,
                    'description': (
                        _apply_contract_prefix(info.description, contract_by_router.get(info.name))
                        if include_contract_metadata
                        else info.description
                    ),
                    'tags': info.tags,
                    'enabled': enabled_features.get(info.name, False),
                    'contract_metadata': (
                        contract_by_router.get(info.name) if include_contract_metadata else None
                    ),
                    # Per-entry indicator: avoids confusing "enabled globally but missing for this router" states.
                    'contract_metadata_included': (
                        include_contract_metadata and info.name in contract_by_router
                    ),
                }
                for info, _ in registry.all()
            ]

        # Workspace plugin panes
        if plugin_manager is not None:
            capabilities['workspace_panes'] = plugin_manager.list_workspace_panes()
            capabilities['workspace_routes'] = plugin_manager.list_workspace_routes()

        # Service connection info for direct-connect panels
        if config and config.companion_url:
            services = capabilities.setdefault('services', {})
            services['companion'] = {
                'url': config.companion_url,
            }
        if config and config.pi_url:
            services = capabilities.setdefault('services', {})
            services['pi'] = {
                'url': config.pi_url,
                'mode': config.pi_mode,
            }

        # Auth configuration for SPA-rendered login pages
        if config and config.use_neon_control_plane and config.neon_auth_base_url:
            capabilities['auth'] = {
                'provider': 'neon',
                'neonAuthUrl': config.neon_auth_base_url.rstrip('/'),
                'callbackUrl': '/auth/callback',
                'appName': config.auth_app_name or '',
                'appDescription': config.auth_app_description or '',
            }
        elif config and config.supabase_url and config.supabase_anon_key:
            capabilities['auth'] = {
                'provider': 'supabase',
                'supabaseUrl': config.supabase_url.rstrip('/'),
                'supabaseAnonKey': config.supabase_anon_key,
                'callbackUrl': '/auth/callback',
                'appName': config.auth_app_name or '',
                'appDescription': config.auth_app_description or '',
            }

        # Workspace runtime info for backend-agent mode
        if config and config.agents_mode == "backend":
            capabilities['workspace_runtime'] = {
                'placement': 'workspace_machine',
                'agent_mode': 'backend',
            }

        return capabilities

    return router

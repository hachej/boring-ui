"""Configuration for boring-ui API."""
import os
import re
import secrets
import shlex
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_GITHUB_SLUG_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9\-]*$')


def _default_cors_origins() -> list[str]:
    """Get default CORS origins, supporting env override."""
    env_origins = os.environ.get('CORS_ORIGINS', '')
    if env_origins:
        return [o.strip() for o in env_origins.split(',') if o.strip()]
    # Default: allow common dev origins
    return [
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175',
        'http://localhost:5176',
        'http://localhost:3000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'http://127.0.0.1:5175',
        'http://127.0.0.1:5176',
        'http://213.32.19.186:3000',
        'http://213.32.19.186:5173',
        'http://213.32.19.186:5174',
        'http://213.32.19.186:5175',
        'http://213.32.19.186:5176',
    ]


def _env_bool(name: str, default: bool = False) -> bool:
    """Parse a bool environment variable."""
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


def _workspace_plugin_allowlist() -> list[str]:
    """Parse optional comma-separated workspace plugin allowlist."""
    raw = os.environ.get('WORKSPACE_PLUGIN_ALLOWLIST', '')
    return [item.strip() for item in raw.split(',') if item.strip()]


def _workspace_extra_passthrough_roots() -> tuple[str, ...]:
    """Parse optional comma-separated extra workspace passthrough roots."""
    raw = os.environ.get('WORKSPACE_EXTRA_PASSTHROUGH_ROOTS', '')
    roots: list[str] = []
    for item in raw.split(','):
        text = str(item or '').strip()
        if not text:
            continue
        normalized = '/' + text.lstrip('/')
        normalized = normalized.rstrip('/') or '/'
        if normalized not in roots:
            roots.append(normalized)
    return tuple(roots)


def _env_str(name: str, default: str) -> str:
    """Read an environment variable as a stripped string."""
    value = os.environ.get(name)
    if value is None:
        return default
    stripped = value.strip()
    return stripped if stripped else default


def _env_optional_multiline(name: str) -> str | None:
    """Read an optional env var and expand escaped newlines when present."""
    value = os.environ.get(name)
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    return stripped.replace('\\n', '\n')


def _env_cmd(name: str) -> list[str] | None:
    """Parse a command list from a string env var (shell-like splitting)."""
    raw = os.environ.get(name)
    if raw is None:
        return None
    raw = raw.strip()
    if not raw:
        return None
    return shlex.split(raw)


def _env_int(name: str, default: int) -> int:
    """Parse an integer environment variable with fallback."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        return default
    return value if value > 0 else default


def _normalize_agents_mode(raw: str | None) -> str:
    """Normalize agents mode: 'frontend' (default) or 'backend'."""
    value = str(raw or "").strip().lower()
    if value == "backend":
        return "backend"
    return "frontend"


def _normalize_control_plane_provider(raw: str | None) -> str:
    value = str(raw or "").strip().lower()
    if value in {"", "local"}:
        return "local"
    if value == "neon":
        return "neon"
    return "local"


@dataclass(frozen=True)
class AgentRuntimeConfig:
    """Serializable agent configuration sourced from boring.app.toml."""

    enabled: bool = True
    port: int | None = None
    transport: str | None = None
    command: tuple[str, ...] = ()
    env: dict[str, str] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


def _default_agents() -> dict[str, AgentRuntimeConfig]:
    return {"pi": AgentRuntimeConfig(enabled=True)}


@dataclass
class APIConfig:
    """Central configuration for all API routers.

    This dataclass is passed to all create_*_router() factories,
    enabling dependency injection and avoiding global state.
    """
    workspace_root: Path
    cors_origins: list[str] = field(default_factory=_default_cors_origins)

    # PTY provider configuration: provider_name -> command list
    # e.g., 'shell' -> ['bash'], 'claude' -> ['claude', '--dangerously-skip-permissions']
    pty_providers: dict[str, list[str]] = field(default_factory=lambda: {
        'shell': ['bash'],
        'claude': ['claude', '--dangerously-skip-permissions'],
    })
    # Disabled by default because workspace plugins execute local Python modules.
    # Hosted backend-agent v1 keeps plugins as a local/dev-only escape hatch.
    workspace_plugins_enabled: bool = field(
        default_factory=lambda: _env_bool('WORKSPACE_PLUGINS_ENABLED', False)
    )
    # Extra allowlist roots for workspace-scoped passthrough `/w/{id}/...`.
    # Defaults stay strict; set via APIConfig(...) or env:
    # WORKSPACE_EXTRA_PASSTHROUGH_ROOTS=/api/v1/domain-extension,/custom/root
    extra_passthrough_roots: tuple[str, ...] = field(
        default_factory=_workspace_extra_passthrough_roots
    )
    workspace_plugin_allowlist: list[str] = field(
        default_factory=_workspace_plugin_allowlist
    )
    control_plane_enabled: bool = field(
        default_factory=lambda: _env_bool('CONTROL_PLANE_ENABLED', True)
    )
    control_plane_state_relpath: str = field(
        default_factory=lambda: _env_str('CONTROL_PLANE_STATE_RELPATH', '.boring/control-plane/state.json')
    )
    auth_session_cookie_name: str = field(
        default_factory=lambda: _env_str('AUTH_SESSION_COOKIE_NAME', 'boring_session')
    )
    auth_session_ttl_seconds: int = field(
        default_factory=lambda: _env_int('AUTH_SESSION_TTL_SECONDS', 86400)
    )
    auth_session_secure_cookie: bool = field(
        default_factory=lambda: _env_bool('AUTH_SESSION_SECURE_COOKIE', False)
    )
    auth_dev_login_enabled: bool = field(
        default_factory=lambda: _env_bool('AUTH_DEV_LOGIN_ENABLED', False)
    )
    auth_dev_auto_login: bool = field(
        default_factory=lambda: _env_bool('AUTH_DEV_AUTO_LOGIN', _env_bool('AUTH_DEV_LOGIN_ENABLED', False))
    )
    auth_session_secret: str = field(
        default_factory=lambda: _env_str('BORING_UI_SESSION_SECRET', '')
    )
    control_plane_provider: str = field(
        default_factory=lambda: _normalize_control_plane_provider(
            os.environ.get('CONTROL_PLANE_PROVIDER')
        )
    )
    control_plane_app_id: str = field(
        default_factory=lambda: _env_str('CONTROL_PLANE_APP_ID', 'boring-ui')
    )
    auth_app_name: str = field(
        default_factory=lambda: _env_str('AUTH_APP_NAME', 'Boring UI')
    )
    auth_app_description: str = field(
        default_factory=lambda: _env_str('AUTH_APP_DESCRIPTION', 'Your collaborative development workspace.')
    )
    auth_rail_code: str = field(
        default_factory=lambda: _env_str('AUTH_RAIL_CODE', '')
    )
    # Canonical hosted control-plane database URL.
    database_url: str | None = field(
        default_factory=lambda: os.environ.get('DATABASE_URL')
    )
    # Neon Auth (Better Auth) configuration
    neon_auth_base_url: str | None = field(
        default_factory=lambda: os.environ.get('NEON_AUTH_BASE_URL')
    )
    neon_auth_jwks_url: str | None = field(
        default_factory=lambda: os.environ.get('NEON_AUTH_JWKS_URL')
    )
    # OAuth providers enabled in Neon Auth (e.g. ["google", "github"])
    # Comma-separated env: AUTH_OAUTH_PROVIDERS=google,github
    auth_oauth_providers: list[str] = field(
        default_factory=lambda: [
            p.strip() for p in os.environ.get('AUTH_OAUTH_PROVIDERS', '').split(',')
            if p.strip()
        ]
    )
    settings_encryption_key: str | None = field(
        default_factory=lambda: os.environ.get('BORING_SETTINGS_KEY')
    )

    # GitHub App (for git sync OAuth)
    github_app_id: str | None = field(
        default_factory=lambda: os.environ.get('GITHUB_APP_ID')
    )
    github_app_client_id: str | None = field(
        default_factory=lambda: os.environ.get('GITHUB_APP_CLIENT_ID')
    )
    github_app_client_secret: str | None = field(
        default_factory=lambda: os.environ.get('GITHUB_APP_CLIENT_SECRET')
    )
    github_app_private_key: str | None = field(
        default_factory=lambda: _env_optional_multiline('GITHUB_APP_PRIVATE_KEY')
    )
    github_app_slug: str | None = field(
        default_factory=lambda: os.environ.get('GITHUB_APP_SLUG')
    )
    # Explicit toggle to disable GitHub sync even when app credentials are present.
    # Useful for child apps that share the same deployment but don't need git sync.
    github_sync_enabled: bool = field(
        default_factory=lambda: _env_bool('GITHUB_SYNC_ENABLED', True)
    )
    # Agent placement mode: "frontend" (browser PI) or "backend" (server-side PiHarness).
    # Set via AGENTS_MODE env var or boring.app.toml [agents] mode.
    agents_mode: str = field(
        default_factory=lambda: _normalize_agents_mode(os.environ.get('AGENTS_MODE'))
    )
    internal_api_token: str = field(
        default_factory=lambda: _env_str(
            "BORING_INTERNAL_API_TOKEN",
            _env_str("BORING_UI_INTERNAL_TOKEN", ""),
        )
    )
    frontend_config: dict[str, Any] = field(default_factory=dict)
    agents_default: str | None = "pi"
    agents: dict[str, AgentRuntimeConfig] = field(default_factory=_default_agents)

    def __post_init__(self) -> None:
        # Test harness hook: allow overriding the PTY provider commands without
        # changing default prod behavior.
        # Example: BORING_UI_PTY_CLAUDE_COMMAND=bash
        claude_override = _env_cmd("BORING_UI_PTY_CLAUDE_COMMAND")
        if claude_override and "claude" in self.pty_providers:
            self.pty_providers["claude"] = claude_override
        if not self.auth_session_secret:
            # Backward compatibility with sandbox naming.
            self.auth_session_secret = _env_str('BORING_SESSION_SECRET', '')
        if not self.auth_session_secret:
            # Generate an ephemeral secret when one is not configured explicitly.
            self.auth_session_secret = secrets.token_urlsafe(48)
        if not self.internal_api_token:
            # Temporary bridge for internal callers until a dedicated token
            # provisioning flow exists.
            self.internal_api_token = self.auth_session_secret

        # Normalize passthrough roots to canonical absolute roots without trailing slash.
        normalized_roots: list[str] = []
        for root in self.extra_passthrough_roots or ():
            text = str(root or '').strip()
            if not text:
                continue
            normalized = '/' + text.lstrip('/')
            normalized = normalized.rstrip('/') or '/'
            if normalized not in normalized_roots:
                normalized_roots.append(normalized)
        self.extra_passthrough_roots = tuple(normalized_roots)

        # Validate github_app_slug to prevent path traversal in URLs
        if self.github_app_slug and not _GITHUB_SLUG_RE.match(self.github_app_slug):
            import logging
            logging.getLogger(__name__).warning(
                'Invalid GITHUB_APP_SLUG %r — clearing', self.github_app_slug,
            )
            self.github_app_slug = None

        # Backend-agent workspace role: disable control plane when no DB is configured.
        # The same image serves both control plane (has DATABASE_URL) and workspace
        # (no DATABASE_URL, agents_mode=backend) roles on Fly.io.
        if self.agents_mode == "backend" and not self.effective_database_url:
            self.control_plane_enabled = False

        # Auto-enable neon provider when explicit envs are present.
        if self.control_plane_provider == "local" and self.neon_auth_base_url:
            self.control_plane_provider = "neon"

        if not self.agents:
            self.agents = _default_agents()
        else:
            normalized_agents: dict[str, AgentRuntimeConfig] = {}
            for name, agent in self.agents.items():
                agent_name = str(name or "").strip()
                if not agent_name:
                    continue
                if isinstance(agent, AgentRuntimeConfig):
                    normalized_agents[agent_name] = agent
                    continue
                if not isinstance(agent, dict):
                    raise TypeError(
                        f"Agent config for {agent_name!r} must be AgentRuntimeConfig or dict"
                    )
                command = tuple(str(part) for part in agent.get("command", ()) if str(part).strip())
                env = {
                    str(key): str(value)
                    for key, value in dict(agent.get("env", {})).items()
                }
                metadata = {
                    key: value
                    for key, value in dict(agent).items()
                    if key not in {"enabled", "port", "transport", "command", "env"}
                }
                normalized_agents[agent_name] = AgentRuntimeConfig(
                    enabled=bool(agent.get("enabled", True)),
                    port=int(agent["port"]) if agent.get("port") is not None else None,
                    transport=str(agent.get("transport")).strip() or None,
                    command=command,
                    env=env,
                    metadata=metadata,
                )
            self.agents = normalized_agents or _default_agents()

        normalized_frontend = dict(self.frontend_config or {})
        for key in ("branding", "features", "data", "panels"):
            value = normalized_frontend.get(key)
            if value is None:
                continue
            if not isinstance(value, dict):
                raise TypeError(f"frontend_config[{key!r}] must be a mapping when provided")
            normalized_frontend[key] = dict(value)
        self.frontend_config = normalized_frontend

        if self.agents_default is not None:
            default_name = str(self.agents_default).strip()
            self.agents_default = default_name or None
        if self.agents_default is None or self.agents_default not in self.agents:
            self.agents_default = next(iter(self.available_agents), None)

    @property
    def use_neon_control_plane(self) -> bool:
        return self.control_plane_provider == "neon"

    @property
    def effective_database_url(self) -> str | None:
        """Return the canonical database URL for hosted control-plane mode."""
        return self.database_url

    @property
    def github_configured(self) -> bool:
        """True when GitHub App credentials are present AND sync is not disabled."""
        return bool(
            self.github_sync_enabled
            and self.github_app_id
            and self.github_app_private_key
        )

    @property
    def available_agents(self) -> list[str]:
        """Return enabled agents in stable configuration order."""
        return [
            name
            for name, agent in self.agents.items()
            if agent.enabled
        ]

    @property
    def default_agent_name(self) -> str | None:
        if self.agents_default and self.agents_default in self.available_agents:
            return self.agents_default
        return next(iter(self.available_agents), None)

    def validate_path(self, path: Path | str) -> Path:
        """Validate that a path is within workspace_root.

        This is CRITICAL for security - prevents path traversal attacks.
        All file operations must use this before accessing the filesystem.

        Args:
            path: Path to validate (relative or absolute)

        Returns:
            Resolved absolute path within workspace_root

        Raises:
            ValueError: If path escapes workspace_root
        """
        if isinstance(path, str):
            path = Path(path)

        # Resolve to absolute, handling .. and symlinks
        resolved = (self.workspace_root / path).resolve()

        # Ensure it's within workspace
        if not resolved.is_relative_to(self.workspace_root.resolve()):
            raise ValueError(f'Path traversal detected: {path}')

        return resolved

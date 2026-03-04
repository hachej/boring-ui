"""Configuration for boring-ui API."""
import os
import secrets
import shlex
from dataclasses import dataclass, field
from pathlib import Path


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
        'http://localhost:3000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'http://127.0.0.1:5175',
        '*',  # Allow all origins in dev - restrict in production
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


def _env_str(name: str, default: str) -> str:
    """Read an environment variable as a stripped string."""
    value = os.environ.get(name)
    if value is None:
        return default
    stripped = value.strip()
    return stripped if stripped else default


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
    companion_url: str | None = field(
        default_factory=lambda: os.environ.get('COMPANION_URL')
    )
    pi_url: str | None = field(
        default_factory=lambda: os.environ.get('PI_URL')
    )
    # PI provider rendering mode:
    # - embedded: use built-in chat UI (functional fallback/default)
    # - iframe: render configured PI_URL inside iframe
    pi_mode: str = field(
        default_factory=lambda: (os.environ.get('PI_MODE') or 'embedded').strip().lower()
    )
    # Disabled by default because workspace plugins execute local Python modules.
    workspace_plugins_enabled: bool = field(
        default_factory=lambda: _env_bool('WORKSPACE_PLUGINS_ENABLED', False)
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
    auth_session_secret: str = field(
        default_factory=lambda: _env_str('BORING_UI_SESSION_SECRET', '')
    )

    def __post_init__(self) -> None:
        # Test harness hook: allow overriding the PTY provider commands without
        # changing default prod behavior.
        # Example: BORING_UI_PTY_CLAUDE_COMMAND=bash
        claude_override = _env_cmd("BORING_UI_PTY_CLAUDE_COMMAND")
        if claude_override and "claude" in self.pty_providers:
            self.pty_providers["claude"] = claude_override
        if not self.auth_session_secret:
            # Generate an ephemeral secret when one is not configured explicitly.
            self.auth_session_secret = secrets.token_urlsafe(48)

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

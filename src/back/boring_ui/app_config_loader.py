"""
Loads boring.app.toml and creates a configured FastAPI app.

This is the bridge between the bui CLI config and boring-ui's create_app() factory.
The bui CLI sets BUI_APP_TOML env var pointing to the config file.

Usage:
    # Direct (uvicorn)
    BUI_APP_TOML=/path/to/boring.app.toml uvicorn boring_ui.app_config_loader:app

    # Via bui CLI (sets BUI_APP_TOML automatically)
    bui dev
"""
import importlib
import os
from pathlib import Path
from typing import Any

try:
    import tomllib
except ImportError:
    import tomli as tomllib

from boring_ui.api.app import create_app
from boring_ui.api.config import APIConfig, AgentRuntimeConfig
from boring_ui.runtime_config import build_runtime_config_payload


def load_app_config(toml_path: str | None = None) -> dict:
    """Load and parse boring.app.toml."""
    if toml_path is None:
        toml_path = os.environ.get("BUI_APP_TOML", "boring.app.toml")

    path = Path(toml_path)
    if not path.exists():
        raise FileNotFoundError(f"Config not found: {path}")

    with open(path, "rb") as f:
        return tomllib.load(f)


def resolve_app_config_path(toml_path: str | None = None) -> Path:
    """Resolve the boring.app.toml path used for app boot."""
    if toml_path is None:
        toml_path = os.environ.get("BUI_APP_TOML", "boring.app.toml")
    return Path(toml_path)


def import_router(dotted_path: str):
    """Import a router from a dotted path like 'myapp.routers.foo:router'."""
    module_path, _, attr_name = dotted_path.rpartition(":")
    if not module_path:
        raise ValueError(f"Invalid router path: {dotted_path} (expected 'module:attr')")

    module = importlib.import_module(module_path)
    router = getattr(module, attr_name, None)
    if router is None:
        raise AttributeError(f"{module_path} has no attribute {attr_name!r}")

    return router


def _runtime_frontend_config(frontend: dict[str, Any]) -> dict[str, Any]:
    runtime_config: dict[str, Any] = {}
    for key in ("branding", "features", "data", "panels"):
        value = frontend.get(key)
        if isinstance(value, dict):
            runtime_config[key] = dict(value)
    return runtime_config


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return int(value)


def _parse_agents_config(cfg: dict[str, Any]) -> tuple[str, str | None, dict[str, AgentRuntimeConfig]]:
    agents_section = dict(cfg.get("agents", {}))
    mode = str(agents_section.get("mode", "frontend")).strip().lower() or "frontend"
    default_name = str(agents_section.get("default", "pi")).strip() or None
    mode_override = (
        os.environ.get("BUI_AGENTS_MODE")
        or os.environ.get("BORING_UI_AGENTS_MODE")
        or ""
    ).strip()
    if mode_override:
        mode = mode_override
    default_override = (
        os.environ.get("BUI_DEFAULT_AGENT")
        or os.environ.get("BORING_UI_DEFAULT_AGENT")
        or ""
    ).strip()
    if default_override:
        default_name = default_override

    agent_configs: dict[str, AgentRuntimeConfig] = {}
    for name, value in agents_section.items():
        if name in {"mode", "default"} or not isinstance(value, dict):
            continue
        command = tuple(str(part) for part in value.get("command", ()) if str(part).strip())
        env = {
            str(key): str(val)
            for key, val in dict(value.get("env", {})).items()
        }
        metadata = {
            key: val
            for key, val in value.items()
            if key not in {"enabled", "port", "transport", "command", "env"}
        }
        agent_configs[str(name)] = AgentRuntimeConfig(
            enabled=bool(value.get("enabled", True)),
            port=_optional_int(value.get("port")),
            transport=str(value.get("transport")).strip() or None,
            command=command,
            env=env,
            metadata=metadata,
        )

    if not agent_configs and default_name:
        agent_configs[default_name] = AgentRuntimeConfig(enabled=True)

    return mode, default_name, agent_configs


def create_app_from_toml(toml_path: str | None = None):
    """Create a FastAPI app from boring.app.toml."""
    config_path = resolve_app_config_path(toml_path).resolve()
    cfg = load_app_config(str(config_path))
    workspace_root = Path(
        os.environ.get("BORING_UI_WORKSPACE_ROOT")
        or os.environ.get("BUI_WORKSPACE_ROOT")
        or str(config_path.parent)
    ).resolve()

    app_section = cfg.get("app", {})
    backend = cfg.get("backend", {})
    frontend = cfg.get("frontend", {})
    auth = cfg.get("auth", {})
    agent_mode, default_agent, agent_configs = _parse_agents_config(cfg)

    # Build APIConfig from TOML
    api_config = APIConfig(
        workspace_root=workspace_root,
        auth_app_name=app_section.get("name", "Boring UI"),
        auth_app_description=app_section.get("description", "Your collaborative development workspace."),
        control_plane_app_id=app_section.get("id", "boring-ui"),
        frontend_config=_runtime_frontend_config(frontend),
        agents_mode=agent_mode,
        agents_default=default_agent,
        agents=agent_configs,
    )

    # Auth provider
    provider = auth.get("provider", "local")
    if provider == "neon":
        # Neon config comes from deploy.neon section or env vars
        deploy_neon = cfg.get("deploy", {}).get("neon", {})
        if deploy_neon.get("auth_url"):
            api_config.neon_auth_base_url = deploy_neon["auth_url"]
        if deploy_neon.get("jwks_url"):
            api_config.neon_auth_jwks_url = deploy_neon["jwks_url"]
    elif provider == "none":
        api_config.control_plane_enabled = False

    # Session config
    if auth.get("session_cookie"):
        api_config.auth_session_cookie_name = auth["session_cookie"]
    if auth.get("session_ttl"):
        api_config.auth_session_ttl_seconds = auth["session_ttl"]

    # Create the base app
    fastapi_app = create_app(config=api_config)
    fastapi_app.state.bui_runtime_config = build_runtime_config_payload(
        cfg,
        config=api_config,
        enabled_features=getattr(fastapi_app.state, "enabled_features", {}),
    )
    fastapi_app.state.bui_runtime_config_path = str(config_path)

    static_dir = os.environ.get("BORING_UI_STATIC_DIR", "").strip()
    if static_dir:
        static_path = Path(static_dir)
        if static_path.exists() and static_path.is_dir():
            existing_paths = {route.path for route in getattr(fastapi_app, "routes", [])}
            if "/{full_path:path}" not in existing_paths:
                from boring_ui.runtime import mount_static

                mount_static(fastapi_app, static_path)

    # Mount child app routers
    for router_path in backend.get("routers", []):
        try:
            router = import_router(router_path)
            # Determine prefix from router or default to /api/x/<name>
            module_name = router_path.split(":")[0].split(".")[-1]
            prefix = f"/api/x/{module_name}"
            fastapi_app.include_router(router, prefix=prefix)
        except Exception as e:
            print(f"[bui] warn: failed to load router {router_path}: {e}")

    return fastapi_app


def _create_app():
    """Lazy app factory — only called when uvicorn imports this module."""
    try:
        return create_app_from_toml()
    except FileNotFoundError:
        # No boring.app.toml — fall back to default boring-ui app
        return create_app(config=APIConfig(workspace_root=Path.cwd()))


# Module-level app instance for uvicorn
# uvicorn boring_ui.app_config_loader:app
app = _create_app()

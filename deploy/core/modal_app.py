"""Canonical Modal ASGI deployment for boring-ui child apps.

This is the single deploy template used by ALL child apps via `bui deploy`.
Child apps should NOT maintain their own copy — bui deploy uses this file
from the framework checkout.

All configuration comes from:
  - boring.app.toml (via BUI_APP_TOML env var)
  - Environment variables injected by `bui deploy` (secrets, Neon URLs, etc.)

Manual deploy (without bui):
    BUI_APP_TOML=/path/to/boring.app.toml modal deploy deploy/core/modal_app.py
"""
from __future__ import annotations

import os
from pathlib import Path

import modal

# ---------------------------------------------------------------------------
# Config: read boring.app.toml
# ---------------------------------------------------------------------------
_cfg = {}
_toml_path = os.environ.get("BUI_APP_TOML", "boring.app.toml")
if Path(_toml_path).exists():
    try:
        import tomllib
    except ImportError:
        try:
            import tomli as tomllib
        except ImportError:
            tomllib = None
    if tomllib:
        with open(_toml_path, "rb") as f:
            _cfg = tomllib.load(f)

_app_cfg = _cfg.get("app", {})
_auth_cfg = _cfg.get("auth", {})
_backend_cfg = _cfg.get("backend", {})
_fw_cfg = _cfg.get("framework", {})
_deploy_cfg = _cfg.get("deploy", {})
_modal_cfg = _deploy_cfg.get("modal", {})

_app_name = (
    os.environ.get("BUI_MODAL_APP_NAME")
    or _modal_cfg.get("app_name")
    or _app_cfg.get("id")
    or "boring-ui"
)
_app_id = _app_cfg.get("id", "boring-ui")
_auth_provider = _auth_cfg.get("provider", "local")
_fw_repo = _fw_cfg.get("repo", "github.com/hachej/boring-ui")
_fw_commit = os.environ.get("BUI_FRAMEWORK_COMMIT") or _fw_cfg.get("commit", "main")
_min_containers = _modal_cfg.get("min_containers", 0)

# Backend pythonpath (child app code) and extra pip dependencies
_pythonpath = _backend_cfg.get("pythonpath", [])
_extra_deps = _backend_cfg.get("dependencies", [])
_boot_module = _deploy_cfg.get("boot_module", "")
_entry = _backend_cfg.get("entry", "")  # e.g. "backend.runtime:app"

# ---------------------------------------------------------------------------
# Modal app
# ---------------------------------------------------------------------------
app = modal.App(_app_name)


def _base_image() -> modal.Image:
    image = (
        modal.Image.debian_slim(python_version="3.12")
        .pip_install(
            "fastapi>=0.115",
            "httpx>=0.27",
            "websockets>=13",
            "python-dotenv>=1.0",
            "asyncpg>=0.30",
            "PyJWT[crypto]>=2.9",
            "ptyprocess>=0.7",
            "uvicorn>=0.30",
        )
        .apt_install("git", "curl")
        .run_commands(
            f"git config --global user.email 'workspace@{_app_id}.app'",
            f"git config --global user.name '{_app_id}'",
        )
        .run_commands(
            f"pip install --no-cache-dir --force-reinstall 'boring-ui @ git+https://{_fw_repo}.git@{_fw_commit}'",
            *(f"pip install --no-cache-dir '{dep}'" for dep in _extra_deps) if _extra_deps else [],
            force_build=True,
        )
    )

    # Mount child app backend code
    for pypath in _pythonpath:
        local_dir = pypath
        if Path(local_dir).is_dir():
            # Map to /root/<pypath> inside container
            remote_dir = f"/root/{pypath}"
            image = image.add_local_dir(local_dir, remote_dir, copy=True)

    # Built frontend (bui build outputs to dist/web/)
    for candidate in ("dist/web", "src/web/dist-front", "dist"):
        if Path(candidate).is_dir():
            image = image.add_local_dir(candidate, "/root/dist/web", copy=True)
            break

    return image


# ---------------------------------------------------------------------------
# Environment: static config from boring.app.toml + secrets from bui deploy
# ---------------------------------------------------------------------------
_pythonpath_str = ":".join(f"/root/{p}" for p in _pythonpath) if _pythonpath else "/root/src/back"

_env = {
    "PYTHONPATH": _pythonpath_str,
    "CONTROL_PLANE_ENABLED": "true",
    "CONTROL_PLANE_PROVIDER": _auth_provider,
    "CONTROL_PLANE_APP_ID": _app_id,
    "BORING_UI_STATIC_DIR": "/root/dist/web",
    "BORING_UI_WORKSPACE_ROOT": f"/tmp/{_app_id}-workspace",
    "AUTH_APP_NAME": _app_cfg.get("name", _app_id),
    "BUI_DEPLOY_TS": os.environ.get("BUI_DEPLOY_TS", "0"),
    **({"BUI_APP_ENTRY": _entry} if _entry else {}),
}

# App-specific static env vars from [deploy.env_vars]
for k, v in _deploy_cfg.get("env_vars", {}).items():
    _env[k] = str(v)

# Forward ALL secret keys declared in [deploy.secrets] + standard config vars.
# bui deploy resolves these from Vault and injects as env vars.
_secret_keys = list(_deploy_cfg.get("secrets", {}).keys())
# Always forward these (injected by bui deploy even if not in [deploy.secrets])
_secret_keys.extend([
    "DATABASE_URL", "BORING_UI_SESSION_SECRET", "BORING_SETTINGS_KEY",
    "NEON_AUTH_BASE_URL", "NEON_AUTH_JWKS_URL",
    "ANTHROPIC_API_KEY", "RESEND_API_KEY",
    "GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET",
    "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_SLUG",
])

for key in set(_secret_keys):
    val = os.environ.get(key)
    if val:
        _env[key] = val

image = _base_image().env(_env)


# ---------------------------------------------------------------------------
# ASGI entrypoint
# ---------------------------------------------------------------------------
@app.function(
    image=image,
    timeout=600,
    min_containers=_min_containers,
    memory=1024,
)
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def web():
    """Config-driven ASGI entrypoint for any boring-ui child app."""
    workspace_root = Path(os.environ.get("BORING_UI_WORKSPACE_ROOT", f"/tmp/{_app_id}-workspace"))
    workspace_root.mkdir(parents=True, exist_ok=True)

    # Optional boot module: runs before app import (e.g. env normalization)
    if _boot_module:
        import importlib
        mod = importlib.import_module(_boot_module)
        if hasattr(mod, "boot"):
            mod.boot()

    # Use child app entry point if configured, else boring-ui default
    entry = os.environ.get("BUI_APP_ENTRY", "")
    if entry:
        import importlib
        module_path, _, attr = entry.partition(":")
        mod = importlib.import_module(module_path)
        child_app = getattr(mod, attr or "app")
        if callable(child_app) and not hasattr(child_app, "__asgi_app__"):
            child_app = child_app()
    else:
        from boring_ui.runtime import app as child_app

    # Mount built frontend (SPA fallback + static assets) when BORING_UI_STATIC_DIR
    # is set and contains a build.  Without this, custom-entry child apps that skip
    # boring_ui.runtime would return 404 on the root URL.
    static_dir = os.environ.get("BORING_UI_STATIC_DIR", "")
    if static_dir:
        static_path = Path(static_dir)
        if static_path.exists() and static_path.is_dir():
            # Only mount if the app doesn't already have a catch-all SPA route
            existing_paths = {r.path for r in getattr(child_app, "routes", [])}
            if "/{full_path:path}" not in existing_paths:
                from boring_ui.runtime import mount_static
                mount_static(child_app, static_path)

    return child_app

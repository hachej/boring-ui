"""Modal ASGI deployment for boring-ui core/frontend mode.

Deploy:
    modal deploy deploy/modal/modal_app_front.py::core

This entrypoint deploys boring-ui as the control-plane owner in core mode.
If `dist/` exists in the checkout, it is mounted and served as static UI.
"""

from __future__ import annotations

import os
from pathlib import Path

import modal

app = modal.App("boring-ui-core")


def _base_image() -> modal.Image:
    image = (
        modal.Image.debian_slim(python_version="3.12")
        .pip_install(
            "fastapi>=0.115",
            "httpx>=0.27",
            "asyncpg>=0.30",
            "PyJWT>=2.9",
            "uvicorn>=0.30",
            "ptyprocess>=0.7",
            "websockets>=13",
        )
        .apt_install("git", "curl")
        .add_local_dir("src/back/boring_ui", "/root/src/back/boring_ui", copy=True)
    )

    # Optional static frontend bundle for single-service deployment.
    if Path("dist").is_dir():
        image = image.add_local_dir("dist", "/root/dist", copy=True)

    return image


image = _base_image().env(
    {
        "PYTHONPATH": "/root/src/back",
        "DEPLOY_MODE": "core",
        "CONTROL_PLANE_APP_ID": "boring-ui",
        "BORING_UI_STATIC_DIR": "/root/dist",
        "BORING_UI_WORKSPACE_ROOT": "/tmp/boring-ui-workspace",
    }
)


# Create this secret in Modal with Supabase/session settings used by boring-ui core.
# Example keys:
#   SUPABASE_URL
#   SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY
#   SUPABASE_JWT_SECRET
#   SUPABASE_DB_URL
#   BORING_SETTINGS_KEY
#   BORING_UI_SESSION_SECRET
core_secrets = modal.Secret.from_name("boring-ui-core-secrets")


@app.function(
    image=image,
    secrets=[core_secrets],
    timeout=600,
    min_containers=1,
    memory=1024,
)
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def core():
    """Create and return the boring-ui FastAPI application."""
    from boring_ui.api import APIConfig, create_app

    workspace_root = Path(os.environ.get("BORING_UI_WORKSPACE_ROOT", "/tmp/boring-ui-workspace"))
    workspace_root.mkdir(parents=True, exist_ok=True)
    return create_app(APIConfig(workspace_root=workspace_root))

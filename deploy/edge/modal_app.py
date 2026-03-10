"""Modal ASGI deployment for boring-ui edge mode (control plane + sandbox provisioning).

Deploy:
    modal deploy deploy/edge/modal_app.py

This entrypoint deploys boring-ui as the control-plane in edge mode,
where sandbox provisioning is delegated to a separate sprite/sandbox service.
"""

from __future__ import annotations

import os
from pathlib import Path

import modal

app = modal.App("boring-ui-edge")


def _base_image() -> modal.Image:
    image = (
        modal.Image.debian_slim(python_version="3.12")
        .pip_install(
            "fastapi>=0.115",
            "httpx>=0.27",
            "asyncpg>=0.30",
            "PyJWT[crypto]>=2.9",
            "uvicorn>=0.30",
            "ptyprocess>=0.7",
            "websockets>=13",
        )
        .apt_install("git", "curl")
        .add_local_dir("src/back/boring_ui", "/root/src/back/boring_ui", copy=True)
    )

    if Path("dist").is_dir():
        image = image.add_local_dir("dist", "/root/dist", copy=True)

    return image


image = _base_image().env(
    {
        "PYTHONPATH": "/root/src/back",
        "DEPLOY_MODE": "edge",
        "CONTROL_PLANE_APP_ID": "boring-ui",
        "BORING_UI_STATIC_DIR": "/root/dist",
        "BORING_UI_WORKSPACE_ROOT": "/tmp/boring-ui-workspace",
    }
)

# Core auth/DB secrets (Neon or Supabase, same as core mode).
core_secrets = modal.Secret.from_name("boring-ui-core-secrets")

# Additional sandbox-specific secrets (sprite provisioning, sandbox API keys).
sandbox_secrets = modal.Secret.from_name("boring-ui-sandbox-secrets")


@app.function(
    image=image,
    secrets=[core_secrets, sandbox_secrets],
    timeout=600,
    min_containers=1,
    memory=1024,
)
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def edge():
    """Create and return the boring-ui FastAPI application in edge mode."""
    workspace_root = Path(os.environ.get("BORING_UI_WORKSPACE_ROOT", "/tmp/boring-ui-workspace"))
    workspace_root.mkdir(parents=True, exist_ok=True)

    # runtime module creates app at import time, wiring create_app + static serving + SPA fallback.
    from boring_ui.runtime import app as runtime_app

    return runtime_app

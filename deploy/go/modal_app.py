"""Modal deploy entrypoint for the Go boring-ui backend.

Usage:
    modal deploy deploy/go/modal_app.py
"""
from __future__ import annotations

import os
import subprocess

import modal

_app_name = os.environ.get("BUI_MODAL_APP_NAME", "boring-ui-go")
_min_containers = int(os.environ.get("BUI_MODAL_MIN_CONTAINERS", "0"))
_port = int(os.environ.get("BORING_PORT", "8000"))
_secret_name = os.environ.get("BUI_MODAL_SECRET_NAME", "boring-ui-core-secrets")
_dockerfile = os.path.join("deploy", "go", "Dockerfile")

image = modal.Image.from_dockerfile(_dockerfile, add_python="3.12").env(
    {
        "BUI_APP_TOML": "/app/boring.app.toml",
        "BORING_HOST": "0.0.0.0",
        "BORING_PORT": str(_port),
    }
)

app = modal.App(_app_name)


@app.function(
    image=image,
    timeout=600,
    min_containers=_min_containers,
    memory=1024,
    secrets=[modal.Secret.from_name(_secret_name)],
)
@modal.web_server(_port, startup_timeout=30)
def web():
    """Expose the Go HTTP server through Modal's web endpoint."""
    subprocess.Popen(["/boring-ui"])

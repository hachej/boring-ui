"""Modal ASGI deployment for boring-ui core mode.

Deploy:
    modal deploy deploy/core/modal_app.py

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
            "PyJWT[crypto]>=2.9",
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


# Create this secret in Modal with auth/DB settings used by boring-ui core.
# Required keys (Neon — production default):
#   CONTROL_PLANE_PROVIDER=neon
#   DATABASE_URL              (Neon pooler connection string)
#   NEON_AUTH_BASE_URL        (Neon Auth / Better Auth endpoint)
#   NEON_AUTH_JWKS_URL        (EdDSA JWKS endpoint)
#   BORING_UI_SESSION_SECRET  (HS256 session cookie secret)
#   BORING_SETTINGS_KEY       (encrypted settings key)
# Legacy keys (Supabase — keep if needed for rollback):
#   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#   SUPABASE_JWT_SECRET, SUPABASE_DB_URL
core_secrets = modal.Secret.from_name("boring-ui-core-secrets")
git_secrets = modal.Secret.from_name("boring-ui-git-secrets")


@app.function(
    image=image,
    secrets=[core_secrets, git_secrets],
    timeout=600,
    min_containers=0,
    memory=1024,
)
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def core():
    """Create and return the boring-ui FastAPI application with static frontend."""
    import subprocess

    workspace_root = Path(os.environ.get("BORING_UI_WORKSPACE_ROOT", "/tmp/boring-ui-workspace"))
    workspace_root.mkdir(parents=True, exist_ok=True)

    # Bootstrap workspace from git repo if GIT_REPO_URL is set and workspace is empty.
    repo_url = os.environ.get("GIT_REPO_URL")
    git_token = os.environ.get("GIT_AUTH_TOKEN")
    if repo_url and not (workspace_root / ".git").exists():
        # Inject credentials into URL for clone
        clone_url = repo_url
        if git_token and "://" in repo_url:
            # https://github.com/... → https://x-access-token:TOKEN@github.com/...
            clone_url = repo_url.replace("://", f"://x-access-token:{git_token}@", 1)
        result = subprocess.run(
            ["git", "clone", "--", clone_url, str(workspace_root)],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode == 0:
            # Reset remote URL to the clean version (no embedded token)
            subprocess.run(
                ["git", "remote", "set-url", "origin", repo_url],
                cwd=workspace_root, capture_output=True,
            )
            print(f"[boot] Cloned {repo_url} into workspace")
        else:
            print(f"[boot] Clone failed: {result.stderr[:200]}")
    elif repo_url and (workspace_root / ".git").exists():
        # Pull latest if already cloned
        env = os.environ.copy()
        env["GIT_TERMINAL_PROMPT"] = "0"
        subprocess.run(
            ["git", "pull", "--ff-only"],
            cwd=workspace_root, capture_output=True, text=True,
            timeout=30, env=env,
        )
        print("[boot] Pulled latest into workspace")

    # Configure git identity
    subprocess.run(["git", "config", "--global", "user.name", "boring-ui"], capture_output=True)
    subprocess.run(["git", "config", "--global", "user.email", "bot@boringdata.io"], capture_output=True)

    # runtime module creates app at import time, wiring create_app + static serving + SPA fallback.
    from boring_ui.runtime import app as runtime_app

    return runtime_app

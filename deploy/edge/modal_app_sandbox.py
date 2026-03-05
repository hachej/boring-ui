"""Modal ASGI deployment for boring-sandbox data plane (edge gateway).

Deploy:
    modal deploy deploy/edge/modal_app_sandbox.py

The sandbox gateway proxies /w/* requests to Sprite runtimes.
Auth and control-plane routes are handled by boring-ui (deploy/edge/modal_app.py).

Requires boring-sandbox source at vendor/boring-sandbox/ (git submodule).
"""

from __future__ import annotations

from pathlib import Path

import modal

app = modal.App("boring-sandbox")

# Resolve vendor root — only meaningful locally (the Modal CLI side).
# Inside the container the script lives at /root/modal_app_sandbox.py
# so the relative path won't resolve; we guard against that.
_SCRIPT_DIR = Path(__file__).resolve().parent
_CANDIDATE = _SCRIPT_DIR.parent.parent / "vendor" / "boring-sandbox"
VENDOR_ROOT: Path | None = _CANDIDATE if _CANDIDATE.is_dir() else None


def _base_image() -> modal.Image:
    assert VENDOR_ROOT is not None, "vendor/boring-sandbox submodule not found"
    return (
        modal.Image.debian_slim(python_version="3.12")
        .pip_install(
            "fastapi>=0.115",
            "httpx>=0.27",
            "asyncpg>=0.30",
            "PyJWT>=2.9",
            "cryptography>=42",
            "websockets>=13",
            "uvicorn>=0.30",
        )
        .apt_install("wget", "unzip", "curl")
        .run_commands(
            "wget -qO /tmp/vault.zip https://releases.hashicorp.com/vault/1.17.5/vault_1.17.5_linux_amd64.zip",
            "unzip -o /tmp/vault.zip -d /usr/local/bin && rm /tmp/vault.zip",
            "curl -fsSL https://sprites.dev/install.sh | sh",
            "ln -sf /root/.local/bin/sprite /usr/local/bin/sprite",
            "sprite --help >/dev/null",
        )
        .add_local_dir(str(VENDOR_ROOT / "apps"), "/root/apps", copy=True)
        .add_local_dir(str(VENDOR_ROOT / "src" / "boring_sandbox"), "/root/src/boring_sandbox", copy=True)
        .add_local_dir(str(VENDOR_ROOT / "deploy"), "/root/deploy", copy=True)
    )


def _with_optional_macro_bundle(img: modal.Image) -> modal.Image:
    if VENDOR_ROOT is None:
        return img
    bundle = VENDOR_ROOT / "artifacts" / "boring-macro-bundle.tar.gz"
    if bundle.exists():
        return img.add_local_file(
            str(bundle),
            "/root/artifacts/boring-macro-bundle.tar.gz",
            copy=True,
        )
    return img


# Image building is guarded by VENDOR_ROOT being available (local CLI only).
if VENDOR_ROOT is not None:
    image = _with_optional_macro_bundle(_base_image()).env(
        {
            "PATH": "/root/.local/bin:/usr/local/bin:/usr/bin:/bin",
            "PYTHONPATH": "/root/src",
            "APP_ID_DEFAULT": "boring-macro",
        }
    )
else:
    # Container-side fallback — the image is already built;
    # Modal ignores the Image object at runtime.
    image = modal.Image.debian_slim(python_version="3.12")

# Modal secrets — create via `modal secret create boring-sandbox-secrets ...`
secrets = modal.Secret.from_name("boring-sandbox-secrets")
macro_secrets = modal.Secret.from_name("boring-sandbox-macro-secrets")
sprite_secrets = modal.Secret.from_name("boring-sandbox-sprite-secrets")
mail_secrets = modal.Secret.from_name("boring-sandbox-mail-secrets")
macro_runtime_secrets = modal.Secret.from_name("boring-sandbox-macro-runtime-secrets")


@app.function(
    image=image,
    secrets=[secrets, macro_secrets, sprite_secrets, mail_secrets, macro_runtime_secrets],
    timeout=600,
    min_containers=1,
    memory=512,
)
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def gateway():
    """Create and return the boring-sandbox gateway ASGI application."""
    from boring_sandbox.gateway.app import create_app

    return create_app()

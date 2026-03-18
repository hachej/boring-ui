"""Production runtime app for boring-ui.

Serves API + built frontend from one FastAPI service when BORING_UI_STATIC_DIR is set.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import FileResponse

from .api import APIConfig, create_app

_PREFIXED_ASSET_RE = re.compile(r"^(?:/w/[^/]+|/auth)(/assets/|/fonts/)")


class _WorkspaceAssetRewriteMiddleware:
    """Rewrite /w/{id}/assets/… and /auth/assets/… → /assets/….

    Build artifacts are public and don't need workspace or auth routing.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope.get("path", "")
            m = _PREFIXED_ASSET_RE.match(path)
            if m:
                scope = dict(scope)
                scope["path"] = path[m.start(1):]
        await self.app(scope, receive, send)


def mount_static(app: FastAPI, static_path: Path) -> None:
    """Mount built frontend assets with gzip and proper cache headers."""
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    # Rewrite /w/{id}/assets/… → /assets/… so the static mount serves them.
    # Must be added AFTER GZip (Starlette middleware stack is LIFO).
    app.add_middleware(_WorkspaceAssetRewriteMiddleware)

    @app.middleware("http")
    async def _cache_control(request, call_next):
        response = await call_next(request)
        path = request.url.path or ""
        content_type = (response.headers.get("content-type") or "").lower()
        if path.startswith("/assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif "text/html" in content_type:
            response.headers["Cache-Control"] = (
                "no-store, no-cache, must-revalidate, max-age=0"
            )
        return response

    assets_path = static_path / "assets"
    if assets_path.exists() and assets_path.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        requested = (static_path / full_path).resolve()
        # Guard against path traversal (e.g. ../../etc/passwd)
        if full_path and str(requested).startswith(str(static_path.resolve())) and requested.is_file():
            return FileResponse(requested)
        return FileResponse(
            static_path / "index.html",
            headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
        )


# Use app_config_loader to read boring.app.toml (if present) for runtime config
# (app name, agents.mode, auth provider, etc.) served via /__bui/config.
# Falls back to plain create_app() if no TOML is found.
from .app_config_loader import _create_app as _create_configured_app

app = _create_configured_app()

static_dir = os.environ.get("BORING_UI_STATIC_DIR", "")
if static_dir:
    static_path = Path(static_dir)
    if static_path.exists() and static_path.is_dir():
        mount_static(app, static_path)

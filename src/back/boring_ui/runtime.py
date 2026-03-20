"""Production runtime app for boring-ui.

Serves API + built frontend from one FastAPI service when BORING_UI_STATIC_DIR is set.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import FileResponse, Response

from .api import APIConfig, create_app

_PREFIXED_ASSET_RE = re.compile(r"^(?:/w/[^/]+|/auth)(/assets/|/fonts/)")

_STALE_JS_RECOVERY_SOURCE = """const marker='__buiChunkReloaded__';
if (typeof window !== 'undefined') {
  if (!window[marker]) {
    window[marker] = true;
    window.location.reload();
  }
}
throw new Error('Missing stale asset chunk; reloading application shell.');
"""


def _missing_asset_recovery_response(path: str) -> Response | None:
    raw = str(path or "").lstrip("/")
    normalized = f"/assets/{raw}" if not raw.startswith(("assets/", "fonts/")) else f"/{raw}"
    if not normalized.startswith("/assets/"):
        return None
    if normalized.endswith((".js", ".mjs")):
        return Response(
            content=_STALE_JS_RECOVERY_SOURCE,
            media_type="text/javascript",
            headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
        )
    if normalized.endswith(".css"):
        return Response(
            content="/* Missing stale asset chunk; stylesheet intentionally empty. */\n",
            media_type="text/css",
            headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
        )
    return None


class _RecoveringStaticFiles(StaticFiles):
    """Serve recovery payloads for stale hashed asset URLs after deploys."""

    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            recovery = _missing_asset_recovery_response(path)
            if recovery is not None:
                return recovery
            raise
        if getattr(response, "status_code", None) == 404:
            recovery = _missing_asset_recovery_response(path)
            if recovery is not None:
                return recovery
        return response


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
            response.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
        elif "text/html" in content_type:
            response.headers["Cache-Control"] = (
                "no-store, no-cache, must-revalidate, max-age=0"
            )
        return response

    assets_path = static_path / "assets"
    if assets_path.exists() and assets_path.is_dir():
        app.mount("/assets", _RecoveringStaticFiles(directory=assets_path), name="assets")

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

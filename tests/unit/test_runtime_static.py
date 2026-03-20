from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from boring_ui.runtime import mount_static


def _client(static_dir: Path) -> TestClient:
    app = FastAPI()
    mount_static(app, static_dir)
    return TestClient(app)


def test_missing_stale_js_chunk_returns_recovery_module(tmp_path: Path) -> None:
    static_dir = tmp_path / "static"
    assets_dir = static_dir / "assets"
    assets_dir.mkdir(parents=True)
    (static_dir / "index.html").write_text("<!doctype html><html></html>\n", encoding="utf-8")

    client = _client(static_dir)
    response = client.get("/assets/index-oldhash.js")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/javascript")
    assert response.headers["cache-control"] == "no-store, no-cache, must-revalidate, max-age=0"
    assert "window.location.reload()" in response.text


def test_missing_stale_css_chunk_returns_empty_stylesheet(tmp_path: Path) -> None:
    static_dir = tmp_path / "static"
    assets_dir = static_dir / "assets"
    assets_dir.mkdir(parents=True)
    (static_dir / "index.html").write_text("<!doctype html><html></html>\n", encoding="utf-8")

    client = _client(static_dir)
    response = client.get("/assets/index-oldhash.css")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/css")
    assert response.headers["cache-control"] == "no-store, no-cache, must-revalidate, max-age=0"
    assert "Missing stale asset chunk" in response.text


def test_existing_asset_keeps_immutable_cache_headers(tmp_path: Path) -> None:
    static_dir = tmp_path / "static"
    assets_dir = static_dir / "assets"
    assets_dir.mkdir(parents=True)
    (static_dir / "index.html").write_text("<!doctype html><html></html>\n", encoding="utf-8")
    (assets_dir / "index-current.js").write_text("console.log('ok')\n", encoding="utf-8")

    client = _client(static_dir)
    response = client.get("/assets/index-current.js")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/javascript")
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


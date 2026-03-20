"""Backend image guardrails for child CLI support."""

from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = REPO_ROOT / "deploy" / "shared" / "Dockerfile.backend"


def test_shared_backend_dockerfile_installs_child_cli_support_tools() -> None:
    contents = DOCKERFILE.read_text(encoding="utf-8")

    # Tools installed via apt
    for package in ("curl", "git", "jq", "ripgrep", "tree"):
        assert package in contents, f"{package} not found in Dockerfile"

    # Node.js installed via nodesource PPA (not apt package list)
    assert "nodesource" in contents, "Node.js should be installed via nodesource"
    assert "npm ci" in contents, "npm ci should run for pi_service deps"
    assert "pi_service" in contents, "pi_service should be copied into image"

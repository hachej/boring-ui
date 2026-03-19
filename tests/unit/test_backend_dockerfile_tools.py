"""Backend image guardrails for child CLI support."""

from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = REPO_ROOT / "deploy" / "shared" / "Dockerfile.backend"


def test_shared_backend_dockerfile_installs_child_cli_support_tools() -> None:
    contents = DOCKERFILE.read_text(encoding="utf-8")

    for package in ("curl", "git", "jq", "nodejs", "npm", "ripgrep", "tree"):
        assert f"    {package} \\" in contents

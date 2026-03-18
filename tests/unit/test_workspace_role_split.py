"""Tests for backend-agent workspace role split (bd-gbqy.7).

Verifies that the same image can serve both roles based on env vars:
- Control plane: AGENTS_MODE=backend + DATABASE_URL set → control_plane enabled
- Workspace: AGENTS_MODE=backend + no DATABASE_URL → control_plane disabled
"""
import os
from pathlib import Path
from unittest.mock import patch

from boring_ui.api.config import APIConfig


def _make_config(**env_overrides):
    """Create APIConfig with controlled environment."""
    env = {
        "CONTROL_PLANE_ENABLED": "true",
        "BORING_UI_SESSION_SECRET": "test-secret",
    }
    env.update(env_overrides)
    # Remove keys set to None
    env = {k: v for k, v in env.items() if v is not None}
    with patch.dict(os.environ, env, clear=False):
        return APIConfig(workspace_root=Path("/workspace"))


def test_frontend_mode_default():
    config = _make_config()
    assert config.agents_mode == "frontend"
    assert config.control_plane_enabled is True


def test_backend_mode_no_db_disables_control_plane():
    config = _make_config(AGENTS_MODE="backend", DATABASE_URL=None)
    assert config.agents_mode == "backend"
    assert config.control_plane_enabled is False


def test_backend_mode_with_db_keeps_control_plane():
    config = _make_config(AGENTS_MODE="backend", DATABASE_URL="postgresql://test")
    assert config.agents_mode == "backend"
    assert config.control_plane_enabled is True


def test_frontend_mode_no_db_keeps_control_plane():
    """Frontend mode doesn't auto-disable control plane even without DB."""
    config = _make_config(AGENTS_MODE="frontend", DATABASE_URL=None)
    assert config.agents_mode == "frontend"
    assert config.control_plane_enabled is True


def test_agents_mode_normalizes_unknown():
    config = _make_config(AGENTS_MODE="invalid")
    assert config.agents_mode == "frontend"


def test_agents_mode_from_env():
    config = _make_config(AGENTS_MODE="BACKEND")
    assert config.agents_mode == "backend"

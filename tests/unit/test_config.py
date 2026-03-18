"""Unit tests for boring_ui.api.config module."""
import os
import sys

import pytest
from pathlib import Path
from boring_ui.api.config import APIConfig


# Check if symlinks are supported (Windows requires admin privileges)
def _symlinks_supported():
    """Check if the platform supports symlinks without special privileges."""
    if sys.platform == 'win32':
        return False
    return True


class TestAPIConfig:
    """Tests for APIConfig dataclass."""

    def test_default_values(self, tmp_path, monkeypatch):
        """Test default configuration values."""
        for name in (
            'WORKSPACE_PLUGINS_ENABLED',
            'WORKSPACE_PLUGIN_ALLOWLIST',
            'CONTROL_PLANE_ENABLED',
            'CONTROL_PLANE_STATE_RELPATH',
            'AUTH_SESSION_COOKIE_NAME',
            'AUTH_SESSION_TTL_SECONDS',
            'AUTH_SESSION_SECURE_COOKIE',
            'AUTH_DEV_LOGIN_ENABLED',
            'AUTH_DEV_AUTO_LOGIN',
        ):
            monkeypatch.delenv(name, raising=False)
        config = APIConfig(workspace_root=tmp_path)
        # Default includes multiple dev origins
        assert 'http://localhost:5173' in config.cors_origins
        assert 'http://localhost:5174' in config.cors_origins
        assert 'http://localhost:3000' in config.cors_origins
        assert 'shell' in config.pty_providers
        assert 'claude' in config.pty_providers
        assert config.pty_providers['shell'] == ['bash']
        assert config.workspace_plugins_enabled is False
        assert config.workspace_plugin_allowlist == []
        assert config.control_plane_enabled is True
        assert config.control_plane_state_relpath == '.boring/control-plane/state.json'
        assert config.auth_session_cookie_name == 'boring_session'
        assert config.auth_session_ttl_seconds == 86400
        assert config.auth_session_secure_cookie is False
        assert config.auth_dev_login_enabled is False
        assert isinstance(config.auth_session_secret, str)
        assert len(config.auth_session_secret) >= 32

    def test_custom_cors_origins(self, tmp_path):
        """Test custom CORS origins."""
        origins = ['http://localhost:3000', 'https://example.com']
        config = APIConfig(workspace_root=tmp_path, cors_origins=origins)
        assert config.cors_origins == origins

    def test_custom_pty_providers(self, tmp_path):
        """Test custom PTY providers."""
        providers = {'custom': ['python', '-m', 'ptpython']}
        config = APIConfig(workspace_root=tmp_path, pty_providers=providers)
        assert config.pty_providers == providers

    def test_pty_claude_command_env_override(self, tmp_path, monkeypatch):
        """Test BORING_UI_PTY_CLAUDE_COMMAND overrides the default claude provider."""
        monkeypatch.setenv("BORING_UI_PTY_CLAUDE_COMMAND", "bash")
        config = APIConfig(workspace_root=tmp_path)
        assert config.pty_providers["claude"] == ["bash"]

    def test_workspace_plugins_enabled_from_env(self, tmp_path, monkeypatch):
        """Plugins stay enabled only when auto resolves to validated_exec."""
        monkeypatch.setenv('WORKSPACE_PLUGINS_ENABLED', 'true')
        monkeypatch.setenv('SANDBOX_BACKEND', 'auto')
        monkeypatch.setattr('boring_ui.api.sandbox.NsjailBackend.available', staticmethod(lambda: False))
        monkeypatch.setattr('boring_ui.api.sandbox.BoxLiteBackend.available', staticmethod(lambda: False))
        config = APIConfig(workspace_root=tmp_path)
        assert config.workspace_plugins_enabled is True

    def test_workspace_plugins_forced_off_for_nsjail(self, tmp_path, monkeypatch):
        """Hosted nsjail mode must not allow in-process workspace plugins."""
        monkeypatch.setenv('WORKSPACE_PLUGINS_ENABLED', 'true')
        monkeypatch.setenv('SANDBOX_BACKEND', 'nsjail')
        config = APIConfig(workspace_root=tmp_path)
        assert config.workspace_plugins_enabled is False

    def test_workspace_plugins_forced_off_for_boxlite(self, tmp_path, monkeypatch):
        """Hosted BoxLite mode must not allow in-process workspace plugins."""
        monkeypatch.setenv('WORKSPACE_PLUGINS_ENABLED', 'true')
        monkeypatch.setenv('SANDBOX_BACKEND', 'boxlite')
        config = APIConfig(workspace_root=tmp_path)
        assert config.workspace_plugins_enabled is False

    def test_workspace_plugins_forced_off_for_auto_nsjail(self, tmp_path, monkeypatch):
        """Auto-resolved nsjail mode must also disable in-process workspace plugins."""
        monkeypatch.setenv('WORKSPACE_PLUGINS_ENABLED', 'true')
        monkeypatch.setenv('SANDBOX_BACKEND', 'auto')
        monkeypatch.setattr('boring_ui.api.sandbox.NsjailBackend.available', staticmethod(lambda: True))
        monkeypatch.setattr('boring_ui.api.sandbox.BoxLiteBackend.available', staticmethod(lambda: False))
        config = APIConfig(workspace_root=tmp_path)
        assert config.workspace_plugins_enabled is False

    def test_workspace_plugins_forced_off_for_auto_boxlite(self, tmp_path, monkeypatch):
        """Auto-resolved BoxLite mode must also disable in-process workspace plugins."""
        monkeypatch.setenv('WORKSPACE_PLUGINS_ENABLED', 'true')
        monkeypatch.setenv('SANDBOX_BACKEND', 'auto')
        monkeypatch.setattr('boring_ui.api.sandbox.NsjailBackend.available', staticmethod(lambda: False))
        monkeypatch.setattr('boring_ui.api.sandbox.BoxLiteBackend.available', staticmethod(lambda: True))
        config = APIConfig(workspace_root=tmp_path)
        assert config.workspace_plugins_enabled is False

    def test_workspace_plugin_allowlist_from_env(self, tmp_path, monkeypatch):
        """Test plugin allowlist is parsed from comma-separated env."""
        monkeypatch.setenv('WORKSPACE_PLUGIN_ALLOWLIST', 'alpha, beta,gamma ')
        config = APIConfig(workspace_root=tmp_path)
        assert config.workspace_plugin_allowlist == ['alpha', 'beta', 'gamma']

    def test_control_plane_enabled_from_env(self, tmp_path, monkeypatch):
        """Test control-plane feature flag is parsed from env."""
        monkeypatch.setenv('CONTROL_PLANE_ENABLED', 'false')
        config = APIConfig(workspace_root=tmp_path)
        assert config.control_plane_enabled is False

    def test_control_plane_state_relpath_from_env(self, tmp_path, monkeypatch):
        """Test control-plane state path can be overridden via env."""
        monkeypatch.setenv('CONTROL_PLANE_STATE_RELPATH', '.control/state.json')
        config = APIConfig(workspace_root=tmp_path)
        assert config.control_plane_state_relpath == '.control/state.json'

    def test_auth_session_config_from_env(self, tmp_path, monkeypatch):
        """Test auth/session config fields are parsed from env vars."""
        monkeypatch.setenv('AUTH_SESSION_COOKIE_NAME', 'custom_session')
        monkeypatch.setenv('AUTH_SESSION_TTL_SECONDS', '1800')
        monkeypatch.setenv('AUTH_SESSION_SECURE_COOKIE', 'true')
        monkeypatch.setenv('AUTH_DEV_LOGIN_ENABLED', 'true')
        monkeypatch.setenv('BORING_UI_SESSION_SECRET', 'super-secret')
        config = APIConfig(workspace_root=tmp_path)
        assert config.auth_session_cookie_name == 'custom_session'
        assert config.auth_session_ttl_seconds == 1800
        assert config.auth_session_secure_cookie is True
        assert config.auth_dev_login_enabled is True
        assert config.auth_session_secret == 'super-secret'

    def test_github_private_key_unescapes_newlines(self, tmp_path, monkeypatch):
        """Docker env files carry PEMs with escaped newlines."""
        monkeypatch.setenv('GITHUB_APP_PRIVATE_KEY', 'line-1\\nline-2')
        config = APIConfig(workspace_root=tmp_path)
        assert config.github_app_private_key == 'line-1\nline-2'


class TestValidatePath:
    """Tests for APIConfig.validate_path method."""

    def test_validate_path_within_workspace(self, tmp_path):
        """Test validating a path within workspace."""
        config = APIConfig(workspace_root=tmp_path)
        subdir = tmp_path / 'subdir'
        subdir.mkdir()
        result = config.validate_path('subdir')
        assert result == subdir

    def test_validate_path_nested(self, tmp_path):
        """Test validating a nested path."""
        config = APIConfig(workspace_root=tmp_path)
        nested = tmp_path / 'a' / 'b' / 'c'
        nested.mkdir(parents=True)
        result = config.validate_path('a/b/c')
        assert result == nested

    def test_validate_path_rejects_traversal(self, tmp_path):
        """Test that path traversal is rejected."""
        config = APIConfig(workspace_root=tmp_path)
        with pytest.raises(ValueError, match='traversal'):
            config.validate_path('../../../etc/passwd')

    def test_validate_path_rejects_absolute_escape(self, tmp_path):
        """Test that absolute paths outside workspace are rejected."""
        config = APIConfig(workspace_root=tmp_path)
        with pytest.raises(ValueError, match='traversal'):
            config.validate_path('/etc/passwd')

    def test_validate_path_handles_dots(self, tmp_path):
        """Test that . and .. in paths are normalized."""
        config = APIConfig(workspace_root=tmp_path)
        subdir = tmp_path / 'subdir'
        subdir.mkdir()
        result = config.validate_path('./subdir/../subdir')
        assert result == subdir

    def test_validate_path_accepts_string(self, tmp_path):
        """Test that string paths are accepted."""
        config = APIConfig(workspace_root=tmp_path)
        result = config.validate_path('.')
        assert result == tmp_path

    def test_validate_path_accepts_path_object(self, tmp_path):
        """Test that Path objects are accepted."""
        config = APIConfig(workspace_root=tmp_path)
        result = config.validate_path(Path('.'))
        assert result == tmp_path

    def test_validate_path_workspace_root_itself(self, tmp_path):
        """Test that workspace root is a valid path."""
        config = APIConfig(workspace_root=tmp_path)
        # Passing '.' should resolve to workspace_root
        result = config.validate_path('.')
        assert result == tmp_path.resolve()

    @pytest.mark.skipif(
        not _symlinks_supported(),
        reason='Symlinks require admin privileges on Windows'
    )
    def test_validate_path_symlink_escape(self, tmp_path):
        """Test that symlinks escaping workspace are rejected."""
        # Create a symlink that points outside workspace
        outside_dir = tmp_path.parent / 'outside'
        outside_dir.mkdir(exist_ok=True)

        symlink = tmp_path / 'escape_link'
        try:
            symlink.symlink_to(outside_dir)
        except OSError:
            pytest.skip('Symlink creation not supported on this system')

        try:
            config = APIConfig(workspace_root=tmp_path)
            with pytest.raises(ValueError, match='traversal'):
                config.validate_path('escape_link')
        finally:
            if symlink.exists():
                symlink.unlink()
            if outside_dir.exists():
                outside_dir.rmdir()

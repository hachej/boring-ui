"""Unit tests for boring_ui.api.modules.git module."""
import os
import subprocess
import pytest
from httpx import AsyncClient, ASGITransport
from pathlib import Path
from boring_ui.api.config import APIConfig
from boring_ui.api.modules.git import create_git_router
from fastapi import FastAPI


@pytest.fixture
def git_repo(tmp_path):
    """Create a git repository with test commits."""
    # Initialize git repo
    subprocess.run(['git', 'init'], cwd=tmp_path, capture_output=True, check=True)
    subprocess.run(
        ['git', 'config', 'user.email', 'test@test.com'],
        cwd=tmp_path, capture_output=True, check=True
    )
    subprocess.run(
        ['git', 'config', 'user.name', 'Test User'],
        cwd=tmp_path, capture_output=True, check=True
    )

    # Create and commit a file
    (tmp_path / 'file.txt').write_text('original content')
    subprocess.run(['git', 'add', '.'], cwd=tmp_path, capture_output=True, check=True)
    subprocess.run(
        ['git', 'commit', '-m', 'Initial commit'],
        cwd=tmp_path, capture_output=True, check=True
    )

    # Modify file (unstaged change)
    (tmp_path / 'file.txt').write_text('modified content')

    return tmp_path


@pytest.fixture
def app(git_repo):
    """Create test FastAPI app with git router."""
    config = APIConfig(workspace_root=git_repo)
    app = FastAPI()
    app.include_router(create_git_router(config), prefix='/api/v1/git')
    return app


@pytest.fixture
def non_git_app(tmp_path):
    """Create test app in a non-git directory."""
    # Create some files but don't init git
    (tmp_path / 'file.txt').write_text('not in repo')
    config = APIConfig(workspace_root=tmp_path)
    app = FastAPI()
    app.include_router(create_git_router(config), prefix='/api/v1/git')
    return app


class TestStatusEndpoint:
    """Tests for GET /status endpoint."""

    @pytest.mark.asyncio
    async def test_status_in_repo(self, app):
        """Test status returns repo info with modified files."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/status')
            assert r.status_code == 200
            data = r.json()
            assert data['is_repo'] is True
            assert data['available'] is True
            # files is a list of {path, status} dicts
            files_by_path = {f['path']: f['status'] for f in data['files']}
            assert 'file.txt' in files_by_path
            # M for modified (unstaged)
            assert files_by_path['file.txt'] == 'M'

    @pytest.mark.asyncio
    async def test_status_not_a_repo(self, non_git_app):
        """Test status returns is_repo=False for non-git directory."""
        transport = ASGITransport(app=non_git_app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/status')
            assert r.status_code == 200
            data = r.json()
            assert data['is_repo'] is False
            assert data['files'] == []

    @pytest.mark.asyncio
    async def test_status_clean_repo(self, git_repo):
        """Test status with clean working tree."""
        # Reset file to original content
        (git_repo / 'file.txt').write_text('original content')

        config = APIConfig(workspace_root=git_repo)
        app = FastAPI()
        app.include_router(create_git_router(config), prefix='/api/v1/git')

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/status')
            assert r.status_code == 200
            data = r.json()
            assert data['is_repo'] is True
            # Should have no modified files
            files_by_path = {f['path']: f['status'] for f in data['files']}
            assert 'file.txt' not in files_by_path

    @pytest.mark.asyncio
    async def test_status_with_staged_file(self, git_repo):
        """Test status shows staged files."""
        # Stage the modified file
        subprocess.run(
            ['git', 'add', 'file.txt'],
            cwd=git_repo, capture_output=True, check=True
        )

        config = APIConfig(workspace_root=git_repo)
        app = FastAPI()
        app.include_router(create_git_router(config), prefix='/api/v1/git')

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/status')
            assert r.status_code == 200
            data = r.json()
            files_by_path = {f['path']: f['status'] for f in data['files']}
            assert 'file.txt' in files_by_path
            # M for modified (staged)
            assert files_by_path['file.txt'] == 'M'

    @pytest.mark.asyncio
    async def test_status_with_untracked_file(self, git_repo):
        """Test status shows untracked files."""
        # Create untracked file
        (git_repo / 'untracked.txt').write_text('untracked')

        config = APIConfig(workspace_root=git_repo)
        app = FastAPI()
        app.include_router(create_git_router(config), prefix='/api/v1/git')

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/status')
            assert r.status_code == 200
            data = r.json()
            files_by_path = {f['path']: f['status'] for f in data['files']}
            assert 'untracked.txt' in files_by_path
            # U for untracked (normalized from '??')
            assert files_by_path['untracked.txt'] == 'U'


class TestDiffEndpoint:
    """Tests for GET /diff endpoint."""

    @pytest.mark.asyncio
    async def test_diff_modified_file(self, app):
        """Test diff shows changes for modified file."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/diff?path=file.txt')
            assert r.status_code == 200
            data = r.json()
            assert 'diff' in data
            assert data['path'] == 'file.txt'
            # Diff should show old and new content
            assert 'original' in data['diff']
            assert 'modified' in data['diff']

    @pytest.mark.asyncio
    async def test_diff_unmodified_file(self, git_repo):
        """Test diff returns empty for unmodified file."""
        # Reset file
        (git_repo / 'file.txt').write_text('original content')

        config = APIConfig(workspace_root=git_repo)
        app = FastAPI()
        app.include_router(create_git_router(config), prefix='/api/v1/git')

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/diff?path=file.txt')
            assert r.status_code == 200
            data = r.json()
            assert data['diff'] == ''

    @pytest.mark.asyncio
    async def test_diff_untracked_file(self, git_repo):
        """Test diff handles untracked file gracefully."""
        # Create untracked file
        (git_repo / 'new.txt').write_text('new content')

        config = APIConfig(workspace_root=git_repo)
        app = FastAPI()
        app.include_router(create_git_router(config), prefix='/api/v1/git')

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/diff?path=new.txt')
            assert r.status_code == 200
            data = r.json()
            # Should return empty diff with error message for untracked
            assert 'error' in data or data['diff'] == ''

    @pytest.mark.asyncio
    async def test_diff_path_traversal_rejected(self, app):
        """Test path traversal is rejected."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/diff?path=../../../etc/passwd')
            assert r.status_code == 400
            assert 'traversal' in r.json()['detail'].lower()


class TestShowEndpoint:
    """Tests for GET /show endpoint."""

    @pytest.mark.asyncio
    async def test_show_tracked_file(self, app):
        """Test show returns file content at HEAD."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/show?path=file.txt')
            assert r.status_code == 200
            data = r.json()
            assert data['content'] == 'original content'
            assert data['path'] == 'file.txt'

    @pytest.mark.asyncio
    async def test_show_untracked_file(self, git_repo):
        """Test show returns null for untracked file."""
        # Create untracked file
        (git_repo / 'untracked.txt').write_text('untracked')

        config = APIConfig(workspace_root=git_repo)
        app = FastAPI()
        app.include_router(create_git_router(config), prefix='/api/v1/git')

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/show?path=untracked.txt')
            assert r.status_code == 200
            data = r.json()
            assert data['content'] is None
            assert 'error' in data

    @pytest.mark.asyncio
    async def test_show_returns_committed_content(self, git_repo):
        """Test show returns committed content, not working tree."""
        # File has modified content but we want committed content
        config = APIConfig(workspace_root=git_repo)
        app = FastAPI()
        app.include_router(create_git_router(config), prefix='/api/v1/git')

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/show?path=file.txt')
            assert r.status_code == 200
            data = r.json()
            # Should return original committed content, not modified
            assert data['content'] == 'original content'
            assert 'modified' not in data['content']

    @pytest.mark.asyncio
    async def test_show_path_traversal_rejected(self, app):
        """Test path traversal is rejected."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/show?path=../../../etc/passwd')
            assert r.status_code == 400
            assert 'traversal' in r.json()['detail'].lower()

    @pytest.mark.asyncio
    async def test_show_nested_file(self, git_repo):
        """Test show works with files in subdirectories."""
        # Create and commit a nested file
        (git_repo / 'subdir').mkdir()
        (git_repo / 'subdir' / 'nested.txt').write_text('nested content')
        subprocess.run(['git', 'add', '.'], cwd=git_repo, capture_output=True, check=True)
        subprocess.run(
            ['git', 'commit', '-m', 'Add nested file'],
            cwd=git_repo, capture_output=True, check=True
        )

        config = APIConfig(workspace_root=git_repo)
        app = FastAPI()
        app.include_router(create_git_router(config), prefix='/api/v1/git')

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/show?path=subdir/nested.txt')
            assert r.status_code == 200
            data = r.json()
            assert data['content'] == 'nested content'


class TestPathSecurity:
    """Security tests for path validation in git routes."""

    @pytest.mark.asyncio
    async def test_absolute_path_diff_rejected(self, app):
        """Test absolute path in diff is rejected."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/diff?path=/etc/passwd')
            assert r.status_code == 400
            assert 'traversal' in r.json()['detail'].lower()

    @pytest.mark.asyncio
    async def test_absolute_path_show_rejected(self, app):
        """Test absolute path in show is rejected."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/show?path=/etc/passwd')
            assert r.status_code == 400
            assert 'traversal' in r.json()['detail'].lower()


class TestAskpassSecurity:
    """Security tests for GIT_ASKPASS credential handling."""

    def test_askpass_escapes_shell_metacharacters(self):
        """Verify credentials with shell metacharacters are properly escaped."""
        from boring_ui.api.modules.git.service import _create_askpass_script, _cleanup_askpass
        import stat

        path = None
        try:
            path = _create_askpass_script(
                'x-access-token',
                '$(echo INJECTED)',
            )
            # File should exist with 0700 permissions
            st = os.stat(path)
            assert st.st_mode & 0o777 == 0o700

            # Read the script and verify shlex.quote() was applied
            with open(path) as f:
                content = f.read()
            # shlex.quote wraps in single quotes: '$(echo INJECTED)'
            assert "'$(echo INJECTED)'" in content
            # The unquoted form should NOT appear
            assert 'echo "$(echo INJECTED)"' not in content

            # Actually execute the script to verify it outputs the literal
            result = subprocess.run(
                ['sh', path, 'Password for ...'],
                capture_output=True, text=True,
            )
            assert result.stdout.strip() == '$(echo INJECTED)'
        finally:
            _cleanup_askpass(path)

    def test_askpass_escapes_double_quotes(self):
        """Verify double quotes in credentials don't break the script."""
        from boring_ui.api.modules.git.service import _create_askpass_script, _cleanup_askpass

        path = None
        try:
            path = _create_askpass_script('user', 'pass"word')
            result = subprocess.run(
                ['sh', path, 'Password for ...'],
                capture_output=True, text=True,
            )
            assert result.stdout.strip() == 'pass"word'
        finally:
            _cleanup_askpass(path)

    def test_sanitize_git_error_strips_credentials(self):
        """Verify credential URLs are redacted in error messages."""
        from boring_ui.api.modules.git.service import _sanitize_git_error

        raw = "fatal: Authentication failed for 'https://x-access-token:ghs_secret123@github.com/org/repo.git'"
        sanitized = _sanitize_git_error(raw)
        assert 'ghs_secret123' not in sanitized
        assert '***@' in sanitized
        assert 'github.com' in sanitized

    def test_sanitize_git_error_preserves_clean_messages(self):
        """Verify clean error messages pass through unchanged."""
        from boring_ui.api.modules.git.service import _sanitize_git_error

        raw = "fatal: not a git repository"
        assert _sanitize_git_error(raw) == raw

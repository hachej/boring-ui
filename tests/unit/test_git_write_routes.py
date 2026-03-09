"""Unit tests for git write operations (init, add, commit, push, pull, clone, remote)."""
import subprocess
import pytest
from httpx import AsyncClient, ASGITransport
from pathlib import Path
from boring_ui.api.config import APIConfig
from boring_ui.api.modules.git import create_git_router
from fastapi import FastAPI


@pytest.fixture
def git_repo(tmp_path):
    """Create a git repository with an initial commit."""
    subprocess.run(['git', 'init'], cwd=tmp_path, capture_output=True, check=True)
    subprocess.run(['git', 'config', 'user.email', 'test@test.com'],
                    cwd=tmp_path, capture_output=True, check=True)
    subprocess.run(['git', 'config', 'user.name', 'Test User'],
                    cwd=tmp_path, capture_output=True, check=True)
    (tmp_path / 'file.txt').write_text('initial content')
    subprocess.run(['git', 'add', '.'], cwd=tmp_path, capture_output=True, check=True)
    subprocess.run(['git', 'commit', '-m', 'Initial commit'],
                    cwd=tmp_path, capture_output=True, check=True)
    return tmp_path


@pytest.fixture
def empty_dir(tmp_path):
    """Create an empty directory (no git repo)."""
    return tmp_path


@pytest.fixture
def app(git_repo):
    config = APIConfig(workspace_root=git_repo)
    app = FastAPI()
    app.include_router(create_git_router(config), prefix='/api/v1/git')
    return app


@pytest.fixture
def empty_app(empty_dir):
    config = APIConfig(workspace_root=empty_dir)
    app = FastAPI()
    app.include_router(create_git_router(config), prefix='/api/v1/git')
    return app


class TestInitEndpoint:
    @pytest.mark.asyncio
    async def test_init_creates_repo(self, empty_app, empty_dir):
        transport = ASGITransport(app=empty_app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.post('/api/v1/git/init')
            assert r.status_code == 200
            assert r.json()['initialized'] is True
            assert (empty_dir / '.git').is_dir()


class TestAddEndpoint:
    @pytest.mark.asyncio
    async def test_add_specific_files(self, app, git_repo):
        (git_repo / 'new.txt').write_text('new content')
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.post('/api/v1/git/add', json={'paths': ['new.txt']})
            assert r.status_code == 200
            assert r.json()['staged'] is True

        # Verify file is staged
        result = subprocess.run(['git', 'status', '--porcelain'], cwd=git_repo,
                                capture_output=True, text=True)
        assert 'A  new.txt' in result.stdout

    @pytest.mark.asyncio
    async def test_add_all(self, app, git_repo):
        (git_repo / 'a.txt').write_text('a')
        (git_repo / 'b.txt').write_text('b')
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.post('/api/v1/git/add', json={'paths': None})
            assert r.status_code == 200

        result = subprocess.run(['git', 'status', '--porcelain'], cwd=git_repo,
                                capture_output=True, text=True)
        assert 'a.txt' in result.stdout
        assert 'b.txt' in result.stdout


class TestCommitEndpoint:
    @pytest.mark.asyncio
    async def test_commit_staged_changes(self, app, git_repo):
        (git_repo / 'file.txt').write_text('updated content')
        subprocess.run(['git', 'add', '.'], cwd=git_repo, capture_output=True, check=True)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.post('/api/v1/git/commit', json={'message': 'test commit'})
            assert r.status_code == 200
            data = r.json()
            assert len(data['oid']) > 0

        # Verify commit is in log
        result = subprocess.run(['git', 'log', '--oneline', '-1'], cwd=git_repo,
                                capture_output=True, text=True)
        assert 'test commit' in result.stdout

    @pytest.mark.asyncio
    async def test_commit_with_author(self, app, git_repo):
        (git_repo / 'file.txt').write_text('author test')
        subprocess.run(['git', 'add', '.'], cwd=git_repo, capture_output=True, check=True)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.post('/api/v1/git/commit', json={
                'message': 'author commit',
                'author': {'name': 'Bot', 'email': 'bot@test.com'},
            })
            assert r.status_code == 200

        result = subprocess.run(['git', 'log', '--format=%an <%ae>', '-1'], cwd=git_repo,
                                capture_output=True, text=True)
        assert 'Bot <bot@test.com>' in result.stdout

    @pytest.mark.asyncio
    async def test_commit_nothing_staged_fails(self, app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.post('/api/v1/git/commit', json={'message': 'empty'})
            assert r.status_code == 400
            assert 'nothing to commit' in r.json()['detail'].lower()


class TestRemoteEndpoints:
    @pytest.mark.asyncio
    async def test_add_and_list_remote(self, app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.post('/api/v1/git/remote', json={
                'name': 'origin',
                'url': 'https://github.com/test/repo.git',
            })
            assert r.status_code == 200
            assert r.json()['added'] is True

            r = await client.get('/api/v1/git/remotes')
            assert r.status_code == 200
            remotes = r.json()['remotes']
            assert len(remotes) == 1
            assert remotes[0]['remote'] == 'origin'
            assert remotes[0]['url'] == 'https://github.com/test/repo.git'

    @pytest.mark.asyncio
    async def test_add_remote_replaces_existing(self, app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            await client.post('/api/v1/git/remote', json={
                'name': 'origin', 'url': 'https://old.com/repo.git',
            })
            await client.post('/api/v1/git/remote', json={
                'name': 'origin', 'url': 'https://new.com/repo.git',
            })

            r = await client.get('/api/v1/git/remotes')
            remotes = r.json()['remotes']
            assert len(remotes) == 1
            assert remotes[0]['url'] == 'https://new.com/repo.git'

    @pytest.mark.asyncio
    async def test_list_remotes_empty_repo(self, app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/remotes')
            assert r.status_code == 200
            assert r.json()['remotes'] == []

    @pytest.mark.asyncio
    async def test_list_remotes_non_git_dir(self, empty_app):
        transport = ASGITransport(app=empty_app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.get('/api/v1/git/remotes')
            assert r.status_code == 200
            assert r.json()['remotes'] == []


class TestCloneEndpoint:
    @pytest.mark.asyncio
    async def test_clone_requires_url(self, empty_app):
        transport = ASGITransport(app=empty_app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            r = await client.post('/api/v1/git/clone', json={})
            assert r.status_code == 400
            assert 'url' in r.json()['detail'].lower()


class TestFullCycle:
    """Integration test: init → write → add → commit → verify."""

    @pytest.mark.asyncio
    async def test_init_add_commit_cycle(self, empty_app, empty_dir):
        transport = ASGITransport(app=empty_app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            # 1. Init
            r = await client.post('/api/v1/git/init')
            assert r.status_code == 200

        # Configure git user (needed for commit)
        subprocess.run(['git', 'config', 'user.email', 'test@test.com'],
                        cwd=empty_dir, capture_output=True, check=True)
        subprocess.run(['git', 'config', 'user.name', 'Test User'],
                        cwd=empty_dir, capture_output=True, check=True)

        # 2. Create a file
        (empty_dir / 'hello.txt').write_text('hello world')

        async with AsyncClient(transport=transport, base_url='http://test') as client:
            # 3. Add
            r = await client.post('/api/v1/git/add', json={'paths': ['hello.txt']})
            assert r.status_code == 200

            # 4. Commit
            r = await client.post('/api/v1/git/commit', json={'message': 'first commit'})
            assert r.status_code == 200
            assert len(r.json()['oid']) > 0

            # 5. Status should be clean
            r = await client.get('/api/v1/git/status')
            assert r.status_code == 200
            assert r.json()['is_repo'] is True
            assert r.json()['files'] == []

"""Unit tests for GitHub App auth routes — full lifecycle + credential chain."""
import json
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from httpx import AsyncClient, ASGITransport
from boring_ui.api.config import APIConfig
from boring_ui.api.modules.github_auth import create_github_auth_router
from boring_ui.api.modules.github_auth.router import (
    _workspace_connections,
    _resolve_connection,
    _store_connection,
    _remove_connection,
)
from boring_ui.api.modules.control_plane.auth_session import create_session_cookie
from boring_ui.api.modules.control_plane.user_settings_state import (
    read_user_github_link,
    user_state_service,
)
from fastapi import FastAPI


# ── Fixtures ────────────────────────────────────────────────────────────

@pytest.fixture
def config(tmp_path):
    return APIConfig(
        workspace_root=tmp_path,
        github_app_id='12345',
        github_app_client_id='Iv1.test123',
        github_app_client_secret='secret456',
        github_app_private_key='fake-pem-key',
    )


@pytest.fixture
def config_with_slug(tmp_path):
    return APIConfig(
        workspace_root=tmp_path,
        github_app_id='12345',
        github_app_client_id='Iv1.test123',
        github_app_client_secret='secret456',
        github_app_private_key='fake-pem-key',
        github_app_slug='boring-ui-app',
    )


@pytest.fixture
def unconfigured_config(tmp_path):
    return APIConfig(
        workspace_root=tmp_path,
        github_app_id=None,
        github_app_client_id=None,
        github_app_client_secret=None,
        github_app_private_key=None,
        github_app_slug=None,
    )


@pytest.fixture
def app(config):
    app = FastAPI()
    app.include_router(
        create_github_auth_router(config), prefix='/api/v1/auth/github',
    )
    return app


@pytest.fixture
def app_with_slug(config_with_slug):
    app = FastAPI()
    app.include_router(
        create_github_auth_router(config_with_slug), prefix='/api/v1/auth/github',
    )
    return app


@pytest.fixture
def unconfigured_app(unconfigured_config):
    app = FastAPI()
    app.include_router(
        create_github_auth_router(unconfigured_config),
        prefix='/api/v1/auth/github',
    )
    return app


@pytest.fixture(autouse=True)
def clear_connections():
    """Clear in-memory connection cache between tests."""
    _workspace_connections.clear()
    yield
    _workspace_connections.clear()


# ── Status endpoint ─────────────────────────────────────────────────────

class TestStatus:
    @pytest.mark.asyncio
    async def test_status_unconfigured(self, unconfigured_app):
        transport = ASGITransport(app=unconfigured_app)
        async with AsyncClient(transport=transport, base_url='http://test') as c:
            r = await c.get('/api/v1/auth/github/status')
            assert r.status_code == 200
            assert r.json()['configured'] is False
            assert r.json()['connected'] is False

    @pytest.mark.asyncio
    async def test_status_configured_no_workspace(self, app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as c:
            r = await c.get('/api/v1/auth/github/status')
            assert r.status_code == 200
            assert r.json()['configured'] is True
            assert r.json()['connected'] is False

    @pytest.mark.asyncio
    async def test_status_with_workspace_not_connected(self, app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as c:
            r = await c.get('/api/v1/auth/github/status',
                            params={'workspace_id': 'ws-1'})
            assert r.status_code == 200
            assert r.json()['connected'] is False

    @pytest.mark.asyncio
    async def test_status_with_connected_workspace(self, app):
        """Status returns connected=True after connect."""
        _workspace_connections['ws-1'] = {'installation_id': 42}
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as c:
            r = await c.get('/api/v1/auth/github/status',
                            params={'workspace_id': 'ws-1'})
            assert r.status_code == 200
            data = r.json()
            assert data['configured'] is True
            assert data['connected'] is True
            assert data['installation_connected'] is True
            assert data['repo_selected'] is False
            assert data['installation_id'] == 42

    @pytest.mark.asyncio
    async def test_status_reports_user_level_account_link_when_workspace_not_connected(self, app, config):
        service = user_state_service(config)
        from boring_ui.api.modules.control_plane.user_settings_state import write_user_github_link
        write_user_github_link(
            service,
            user_id='user-gh-status',
            email='gh-status@example.com',
            account_linked=True,
            default_installation_id=777,
        )
        cookie = create_session_cookie(
            'user-gh-status',
            'gh-status@example.com',
            secret=config.auth_session_secret,
            ttl_seconds=config.auth_session_ttl_seconds,
        )
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as c:
            c.cookies.set(config.auth_session_cookie_name, cookie)
            r = await c.get('/api/v1/auth/github/status',
                            params={'workspace_id': 'ws-account-only'})
            assert r.status_code == 200
            data = r.json()
            assert data['account_linked'] is True
            assert data['default_installation_id'] == 777
            assert data['installation_connected'] is False
            assert data['repo_selected'] is False

    @pytest.mark.asyncio
    async def test_status_with_selected_repo(self, app):
        """Status exposes repo selection when a workspace repo is chosen."""
        _workspace_connections['ws-2'] = {
            'installation_id': 77,
            'repo_url': 'https://github.com/myorg/myrepo.git',
        }
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as c:
            r = await c.get('/api/v1/auth/github/status',
                            params={'workspace_id': 'ws-2'})
            assert r.status_code == 200
            data = r.json()
            assert data['configured'] is True
            assert data['connected'] is True
            assert data['installation_connected'] is True
            assert data['repo_selected'] is True
            assert data['repo_url'] == 'https://github.com/myorg/myrepo.git'


# ── Callback endpoint ───────────────────────────────────────────────────

class TestAuthorize:
    @pytest.mark.asyncio
    async def test_authorize_workspace_prefers_user_oauth_detection(self, app_with_slug):
        transport = ASGITransport(app=app_with_slug)
        async with AsyncClient(
            transport=transport, base_url='http://test', follow_redirects=False,
        ) as c:
            r = await c.get('/api/v1/auth/github/authorize', params={'workspace_id': 'ws-oauth'})
            assert r.status_code in (302, 307)
            assert 'github.com/login/oauth/authorize' in r.headers['location']

    @pytest.mark.asyncio
    async def test_authorize_force_install_uses_app_install_flow(self, app_with_slug):
        transport = ASGITransport(app=app_with_slug)
        async with AsyncClient(
            transport=transport, base_url='http://test', follow_redirects=False,
        ) as c:
            r = await c.get('/api/v1/auth/github/authorize', params={
                'workspace_id': 'ws-install',
                'force_install': 'true',
            })
            assert r.status_code in (302, 307)
            assert 'github.com/apps/boring-ui-app/installations/new' in r.headers['location']

class TestCallback:
    @pytest.mark.asyncio
    async def test_callback_oauth_code_returns_html(self, app):
        """Callback with OAuth code returns HTML page (not JSON)."""
        transport = ASGITransport(app=app)
        with patch(
            'boring_ui.api.modules.github_auth.service.httpx.post'
        ) as mock_post, patch(
            'boring_ui.api.modules.github_auth.service.httpx.get'
        ) as mock_get:
            # Mock OAuth token exchange
            token_resp = MagicMock()
            token_resp.status_code = 200
            token_resp.json.return_value = {
                'access_token': 'ghu_test123',
                'token_type': 'bearer',
            }
            token_resp.raise_for_status = MagicMock()
            mock_post.return_value = token_resp

            # Mock user installations
            install_resp = MagicMock()
            install_resp.status_code = 200
            install_resp.json.return_value = {
                'installations': [{
                    'id': 99,
                    'account': {'login': 'testorg', 'type': 'Organization'},
                }],
            }
            install_resp.raise_for_status = MagicMock()
            mock_get.return_value = install_resp

            async with AsyncClient(
                transport=transport, base_url='http://test',
                follow_redirects=False,
            ) as c:
                r = await c.get('/api/v1/auth/github/callback',
                                params={'code': 'test-code'})
                assert r.status_code == 200
                assert 'text/html' in r.headers.get('content-type', '')
                assert 'Connected successfully!' in r.text

    @pytest.mark.asyncio
    async def test_callback_oauth_code_with_workspace_stores_first_user_installation(self, app, config):
        transport = ASGITransport(app=app)
        cookie = create_session_cookie(
            'user-gh-callback',
            'gh-callback@example.com',
            secret=config.auth_session_secret,
            ttl_seconds=config.auth_session_ttl_seconds,
        )
        with patch(
            'boring_ui.api.modules.github_auth.service.httpx.post'
        ) as mock_post, patch(
            'boring_ui.api.modules.github_auth.service.httpx.get'
        ) as mock_get:
            token_resp = MagicMock()
            token_resp.status_code = 200
            token_resp.json.return_value = {
                'access_token': 'ghu_test123',
                'token_type': 'bearer',
            }
            token_resp.raise_for_status = MagicMock()
            mock_post.return_value = token_resp

            install_resp = MagicMock()
            install_resp.status_code = 200
            install_resp.json.return_value = {
                'installations': [{
                    'id': 321,
                    'account': {'login': 'juline', 'type': 'User'},
                }],
            }
            install_resp.raise_for_status = MagicMock()
            mock_get.return_value = install_resp

            async with AsyncClient(
                transport=transport, base_url='http://test', follow_redirects=False,
            ) as c:
                c.cookies.set(config.auth_session_cookie_name, cookie)
                r = await c.get('/api/v1/auth/github/callback', params={
                    'code': 'test-code',
                    'workspace_id': 'ws-reconnect',
                })
                assert r.status_code == 200
                assert 'Connected successfully!' in r.text

        conn = _workspace_connections.get('ws-reconnect')
        assert conn is not None
        assert conn['installation_id'] == 321
        user_link = read_user_github_link(user_state_service(config), 'user-gh-callback')
        assert user_link['account_linked'] is True
        assert user_link['default_installation_id'] == 321

    @pytest.mark.asyncio
    async def test_callback_oauth_code_without_installation_redirects_to_install_flow(self, app_with_slug):
        transport = ASGITransport(app=app_with_slug)
        with patch(
            'boring_ui.api.modules.github_auth.service.httpx.post'
        ) as mock_post, patch(
            'boring_ui.api.modules.github_auth.service.httpx.get'
        ) as mock_get:
            token_resp = MagicMock()
            token_resp.status_code = 200
            token_resp.json.return_value = {
                'access_token': 'ghu_test123',
                'token_type': 'bearer',
            }
            token_resp.raise_for_status = MagicMock()
            mock_post.return_value = token_resp

            install_resp = MagicMock()
            install_resp.status_code = 200
            install_resp.json.return_value = {'installations': []}
            install_resp.raise_for_status = MagicMock()
            mock_get.return_value = install_resp

            async with AsyncClient(
                transport=transport, base_url='http://test', follow_redirects=False,
            ) as c:
                r = await c.get('/api/v1/auth/github/callback', params={
                    'code': 'test-code',
                    'workspace_id': 'ws-new-install',
                })
                assert r.status_code == 200
                assert 'Install the GitHub App to continue.' in r.text
                assert 'github.com/apps/boring-ui-app/installations/new' in r.text

    @pytest.mark.asyncio
    async def test_callback_installation_flow_stores_connection(self, app):
        """Installation callback with workspace_id stores the connection."""
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport, base_url='http://test',
            follow_redirects=False,
        ) as c:
            r = await c.get('/api/v1/auth/github/callback', params={
                'installation_id': '77',
                'setup_action': 'install',
                'workspace_id': 'ws-install-test',
            })
            assert r.status_code == 200
            assert 'Connected successfully!' in r.text

        # Verify connection was stored
        conn = _workspace_connections.get('ws-install-test')
        assert conn is not None
        assert conn['installation_id'] == 77

    @pytest.mark.asyncio
    async def test_callback_missing_code_and_installation(self, app):
        """Callback without code or installation_id shows error."""
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport, base_url='http://test',
            follow_redirects=False,
        ) as c:
            r = await c.get('/api/v1/auth/github/callback')
            assert r.status_code == 200
            assert 'Missing code or installation_id' in r.text


# ── Connect + Disconnect lifecycle ──────────────────────────────────────

class TestConnectDisconnect:
    @pytest.mark.asyncio
    async def test_connect_requires_fields(self, app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as c:
            r = await c.post('/api/v1/auth/github/connect', json={})
            assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_connect_validates_installation(self, app):
        """Connect validates the installation token before storing."""
        transport = ASGITransport(app=app)
        with patch(
            'boring_ui.api.modules.github_auth.service.GitHubAppService.get_installation_token',
            side_effect=Exception('Invalid installation'),
        ):
            async with AsyncClient(transport=transport, base_url='http://test') as c:
                r = await c.post('/api/v1/auth/github/connect', json={
                    'workspace_id': 'ws-bad',
                    'installation_id': 999,
                })
                assert r.status_code == 400
                assert 'Invalid installation' in r.json()['detail']

    @pytest.mark.asyncio
    async def test_connect_stores_and_status_reads(self, app):
        """Full round-trip: connect → status shows connected."""
        transport = ASGITransport(app=app)
        with patch(
            'boring_ui.api.modules.github_auth.service.GitHubAppService.get_installation_token',
            return_value='ghs_test_token',
        ):
            async with AsyncClient(transport=transport, base_url='http://test') as c:
                # Connect
                r = await c.post('/api/v1/auth/github/connect', json={
                    'workspace_id': 'ws-round-trip',
                    'installation_id': 42,
                })
                assert r.status_code == 200
                assert r.json()['connected'] is True
                assert r.json()['installation_id'] == 42

                # Status
                r = await c.get('/api/v1/auth/github/status',
                                params={'workspace_id': 'ws-round-trip'})
                assert r.status_code == 200
                data = r.json()
                assert data['connected'] is True
                assert data['installation_id'] == 42

    @pytest.mark.asyncio
    async def test_disconnect_clears_connection(self, app):
        """Disconnect removes the connection and status shows disconnected."""
        _workspace_connections['ws-disc'] = {'installation_id': 10}
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as c:
            # Disconnect
            r = await c.post('/api/v1/auth/github/disconnect',
                             json={'workspace_id': 'ws-disc'})
            assert r.status_code == 200
            assert r.json()['disconnected'] is True

            # Verify disconnected
            r = await c.get('/api/v1/auth/github/status',
                            params={'workspace_id': 'ws-disc'})
            assert r.json()['connected'] is False

    @pytest.mark.asyncio
    async def test_disconnect_requires_workspace_id(self, app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as c:
            r = await c.post('/api/v1/auth/github/disconnect', json={})
            assert r.status_code == 400


# ── Git credentials ─────────────────────────────────────────────────────

class TestGitCredentials:
    @pytest.mark.asyncio
    async def test_credentials_not_connected(self, app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as c:
            r = await c.get('/api/v1/auth/github/git-credentials',
                            params={'workspace_id': 'ws-nonexistent'})
            assert r.status_code == 404

    @pytest.mark.asyncio
    async def test_credentials_after_connect(self, app):
        """Git credentials returned for connected workspace."""
        _workspace_connections['ws-creds'] = {'installation_id': 55}
        transport = ASGITransport(app=app)
        with patch(
            'boring_ui.api.modules.github_auth.service.GitHubAppService.get_installation_token',
            return_value='ghs_cred_token_55',
        ):
            async with AsyncClient(transport=transport, base_url='http://test') as c:
                r = await c.get('/api/v1/auth/github/git-credentials',
                                params={'workspace_id': 'ws-creds'})
                assert r.status_code == 200
                data = r.json()
                assert data['username'] == 'x-access-token'
                assert data['password'] == 'ghs_cred_token_55'

    @pytest.mark.asyncio
    async def test_credentials_after_disconnect(self, app):
        """Credentials return 404 after disconnect."""
        _workspace_connections['ws-gone'] = {'installation_id': 66}
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as c:
            # Disconnect
            await c.post('/api/v1/auth/github/disconnect',
                         json={'workspace_id': 'ws-gone'})
            # Credentials should 404
            r = await c.get('/api/v1/auth/github/git-credentials',
                            params={'workspace_id': 'ws-gone'})
            assert r.status_code == 404

    @pytest.mark.asyncio
    async def test_unconfigured_returns_503(self, unconfigured_app):
        transport = ASGITransport(app=unconfigured_app)
        async with AsyncClient(
            transport=transport, base_url='http://test'
        ) as c:
            r = await c.get('/api/v1/auth/github/installations')
            assert r.status_code == 503


class TestGitProxy:
    @pytest.mark.asyncio
    async def test_git_proxy_rejects_non_github_targets(self, app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as c:
            r = await c.get('/api/v1/auth/github/git-proxy/https://example.com/repo.git/info/refs')
            assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_git_proxy_forwards_allowed_requests(self, app):
        upstream = MagicMock()
        upstream.status_code = 200
        upstream.content = b'git-proxy-ok'
        upstream.headers = {
            'content-type': 'application/x-git-upload-pack-advertisement',
            'cache-control': 'no-cache',
        }

        transport = ASGITransport(app=app)
        with patch('boring_ui.api.modules.github_auth.router.httpx.AsyncClient') as client_cls:
            client = AsyncMock()
            client.request = AsyncMock(return_value=upstream)
            client_cls.return_value.__aenter__.return_value = client

            async with AsyncClient(transport=transport, base_url='http://test') as c:
                r = await c.get(
                    '/api/v1/auth/github/git-proxy/https://github.com/myorg/myrepo.git/info/refs',
                    params={'service': 'git-upload-pack'},
                    headers={'git-protocol': 'version=2'},
                )

        assert r.status_code == 200
        assert r.content == b'git-proxy-ok'
        assert r.headers['content-type'] == 'application/x-git-upload-pack-advertisement'
        client.request.assert_awaited_once()
        args, kwargs = client.request.await_args
        assert kwargs['headers']['git-protocol'] == 'version=2'
        assert kwargs['content'] is None
        assert args[1] == 'https://github.com/myorg/myrepo.git/info/refs?service=git-upload-pack'

    @pytest.mark.asyncio
    async def test_git_proxy_workspace_injects_installation_auth(self, app):
        _workspace_connections['ws-proxy'] = {'installation_id': 77}
        upstream = MagicMock()
        upstream.status_code = 200
        upstream.content = b'ok'
        upstream.headers = {'content-type': 'application/x-git-upload-pack-result'}

        transport = ASGITransport(app=app)
        with patch('boring_ui.api.modules.github_auth.router.httpx.AsyncClient') as client_cls, patch(
            'boring_ui.api.modules.github_auth.service.GitHubAppService.get_installation_token',
            return_value='ghs_proxy_token',
        ):
            client = AsyncMock()
            client.request = AsyncMock(return_value=upstream)
            client_cls.return_value.__aenter__.return_value = client

            async with AsyncClient(transport=transport, base_url='http://test') as c:
                r = await c.post(
                    '/api/v1/auth/github/git-proxy/ws/ws-proxy/https://github.com/myorg/myrepo.git/git-upload-pack',
                    content=b'pack-data',
                )

        assert r.status_code == 200
        args, kwargs = client.request.await_args
        assert kwargs['content'] == b'pack-data'
        assert kwargs['headers']['authorization'].startswith('Basic ')
        assert args[1] == 'https://github.com/myorg/myrepo.git/git-upload-pack'


# ── Installations + Repos ───────────────────────────────────────────────

class TestInstallations:
    @pytest.mark.asyncio
    async def test_list_installations(self, app):
        transport = ASGITransport(app=app)
        with patch(
            'boring_ui.api.modules.github_auth.service.GitHubAppService.list_installations',
            return_value=[{
                'id': 100,
                'account': {'login': 'myorg', 'type': 'Organization'},
            }],
        ):
            async with AsyncClient(transport=transport, base_url='http://test') as c:
                r = await c.get('/api/v1/auth/github/installations')
                assert r.status_code == 200
                installs = r.json()['installations']
                assert len(installs) == 1
                assert installs[0]['id'] == 100
                assert installs[0]['account'] == 'myorg'

    @pytest.mark.asyncio
    async def test_list_repos(self, app):
        transport = ASGITransport(app=app)
        with patch(
            'boring_ui.api.modules.github_auth.service.GitHubAppService.list_repos',
            return_value=[{
                'full_name': 'myorg/myrepo',
                'private': True,
                'clone_url': 'https://github.com/myorg/myrepo.git',
                'ssh_url': 'git@github.com:myorg/myrepo.git',
            }],
        ):
            async with AsyncClient(transport=transport, base_url='http://test') as c:
                r = await c.get('/api/v1/auth/github/repos',
                                params={'installation_id': 100})
                assert r.status_code == 200
                repos = r.json()['repos']
                assert len(repos) == 1
                assert repos[0]['full_name'] == 'myorg/myrepo'

    @pytest.mark.asyncio
    async def test_select_repo_persists_choice(self, app):
        _workspace_connections['ws-select'] = {'installation_id': 100}
        transport = ASGITransport(app=app)
        with patch(
            'boring_ui.api.modules.github_auth.service.GitHubAppService.list_repos',
            return_value=[{
                'full_name': 'myorg/myrepo',
                'private': True,
                'clone_url': 'https://github.com/myorg/myrepo.git',
                'ssh_url': 'git@github.com:myorg/myrepo.git',
            }],
        ):
            async with AsyncClient(transport=transport, base_url='http://test') as c:
                r = await c.post('/api/v1/auth/github/repo', json={
                    'workspace_id': 'ws-select',
                    'repo_url': 'https://github.com/myorg/myrepo',
                })
                assert r.status_code == 200
                assert r.json()['selected'] is True
                assert r.json()['repo_url'] == 'https://github.com/myorg/myrepo.git'

                status = await c.get('/api/v1/auth/github/status', params={'workspace_id': 'ws-select'})
                assert status.status_code == 200
                data = status.json()
                assert data['repo_selected'] is True
                assert data['repo_url'] == 'https://github.com/myorg/myrepo.git'

    @pytest.mark.asyncio
    async def test_select_repo_rejects_repo_outside_installation(self, app):
        _workspace_connections['ws-select-bad'] = {'installation_id': 100}
        transport = ASGITransport(app=app)
        with patch(
            'boring_ui.api.modules.github_auth.service.GitHubAppService.list_repos',
            return_value=[{
                'full_name': 'myorg/myrepo',
                'private': True,
                'clone_url': 'https://github.com/myorg/myrepo.git',
                'ssh_url': 'git@github.com:myorg/myrepo.git',
            }],
        ):
            async with AsyncClient(transport=transport, base_url='http://test') as c:
                r = await c.post('/api/v1/auth/github/repo', json={
                    'workspace_id': 'ws-select-bad',
                    'repo_url': 'https://github.com/other/repo',
                })
                assert r.status_code == 400


# ── Connection resolution (cache + DB fallback) ────────────────────────

class TestResolveConnection:
    @pytest.mark.asyncio
    async def test_resolve_from_cache(self, config):
        """_resolve_connection returns cached connection without DB hit."""
        _workspace_connections['ws-cached'] = {'installation_id': 88}
        conn = await _resolve_connection(config, 'ws-cached')
        assert conn is not None
        assert conn['installation_id'] == 88

    @pytest.mark.asyncio
    async def test_resolve_cache_miss_no_db(self, config):
        """_resolve_connection returns None when no cache and no DB."""
        conn = await _resolve_connection(config, 'ws-no-exist')
        assert conn is None

    @pytest.mark.asyncio
    async def test_store_populates_cache(self, config):
        """_store_connection puts entry in cache."""
        await _store_connection(config, 'ws-store', 77)
        assert _workspace_connections['ws-store']['installation_id'] == 77

    @pytest.mark.asyncio
    async def test_remove_clears_cache(self, config):
        """_remove_connection removes entry from cache."""
        _workspace_connections['ws-rm'] = {'installation_id': 33}
        await _remove_connection(config, 'ws-rm')
        assert 'ws-rm' not in _workspace_connections


# ── Full lifecycle: connect → credentials → disconnect → 404 ───────────

class TestFullLifecycle:
    @pytest.mark.asyncio
    async def test_connect_creds_disconnect_lifecycle(self, app):
        """E2E: connect → get creds → disconnect → creds 404."""
        transport = ASGITransport(app=app)

        with patch(
            'boring_ui.api.modules.github_auth.service.GitHubAppService.get_installation_token',
            return_value='ghs_lifecycle_token',
        ):
            async with AsyncClient(transport=transport, base_url='http://test') as c:
                # 1. Connect
                r = await c.post('/api/v1/auth/github/connect', json={
                    'workspace_id': 'ws-lifecycle',
                    'installation_id': 123,
                })
                assert r.status_code == 200
                assert r.json()['connected'] is True

                # 2. Status shows connected
                r = await c.get('/api/v1/auth/github/status',
                                params={'workspace_id': 'ws-lifecycle'})
                assert r.json()['connected'] is True
                assert r.json()['installation_id'] == 123

                # 3. Get credentials
                r = await c.get('/api/v1/auth/github/git-credentials',
                                params={'workspace_id': 'ws-lifecycle'})
                assert r.status_code == 200
                assert r.json()['username'] == 'x-access-token'
                assert r.json()['password'] == 'ghs_lifecycle_token'

                # 4. Disconnect
                r = await c.post('/api/v1/auth/github/disconnect',
                                 json={'workspace_id': 'ws-lifecycle'})
                assert r.json()['disconnected'] is True

                # 5. Status shows disconnected
                r = await c.get('/api/v1/auth/github/status',
                                params={'workspace_id': 'ws-lifecycle'})
                assert r.json()['connected'] is False

                # 6. Credentials return 404
                r = await c.get('/api/v1/auth/github/git-credentials',
                                params={'workspace_id': 'ws-lifecycle'})
                assert r.status_code == 404


# ── Credential resolution in git router ─────────────────────────────────

class TestCredentialResolution:
    """Test that git router resolves credentials via github_auth connection."""

    @pytest.mark.asyncio
    async def test_resolve_credentials_uses_github_connection(self, config):
        """_resolve_credentials_async resolves creds from github_auth cache."""
        from boring_ui.api.modules.git.router import _resolve_credentials_async
        from starlette.requests import Request

        # Store connection in cache
        _workspace_connections['ws-resolve'] = {'installation_id': 42}

        # Build a fake request with x-workspace-id header
        scope = {
            'type': 'http',
            'method': 'POST',
            'path': '/api/v1/git/push',
            'headers': [(b'x-workspace-id', b'ws-resolve')],
        }
        request = Request(scope)

        with patch(
            'boring_ui.api.modules.github_auth.service.GitHubAppService.get_installation_token',
            return_value='ghs_resolved_token',
        ) as mock_token:
            creds = await _resolve_credentials_async(config, request)
            assert creds is not None
            assert creds['username'] == 'x-access-token'
            assert creds['password'] == 'ghs_resolved_token'
            mock_token.assert_called_once_with(42)

    @pytest.mark.asyncio
    async def test_resolve_credentials_no_workspace_header(self, config):
        """Without x-workspace-id, falls through to PAT or None."""
        from boring_ui.api.modules.git.router import _resolve_credentials_async
        from starlette.requests import Request

        scope = {
            'type': 'http',
            'method': 'POST',
            'path': '/api/v1/git/push',
            'headers': [],
        }
        request = Request(scope)

        with patch.dict('os.environ', {}, clear=False):
            # Remove GIT_AUTH_TOKEN if present
            import os
            os.environ.pop('GIT_AUTH_TOKEN', None)
            creds = await _resolve_credentials_async(config, request)
            assert creds is None

    @pytest.mark.asyncio
    async def test_resolve_credentials_pat_fallback(self, config):
        """Falls through to GIT_AUTH_TOKEN when no GitHub connection."""
        from boring_ui.api.modules.git.router import _resolve_credentials_async
        from starlette.requests import Request

        scope = {
            'type': 'http',
            'method': 'POST',
            'path': '/api/v1/git/push',
            'headers': [(b'x-workspace-id', b'ws-no-connection')],
        }
        request = Request(scope)

        with patch.dict('os.environ', {'GIT_AUTH_TOKEN': 'ghp_pat_token'}):
            creds = await _resolve_credentials_async(config, request)
            assert creds is not None
            assert creds['username'] == 'x-access-token'
            assert creds['password'] == 'ghp_pat_token'

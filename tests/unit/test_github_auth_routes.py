"""Unit tests for GitHub App auth routes."""
import pytest
from unittest.mock import patch, MagicMock
from httpx import AsyncClient, ASGITransport
from boring_ui.api.config import APIConfig
from boring_ui.api.modules.github_auth import create_github_auth_router
from fastapi import FastAPI


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
def unconfigured_config(tmp_path):
    return APIConfig(workspace_root=tmp_path)


@pytest.fixture
def app(config):
    app = FastAPI()
    app.include_router(
        create_github_auth_router(config), prefix='/api/v1/auth/github',
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


class TestCallback:
    @pytest.mark.asyncio
    async def test_callback_exchanges_code(self, app):
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

            # Mock user info + installations
            user_resp = MagicMock()
            user_resp.status_code = 200
            user_resp.json.return_value = {
                'login': 'testuser',
                'email': 'test@example.com',
                'avatar_url': 'https://github.com/avatar.png',
            }
            user_resp.raise_for_status = MagicMock()

            install_resp = MagicMock()
            install_resp.status_code = 200
            install_resp.json.return_value = {
                'installations': [{
                    'id': 99,
                    'account': {'login': 'testorg', 'type': 'Organization'},
                }],
            }
            install_resp.raise_for_status = MagicMock()

            mock_get.side_effect = [user_resp, install_resp]

            async with AsyncClient(
                transport=transport, base_url='http://test'
            ) as c:
                r = await c.get('/api/v1/auth/github/callback',
                                params={'code': 'test-code'})
                assert r.status_code == 200
                data = r.json()
                assert data['user']['login'] == 'testuser'
                assert data['access_token'] == 'ghu_test123'
                assert len(data['installations']) == 1
                assert data['installations'][0]['id'] == 99


class TestConnectDisconnect:
    @pytest.mark.asyncio
    async def test_connect_requires_fields(self, app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as c:
            r = await c.post('/api/v1/auth/github/connect', json={})
            assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_disconnect_clears_connection(self, app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as c:
            r = await c.post('/api/v1/auth/github/disconnect',
                             json={'workspace_id': 'ws-1'})
            assert r.status_code == 200
            assert r.json()['disconnected'] is True


class TestGitCredentials:
    @pytest.mark.asyncio
    async def test_credentials_not_connected(self, app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as c:
            r = await c.get('/api/v1/auth/github/git-credentials',
                            params={'workspace_id': 'ws-nonexistent'})
            assert r.status_code == 404

    @pytest.mark.asyncio
    async def test_unconfigured_returns_503(self, unconfigured_app):
        transport = ASGITransport(app=unconfigured_app)
        async with AsyncClient(
            transport=transport, base_url='http://test'
        ) as c:
            r = await c.get('/api/v1/auth/github/installations')
            assert r.status_code == 503

"""Integration tests for boring_ui.api.app.create_app factory.

These tests validate that all modules work together correctly when
assembled through the application factory.
"""
import pytest
from pathlib import Path
from httpx import AsyncClient, ASGITransport

from boring_ui.api.app import create_app
from boring_ui.api.config import APIConfig
from boring_ui.api.modules.ui_state import get_ui_state_service


@pytest.fixture
def workspace(tmp_path):
    """Create a test workspace with sample files."""
    # Create test files
    (tmp_path / 'README.md').write_text('# Test Project')
    (tmp_path / 'src').mkdir()
    (tmp_path / 'src' / 'main.py').write_text('print("hello")')
    return tmp_path


@pytest.fixture(autouse=True)
def clear_ui_state_service():
    """Reset module-level UI state store between integration tests."""
    service = get_ui_state_service()
    service.clear()
    yield
    service.clear()


@pytest.fixture
def app(workspace):
    """Create a full application with all routers enabled."""
    config = APIConfig(workspace_root=workspace)
    return create_app(config)


@pytest.fixture
def minimal_app(workspace):
    """Create a minimal application with only core routers."""
    config = APIConfig(workspace_root=workspace)
    return create_app(config, include_pty=False, include_stream=False, include_approval=False)


class TestAppFactory:
    """Tests for create_app factory function."""

    def test_creates_fastapi_app(self, app):
        """Test that create_app returns a FastAPI application."""
        from fastapi import FastAPI
        assert isinstance(app, FastAPI)
        assert app.title == 'Boring UI API'

    def test_app_has_health_endpoint(self, app):
        """Test that health endpoint is available."""
        paths = [r.path for r in app.routes if hasattr(r, 'path')]
        assert '/health' in paths

    def test_app_has_api_config_endpoint(self, app):
        """Test that config endpoint is available."""
        paths = [r.path for r in app.routes if hasattr(r, 'path')]
        assert '/api/config' in paths

    def test_app_has_api_project_endpoint(self, app):
        """Test that project endpoint is available."""
        paths = [r.path for r in app.routes if hasattr(r, 'path')]
        assert '/api/project' in paths

    def test_app_has_workspace_core_ui_state_endpoints(self, app):
        """Test that canonical workspace-core UI-state endpoints are available."""
        paths = [r.path for r in app.routes if hasattr(r, 'path')]
        assert '/api/v1/ui/state' in paths
        assert '/api/v1/ui/state/latest' in paths
        assert '/api/v1/ui/state/{client_id}' in paths
        assert '/api/v1/ui/panes' in paths
        assert '/api/v1/ui/panes/{client_id}' in paths
        assert '/api/v1/ui/commands' in paths
        assert '/api/v1/ui/commands/next' in paths
        assert '/api/v1/ui/focus' in paths

    def test_app_has_api_sessions_endpoints(self, app):
        """Test that session list/create endpoints are available."""
        paths = [r.path for r in app.routes if hasattr(r, 'path')]
        assert '/api/v1/agent/normal/sessions' in paths

    def test_app_has_api_attachment_upload_endpoint(self, app):
        """Test that canonical attachment upload endpoint is available."""
        paths = [r.path for r in app.routes if hasattr(r, 'path')]
        assert '/api/v1/agent/normal/attachments' in paths

    def test_app_has_capabilities_endpoint(self, app):
        """Test that capabilities endpoint is available."""
        paths = [r.path for r in app.routes if hasattr(r, 'path')]
        assert '/api/capabilities' in paths


class TestHealthEndpoint:
    """Integration tests for /health endpoint."""

    @pytest.mark.asyncio
    async def test_health_returns_ok(self, app, workspace):
        """Test health endpoint returns status ok."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/health')
            assert response.status_code == 200
            data = response.json()
            assert data['status'] == 'ok'
            assert data['workspace'] == str(workspace)

    @pytest.mark.asyncio
    async def test_health_includes_all_features(self, app):
        """Test health endpoint includes all enabled features."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/health')
            data = response.json()
            features = data['features']
            assert features['files'] is True
            assert features['git'] is True
            assert features['ui_state'] is True
            assert features['pty'] is True
            assert features['chat_claude_code'] is True
            assert features['stream'] is True  # Backward compat alias
            assert features['approval'] is True

    @pytest.mark.asyncio
    async def test_minimal_app_features(self, minimal_app):
        """Test minimal app only has core features enabled."""
        transport = ASGITransport(app=minimal_app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/health')
            data = response.json()
            features = data['features']
            assert features['files'] is True
            assert features['git'] is True
            assert features['ui_state'] is True
            assert features['pty'] is False
            assert features['chat_claude_code'] is False
            assert features['stream'] is False
            assert features['approval'] is False


class TestCapabilitiesEndpoint:
    """Integration tests for /api/capabilities endpoint."""

    @pytest.mark.asyncio
    async def test_capabilities_returns_json(self, app):
        """Test capabilities endpoint returns valid JSON."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/api/capabilities')
            assert response.status_code == 200
            assert response.headers['content-type'] == 'application/json'

    @pytest.mark.asyncio
    async def test_capabilities_has_version(self, app):
        """Test capabilities includes version field."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/api/capabilities')
            data = response.json()
            assert 'version' in data
            assert data['version'] == '0.1.0'

    @pytest.mark.asyncio
    async def test_capabilities_has_features(self, app):
        """Test capabilities includes features map."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/api/capabilities')
            data = response.json()
            assert 'features' in data
            assert isinstance(data['features'], dict)

    @pytest.mark.asyncio
    async def test_capabilities_has_routers(self, app):
        """Test capabilities includes router list."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/api/capabilities')
            data = response.json()
            assert 'routers' in data
            assert isinstance(data['routers'], list)
            router_names = [r['name'] for r in data['routers']]
            assert 'files' in router_names
            assert 'git' in router_names
            assert 'ui_state' in router_names


class TestFileRoutes:
    """Integration tests for file endpoints through full app."""

    @pytest.mark.asyncio
    async def test_tree_endpoint(self, app, workspace):
        """Test /api/v1/files/list returns directory listing."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/api/v1/files/list?path=.')
            assert response.status_code == 200
            data = response.json()
            names = [e['name'] for e in data['entries']]
            assert 'README.md' in names
            assert 'src' in names

    @pytest.mark.asyncio
    async def test_file_read_endpoint(self, app, workspace):
        """Test /api/v1/files/read returns file contents."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/api/v1/files/read?path=README.md')
            assert response.status_code == 200
            data = response.json()
            assert data['content'] == '# Test Project'

    @pytest.mark.asyncio
    async def test_file_write_endpoint(self, app, workspace):
        """Test PUT /api/v1/files/write writes file contents."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.put(
                '/api/v1/files/write?path=new.txt',
                json={'content': 'new content'}
            )
            assert response.status_code == 200
            assert (workspace / 'new.txt').read_text() == 'new content'

    @pytest.mark.asyncio
    async def test_legacy_file_routes_not_found(self, app):
        """Legacy /api file route family should be unavailable."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            checks = [
                ('GET /api/tree?path=.', await client.get('/api/tree?path=.')),
                ('GET /api/file?path=README.md', await client.get('/api/file?path=README.md')),
                ('PUT /api/file?path=README.md', await client.put('/api/file?path=README.md', json={'content': 'x'})),
                ('DELETE /api/file?path=README.md', await client.delete('/api/file?path=README.md')),
                ('POST /api/file/rename', await client.post('/api/file/rename', json={'old_path': 'a', 'new_path': 'b'})),
                ('POST /api/file/move', await client.post('/api/file/move', json={'src_path': 'a', 'dest_dir': '.'})),
                ('GET /api/search?q=README', await client.get('/api/search?q=README')),
            ]
            for url, response in checks:
                assert response.status_code == 404, f'{url} returned {response.status_code}'


class TestGitRoutes:
    """Integration tests for canonical git endpoints."""

    @pytest.mark.asyncio
    async def test_git_status_endpoint(self, app):
        """Canonical /api/v1/git/status endpoint should be available."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/api/v1/git/status')
            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_legacy_git_routes_not_found(self, app):
        """Legacy /api/git route family should be unavailable."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            checks = [
                ('GET /api/git/status', await client.get('/api/git/status')),
                ('GET /api/git/diff?path=README.md', await client.get('/api/git/diff?path=README.md')),
                ('GET /api/git/show?path=README.md', await client.get('/api/git/show?path=README.md')),
            ]
            for url, response in checks:
                assert response.status_code == 404, f'{url} returned {response.status_code}'


class TestAgentNormalAttachmentRoutes:
    """Integration tests for canonical agent-normal attachment upload endpoint."""

    @pytest.mark.asyncio
    async def test_attachment_upload_endpoint(self, app, workspace):
        """POST /api/v1/agent/normal/attachments stores attachment metadata and file."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.post(
                '/api/v1/agent/normal/attachments',
                files={'file': ('notes.txt', b'hello attachment', 'text/plain')},
            )
            assert response.status_code == 200
            data = response.json()
            assert data['name'] == 'notes.txt'
            assert data['size'] == len(b'hello attachment')
            assert data['file_id']
            assert data['relative_path'].startswith('.attachments/')

            saved_path = workspace / data['relative_path']
            assert saved_path.exists()
            assert saved_path.read_bytes() == b'hello attachment'


class TestUiStateRoutes:
    """Integration tests for canonical workspace-core UI-state endpoints."""

    @pytest.mark.asyncio
    async def test_ui_state_roundtrip(self, app):
        """PUT /state then GET /state/latest should return the published payload."""
        transport = ASGITransport(app=app)
        payload = {
            'client_id': 'web-client-1',
            'project_root': '/tmp/demo',
            'active_panel_id': 'pane-1',
            'open_panels': [
                {'id': 'pane-1', 'component': 'list', 'params': {'q': 'abc'}},
                {'id': 'pane-2', 'component': 'chart', 'params': {'symbol': 'AAPL'}},
            ],
            'meta': {'pane_count': 2},
        }
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            put_response = await client.put('/api/v1/ui/state', json=payload)
            assert put_response.status_code == 200
            put_state = put_response.json()['state']
            assert put_state['client_id'] == 'web-client-1'
            assert put_state['meta']['pane_count'] == 2

            latest_response = await client.get('/api/v1/ui/state/latest')
            assert latest_response.status_code == 200
            latest_state = latest_response.json()['state']
            assert latest_state['client_id'] == 'web-client-1'
            assert latest_state['active_panel_id'] == 'pane-1'
            assert len(latest_state['open_panels']) == 2

    @pytest.mark.asyncio
    async def test_ui_state_latest_is_404_without_publication(self, app):
        """GET /state/latest should return 404 when no frontend state exists."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/api/v1/ui/state/latest')
            assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_ui_state_panes_and_command_queue(self, app):
        """Panes view and generic command queue should operate for a published client."""
        transport = ASGITransport(app=app)
        payload = {
            'client_id': 'web-client-2',
            'active_panel_id': 'pane-2',
            'open_panels': [
                {'id': 'pane-1', 'component': 'table'},
                {'id': 'pane-2', 'component': 'chart-canvas'},
            ],
        }
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            assert (await client.put('/api/v1/ui/state', json=payload)).status_code == 200

            panes = await client.get('/api/v1/ui/panes')
            assert panes.status_code == 200
            panes_payload = panes.json()
            assert panes_payload['client_id'] == 'web-client-2'
            assert panes_payload['count'] == 2
            assert panes_payload['active_panel_id'] == 'pane-2'

            focus_command = await client.post(
                '/api/v1/ui/commands',
                json={
                    'client_id': 'web-client-2',
                    'command': {'kind': 'focus_panel', 'panel_id': 'pane-1'},
                },
            )
            assert focus_command.status_code == 200

            next_command = await client.get('/api/v1/ui/commands/next?client_id=web-client-2')
            assert next_command.status_code == 200
            command = next_command.json()['command']
            assert command['client_id'] == 'web-client-2'
            assert command['command']['kind'] == 'focus_panel'
            assert command['command']['panel_id'] == 'pane-1'


class TestConfigEndpoint:
    """Integration tests for /api/config endpoint."""

    @pytest.mark.asyncio
    async def test_config_returns_workspace(self, app, workspace):
        """Test config endpoint returns workspace root."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/api/config')
            assert response.status_code == 200
            data = response.json()
            assert data['workspace_root'] == str(workspace)

    @pytest.mark.asyncio
    async def test_config_lists_pty_providers(self, app):
        """Test config endpoint lists PTY providers."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/api/config')
            data = response.json()
            assert 'pty_providers' in data
            assert 'shell' in data['pty_providers']


class TestProjectEndpoint:
    """Integration tests for /api/project endpoint."""

    @pytest.mark.asyncio
    async def test_project_returns_workspace_root(self, app, workspace):
        """Project endpoint should expose workspace root for frontend bootstrap."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/api/project')
            assert response.status_code == 200
            data = response.json()
            assert data == {'root': str(workspace)}


class TestSessionsEndpoint:
    """Integration tests for agent-normal session endpoints."""

    @pytest.mark.asyncio
    async def test_list_sessions_returns_collection(self, app):
        """Session listing should always return a sessions array."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/api/v1/agent/normal/sessions')
            assert response.status_code == 200
            data = response.json()
            assert 'sessions' in data
            assert isinstance(data['sessions'], list)

    @pytest.mark.asyncio
    async def test_create_session_returns_session_id(self, app):
        """Session create should return a generated session_id."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.post('/api/v1/agent/normal/sessions')
            assert response.status_code == 200
            data = response.json()
            assert 'session_id' in data
            assert isinstance(data['session_id'], str)
            assert data['session_id']


class TestRouterSelection:
    """Tests for selective router inclusion."""

    @pytest.mark.asyncio
    async def test_explicit_routers_list(self, workspace):
        """Test explicit routers list overrides include_* flags."""
        config = APIConfig(workspace_root=workspace)
        app = create_app(config, routers=['files'])

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/health')
            data = response.json()
            assert data['features']['files'] is True
            assert data['features']['git'] is False

    @pytest.mark.asyncio
    async def test_stream_alias_works(self, workspace):
        """Test 'stream' alias enables chat_claude_code feature."""
        config = APIConfig(workspace_root=workspace)
        app = create_app(config, routers=['files', 'stream'])

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/health')
            data = response.json()
            assert data['features']['stream'] is True
            assert data['features']['chat_claude_code'] is True

    @pytest.mark.asyncio
    async def test_chat_claude_code_name_works(self, workspace):
        """Test 'chat_claude_code' name enables both features."""
        config = APIConfig(workspace_root=workspace)
        app = create_app(config, routers=['files', 'chat_claude_code'])

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.get('/health')
            data = response.json()
            assert data['features']['stream'] is True
            assert data['features']['chat_claude_code'] is True

    @pytest.mark.asyncio
    async def test_custom_registry_prefixes_for_files_and_git(self, workspace):
        """Custom registry prefixes should be honored for files/git routers."""
        from boring_ui.api.capabilities import RouterRegistry
        from boring_ui.api.modules.files import create_file_router
        from boring_ui.api.modules.git import create_git_router

        config = APIConfig(workspace_root=workspace)
        registry = RouterRegistry()
        registry.register('files', '/custom/files', create_file_router, tags=['files'])
        registry.register('git', '/custom/git', create_git_router, tags=['git'])

        app = create_app(config, registry=registry, routers=['files', 'git'])

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            files_response = await client.get('/custom/files/list?path=.')
            git_response = await client.get('/custom/git/status')
            default_response = await client.get('/api/v1/files/list?path=.')

            assert files_response.status_code == 200
            assert git_response.status_code == 200
            assert default_response.status_code == 404
            assert 'entries' in files_response.json()
            git_data = git_response.json()
            assert 'is_repo' in git_data
            assert 'files' in git_data


class TestWebSocketRoutes:
    """Integration tests for WebSocket route availability."""

    def test_pty_websocket_registered(self, app):
        """Test PTY WebSocket route is registered."""
        paths = [r.path for r in app.routes if hasattr(r, 'path')]
        assert '/ws/pty' in paths

    def test_stream_websocket_registered(self, app):
        """Test Claude stream WebSocket route is registered."""
        paths = [r.path for r in app.routes if hasattr(r, 'path')]
        assert '/ws/agent/normal/stream' in paths

    def test_minimal_app_no_websockets(self, minimal_app):
        """Test minimal app doesn't have WebSocket routes."""
        paths = [r.path for r in minimal_app.routes if hasattr(r, 'path')]
        assert '/ws/pty' not in paths
        assert '/ws/agent/normal/stream' not in paths

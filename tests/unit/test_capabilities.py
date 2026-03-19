"""Tests for the capabilities endpoint and router registry."""
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI
from boring_ui.api import create_app, RouterRegistry, create_default_registry
from boring_ui.api.capabilities import create_capabilities_router
from boring_ui.api.config import APIConfig


class TestRouterRegistry:
    """Test the RouterRegistry class."""

    def test_default_registry_has_expected_routers(self):
        """Default registry should have all standard routers."""
        registry = create_default_registry()
        router_names = registry.list_names()

        assert 'files' in router_names
        assert 'git' in router_names
        assert 'ui_state' in router_names
        assert 'control_plane' in router_names
        assert 'pty' in router_names
        assert 'stream' in router_names
        assert 'approval' in router_names

    def test_registry_get_router(self):
        """Should be able to get a registered router."""
        registry = create_default_registry()
        entry = registry.get('files')

        assert entry is not None
        info, factory = entry
        assert info.name == 'files'
        assert info.prefix == '/api/v1/files'
        assert callable(factory)

    def test_registry_get_nonexistent(self):
        """Getting a non-existent router returns None."""
        registry = create_default_registry()
        entry = registry.get('nonexistent')

        assert entry is None

    def test_registry_get_info(self):
        """Should be able to get router info without factory."""
        registry = create_default_registry()
        info = registry.get_info('git')

        assert info is not None
        assert info.name == 'git'
        assert info.prefix == '/api/v1/git'
        assert 'git' in info.tags


class TestCapabilitiesEndpoint:
    """Test the /api/capabilities endpoint."""

    @pytest.fixture
    def client(self):
        """Create a test client with all features enabled."""
        app = create_app()
        return TestClient(app)

    @pytest.fixture
    def minimal_client(self):
        """Create a test client with minimal features."""
        app = create_app(routers=['files', 'git'])
        return TestClient(app)

    def test_capabilities_returns_json(self, client):
        """Capabilities endpoint should return JSON."""
        response = client.get('/api/capabilities')
        assert response.status_code == 200
        assert response.headers['content-type'] == 'application/json'

    def test_capabilities_has_version(self, client):
        """Response should include version."""
        response = client.get('/api/capabilities')
        data = response.json()

        assert 'version' in data
        assert isinstance(data['version'], str)

    def test_capabilities_has_features(self, client):
        """Response should include features map."""
        response = client.get('/api/capabilities')
        data = response.json()

        assert 'features' in data
        features = data['features']
        assert isinstance(features, dict)

        # Check expected feature flags
        assert 'files' in features
        assert 'git' in features
        assert 'ui_state' in features
        assert 'control_plane' in features
        assert 'pty' in features
        assert 'stream' in features
        assert 'approval' in features
        assert 'pi' in features

    def test_default_pi_feature_is_enabled(self):
        """PI should be available by default when the runtime exposes a pi agent."""
        app = create_app(config=APIConfig(workspace_root=Path.cwd()))
        client = TestClient(app)

        response = client.get('/api/capabilities')
        data = response.json()

        assert data['features']['pi'] is True

    def test_capabilities_has_routers(self, client):
        """Response should include router details."""
        response = client.get('/api/capabilities')
        data = response.json()

        assert 'routers' in data
        routers = data['routers']
        assert isinstance(routers, list)
        assert len(routers) > 0

        # Check router structure
        files_router = next((r for r in routers if r['name'] == 'files'), None)
        ui_state_router = next((r for r in routers if r['name'] == 'ui_state'), None)
        assert files_router is not None
        assert ui_state_router is not None
        assert 'prefix' in files_router
        assert 'description' in files_router
        assert 'tags' in files_router
        assert 'enabled' in files_router

    def test_capabilities_features_match_routers(self, client):
        """Features should match enabled routers."""
        response = client.get('/api/capabilities')
        data = response.json()

        features = data['features']
        routers = data['routers']

        # All features with true should have corresponding enabled router
        for name, enabled in features.items():
            router = next((r for r in routers if r['name'] == name), None)
            if router:
                assert router['enabled'] == enabled

    def test_capabilities_minimal_features(self, minimal_client):
        """Minimal app should have only selected features enabled."""
        response = minimal_client.get('/api/capabilities')
        data = response.json()

        features = data['features']
        assert features['files'] is True
        assert features['git'] is True
        assert features['ui_state'] is False
        assert features['control_plane'] is False
        assert features['pty'] is False
        assert features['stream'] is False
        assert features['approval'] is False

    def test_capabilities_with_selective_routers(self):
        """Creating app with specific routers should enable only those."""
        app = create_app(routers=['files', 'approval'])
        client = TestClient(app)

        response = client.get('/api/capabilities')
        data = response.json()

        features = data['features']
        assert features['files'] is True
        assert features['git'] is False
        assert features['ui_state'] is False
        assert features['control_plane'] is False
        assert features['pty'] is False
        assert features['stream'] is False
        assert features['approval'] is True

    def test_capabilities_omits_services_without_pi_harness(self):
        """Services block should be absent when no backend PI harness is mounted."""
        config = APIConfig(workspace_root=Path.cwd())
        registry = create_default_registry()
        enabled_features = {'pi': True}

        app = FastAPI()
        app.include_router(
            create_capabilities_router(enabled_features, registry, config),
            prefix='/api',
        )
        client = TestClient(app)

        response = client.get('/api/capabilities')
        data = response.json()

        assert 'services' not in data

    def test_runtime_config_endpoint_returns_state_payload(self):
        """The runtime config endpoint should serve the app-provided payload."""
        app = create_app()
        app.state.bui_runtime_config = {
            'app': {'id': 'child-app', 'name': 'Child App', 'logo': 'C'},
            'frontend': {
                'branding': {'name': 'Child App', 'logo': 'C'},
                'data': {'backend': 'http'},
                'panels': {'chart': {'component': 'chart-panel'}},
                'mode': {'profile': 'backend'},
            },
            'agents': {'mode': 'backend', 'available': ['pi']},
            'auth': None,
        }
        client = TestClient(app)

        response = client.get('/__bui/config')
        data = response.json()

        assert response.status_code == 200
        assert data['app']['id'] == 'child-app'
        assert data['frontend']['panels']['chart']['component'] == 'chart-panel'
        assert data['agents']['available'] == ['pi']

    def test_runtime_config_endpoint_falls_back_to_default_payload(self):
        """The runtime config endpoint should still work without TOML-backed state."""
        config = APIConfig(workspace_root=Path.cwd())
        app = create_app(config=config)
        client = TestClient(app)

        response = client.get('/__bui/config')
        data = response.json()

        assert response.status_code == 200
        assert data['app']['id'] == 'boring-ui'
        assert data['frontend']['branding']['name'] == 'Boring UI'
        assert 'panels' in data['frontend']
        assert data['agents']['mode'] == 'frontend'
        assert 'pi' in data['agents']['available']
        assert data['frontend']['mode']['profile'] == 'frontend'


class TestHealthEndpointFeatures:
    """Test that /health endpoint also reports features correctly."""

    def test_health_includes_features(self):
        """Health endpoint should include features map."""
        app = create_app()
        client = TestClient(app)

        response = client.get('/health')
        data = response.json()

        assert 'features' in data
        features = data['features']
        assert features['files'] is True
        assert features['git'] is True
        assert features['ui_state'] is True
        assert features['control_plane'] is True
        assert features['pty'] is True
        assert features['stream'] is True
        assert features['approval'] is True

    def test_health_features_match_selective_routers(self):
        """Health features should match when using selective routers."""
        app = create_app(routers=['files', 'git'])
        client = TestClient(app)

        response = client.get('/health')
        data = response.json()

        features = data['features']
        assert features['files'] is True
        assert features['git'] is True
        assert features['ui_state'] is False
        assert features['control_plane'] is False
        assert features['pty'] is False
        assert features['stream'] is False
        assert features['approval'] is False



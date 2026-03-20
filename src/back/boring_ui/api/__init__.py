"""FastAPI routers and utilities for boring-ui backend.

This module provides composable FastAPI routers for building web IDE backends.

Example:
    # Simple usage with create_app()
    from boring_ui.api import create_app
    app = create_app()

    # Custom configuration
    from boring_ui.api import create_app, APIConfig
    from pathlib import Path
    config = APIConfig(workspace_root=Path('/my/project'))
    app = create_app(config)

    # Compose routers manually
    from fastapi import FastAPI
    from boring_ui.api import (
        APIConfig, LocalStorage,
        create_file_router, create_git_router
    )
    config = APIConfig(workspace_root=Path.cwd())
    storage = LocalStorage(config.workspace_root)
    app = FastAPI()
    app.include_router(create_file_router(config, storage), prefix='/api')
    app.include_router(create_git_router(config), prefix='/api/git')

    # Using router registry for dynamic composition
    from boring_ui.api import create_default_registry, RouterRegistry
    registry = create_default_registry()
    app = create_app(routers=['files', 'git', 'pty'])  # Selective routers
"""

# Configuration
from .config import APIConfig

# Storage
from .storage import Storage, LocalStorage, S3Storage

# Router factories
from .modules.files import create_file_router
from .modules.git import create_git_router
from .modules.ui_state import create_ui_state_router
from .modules.control_plane import create_control_plane_router
from .modules.control_plane import create_auth_session_router
from .modules.control_plane import create_me_router
from .modules.control_plane import create_workspace_router
from .modules.control_plane import create_collaboration_router
from .modules.control_plane import create_workspace_boundary_router
from .modules.pty import create_pty_router
from .modules.stream import create_stream_router
from .approval import (
    ApprovalStore,
    InMemoryApprovalStore,
    create_approval_router,
)

# Capabilities and registry
from .capabilities import (
    RouterRegistry,
    RouterInfo,
    create_default_registry,
    create_capabilities_router,
    create_runtime_config_router,
)

# App factory
from .app import create_app

__all__ = [
    # Configuration
    'APIConfig',
    # Storage
    'Storage',
    'LocalStorage',
    'S3Storage',
    # Router factories
    'create_file_router',
    'create_git_router',
    'create_ui_state_router',
    'create_control_plane_router',
    'create_auth_session_router',
    'create_me_router',
    'create_workspace_router',
    'create_collaboration_router',
    'create_workspace_boundary_router',
    'create_pty_router',
    'create_stream_router',
    'create_approval_router',
    # Approval
    'ApprovalStore',
    'InMemoryApprovalStore',
    # Capabilities and registry
    'RouterRegistry',
    'RouterInfo',
    'create_default_registry',
    'create_capabilities_router',
    'create_runtime_config_router',
    # App factory
    'create_app',
]

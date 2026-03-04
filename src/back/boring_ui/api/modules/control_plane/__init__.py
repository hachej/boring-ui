"""Control-plane foundation module for boring-ui core ownership."""

from .router import create_control_plane_router
from .auth_router import create_auth_session_router
from .me_router import create_me_router
from .workspace_router import create_workspace_router
from .collaboration_router import create_collaboration_router
from .workspace_boundary_router import create_workspace_boundary_router
from .service import ControlPlaneService
from .repository import ControlPlaneRepository, LocalControlPlaneRepository
from .models import ControlPlaneState
from .auth_session import (
    SessionPayload,
    SessionError,
    SessionExpired,
    SessionInvalid,
    create_session_cookie,
    parse_session_cookie,
)

__all__ = [
    "create_control_plane_router",
    "create_auth_session_router",
    "create_me_router",
    "create_workspace_router",
    "create_collaboration_router",
    "create_workspace_boundary_router",
    "ControlPlaneService",
    "ControlPlaneRepository",
    "LocalControlPlaneRepository",
    "ControlPlaneState",
    "SessionPayload",
    "SessionError",
    "SessionExpired",
    "SessionInvalid",
    "create_session_cookie",
    "parse_session_cookie",
]

"""UI state module for boring-ui API.

Provides a workspace-core surface for publishing frontend pane snapshots.
"""

from .router import create_ui_state_router, get_ui_state_service
from .service import UIStateService

__all__ = [
    "create_ui_state_router",
    "get_ui_state_service",
    "UIStateService",
]


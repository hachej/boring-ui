"""Backend API modules for boring-ui.

Each module provides:
- router.py: FastAPI router with endpoints
- service.py: Business logic
- schemas.py: Pydantic models (if applicable)

Core modules include:
- workspace-core foundations (`files`, `git`, `ui_state`, `control_plane`)
- runtime services (`pty`, `stream`, `agent_normal`)
"""

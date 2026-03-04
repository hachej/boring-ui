"""Workspace membership access control helpers."""

from __future__ import annotations

from enum import Enum
from typing import TYPE_CHECKING

from fastapi import HTTPException

if TYPE_CHECKING:
    import asyncpg


class MemberRole(str, Enum):
    owner = "owner"
    editor = "editor"
    viewer = "viewer"


class WorkspaceNotFound(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=404,
            detail={
                "error": "not_found",
                "code": "WORKSPACE_NOT_FOUND",
                "message": "Workspace not found",
            },
        )


class NotAMember(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status_code=403,
            detail={
                "error": "forbidden",
                "code": "NOT_A_MEMBER",
                "message": "You are not a member of this workspace",
            },
        )


async def require_membership(
    pool: "asyncpg.Pool",
    workspace_id,
    user_id,
    *,
    app_id: str = "boring-ui",
) -> MemberRole:
    row = await pool.fetchrow(
        """
        SELECT wm.role
        FROM workspaces w
        LEFT JOIN workspace_members wm
          ON wm.workspace_id = w.id AND wm.user_id = $2
        WHERE w.id = $1
          AND w.app_id = $3
          AND w.deleted_at IS NULL
        """,
        workspace_id,
        user_id,
        app_id,
    )

    if row is None:
        raise WorkspaceNotFound()

    if row["role"] is None:
        raise NotAMember()

    return MemberRole(row["role"])

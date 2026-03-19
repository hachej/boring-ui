"""Internal workspace-scoped tools shared by agent harnesses."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..workspace import WorkspaceContext


@dataclass
class ExecutionResult:
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    truncated: bool


class ToolGateway:
    """Wrap workspace services so Python-native harnesses avoid self-HTTP calls."""

    def __init__(self, ctx: WorkspaceContext) -> None:
        self.ctx = ctx

    async def list_dir(self, path: str = ".") -> list[dict[str, Any]]:
        return await asyncio.to_thread(self.ctx.storage.list_dir, Path(path))

    async def read_file(self, path: str) -> str:
        return await asyncio.to_thread(self.ctx.storage.read_file, Path(path))

    async def write_file(self, path: str, content: str) -> None:
        await asyncio.to_thread(self.ctx.storage.write_file, Path(path), content)

    async def delete_file(self, path: str) -> None:
        await asyncio.to_thread(self.ctx.storage.delete, Path(path))

    async def exec(
        self,
        *,
        command: str | None = None,
        argv: list[str] | None = None,
        cwd: str = ".",
        env: dict[str, str] | None = None,
        timeout_seconds: int = 60,
    ) -> ExecutionResult:
        if self.ctx.execution_backend is None:
            raise RuntimeError("Execution backend is not configured for this workspace context")
        return await self.ctx.execution_backend.run(
            workspace_root=self.ctx.root_path,
            command=command,
            argv=argv,
            cwd=cwd,
            env=env,
            timeout_seconds=timeout_seconds,
        )

    async def git_status(self) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self.ctx.git_backend.status)

    async def git_diff(self, path: str) -> str:
        return await asyncio.to_thread(self.ctx.git_backend.diff, str(Path(path)))

    async def git_show(self, path: str) -> str | None:
        return await asyncio.to_thread(self.ctx.git_backend.show, str(Path(path)))

    async def git_add(self, paths: list[str] | None = None) -> None:
        await asyncio.to_thread(self.ctx.git_backend.add, paths)

    async def git_commit(
        self,
        message: str,
        author_name: str | None = None,
        author_email: str | None = None,
    ) -> str:
        return await asyncio.to_thread(
            self.ctx.git_backend.commit,
            message,
            author_name,
            author_email,
        )

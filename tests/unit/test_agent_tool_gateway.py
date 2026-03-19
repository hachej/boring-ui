from __future__ import annotations

import pytest

from boring_ui.api.agents import ToolGateway
from boring_ui.api.agents.tool_gateway import ExecutionResult
from boring_ui.api.storage import LocalStorage
from boring_ui.api.workspace import WorkspaceContext


class FakeGitBackend:
    def __init__(self) -> None:
        self.added_paths = None
        self.commit_args = None

    def status(self):
        return [{"path": "notes.txt", "status": "M"}]

    def diff(self, path: str):
        return f"diff::{path}"

    def show(self, path: str):
        return f"show::{path}"

    def add(self, paths=None):
        self.added_paths = paths

    def commit(self, message: str, author_name: str | None = None, author_email: str | None = None):
        self.commit_args = (message, author_name, author_email)
        return "oid-123"


class FakeExecBackend:
    async def run(self, **kwargs):
        return ExecutionResult(
            exit_code=0,
            stdout="ok",
            stderr="",
            duration_ms=12,
            working_dir=kwargs["cwd"],
        )


@pytest.mark.asyncio
async def test_agent_tool_gateway_uses_workspace_scoped_services(tmp_path):
    git_backend = FakeGitBackend()
    ctx = WorkspaceContext(
        workspace_id="ws-agent",
        root_path=tmp_path,
        storage=LocalStorage(tmp_path),
        git_backend=git_backend,
        execution_backend=FakeExecBackend(),
    )
    gateway = ToolGateway(ctx)

    await gateway.write_file("notes.txt", "hello world")

    assert await gateway.read_file("notes.txt") == "hello world"
    assert [entry["name"] for entry in await gateway.list_dir(".")] == ["notes.txt"]

    exec_result = await gateway.exec(command="echo ok", cwd=".")
    assert exec_result.exit_code == 0
    assert exec_result.stdout == "ok"

    assert await gateway.git_status() == [{"path": "notes.txt", "status": "M"}]
    assert await gateway.git_diff("notes.txt") == "diff::notes.txt"
    assert await gateway.git_show("notes.txt") == "show::notes.txt"

    await gateway.git_add(["notes.txt"])
    assert git_backend.added_paths == ["notes.txt"]

    commit_oid = await gateway.git_commit("message", "Windy", "windy@example.com")
    assert commit_oid == "oid-123"
    assert git_backend.commit_args == ("message", "Windy", "windy@example.com")

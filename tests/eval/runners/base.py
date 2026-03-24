"""Pluggable agent runner interface.

Launches the agent with the generated prompt, captures stdout/stderr/
exit_code, enforces timeout, and maintains a structured observed command log.

Concrete implementations:
    - ``SubprocessRunner``: launches a CLI agent as a subprocess
    - ``MockRunner``: replays recorded sessions for harness self-testing
"""

from __future__ import annotations

import asyncio
import json
import shutil
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tests.eval.contracts import ObservedCommand, RunManifest


# ---------------------------------------------------------------------------
# RunResult
# ---------------------------------------------------------------------------

@dataclass
class RunResult:
    """Result of running an agent."""

    exit_code: int
    timed_out: bool = False
    stdout: str = ""
    stderr: str = ""
    final_response: str = ""
    command_log: list[ObservedCommand] = field(default_factory=list)
    elapsed_s: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "exit_code": self.exit_code,
            "timed_out": self.timed_out,
            "stdout_length": len(self.stdout),
            "stderr_length": len(self.stderr),
            "final_response_length": len(self.final_response),
            "command_count": len(self.command_log),
            "elapsed_s": self.elapsed_s,
        }


# ---------------------------------------------------------------------------
# AgentRunner (abstract)
# ---------------------------------------------------------------------------

class AgentRunner(ABC):
    """Abstract runner interface for launching AI agents."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Runner implementation name."""

    @abstractmethod
    async def run(
        self,
        manifest: RunManifest,
        prompt: str,
        timeout_s: int = 600,
    ) -> RunResult:
        """Launch the agent and return the result.

        Parameters
        ----------
        manifest : RunManifest
            The eval manifest with naming contract and config.
        prompt : str
            The generated agent prompt.
        timeout_s : int
            Maximum wall-clock time before the agent is killed.

        Returns
        -------
        RunResult
            Captured output, command log, and timing.
        """

    @abstractmethod
    async def cleanup(self) -> None:
        """Clean up any resources (background processes, temp files)."""


# ---------------------------------------------------------------------------
# SubprocessRunner
# ---------------------------------------------------------------------------

class SubprocessRunner(AgentRunner):
    """Launches a CLI agent as a subprocess.

    The agent command should accept the prompt via stdin or a file path.
    """

    def __init__(
        self,
        command: list[str] | None = None,
        env: dict[str, str] | None = None,
        cwd: str | None = None,
    ) -> None:
        self._command = command or ["claude", "--print"]
        self._env = env
        self._cwd = cwd
        self._process: asyncio.subprocess.Process | None = None

    @property
    def name(self) -> str:
        return "subprocess"

    async def run(
        self,
        manifest: RunManifest,
        prompt: str,
        timeout_s: int = 600,
    ) -> RunResult:
        start = time.monotonic()
        timed_out = False

        try:
            self._process = await asyncio.create_subprocess_exec(
                *self._command,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self._cwd or manifest.project_root,
                env=self._env,
            )

            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    self._process.communicate(input=prompt.encode()),
                    timeout=timeout_s,
                )
            except asyncio.TimeoutError:
                timed_out = True
                self._process.kill()
                stdout_bytes, stderr_bytes = await self._process.communicate()

            elapsed = time.monotonic() - start
            stdout = stdout_bytes.decode(errors="replace")
            stderr = stderr_bytes.decode(errors="replace")

            return RunResult(
                exit_code=self._process.returncode or -1,
                timed_out=timed_out,
                stdout=stdout,
                stderr=stderr,
                final_response=stdout,  # CLI agents typically output to stdout
                elapsed_s=elapsed,
            )

        except FileNotFoundError:
            elapsed = time.monotonic() - start
            return RunResult(
                exit_code=-1,
                stdout="",
                stderr=f"Command not found: {self._command[0]}",
                elapsed_s=elapsed,
            )

    async def cleanup(self) -> None:
        if self._process and self._process.returncode is None:
            try:
                self._process.terminate()
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except (asyncio.TimeoutError, ProcessLookupError):
                try:
                    self._process.kill()
                except ProcessLookupError:
                    pass


# ---------------------------------------------------------------------------
# MockRunner
# ---------------------------------------------------------------------------

class MockRunner(AgentRunner):
    """Replays recorded sessions for harness self-testing.

    Accepts a pre-built RunResult or replays a checked-in fixture directory.
    """

    def __init__(
        self,
        result: RunResult | None = None,
        delay_s: float = 0.0,
        fixture_dir: str | Path | None = None,
    ) -> None:
        self._fixture_dir = Path(fixture_dir) if fixture_dir else None
        self._result = result or RunResult(exit_code=0)
        self._delay = delay_s

    @property
    def name(self) -> str:
        return "mock"

    async def run(
        self,
        manifest: RunManifest,
        prompt: str,
        timeout_s: int = 600,
    ) -> RunResult:
        start = time.monotonic()

        if self._delay > 0:
            effective_delay = min(self._delay, timeout_s)
            timed_out = self._delay > timeout_s
            await asyncio.sleep(effective_delay)
        else:
            timed_out = False

        elapsed = time.monotonic() - start
        loaded = self._load_result(manifest)

        return RunResult(
            exit_code=loaded.exit_code,
            timed_out=timed_out,
            stdout=loaded.stdout,
            stderr=loaded.stderr,
            final_response=loaded.final_response,
            command_log=list(loaded.command_log),
            elapsed_s=elapsed,
        )

    async def cleanup(self) -> None:
        pass  # nothing to clean up

    def _load_result(self, manifest: RunManifest) -> RunResult:
        if self._fixture_dir is None:
            return self._result
        if not self._fixture_dir.exists():
            return RunResult(
                exit_code=-1,
                stderr=f"Fixture directory not found: {self._fixture_dir}",
            )

        self._copy_project_tree(manifest)
        stdout = self._read_text("agent_stdout.txt")
        stderr = self._read_text("agent_stderr.txt")
        final_response = self._read_text("final_response.txt") or stdout
        command_log = self._load_command_log()

        return RunResult(
            exit_code=self._load_exit_code(),
            stdout=stdout,
            stderr=stderr,
            final_response=final_response,
            command_log=command_log,
        )

    def _copy_project_tree(self, manifest: RunManifest) -> None:
        if self._fixture_dir is None:
            return

        tree = self._fixture_dir / "project_tree"
        if not tree.exists():
            return

        destination = Path(manifest.project_root)
        destination.mkdir(parents=True, exist_ok=True)
        shutil.copytree(tree, destination, dirs_exist_ok=True)

    def _read_text(self, filename: str) -> str:
        if self._fixture_dir is None:
            return ""
        path = self._fixture_dir / filename
        if not path.exists():
            return ""
        return path.read_text(encoding="utf-8")

    def _load_exit_code(self) -> int:
        raw = self._read_text("exit_code.txt").strip()
        if not raw:
            return 0
        try:
            return int(raw)
        except ValueError:
            return 0

    def _load_command_log(self) -> list[ObservedCommand]:
        raw = self._read_text("command_log.jsonl").strip()
        if not raw:
            return []

        try:
            if raw.startswith("["):
                payload = json.loads(raw)
                return [
                    ObservedCommand.from_dict(item)
                    for item in payload
                    if isinstance(item, dict)
                ]
        except json.JSONDecodeError:
            return []

        commands: list[ObservedCommand] = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                commands.append(ObservedCommand.from_dict(payload))
        return commands

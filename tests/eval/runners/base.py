"""Pluggable agent runner interface.

Launches the agent with the generated prompt, captures stdout/stderr/
exit_code, enforces timeout, and maintains a structured observed command log.

Concrete implementations:
    - ``SubprocessRunner``: launches a CLI agent as a subprocess
    - ``MockRunner``: replays recorded sessions for harness self-testing
"""

from __future__ import annotations

import asyncio
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
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

    Accepts a pre-built RunResult to return, optionally with a delay.
    """

    def __init__(
        self,
        result: RunResult | None = None,
        delay_s: float = 0.0,
    ) -> None:
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

        return RunResult(
            exit_code=self._result.exit_code,
            timed_out=timed_out,
            stdout=self._result.stdout,
            stderr=self._result.stderr,
            final_response=self._result.final_response,
            command_log=list(self._result.command_log),
            elapsed_s=elapsed,
        )

    async def cleanup(self) -> None:
        pass  # nothing to clean up

"""Command execution service for boring-ui API."""
import asyncio
import logging
import shutil
import time
from pathlib import Path

from fastapi import HTTPException

from ...config import APIConfig
from ...workspace.paths import resolve_path_beneath

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 60
_MAX_OUTPUT_BYTES = 512 * 1024  # 512 KB

# Paths to bind-mount read-only into the sandbox.
_RO_BINDS = ('/usr', '/lib', '/lib64', '/bin', '/sbin', '/etc')

_BWRAP_BIN: str | None = shutil.which('bwrap')

# Track which workspace roots have been bootstrapped this process lifetime.
_bootstrapped: set[str] = set()


def _ensure_workspace_bootstrapped(workspace_root: Path) -> None:
    """One-time workspace bootstrap: git init + virtualenv.

    Idempotent — skips if already done (this process) or markers exist on disk.
    """
    root_str = str(workspace_root)
    if root_str in _bootstrapped:
        return

    # Git init
    git_dir = workspace_root / '.git'
    if not git_dir.exists():
        import subprocess
        try:
            subprocess.run(
                ['git', 'init'],
                cwd=root_str, check=True, capture_output=True,
            )
            subprocess.run(
                ['git', 'config', 'user.email', 'workspace@boring.dev'],
                cwd=root_str, check=True, capture_output=True,
            )
            subprocess.run(
                ['git', 'config', 'user.name', 'Workspace'],
                cwd=root_str, check=True, capture_output=True,
            )
            logger.info('Bootstrapped git repo at %s', workspace_root)
        except Exception:
            logger.warning('Failed to bootstrap git at %s', workspace_root, exc_info=True)

    # Python virtualenv
    venv_dir = workspace_root / '.venv'
    if not venv_dir.exists():
        import subprocess
        try:
            subprocess.run(
                ['python3', '-m', 'venv', str(venv_dir)],
                cwd=root_str, check=True, capture_output=True,
            )
            logger.info('Bootstrapped venv at %s', venv_dir)
        except Exception:
            logger.warning('Failed to create venv at %s', venv_dir, exc_info=True)

    _bootstrapped.add(root_str)


def _build_sandbox_argv(command: str, workspace_root: Path, cwd: Path) -> list[str]:
    """Build a bwrap command line that jails *command* into *workspace_root*.

    The sandbox sees:
      /workspace  <- read-write bind of workspace_root
      /tmp        <- private tmpfs
      /dev, /proc <- minimal device + proc
      /usr /lib ... <- read-only host binaries
    Nothing outside these mounts is visible — no /app, no other workspaces.
    """
    argv: list[str] = [
        _BWRAP_BIN,
        '--tmpfs', '/',
        '--proc', '/proc',
        '--dev', '/dev',
        '--tmpfs', '/tmp',
    ]
    for host_path in _RO_BINDS:
        if Path(host_path).is_dir():
            argv += ['--ro-bind', host_path, host_path]

    argv += ['--bind', str(workspace_root), '/workspace']

    # Map cwd into the sandbox namespace.
    if cwd == workspace_root:
        sandbox_cwd = '/workspace'
    else:
        relative = cwd.relative_to(workspace_root)
        sandbox_cwd = f'/workspace/{relative}'

    argv += ['--chdir', sandbox_cwd]
    argv += ['--', 'sh', '-c', command]
    return argv


def _build_env(workspace_root: Path) -> dict[str, str]:
    """Build the environment for a sandboxed command."""
    sandboxed = _BWRAP_BIN is not None
    home = '/workspace' if sandboxed else str(workspace_root)
    venv = f'{home}/.venv'

    return {
        'HOME': home,
        'PATH': f'{venv}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        'VIRTUAL_ENV': venv,
        # pip install --user goes to workspace/.local
        'PYTHONUSERBASE': f'{home}/.local',
    }


async def execute_command(
    command: str,
    cwd: str | None,
    workspace_root: Path,
) -> dict:
    """Execute a shell command within the workspace.

    When bubblewrap (bwrap) is available the command runs inside a
    filesystem-namespace sandbox that only exposes the workspace directory.
    Falls back to a plain subprocess when bwrap is not installed (local dev).

    On first call per workspace, bootstraps git + Python venv.

    Args:
        command: Shell command to execute
        cwd: Working directory relative to workspace root (None = workspace root)
        workspace_root: Absolute path to the workspace root

    Returns:
        dict with stdout, stderr, exit_code, duration_ms
    """
    resolved_root = Path(workspace_root).resolve()

    if cwd is not None:
        try:
            exec_dir = resolve_path_beneath(resolved_root, Path(cwd))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if not exec_dir.is_dir():
            raise HTTPException(status_code=400, detail=f"Not a directory: {cwd}")
    else:
        exec_dir = resolved_root

    _ensure_workspace_bootstrapped(resolved_root)

    env = _build_env(resolved_root)

    start = time.monotonic()
    try:
        if _BWRAP_BIN:
            argv = _build_sandbox_argv(command, resolved_root, exec_dir)
            proc = await asyncio.create_subprocess_exec(
                *argv,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
        else:
            proc = await asyncio.create_subprocess_shell(
                command,
                cwd=str(exec_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(),
            timeout=_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        proc.kill()
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(), timeout=5,
            )
        except Exception:
            stdout_bytes = b''
            stderr_bytes = b''
        duration_ms = int((time.monotonic() - start) * 1000)
        return {
            'stdout': stdout_bytes[:_MAX_OUTPUT_BYTES].decode(errors='replace'),
            'stderr': stderr_bytes[:_MAX_OUTPUT_BYTES].decode(errors='replace')
                + f'\n[killed: timeout after {_TIMEOUT_SECONDS}s]',
            'exit_code': -1,
            'duration_ms': duration_ms,
        }

    duration_ms = int((time.monotonic() - start) * 1000)
    return {
        'stdout': stdout_bytes[:_MAX_OUTPUT_BYTES].decode(errors='replace'),
        'stderr': stderr_bytes[:_MAX_OUTPUT_BYTES].decode(errors='replace'),
        'exit_code': proc.returncode,
        'duration_ms': duration_ms,
    }

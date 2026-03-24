"""Resource cleanup with manifest and resumability.

Best-effort, idempotent cleanup that operates from a discovered resource
inventory and produces a cleanup_manifest.json for deferred recovery.

Safety:
    - NEVER delete a directory outside projects_root
    - NEVER delete a directory that doesn't match the eval prefix
    - Log every destructive action before executing
    - Each step is independent — failure in one doesn't skip others
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tests.eval.contracts import CleanupResult, RunManifest
from tests.eval.eval_logger import EvalLogger
from tests.eval.providers.fly import FlyAdapter
from tests.eval.providers.neon import NeonAdapter


# ---------------------------------------------------------------------------
# Cleanup manifest
# ---------------------------------------------------------------------------

@dataclass
class CleanupManifest:
    """Record of all cleanup actions taken."""

    eval_id: str
    results: list[CleanupResult] = field(default_factory=list)
    completed: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "eval_id": self.eval_id,
            "results": [r.to_dict() for r in self.results],
            "completed": self.completed,
            "total": len(self.results),
            "succeeded": sum(1 for r in self.results if r.success),
            "failed": sum(1 for r in self.results if not r.success),
        }

    def save(self, evidence_dir: str | Path) -> Path:
        path = Path(evidence_dir) / "cleanup_manifest.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")
        return path


# ---------------------------------------------------------------------------
# Cleanup executor
# ---------------------------------------------------------------------------

def run_cleanup(
    manifest: RunManifest,
    *,
    fly_adapter: FlyAdapter | None = None,
    neon_adapter: NeonAdapter | None = None,
    logger: EvalLogger | None = None,
    kill_local_processes: bool = True,
    delete_project_dir: bool = True,
) -> CleanupManifest:
    """Run best-effort cleanup for all eval resources.

    Each step is independent — failure in one doesn't skip others.
    """
    fly = fly_adapter or FlyAdapter()
    neon = neon_adapter or NeonAdapter()
    cleanup = CleanupManifest(eval_id=manifest.eval_id)

    def _log(msg: str) -> None:
        if logger:
            logger.info(msg)

    # 1. Stop/delete Fly app
    _log(f"Cleanup: checking Fly app {manifest.app_slug}")
    start = time.monotonic()
    try:
        if fly.app_exists(manifest.app_slug):
            _log(f"Cleanup: deleting Fly app {manifest.app_slug}")
            success = fly.delete_app(manifest.app_slug)
            cleanup.results.append(CleanupResult(
                resource_type="fly_app",
                resource_id=manifest.app_slug,
                success=success,
                error="" if success else "delete_app returned False",
                duration_seconds=time.monotonic() - start,
            ))
        else:
            cleanup.results.append(CleanupResult(
                resource_type="fly_app",
                resource_id=manifest.app_slug,
                success=True,
                error="app not found (already cleaned or never created)",
                duration_seconds=time.monotonic() - start,
            ))
    except Exception as e:
        cleanup.results.append(CleanupResult(
            resource_type="fly_app",
            resource_id=manifest.app_slug,
            success=False,
            error=str(e),
            duration_seconds=time.monotonic() - start,
        ))

    # 2. Kill local dev processes
    if kill_local_processes:
        _log("Cleanup: killing local dev processes")
        start = time.monotonic()
        try:
            killed = _kill_local_processes(manifest.project_root)
            cleanup.results.append(CleanupResult(
                resource_type="local_processes",
                resource_id=manifest.project_root,
                success=True,
                error=f"killed {killed} processes" if killed else "no processes found",
                duration_seconds=time.monotonic() - start,
            ))
        except Exception as e:
            cleanup.results.append(CleanupResult(
                resource_type="local_processes",
                resource_id=manifest.project_root,
                success=False,
                error=str(e),
                duration_seconds=time.monotonic() - start,
            ))

    # 3. Delete project directory
    if delete_project_dir:
        _log(f"Cleanup: removing project dir {manifest.project_root}")
        start = time.monotonic()
        try:
            success, error = _safe_delete_project(
                manifest.project_root,
                projects_root=str(Path(manifest.project_root).parent),
            )
            cleanup.results.append(CleanupResult(
                resource_type="directory",
                resource_id=manifest.project_root,
                success=success,
                error=error,
                duration_seconds=time.monotonic() - start,
            ))
        except Exception as e:
            cleanup.results.append(CleanupResult(
                resource_type="directory",
                resource_id=manifest.project_root,
                success=False,
                error=str(e),
                duration_seconds=time.monotonic() - start,
            ))

    cleanup.completed = True

    # Save manifest
    try:
        cleanup.save(manifest.evidence_dir)
    except Exception:
        pass  # best-effort

    return cleanup


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _kill_local_processes(project_root: str) -> int:
    """Kill processes with cwd matching the project root.

    Returns the number of processes killed.
    """
    killed = 0
    try:
        # Find PIDs with matching cwd
        result = subprocess.run(
            ["lsof", "-t", "+D", project_root],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0 and result.stdout.strip():
            pids = [int(p) for p in result.stdout.strip().split() if p.isdigit()]
            my_pid = os.getpid()
            for pid in pids:
                if pid == my_pid:
                    continue
                try:
                    os.kill(pid, signal.SIGTERM)
                    killed += 1
                except ProcessLookupError:
                    pass
    except (subprocess.TimeoutExpired, FileNotFoundError, ValueError):
        pass
    return killed


def _safe_delete_project(
    project_root: str,
    projects_root: str,
) -> tuple[bool, str]:
    """Safely delete a project directory.

    Safety checks:
    - Must be under projects_root
    - Must match eval prefix (ce-* or child-eval-*)
    - Must not be a symlink
    """
    path = Path(project_root).resolve()
    parent = Path(projects_root).resolve()

    # Safety: must be under projects_root
    if not str(path).startswith(str(parent)):
        return False, f"SAFETY: {path} is not under {parent}"

    # Safety: directory name must match eval prefix
    dirname = path.name
    if not (dirname.startswith("ce-") or dirname.startswith("child-eval-")):
        return False, f"SAFETY: {dirname} does not match eval prefix (ce-* or child-eval-*)"

    # Safety: must not be a symlink
    if Path(project_root).is_symlink():
        return False, f"SAFETY: {project_root} is a symlink"

    if not path.exists():
        return True, "already deleted"

    try:
        shutil.rmtree(str(path))
        return True, ""
    except Exception as e:
        return False, str(e)

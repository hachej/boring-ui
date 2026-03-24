"""Platform fact discovery via runtime introspection.

Reads the current repo, bui CLI, and environment to discover platform
facts.  These facts populate ``PlatformFacts`` and are used to validate
capability manifests and populate the run manifest.

Introspection discovers facts; it does NOT silently redefine the benchmark.
If bui init suddenly produces a different file structure, the capability
manifest validation should flag this, not silently adjust check behavior.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
from pathlib import Path
from typing import Any

from tests.eval.capabilities import (
    CapabilityIssue,
    CapabilityManifest,
    validate_profile_against_capabilities,
)
from tests.eval.contracts import PlatformFacts


# ---------------------------------------------------------------------------
# Subprocess helpers
# ---------------------------------------------------------------------------

def _run(cmd: list[str], timeout: int = 10) -> tuple[int, str, str]:
    """Run a command and return (exit_code, stdout, stderr)."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except FileNotFoundError:
        return -1, "", f"command not found: {cmd[0]}"
    except subprocess.TimeoutExpired:
        return -2, "", f"command timed out: {' '.join(cmd)}"


def _version_from_cmd(cmd: list[str]) -> str:
    """Extract version string from a command's output."""
    rc, stdout, stderr = _run(cmd)
    if rc != 0:
        return ""
    # Take first line, strip common prefixes
    line = (stdout or stderr).split("\n")[0]
    # Common patterns: "v1.2.3", "fly v0.2.1", "bui version 0.1.0"
    for prefix in ("v", "fly ", "bui version ", "Python ", "node "):
        if line.startswith(prefix):
            line = line[len(prefix):]
    return line.strip()


# ---------------------------------------------------------------------------
# Fact discovery
# ---------------------------------------------------------------------------

def discover_platform_facts(
    boring_ui_root: str | Path | None = None,
) -> PlatformFacts:
    """Discover platform facts from the current environment.

    Parameters
    ----------
    boring_ui_root : str or Path, optional
        Path to the boring-ui repo. Defaults to the parent of this file's
        grandparent (assumes ``tests/eval/`` is inside boring-ui).
    """
    if boring_ui_root is None:
        boring_ui_root = Path(__file__).resolve().parent.parent.parent

    boring_ui_root = Path(boring_ui_root)

    return PlatformFacts(
        boring_ui_commit=_git_commit(boring_ui_root),
        boring_ui_dirty=_git_dirty(boring_ui_root),
        bui_version=_bui_version(),
        python_version=platform.python_version(),
        node_version=_version_from_cmd(["node", "--version"]),
        fly_cli_version=_fly_version(),
        vault_available=_vault_available(),
        neon_cli_version="",  # not widely available yet
        os_info=f"{platform.system()} {platform.release()}",
    )


def _git_commit(repo_root: Path) -> str:
    """Get the HEAD commit SHA of a git repo."""
    rc, stdout, _ = _run(["git", "-C", str(repo_root), "rev-parse", "HEAD"])
    return stdout[:12] if rc == 0 else ""


def _git_dirty(repo_root: Path) -> bool:
    """Check if the git repo has uncommitted changes."""
    rc, stdout, _ = _run(
        ["git", "-C", str(repo_root), "status", "--porcelain", "--short"]
    )
    return rc == 0 and bool(stdout)


def _bui_version() -> str:
    """Get bui CLI version."""
    if not shutil.which("bui"):
        return ""
    rc, stdout, _ = _run(["bui", "version"])
    if rc != 0:
        return ""
    # Parse "bui version X.Y.Z" or just "X.Y.Z"
    line = stdout.split("\n")[0].strip()
    if line.startswith("bui version "):
        line = line[len("bui version "):]
    return line


def _fly_version() -> str:
    """Get Fly CLI version."""
    if not shutil.which("fly") and not shutil.which("flyctl"):
        return ""
    cmd = ["fly", "version"] if shutil.which("fly") else ["flyctl", "version"]
    rc, stdout, _ = _run(cmd)
    if rc != 0:
        return ""
    line = stdout.split("\n")[0].strip()
    # "fly v0.2.1 ..." → "0.2.1"
    if " " in line:
        parts = line.split()
        for p in parts:
            if p.startswith("v") and "." in p:
                return p[1:]
            if p[0].isdigit() and "." in p:
                return p
    return line


def _vault_available() -> bool:
    """Check if Vault CLI is available and configured."""
    if not shutil.which("vault"):
        return False
    rc, _, _ = _run(["vault", "token", "lookup", "-format=json"])
    return rc == 0


# ---------------------------------------------------------------------------
# Manifest validation
# ---------------------------------------------------------------------------

def build_manifest_from_facts(facts: PlatformFacts) -> CapabilityManifest:
    """Build a CapabilityManifest from discovered platform facts."""
    return CapabilityManifest.from_platform_facts(facts)


def validate_against_manifest(
    facts: PlatformFacts,
    profile: str,
) -> list[CapabilityIssue]:
    """Validate discovered facts against profile requirements.

    Returns a list of issues (empty = all requirements met).
    """
    manifest = build_manifest_from_facts(facts)
    return validate_profile_against_capabilities(profile, manifest)

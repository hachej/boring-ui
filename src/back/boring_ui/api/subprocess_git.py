"""SubprocessGitBackend — git operations via subprocess.

Mechanical extraction from GitService. All git subprocess logic lives here.
GitService becomes a thin adapter that delegates to this backend.
"""
from __future__ import annotations

import os
import re
import shlex
import stat
import subprocess
import tempfile
from pathlib import Path

from .git_backend import (
    GitBackend,
    GitAuthError,
    GitCommandError,
    GitConflictError,
    GitCredentials,
    GitNotRepoError,
    RemoteInfo,
    StatusEntry,
)

# Patterns that may leak credentials in git stderr
_CREDENTIAL_PATTERNS = re.compile(
    r'(https?://)[^\s@]+@',  # embedded creds in URLs
    re.IGNORECASE,
)


def _create_askpass_script(username: str, password: str) -> str:
    """Create a GIT_ASKPASS script with proper shell escaping.

    Creates the file with 0700 permissions from the start (no world-readable
    window). Uses shlex.quote() to prevent shell injection via credentials.

    Returns:
        Path to the temporary script file.
    """
    fd, path = tempfile.mkstemp(suffix='.sh', prefix='git_askpass_')
    try:
        os.fchmod(fd, stat.S_IRWXU)
        os.write(fd, (
            '#!/bin/sh\n'
            'case "$1" in\n'
            f'  *sername*) echo {shlex.quote(username)} ;;\n'
            f'  *) echo {shlex.quote(password)} ;;\n'
            'esac\n'
        ).encode())
    finally:
        os.close(fd)
    return path


def _cleanup_askpass(path: str | None) -> None:
    """Remove a temporary askpass script."""
    if path:
        try:
            os.unlink(path)
        except OSError:
            pass


def _sanitize_git_error(stderr: str) -> str:
    """Strip credentials from git error messages before returning to client."""
    sanitized = _CREDENTIAL_PATTERNS.sub(r'\1***@', stderr)
    return sanitized.strip()


def _sanitize_url(url: str) -> str:
    """Strip embedded credentials from a URL for display."""
    if '://' in url and '@' in url:
        scheme_rest = url.split('://', 1)
        if len(scheme_rest) == 2 and '@' in scheme_rest[1]:
            host_path = scheme_rest[1].split('@', 1)[1]
            return f'{scheme_rest[0]}://{host_path}'
    return url


# Status code priority (higher = more important, don't overwrite)
_STATUS_PRIORITY = {'C': 5, 'D': 4, 'A': 3, 'M': 2, 'U': 1}


def _normalize_status(raw: str) -> str:
    """Convert git XY status to single-char frontend status.

    Returns: M (Modified), A (Added), D (Deleted), U (Untracked), C (Conflict)
    """
    raw = raw.strip()
    # Untracked files (standard '??' or condensed '?' format)
    if raw in ('??', '?'):
        return 'U'
    # Merge conflicts (unmerged states)
    if raw in ('UU', 'AA', 'DD', 'DU', 'UD', 'AU', 'UA'):
        return 'C'
    # Deleted
    if raw in ('D', 'D ', ' D'):
        return 'D'
    # Added
    if raw in ('A', 'A ', ' A'):
        return 'A'
    # Modified (including MM - modified in both index and worktree)
    if raw in ('M', 'M ', ' M', 'MM'):
        return 'M'
    # Renamed (show as modified for simplicity)
    if raw.startswith('R'):
        return 'M'
    # Copied (show as added since it's a new file)
    if raw.startswith('C'):
        return 'A'
    # Default: use first non-space character if recognized
    for c in raw:
        if c in 'MADU':
            return c
        if c != ' ':
            break
    return 'M'  # Fallback to modified for unknown


class SubprocessGitBackend(GitBackend):
    """Git operations via subprocess. Current behavior, extracted."""

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root

    def _run(
        self,
        args: list[str],
        credentials: GitCredentials | None = None,
        timeout: int = 30,
        cwd: Path | None = None,
        extra_env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess:
        """Run a git command and return the CompletedProcess.

        Raises GitCommandError on non-zero exit. Caller gets full result
        for cases needing stdout inspection (e.g. commit).
        """
        env = None
        askpass_path = None
        try:
            if extra_env:
                env = os.environ.copy()
                env.update(extra_env)
            if credentials:
                askpass_path = _create_askpass_script(
                    credentials.username,
                    credentials.password,
                )
                if env is None:
                    env = os.environ.copy()
                env['GIT_ASKPASS'] = askpass_path
                env['GIT_TERMINAL_PROMPT'] = '0'

            result = subprocess.run(
                ['git'] + args,
                cwd=cwd or self.workspace_root,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )
        except subprocess.TimeoutExpired as e:
            raise GitCommandError(
                f'Git command timed out after {timeout}s',
                stderr=str(e.stderr or e.stdout or ''),
            ) from e
        except OSError as e:
            raise GitCommandError(f'Failed to execute git: {e}') from e
        finally:
            _cleanup_askpass(askpass_path)

        if result.returncode != 0:
            stderr = _sanitize_git_error(result.stderr or result.stdout or '')
            # Detect auth failures
            if any(kw in stderr.lower() for kw in (
                'authentication failed', 'could not read username',
                'permission denied', 'invalid credentials',
            )):
                raise GitAuthError(stderr)
            # Detect merge conflicts
            if 'conflict' in stderr.lower() or 'merge conflict' in (result.stdout or '').lower():
                raise GitConflictError(stderr)
            raise GitCommandError(
                f'Git error: {stderr}',
                stderr=stderr,
                exit_code=result.returncode,
            )
        return result

    def _run_stdout(self, args: list[str], credentials: GitCredentials | None = None,
                    timeout: int = 30) -> str:
        """Run a git command and return stdout."""
        return self._run(args, credentials=credentials, timeout=timeout).stdout

    # ── Repo state ──

    def is_repo(self) -> bool:
        try:
            self._run_stdout(['rev-parse', '--git-dir'])
            return True
        except GitCommandError:
            return False

    def status(self) -> list[StatusEntry]:
        if not self.is_repo():
            return []

        output = self._run_stdout(['status', '--porcelain'])
        files: dict[str, str] = {}

        for line in output.strip().split('\n'):
            if len(line) >= 3:
                # Check if position 2 is a space (standard XY format)
                if len(line) > 3 and line[2] == ' ':
                    raw_status = line[:2]
                    file_path = line[3:]
                else:
                    raw_status = line[0]
                    file_path = line[2:] if line[1] == ' ' else line[3:]

                # Handle rename/copy paths: "old -> new" format
                if raw_status.startswith(('R', 'C')) and ' -> ' in file_path:
                    file_path = file_path.split(' -> ')[-1]

                if raw_status and file_path:
                    status_code = _normalize_status(raw_status)
                    existing = files.get(file_path)
                    if existing is None or _STATUS_PRIORITY.get(status_code, 0) > _STATUS_PRIORITY.get(existing, 0):
                        files[file_path] = status_code

        return [StatusEntry(path=p, status=s) for p, s in files.items()]

    def diff(self, path: str) -> str:
        try:
            return self._run_stdout(['diff', 'HEAD', '--', path])
        except GitCommandError:
            return ''

    def show(self, path: str) -> str | None:
        try:
            return self._run_stdout(['show', f'HEAD:{path}'])
        except GitCommandError:
            return None

    # ── Write operations ──

    def init(self) -> None:
        self._run_stdout(['init'])

    def add(self, paths: list[str] | None = None) -> None:
        if paths is None:
            self._run_stdout(['add', '-A'])
        elif len(paths) == 0:
            return
        else:
            self._run_stdout(['add', '--'] + paths)

    def commit(self, message: str, author_name: str | None = None,
               author_email: str | None = None) -> str:
        args = ['commit', '-m', message]
        extra_env = None
        if author_name and author_email:
            args.extend(['--author', f'{author_name} <{author_email}>'])
            extra_env = {
                'GIT_AUTHOR_NAME': author_name,
                'GIT_AUTHOR_EMAIL': author_email,
                'GIT_COMMITTER_NAME': author_name,
                'GIT_COMMITTER_EMAIL': author_email,
            }

        self._run(args, extra_env=extra_env)
        oid = self._run_stdout(['rev-parse', 'HEAD']).strip()
        return oid

    def push(self, remote: str, branch: str | None = None,
             credentials: GitCredentials | None = None) -> None:
        args = ['push', remote]
        if branch:
            args.append(branch)
        self._run_stdout(args, credentials=credentials, timeout=60)

    def pull(self, remote: str, branch: str | None = None,
             credentials: GitCredentials | None = None) -> None:
        args = ['pull', remote]
        if branch:
            args.append(branch)
        self._run_stdout(args, credentials=credentials, timeout=60)

    def clone(self, url: str, branch: str | None = None,
              credentials: GitCredentials | None = None) -> None:
        args = ['clone', '--depth', '1']
        if branch:
            args.extend(['-b', branch])
        args.extend(['--', url, str(self.workspace_root)])
        # Clone runs from parent dir, not workspace_root
        self._run(args, credentials=credentials, timeout=120,
                  cwd=self.workspace_root.parent)

    # ── Branches ──

    def branches(self) -> tuple[list[str], str | None]:
        if not self.is_repo():
            return ([], None)
        output = self._run_stdout(['branch', '--list', '--no-color'])
        branch_list: list[str] = []
        current: str | None = None
        for line in output.strip().split('\n'):
            if not line.strip():
                continue
            is_current = line.startswith('*')
            name = line.lstrip('* ').strip()
            if not name or name.startswith('('):
                continue
            branch_list.append(name)
            if is_current:
                current = name
        return (branch_list, current)

    def current_branch_name(self) -> str | None:
        if not self.is_repo():
            return None
        try:
            name = self._run_stdout(['rev-parse', '--abbrev-ref', 'HEAD']).strip()
            return name if name != 'HEAD' else None  # 'HEAD' means detached
        except GitCommandError:
            return None

    def create_branch(self, name: str, checkout: bool = True) -> None:
        if checkout:
            self._run_stdout(['checkout', '-b', name])
        else:
            self._run_stdout(['branch', name])

    def checkout(self, name: str) -> None:
        self._run_stdout(['checkout', name])

    def merge(self, source: str, message: str | None = None) -> None:
        args = ['merge', source]
        if message:
            args.extend(['-m', message])
        try:
            self._run(args, timeout=60)
        except GitConflictError:
            # Abort the failed merge to leave workspace clean
            try:
                self._run(['merge', '--abort'], timeout=10)
            except GitCommandError:
                pass
            raise

    # ── Remotes ──

    def add_remote(self, name: str, url: str) -> None:
        # Remove existing first (ignore failure)
        try:
            self._run_stdout(['remote', 'remove', '--', name])
        except GitCommandError:
            pass
        self._run_stdout(['remote', 'add', '--', name, url])

    def remove_remote(self, name: str) -> None:
        try:
            self._run_stdout(['remote', 'remove', '--', name])
        except GitCommandError:
            pass

    def list_remotes(self) -> list[RemoteInfo]:
        if not self.is_repo():
            return []
        output = self._run_stdout(['remote', '-v'])
        remotes: list[RemoteInfo] = []
        seen: set[str] = set()
        for line in output.strip().split('\n'):
            parts = line.split()
            if len(parts) >= 2 and parts[-1] == '(fetch)' and parts[0] not in seen:
                seen.add(parts[0])
                remotes.append(RemoteInfo(remote=parts[0], url=_sanitize_url(parts[1])))
        return remotes

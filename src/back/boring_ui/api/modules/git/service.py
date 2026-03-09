"""Git operations service for boring-ui API."""
import os
import re
import shlex
import stat
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse
from fastapi import HTTPException

from ...config import APIConfig

_ALLOWED_CLONE_SCHEMES = {'http', 'https', 'git', 'ssh'}
_SAFE_NAME_RE = re.compile(r'^[A-Za-z0-9_][A-Za-z0-9._\-/]*$')
# scp-style: user@host:path (no scheme, colon without //)
_SCP_STYLE_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._\-]*@[A-Za-z0-9][A-Za-z0-9._\-]*:.+$')

# Patterns that may leak credentials in git stderr
_CREDENTIAL_PATTERNS = re.compile(
    r'(https?://)[^\s@]+@',  # embedded creds in URLs
    re.IGNORECASE,
)


def _validate_git_ref(value: str, label: str = 'value') -> None:
    """Reject values that could be interpreted as git flags."""
    if not value or not _SAFE_NAME_RE.match(value):
        raise HTTPException(status_code=400, detail=f'Invalid {label}: {value!r}')


def _validate_git_url(url: str) -> None:
    """Validate a git remote URL (scheme-based or scp-style)."""
    if _SCP_STYLE_RE.match(url):
        return  # git@github.com:user/repo.git
    parsed = urlparse(url)
    if parsed.scheme.lower() not in _ALLOWED_CLONE_SCHEMES:
        raise HTTPException(
            status_code=400,
            detail=f'Invalid git URL scheme: {parsed.scheme!r}. '
                   f'Allowed: {", ".join(sorted(_ALLOWED_CLONE_SCHEMES))} or scp-style',
        )


def _create_askpass_script(username: str, password: str) -> str:
    """Create a GIT_ASKPASS script with proper shell escaping.

    Creates the file with 0700 permissions from the start (no world-readable
    window). Uses shlex.quote() to prevent shell injection via credentials.

    Returns:
        Path to the temporary script file.
    """
    # Use os.open with explicit mode to avoid permission window
    path = tempfile.mktemp(suffix='.sh', prefix='git_askpass_')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, stat.S_IRWXU)
    try:
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


class GitService:
    """Service class for git operations.

    Handles git command execution and path validation.
    """
    
    def __init__(self, config: APIConfig):
        """Initialize the git service.
        
        Args:
            config: API configuration with workspace_root
        """
        self.config = config
    
    def validate_and_relativize(self, path_str: str) -> Path:
        """Validate path and return relative path.
        
        Args:
            path_str: Path to validate
            
        Returns:
            Path relative to workspace root
            
        Raises:
            HTTPException: If path is invalid or outside workspace
        """
        try:
            validated = self.config.validate_path(Path(path_str))
            return validated.relative_to(self.config.workspace_root)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    
    def run_git(self, args: list[str], credentials: dict | None = None,
                timeout: int = 30) -> str:
        """Run git command in workspace.

        Args:
            args: Git command arguments (without 'git' prefix)
            credentials: Optional dict with 'username' and 'password' for HTTPS auth.
            timeout: Command timeout in seconds (default: 30).

        Returns:
            stdout from git command

        Raises:
            HTTPException: If git command fails
        """
        env = None
        askpass_path = None
        try:
            if credentials:
                askpass_path = _create_askpass_script(
                    credentials.get('username', ''),
                    credentials.get('password', ''),
                )
                env = os.environ.copy()
                env['GIT_ASKPASS'] = askpass_path
                env['GIT_TERMINAL_PROMPT'] = '0'

            result = subprocess.run(
                ['git'] + args,
                cwd=self.config.workspace_root,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )
        finally:
            _cleanup_askpass(askpass_path)
        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f'Git error: {_sanitize_git_error(result.stderr)}'
            )
        return result.stdout
    
    def is_git_repo(self) -> bool:
        """Check if workspace is a git repository.
        
        Returns:
            True if workspace is a git repo, False otherwise
        """
        try:
            self.run_git(['rev-parse', '--git-dir'])
            return True
        except HTTPException:
            return False
    
    def get_status(self) -> dict:
        """Get git repository status.

        Returns:
            dict with is_repo (bool) and files (list of {path, status} dicts)
        """
        if not self.is_git_repo():
            return {'is_repo': False, 'available': True, 'files': []}

        # Get status (porcelain v1 format for stable parsing)
        status = self.run_git(['status', '--porcelain'])
        files = {}

        # Priority for status codes (higher = more important, don't overwrite)
        status_priority = {'C': 5, 'D': 4, 'A': 3, 'M': 2, 'U': 1}

        def normalize_status(raw: str) -> str:
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

        for line in status.strip().split('\n'):
            if len(line) >= 3:
                # Check if position 2 is a space (standard XY format)
                if len(line) > 3 and line[2] == ' ':
                    # Standard: XY PATH - path starts at position 3
                    raw_status = line[:2]
                    file_path = line[3:]
                else:
                    # Condensed: X PATH - path starts at position 2
                    raw_status = line[0]
                    file_path = line[2:] if line[1] == ' ' else line[3:]

                # Handle rename/copy paths: "old -> new" format
                # Only split for actual rename/copy statuses
                if raw_status.startswith(('R', 'C')) and ' -> ' in file_path:
                    file_path = file_path.split(' -> ')[-1]

                if raw_status and file_path:
                    status_code = normalize_status(raw_status)
                    # Don't overwrite higher-priority status
                    existing = files.get(file_path)
                    if existing is None or status_priority.get(status_code, 0) > status_priority.get(existing, 0):
                        files[file_path] = status_code

        return {
            'is_repo': True,
            'available': True,  # Compatibility with frontend
            'files': [{'path': p, 'status': s} for p, s in files.items()],
        }
    
    def get_diff(self, path: str) -> dict:
        """Get diff for a specific file against HEAD.
        
        Args:
            path: File path relative to workspace root
            
        Returns:
            dict with diff content and path
        """
        rel_path = self.validate_and_relativize(path)
        
        try:
            diff = self.run_git(['diff', 'HEAD', '--', str(rel_path)])
            return {'diff': diff, 'path': path}
        except HTTPException as e:
            # File might be untracked
            return {'diff': '', 'path': path, 'error': str(e.detail)}
    
    def get_show(self, path: str) -> dict:
        """Get file contents at HEAD.

        Args:
            path: File path relative to workspace root

        Returns:
            dict with content at HEAD (or null if not tracked)
        """
        rel_path = self.validate_and_relativize(path)

        try:
            content = self.run_git(['show', f'HEAD:{rel_path}'])
            return {'content': content, 'path': path}
        except HTTPException:
            return {'content': None, 'path': path, 'error': 'Not in HEAD'}

    # -------------------------------------------------------------------
    # Write operations
    # -------------------------------------------------------------------

    def init_repo(self) -> dict:
        """Initialize a git repository in the workspace."""
        self.run_git(['init'])
        return {'initialized': True}

    def add_files(self, paths: list[str] | None = None) -> dict:
        """Stage files for commit.

        Args:
            paths: Specific file paths to stage. If None, stages all.
                   If empty list, returns without staging.
        """
        if paths is None:
            self.run_git(['add', '-A'])
        elif len(paths) == 0:
            return {'staged': False}
        else:
            validated = [str(self.validate_and_relativize(p)) for p in paths]
            self.run_git(['add', '--'] + validated)
        return {'staged': True}

    def commit(self, message: str, author_name: str | None = None,
               author_email: str | None = None) -> dict:
        """Create a commit with staged changes.

        Args:
            message: Commit message.
            author_name: Optional author name override.
            author_email: Optional author email override.
        """
        args = ['commit', '-m', message]
        if author_name and author_email:
            args.extend(['--author', f'{author_name} <{author_email}>'])
        result = subprocess.run(
            ['git'] + args,
            cwd=self.config.workspace_root,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            msg = _sanitize_git_error(result.stderr or result.stdout or '')
            # "nothing to commit" is a client error, not a server error
            if 'nothing to commit' in msg.lower():
                raise HTTPException(status_code=400, detail=f'Git error: {msg}')
            raise HTTPException(status_code=500, detail=f'Git error: {msg}')
        oid = self.run_git(['rev-parse', 'HEAD']).strip()
        return {'oid': oid, 'output': result.stdout.strip()}

    def push(self, remote: str = 'origin', branch: str | None = None,
             credentials: dict | None = None) -> dict:
        """Push to a remote.

        Args:
            remote: Remote name (default: origin).
            branch: Branch to push (default: current HEAD).
            credentials: Optional dict with 'username' and 'password'.
        """
        _validate_git_ref(remote, 'remote')
        if branch:
            _validate_git_ref(branch, 'branch')
        args = ['push', remote]
        if branch:
            args.append(branch)
        self.run_git(args, credentials=credentials, timeout=60)
        return {'pushed': True}

    def pull(self, remote: str = 'origin', branch: str | None = None,
             credentials: dict | None = None) -> dict:
        """Pull from a remote.

        Args:
            remote: Remote name (default: origin).
            branch: Branch to pull.
            credentials: Optional dict with 'username' and 'password'.
        """
        _validate_git_ref(remote, 'remote')
        if branch:
            _validate_git_ref(branch, 'branch')
        args = ['pull', remote]
        if branch:
            args.append(branch)
        self.run_git(args, credentials=credentials, timeout=60)
        return {'pulled': True}

    def clone_repo(self, url: str, branch: str | None = None,
                   credentials: dict | None = None) -> dict:
        """Clone a repository into workspace.

        Args:
            url: Repository URL.
            branch: Branch to clone.
            credentials: Optional dict with 'username' and 'password'.
        """
        _validate_git_url(url)
        if branch:
            _validate_git_ref(branch, 'branch')

        env = None
        askpass_path = None
        try:
            if credentials:
                askpass_path = _create_askpass_script(
                    credentials.get('username', ''),
                    credentials.get('password', ''),
                )
                env = os.environ.copy()
                env['GIT_ASKPASS'] = askpass_path
                env['GIT_TERMINAL_PROMPT'] = '0'

            args = ['clone', '--depth', '1']
            if branch:
                args.extend(['-b', branch])
            args.extend(['--', url, str(self.config.workspace_root)])
            # Clone runs from parent dir, not workspace_root
            result = subprocess.run(
                ['git'] + args,
                capture_output=True,
                text=True,
                timeout=120,
                env=env,
            )
        finally:
            _cleanup_askpass(askpass_path)
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f'Git error: {_sanitize_git_error(result.stderr)}')
        return {'cloned': True}

    def add_remote(self, name: str, url: str) -> dict:
        """Add or update a remote."""
        _validate_git_ref(name, 'remote name')
        _validate_git_url(url)
        # Remove existing first (ignore failure)
        try:
            self.run_git(['remote', 'remove', '--', name])
        except HTTPException:
            pass
        self.run_git(['remote', 'add', '--', name, url])
        return {'added': True}

    def list_remotes(self) -> dict:
        """List configured remotes."""
        if not self.is_git_repo():
            return {'remotes': []}
        output = self.run_git(['remote', '-v'])
        remotes = []
        seen = set()
        for line in output.strip().split('\n'):
            parts = line.split()
            if len(parts) >= 2 and parts[-1] == '(fetch)' and parts[0] not in seen:
                seen.add(parts[0])
                remotes.append({'remote': parts[0], 'url': _sanitize_url(parts[1])})
        return {'remotes': remotes}


def _sanitize_url(url: str) -> str:
    """Strip embedded credentials from a URL for display."""
    if '://' in url and '@' in url:
        scheme_rest = url.split('://', 1)
        if len(scheme_rest) == 2 and '@' in scheme_rest[1]:
            host_path = scheme_rest[1].split('@', 1)[1]
            return f'{scheme_rest[0]}://{host_path}'
    return url

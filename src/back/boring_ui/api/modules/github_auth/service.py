"""GitHub App service — JWT generation, OAuth, installation tokens."""
import time
import threading
from dataclasses import dataclass

import jwt
import httpx

from ...config import APIConfig


@dataclass(frozen=True)
class InstallationToken:
    """Cached installation access token."""
    token: str
    expires_at: float  # epoch seconds


class GitHubAppService:
    """Manages GitHub App authentication and installation tokens.

    Lifecycle:
      1. App private key (permanent, from config) signs short-lived JWTs
      2. JWTs are exchanged for installation tokens (1 hour)
      3. Installation tokens are used as git credentials
    """

    GITHUB_API = 'https://api.github.com'

    def __init__(self, config: APIConfig):
        self.app_id = config.github_app_id
        self.client_id = config.github_app_client_id
        self.client_secret = config.github_app_client_secret
        self.private_key = config.github_app_private_key
        self._slug = config.github_app_slug
        self._token_cache: dict[int, InstallationToken] = {}
        self._lock = threading.Lock()

    @property
    def is_configured(self) -> bool:
        return bool(self.app_id and self.private_key)

    # ── JWT ───────────────────────────────────────────────────────────

    def _make_jwt(self) -> str:
        """Create a short-lived JWT signed with the app's private key."""
        now = int(time.time())
        payload = {
            'iat': now - 60,
            'exp': now + (10 * 60),
            'iss': str(self.app_id),
        }
        return jwt.encode(payload, self.private_key, algorithm='RS256')

    # ── OAuth flow ────────────────────────────────────────────────────

    def get_authorize_url(self, redirect_uri: str, state: str) -> str:
        """Build the GitHub App installation URL.

        Uses the installation flow — user installs the app on their account/org
        and grants repo access. No OAuth "Act on your behalf" permission needed.
        GitHub redirects to the Setup URL with installation_id and state.
        """
        slug = getattr(self, '_slug', None)
        if slug:
            return (
                f'https://github.com/apps/{slug}/installations/new'
                f'?state={state}'
            )
        # Fallback to OAuth if slug not configured
        if self.client_id:
            return (
                f'https://github.com/login/oauth/authorize'
                f'?client_id={self.client_id}'
                f'&redirect_uri={redirect_uri}'
                f'&state={state}'
            )
        raise ValueError('Neither app slug nor client_id configured')

    def exchange_code(self, code: str) -> dict:
        """Exchange an OAuth code for a user access token.

        Returns:
            dict with access_token, token_type, scope
        """
        resp = httpx.post(
            'https://github.com/login/oauth/access_token',
            json={
                'client_id': self.client_id,
                'client_secret': self.client_secret,
                'code': code,
            },
            headers={'Accept': 'application/json'},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        if 'error' in data:
            raise ValueError(f'GitHub OAuth error: {data["error_description"]}')
        return data

    def get_user_info(self, access_token: str) -> dict:
        """Fetch GitHub user info using an access token."""
        resp = httpx.get(
            f'{self.GITHUB_API}/user',
            headers={
                'Authorization': f'Bearer {access_token}',
                'Accept': 'application/vnd.github+json',
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    # ── Installations ─────────────────────────────────────────────────

    def list_installations(self) -> list[dict]:
        """List all installations of this app."""
        app_jwt = self._make_jwt()
        resp = httpx.get(
            f'{self.GITHUB_API}/app/installations',
            headers={
                'Authorization': f'Bearer {app_jwt}',
                'Accept': 'application/vnd.github+json',
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    def get_user_installations(self, access_token: str) -> list[dict]:
        """List installations accessible to a user."""
        resp = httpx.get(
            f'{self.GITHUB_API}/user/installations',
            headers={
                'Authorization': f'Bearer {access_token}',
                'Accept': 'application/vnd.github+json',
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get('installations', [])

    def get_installation_token(self, installation_id: int) -> str:
        """Get a fresh installation token (cached, auto-refreshed).

        Returns:
            Installation access token string (valid ~1 hour)
        """
        with self._lock:
            cached = self._token_cache.get(installation_id)
            if cached and cached.expires_at > time.time() + 300:
                return cached.token

        app_jwt = self._make_jwt()
        resp = httpx.post(
            f'{self.GITHUB_API}/app/installations/{installation_id}/access_tokens',
            headers={
                'Authorization': f'Bearer {app_jwt}',
                'Accept': 'application/vnd.github+json',
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        token = data['token']
        # Parse ISO 8601 expiry to epoch
        from datetime import datetime, timezone
        expires_at = datetime.fromisoformat(
            data['expires_at'].replace('Z', '+00:00')
        ).timestamp()

        with self._lock:
            self._token_cache[installation_id] = InstallationToken(
                token=token, expires_at=expires_at,
            )

        return token

    def get_git_credentials(self, installation_id: int) -> dict:
        """Get git credentials for an installation.

        Returns:
            dict with username and password for git operations
        """
        token = self.get_installation_token(installation_id)
        return {
            'username': 'x-access-token',
            'password': token,
        }

    def list_repos(self, installation_id: int) -> list[dict]:
        """List repos accessible to an installation."""
        token = self.get_installation_token(installation_id)
        resp = httpx.get(
            f'{self.GITHUB_API}/installation/repositories',
            headers={
                'Authorization': f'Bearer {token}',
                'Accept': 'application/vnd.github+json',
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get('repositories', [])

    def create_repo(self, installation_id: int, name: str,
                    *, private: bool = True, description: str = '') -> dict:
        """Create a repository using an installation token.

        Args:
            installation_id: GitHub App installation ID.
            name: Repository name (e.g., 'boring-ws-abc123').
            private: Whether the repo is private (default: True).
            description: Optional repo description.

        Returns:
            dict with full_name, clone_url, html_url, etc.
        """
        token = self.get_installation_token(installation_id)

        # Determine the owner (org or user) from the installation
        app_jwt = self._make_jwt()
        install_resp = httpx.get(
            f'{self.GITHUB_API}/app/installations/{installation_id}',
            headers={
                'Authorization': f'Bearer {app_jwt}',
                'Accept': 'application/vnd.github+json',
            },
            timeout=15,
        )
        install_resp.raise_for_status()
        install_data = install_resp.json()
        account_type = install_data['account']['type']
        account_login = install_data['account']['login']

        # Create repo under org or user
        if account_type == 'Organization':
            url = f'{self.GITHUB_API}/orgs/{account_login}/repos'
        else:
            url = f'{self.GITHUB_API}/user/repos'

        resp = httpx.post(
            url,
            json={
                'name': name,
                'private': private,
                'description': description,
                'auto_init': True,  # Create with README so it's not empty
            },
            headers={
                'Authorization': f'Bearer {token}',
                'Accept': 'application/vnd.github+json',
            },
            timeout=30,
        )
        resp.raise_for_status()
        repo = resp.json()
        return {
            'full_name': repo['full_name'],
            'clone_url': repo['clone_url'],
            'html_url': repo['html_url'],
            'private': repo['private'],
        }

    def get_first_installation_id(self) -> int | None:
        """Get the first installation ID (for single-org setups)."""
        installations = self.list_installations()
        if installations:
            return installations[0]['id']
        return None

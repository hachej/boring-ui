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
        """Build the GitHub OAuth authorization URL."""
        return (
            f'https://github.com/login/oauth/authorize'
            f'?client_id={self.client_id}'
            f'&redirect_uri={redirect_uri}'
            f'&state={state}'
        )

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

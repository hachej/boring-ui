"""Session cookie: signed JWT issuance and parsing.

The ``boring_session`` cookie contains an HS256-signed JWT with user identity.
It is issued by the auth callback and validated by the session middleware on
every request.

Cookie format is a standard JWT (3-part ``header.payload.signature``) so that
both the control plane (issuer) and workspace VMs (via Fly replay) can share
the same secret and interoperate without a shared library dependency.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass

import jwt as pyjwt

_ALGORITHM = "HS256"
_CLOCK_SKEW_LEEWAY = 30  # seconds
_COOKIE_NAME = "boring_session"
_APP_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")

COOKIE_NAME = _COOKIE_NAME


def app_cookie_name(app_id: str | None) -> str:
    """Return the app-scoped session cookie name."""
    if app_id:
        if not _APP_ID_RE.fullmatch(app_id):
            raise ValueError(f"Invalid app_id for cookie name: {app_id!r}")
        return f"{_COOKIE_NAME}_{app_id}"
    return _COOKIE_NAME


@dataclass(frozen=True)
class SessionPayload:
    user_id: str
    email: str
    exp: int
    app_id: str | None = None


class SessionError(Exception):
    """Base class for session parsing issues."""


class SessionExpired(SessionError):
    """The session token is expired."""


class SessionInvalid(SessionError):
    """The session token is malformed or fails signature validation."""


def create_session_cookie(
    user_id: str,
    email: str,
    *,
    secret: str,
    ttl_seconds: int,
    app_id: str | None = None,
) -> str:
    """Create a signed HS256 JWT for the session cookie."""
    now = int(time.time())
    payload: dict = {
        "sub": str(user_id),
        "email": str(email).strip().lower(),
        "iat": now,
        "exp": now + int(ttl_seconds),
    }
    if app_id:
        payload["app_id"] = app_id
    return pyjwt.encode(payload, secret, algorithm=_ALGORITHM)


def parse_session_cookie(
    token: str,
    *,
    secret: str,
) -> SessionPayload:
    """Decode and validate a session cookie JWT.

    Raises:
        SessionExpired: If the token has expired.
        SessionInvalid: If the token is malformed or signature is bad.
    """
    if not token:
        raise SessionInvalid("Empty session token")
    try:
        data = pyjwt.decode(
            token,
            secret,
            algorithms=[_ALGORITHM],
            leeway=_CLOCK_SKEW_LEEWAY,
            options={"require": ["sub", "email", "exp"]},
        )
    except pyjwt.ExpiredSignatureError as exc:
        raise SessionExpired("Session has expired") from exc
    except pyjwt.InvalidTokenError as exc:
        raise SessionInvalid(f"Invalid session token: {exc}") from exc

    return SessionPayload(
        user_id=data["sub"],
        email=data["email"],
        exp=data["exp"],
        app_id=data.get("app_id"),
    )

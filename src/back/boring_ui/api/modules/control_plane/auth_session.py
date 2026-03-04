"""Session cookie helpers for control-plane auth endpoints."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import time
from dataclasses import dataclass


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode((raw + padding).encode("ascii"))


@dataclass(frozen=True)
class SessionPayload:
    user_id: str
    email: str
    exp: int


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
) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "email": str(email).strip().lower(),
        "exp": now + int(ttl_seconds),
    }
    payload_part = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = hmac.new(secret.encode("utf-8"), payload_part.encode("ascii"), hashlib.sha256).digest()
    signature_part = _b64url_encode(signature)
    return f"{payload_part}.{signature_part}"


def parse_session_cookie(token: str, *, secret: str) -> SessionPayload:
    if not token or "." not in token:
        raise SessionInvalid("Malformed session token")
    payload_part, signature_part = token.split(".", 1)
    expected_sig = hmac.new(secret.encode("utf-8"), payload_part.encode("ascii"), hashlib.sha256).digest()
    try:
        actual_sig = _b64url_decode(signature_part)
    except (binascii.Error, ValueError) as exc:
        raise SessionInvalid("Malformed session signature") from exc
    if not hmac.compare_digest(expected_sig, actual_sig):
        raise SessionInvalid("Invalid session signature")

    try:
        payload = json.loads(_b64url_decode(payload_part).decode("utf-8"))
    except (binascii.Error, json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
        raise SessionInvalid("Malformed session payload") from exc

    user_id = str(payload.get("sub", "")).strip()
    email = str(payload.get("email", "")).strip().lower()
    exp = payload.get("exp")
    if not user_id or not email or not isinstance(exp, int):
        raise SessionInvalid("Missing required session fields")
    if int(time.time()) >= exp:
        raise SessionExpired("Session has expired")

    return SessionPayload(user_id=user_id, email=email, exp=exp)

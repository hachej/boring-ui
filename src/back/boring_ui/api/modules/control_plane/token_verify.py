"""Hosted auth JWT verification: JWKS (RS256) with HS256 fallback."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any

import jwt as pyjwt
from jwt import PyJWKClient

_JWKS_CACHE_TTL = 3600
_CLOCK_SKEW_LEEWAY = 30


@dataclass(frozen=True)
class TokenPayload:
    user_id: str
    email: str
    exp: int
    iss: str
    raw_claims: dict[str, Any] = field(repr=False)


class TokenError(Exception):
    """Base class for token verification errors."""


class TokenExpired(TokenError):
    """The JWT has expired."""


class TokenInvalid(TokenError):
    """The JWT is invalid."""


class _JWKSCache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._clients: dict[str, tuple[PyJWKClient, float]] = {}

    def get_client(self, jwks_url: str) -> PyJWKClient:
        now = time.monotonic()
        with self._lock:
            entry = self._clients.get(jwks_url)
            if entry and (now - entry[1]) < _JWKS_CACHE_TTL:
                return entry[0]
            client = PyJWKClient(jwks_url, cache_keys=True)
            self._clients[jwks_url] = (client, now)
            return client


_jwks_cache = _JWKSCache()


def verify_token(
    token: str,
    *,
    issuer_base_url: str,
    jwt_secret: str | None = None,
    audience: str | None = None,
    jwks_url: str | None = None,
) -> TokenPayload:
    """Verify a JWT using JWKS (RS256/ES256/EdDSA) or HS256 fallback.

    Args:
        token: The JWT to verify.
        issuer_base_url: Base URL used to derive the default JWKS endpoint.
        jwt_secret: Optional HS256 shared secret for fallback.
        audience: Expected ``aud`` claim (e.g. ``"authenticated"``).
        jwks_url: Explicit JWKS URL override. When provided, JWKS-based
            algorithms use this URL instead of deriving one via the base URL.
    """
    try:
        header = pyjwt.get_unverified_header(token)
    except pyjwt.InvalidTokenError as exc:
        raise TokenInvalid(f"Cannot decode JWT header: {exc}") from exc

    alg = header.get("alg", "")

    if alg in ("RS256", "ES256", "EdDSA"):
        return _verify_jwks(
            token,
            alg=alg,
            issuer_base_url=issuer_base_url,
            audience=audience,
            jwks_url_override=jwks_url,
        )
    if alg == "HS256":
        if not jwt_secret:
            raise TokenInvalid("HS256 token received but no JWT secret configured for fallback")
        return _verify_hs256(
            token,
            secret=jwt_secret,
            issuer_base_url=issuer_base_url,
            audience=audience,
        )
    raise TokenInvalid(f"Unsupported JWT algorithm: {alg}")


def _verify_jwks(
    token: str,
    *,
    alg: str,
    issuer_base_url: str,
    audience: str | None,
    jwks_url_override: str | None = None,
) -> TokenPayload:
    jwks_url = jwks_url_override or f"{issuer_base_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    client = _jwks_cache.get_client(jwks_url)

    try:
        signing_key = client.get_signing_key_from_jwt(token)
    except (pyjwt.PyJWKClientError, pyjwt.InvalidTokenError) as exc:
        raise TokenInvalid(f"JWKS key lookup failed: {exc}") from exc

    decode_opts: dict[str, Any] = {
        "algorithms": [alg],
        "leeway": _CLOCK_SKEW_LEEWAY,
        "options": {"require": ["sub", "exp"]},
    }
    if audience:
        decode_opts["audience"] = audience

    return _decode(token, signing_key.key, **decode_opts)


def _verify_hs256(
    token: str,
    *,
    secret: str,
    issuer_base_url: str,
    audience: str | None,
) -> TokenPayload:
    _ = issuer_base_url
    decode_opts: dict[str, Any] = {
        "algorithms": ["HS256"],
        "leeway": _CLOCK_SKEW_LEEWAY,
        "options": {"require": ["sub", "exp"]},
    }
    if audience:
        decode_opts["audience"] = audience

    return _decode(token, secret, **decode_opts)


def _decode(token: str, key: Any, **kwargs: Any) -> TokenPayload:
    try:
        data = pyjwt.decode(token, key, **kwargs)
    except pyjwt.ExpiredSignatureError as exc:
        raise TokenExpired("JWT has expired") from exc
    except pyjwt.InvalidTokenError as exc:
        raise TokenInvalid(f"JWT verification failed: {exc}") from exc

    return TokenPayload(
        user_id=data["sub"],
        email=data.get("email", ""),
        exp=data["exp"],
        iss=data.get("iss", ""),
        raw_claims=data,
    )

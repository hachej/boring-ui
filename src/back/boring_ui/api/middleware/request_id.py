"""Request ID helpers for HTTP and WebSocket flows."""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any

REQUEST_ID_HEADER = "X-Request-ID"
_REQUEST_ID_HEADER_LOWER = REQUEST_ID_HEADER.lower()


def _normalize_request_id(value: str | None) -> str:
    candidate = str(value or "").strip()
    return candidate or str(uuid.uuid4())


def _header_value(headers: Any, name: str) -> str | None:
    if headers is None:
        return None
    getter = getattr(headers, "get", None)
    if callable(getter):
        return getter(name) or getter(name.lower())
    if isinstance(headers, Mapping):
        return headers.get(name) or headers.get(name.lower())
    return None


def ensure_request_id(connection: Any) -> str:
    """Read or assign a stable request ID on a Request/WebSocket-like object."""

    state = getattr(connection, "state", None)
    if state is not None:
        current = str(getattr(state, "request_id", "") or "").strip()
        if current:
            return current

    request_id = _normalize_request_id(_header_value(getattr(connection, "headers", None), REQUEST_ID_HEADER))
    if state is not None:
        setattr(state, "request_id", request_id)
    return request_id


def request_id_header_pair(request_id: str) -> tuple[bytes, bytes]:
    """Return a raw header pair for WebSocket accept/send hooks."""

    return (_REQUEST_ID_HEADER_LOWER.encode("latin-1"), request_id.encode("utf-8"))


class RequestIDMiddleware:
    """Assign a request ID to every HTTP request and echo it in the response."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1"): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        request_id = _normalize_request_id(headers.get(_REQUEST_ID_HEADER_LOWER))
        scope.setdefault("state", {})["request_id"] = request_id

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                raw_headers = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.decode("latin-1").lower() != _REQUEST_ID_HEADER_LOWER
                ]
                raw_headers.append(request_id_header_pair(request_id))
                message["headers"] = raw_headers
            await send(message)

        await self.app(scope, receive, send_wrapper)

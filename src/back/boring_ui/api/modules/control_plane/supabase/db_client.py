"""AsyncPG client helpers for Supabase-backed control-plane."""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import threading
import weakref
from contextvars import ContextVar
from typing import Optional, TYPE_CHECKING
from urllib.parse import parse_qs, urlparse

if TYPE_CHECKING:
    import asyncpg

try:
    import asyncpg  # type: ignore[assignment]
except ModuleNotFoundError:  # pragma: no cover - optional local env dependency
    asyncpg = None  # type: ignore[assignment]

_pool: Optional[asyncpg.Pool] = None
_pools_by_url: dict[str, asyncpg.Pool] = {}
_current_pool: ContextVar[Optional[asyncpg.Pool]] = ContextVar("control_plane_db_pool", default=None)
_pool_locks: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock]" = (
    weakref.WeakKeyDictionary()
)
_pool_lock_guard = threading.Lock()
_logger = logging.getLogger(__name__)


def _get_pool_lock() -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    with _pool_lock_guard:
        lock = _pool_locks.get(loop)
        if lock is None:
            lock = asyncio.Lock()
            _pool_locks[loop] = lock
        return lock


def _ensure_asyncpg() -> None:
    if asyncpg is None:
        raise RuntimeError("asyncpg is required for Supabase DB pooling. Install project dependencies.")


def _uses_pgbouncer_pooling(db_url: str) -> bool:
    parsed = urlparse(db_url)
    host = (parsed.hostname or "").lower()
    if host.endswith(".pooler.supabase.com"):
        return True

    query = parse_qs(parsed.query)
    values = [v.lower() for v in query.get("pgbouncer", [])]
    return any(v in {"1", "true", "yes", "on"} for v in values)


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def _resolve_ipv4_hosts(host: str, port: int) -> list[str]:
    if _is_ip_literal(host):
        return [host]
    try:
        infos = socket.getaddrinfo(
            host,
            port,
            family=socket.AF_INET,
            type=socket.SOCK_STREAM,
        )
    except OSError:
        return []

    seen: set[str] = set()
    resolved: list[str] = []
    for info in infos:
        addr = info[4][0]
        if addr in seen:
            continue
        seen.add(addr)
        resolved.append(addr)
    return resolved


def _pool_kwargs(db_url: str) -> dict[str, object]:
    parsed = urlparse(db_url)
    kwargs: dict[str, object] = {"server_settings": {"application_name": "boring-ui"}}
    if _uses_pgbouncer_pooling(db_url):
        kwargs["statement_cache_size"] = 0
    if parsed.hostname:
        port = parsed.port or 5432
        resolved_hosts = _resolve_ipv4_hosts(parsed.hostname, port)
        if resolved_hosts:
            kwargs["host"] = resolved_hosts
            kwargs["port"] = port
            _logger.info(
                "Using IPv4 override for Supabase host %s (%d addresses)",
                parsed.hostname,
                len(resolved_hosts),
            )
    return kwargs


async def create_pool(
    db_url: str,
    *,
    min_size: int = 2,
    max_size: int = 10,
    command_timeout: int = 30,
) -> "asyncpg.Pool":
    global _pool
    _ensure_asyncpg()
    if _pool is not None:
        await _pool.close()
    _pool = await asyncpg.create_pool(
        dsn=db_url,
        min_size=min_size,
        max_size=max_size,
        command_timeout=command_timeout,
        **_pool_kwargs(db_url),
    )
    _pools_by_url[db_url] = _pool
    return _pool


async def get_or_create_pool(
    db_url: str,
    *,
    min_size: int = 2,
    max_size: int = 10,
    command_timeout: int = 30,
) -> "asyncpg.Pool":
    _ensure_asyncpg()
    async with _get_pool_lock():
        pool = _pools_by_url.get(db_url)
        if pool is not None:
            return pool
        pool = await asyncpg.create_pool(
            dsn=db_url,
            min_size=min_size,
            max_size=max_size,
            command_timeout=command_timeout,
            **_pool_kwargs(db_url),
        )
        _pools_by_url[db_url] = pool
        return pool


def set_current_pool(pool: Optional["asyncpg.Pool"]):
    return _current_pool.set(pool)


def reset_current_pool(token) -> None:
    _current_pool.reset(token)


def get_pool() -> "asyncpg.Pool":
    current = _current_pool.get()
    if current is not None:
        return current
    if _pool is None:
        raise RuntimeError("DB pool is not initialized; call create_pool() first.")
    return _pool


def get_pool_or_none() -> "Optional[asyncpg.Pool]":
    current = _current_pool.get()
    if current is not None:
        return current
    return _pool


async def close_pool() -> None:
    global _pool
    pools = []
    if _pool is not None:
        pools.append(_pool)
    for pool in _pools_by_url.values():
        if pool not in pools:
            pools.append(pool)
    for pool in pools:
        await pool.close()
    _pool = None
    _pools_by_url.clear()

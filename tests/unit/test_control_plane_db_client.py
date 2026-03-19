from __future__ import annotations

import socket
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest

from boring_ui.api.modules.control_plane import db_client


def test_pool_kwargs_keeps_pooler_hostname_for_sni(monkeypatch) -> None:
    def _fake_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        assert host == "db.pooler.example.internal"
        assert port == 5432
        assert family == socket.AF_INET
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("52.1.2.3", 5432)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("52.1.2.3", 5432)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("52.4.5.6", 5432)),
        ]

    monkeypatch.setattr(db_client.socket, "getaddrinfo", _fake_getaddrinfo)

    kwargs = db_client._pool_kwargs(
        "postgresql://postgres.ref:pw@db.pooler.example.internal:5432/postgres"
    )

    assert kwargs["statement_cache_size"] == 0
    assert "host" not in kwargs
    assert "port" not in kwargs


def test_pool_kwargs_resolves_non_pooler_host_to_ipv4(monkeypatch) -> None:
    def _fake_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        assert host == "db.example.internal"
        assert port == 5432
        assert family == socket.AF_INET
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("52.1.2.3", 5432)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("52.1.2.3", 5432)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("52.4.5.6", 5432)),
        ]

    monkeypatch.setattr(db_client.socket, "getaddrinfo", _fake_getaddrinfo)

    kwargs = db_client._pool_kwargs("postgresql://postgres.ref:pw@db.example.internal:5432/postgres")

    assert kwargs["host"] == ["52.1.2.3", "52.4.5.6"]
    assert kwargs["port"] == 5432


def test_pool_kwargs_keeps_base_config_when_ipv4_lookup_fails(monkeypatch) -> None:
    def _raise_gaierror(*_args, **_kwargs):
        raise socket.gaierror("lookup failed")

    monkeypatch.setattr(db_client.socket, "getaddrinfo", _raise_gaierror)

    kwargs = db_client._pool_kwargs(
        "postgresql://postgres.ref:pw@db.pooler.example.internal:5432/postgres"
    )

    assert kwargs["statement_cache_size"] == 0
    assert "host" not in kwargs
    assert "port" not in kwargs


def test_normalize_neon_dsn_adds_missing_endpoint_option() -> None:
    dsn = (
        "postgresql://postgres.ref:pw@ep-solitary-darkness-ag6rrvrn."
        "c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require"
    )

    normalized = db_client._normalize_neon_dsn(dsn)
    parsed = urlparse(normalized)
    query = parse_qs(parsed.query)

    assert query["sslmode"] == ["require"]
    assert query["options"] == ["endpoint=ep-solitary-darkness-ag6rrvrn"]


def test_normalize_neon_dsn_leaves_pooler_url_unchanged() -> None:
    dsn = (
        "postgresql://postgres.ref:pw@ep-solitary-darkness-ag6rrvrn-pooler."
        "c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require"
    )

    assert db_client._normalize_neon_dsn(dsn) == dsn


class _FakePool:
    def __init__(self, *, closed: bool = False) -> None:
        self._closed = closed
        self.close_calls = 0

    def is_closing(self) -> bool:
        return self._closed

    async def close(self) -> None:
        self.close_calls += 1
        self._closed = True


@pytest.mark.asyncio
async def test_get_or_create_pool_recreates_closed_cached_pool(monkeypatch) -> None:
    created: list[_FakePool] = []

    async def _fake_create_pool(*_args, **_kwargs):
        pool = _FakePool()
        created.append(pool)
        return pool

    dsn = "postgresql://postgres.ref:pw@db.example.internal:5432/postgres"
    closed_pool = _FakePool(closed=True)
    monkeypatch.setattr(db_client, "asyncpg", SimpleNamespace(create_pool=_fake_create_pool))
    monkeypatch.setattr(db_client, "_pools_by_url", {dsn: closed_pool})
    monkeypatch.setattr(db_client, "_pool", None)

    pool = await db_client.get_or_create_pool(dsn)

    assert pool is created[0]
    assert db_client._pools_by_url[dsn] is pool
    assert closed_pool.close_calls == 0


@pytest.mark.asyncio
async def test_create_pool_evicts_previous_pool_cache_on_url_switch(monkeypatch) -> None:
    created: list[_FakePool] = []

    async def _fake_create_pool(*_args, **_kwargs):
        pool = _FakePool()
        created.append(pool)
        return pool

    old_dsn = "postgresql://postgres.ref:pw@old.example.internal:5432/postgres"
    new_dsn = "postgresql://postgres.ref:pw@new.example.internal:5432/postgres"
    old_pool = _FakePool()
    monkeypatch.setattr(db_client, "asyncpg", SimpleNamespace(create_pool=_fake_create_pool))
    monkeypatch.setattr(db_client, "_pool", old_pool)
    monkeypatch.setattr(db_client, "_pools_by_url", {old_dsn: old_pool})

    pool = await db_client.create_pool(new_dsn)

    assert old_dsn not in db_client._pools_by_url
    assert db_client._pools_by_url[new_dsn] is pool
    assert old_pool.close_calls == 1

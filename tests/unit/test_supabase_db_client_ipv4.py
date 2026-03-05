from __future__ import annotations

import socket

from boring_ui.api.modules.control_plane.supabase import db_client


def test_pool_kwargs_resolves_pooler_host_to_ipv4(monkeypatch) -> None:
    def _fake_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        assert host == "aws-1-eu-west-1.pooler.supabase.com"
        assert port == 5432
        assert family == socket.AF_INET
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("52.1.2.3", 5432)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("52.1.2.3", 5432)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("52.4.5.6", 5432)),
        ]

    monkeypatch.setattr(db_client.socket, "getaddrinfo", _fake_getaddrinfo)

    kwargs = db_client._pool_kwargs(
        "postgresql://postgres.ref:pw@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"
    )

    assert kwargs["statement_cache_size"] == 0
    assert kwargs["host"] == ["52.1.2.3", "52.4.5.6"]
    assert kwargs["port"] == 5432


def test_pool_kwargs_keeps_base_config_when_ipv4_lookup_fails(monkeypatch) -> None:
    def _raise_gaierror(*_args, **_kwargs):
        raise socket.gaierror("lookup failed")

    monkeypatch.setattr(db_client.socket, "getaddrinfo", _raise_gaierror)

    kwargs = db_client._pool_kwargs(
        "postgresql://postgres.ref:pw@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"
    )

    assert kwargs["statement_cache_size"] == 0
    assert "host" not in kwargs
    assert "port" not in kwargs

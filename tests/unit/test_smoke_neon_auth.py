from __future__ import annotations

from argparse import Namespace

from tests.smoke import smoke_neon_auth


def test_resolve_public_origin_uses_environment_fallback(monkeypatch) -> None:
    monkeypatch.setenv("BORING_UI_PUBLIC_ORIGIN", "https://frontend.example.com/")
    args = Namespace(
        public_origin="",
        base_url="http://127.0.0.1:8010/",
    )

    assert smoke_neon_auth._resolve_public_origin(args) == "https://frontend.example.com"


def test_resolve_public_origin_prefers_explicit_flag_over_environment(monkeypatch) -> None:
    monkeypatch.setenv("BORING_UI_PUBLIC_ORIGIN", "https://frontend.example.com")
    args = Namespace(
        public_origin="https://cli.example.com/",
        base_url="http://127.0.0.1:8010/",
    )

    assert smoke_neon_auth._resolve_public_origin(args) == "https://cli.example.com"

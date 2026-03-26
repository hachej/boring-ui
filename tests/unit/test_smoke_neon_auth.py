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


def test_forged_session_cookie_uses_smoke_client_cookie_dict(monkeypatch) -> None:
    class _FakeResponse:
        status_code = 401

        def json(self) -> dict[str, str]:
            return {"code": "SESSION_INVALID"}

    class _FakeClient:
        instances: list["_FakeClient"] = []

        def __init__(self, base_url: str):
            self.base_url = base_url
            self.cookies: dict[str, str] = {}
            self.results: list[object] = []
            self.phase = ""
            _FakeClient.instances.append(self)

        def set_phase(self, phase: str) -> None:
            self.phase = phase

        def get(self, path: str, expect_status: tuple[int, ...] | None = None) -> _FakeResponse:
            assert path == "/auth/session"
            assert expect_status == (401,)
            assert self.cookies["boring_session"].endswith(".fake")
            self.results.append({"phase": self.phase, "path": path})
            return _FakeResponse()

    monkeypatch.setattr(smoke_neon_auth, "SmokeClient", _FakeClient)
    main_client = _FakeClient("https://example.test")

    smoke_neon_auth.test_forged_session_cookie(main_client)

    assert len(_FakeClient.instances) == 2
    assert main_client.results == [{"phase": "forged-cookie", "path": "/auth/session"}]

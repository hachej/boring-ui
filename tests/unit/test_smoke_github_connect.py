from __future__ import annotations

import httpx

from tests.smoke import smoke_github_connect as github_connect_module
from tests.smoke.smoke_lib import git as git_module


def _response(
    status_code: int,
    payload: dict | None = None,
    *,
    url: str = "https://example.test/api/v1/github/status",
) -> httpx.Response:
    kwargs = {"request": httpx.Request("GET", url)}
    if payload is None:
        return httpx.Response(status_code, **kwargs)
    return httpx.Response(status_code, json=payload, **kwargs)


class _DummyClient:
    def __init__(self, responses: list[httpx.Response] | None = None) -> None:
        self.base_url = "https://example.test"
        self._responses = list(responses or [])
        self.calls: list[tuple[str, dict]] = []
        self.records: list[dict] = []
        self.phase = "init"

    def set_phase(self, phase: str) -> None:
        self.phase = phase

    def get(self, path: str, **kwargs) -> httpx.Response:
        self.calls.append((path, kwargs))
        return self._responses.pop(0)

    def _record(self, method, path, resp, ok, elapsed_ms, detail="", **kwargs) -> None:
        self.records.append({
            "method": method,
            "path": path,
            "status": resp.status_code,
            "ok": ok,
            "elapsed_ms": elapsed_ms,
            "detail": detail,
            **kwargs,
        })


def test_phase_github_status_prefers_current_ts_route() -> None:
    client = _DummyClient([
        _response(200, {"ok": True, "configured": True, "app_slug": "boring-ui-app"}),
    ])

    route_info = github_connect_module.phase_github_status(client, workspace_id="ws-123")

    assert route_info["route_base"] == github_connect_module.CURRENT_GITHUB_ROUTE_BASE
    assert route_info["surface"] == "ts-minimal"
    assert route_info["status"]["configured"] is True
    assert client.calls == [
        (
            "/api/v1/github/status",
            {"expect_status": (200, 401, 404, 503)},
        ),
    ]


def test_phase_github_status_falls_back_to_legacy_route_with_workspace_scope() -> None:
    client = _DummyClient([
        _response(404),
        _response(
            200,
            {"configured": True, "connected": False},
            url="https://example.test/api/v1/auth/github/status",
        ),
    ])

    route_info = github_connect_module.phase_github_status(client, workspace_id="ws-legacy")

    assert route_info["route_base"] == github_connect_module.LEGACY_GITHUB_ROUTE_BASE
    assert route_info["surface"] == "legacy-parity"
    assert client.calls == [
        (
            "/api/v1/github/status",
            {"expect_status": (200, 401, 404, 503)},
        ),
        (
            "/api/v1/auth/github/status",
            {
                "params": {"workspace_id": "ws-legacy"},
                "expect_status": (200, 401, 503),
            },
        ),
    ]


def test_phase_require_full_lifecycle_surface_records_explicit_blocker() -> None:
    client = _DummyClient()

    ok = github_connect_module.phase_require_full_lifecycle_surface(client, {
        "surface": "ts-minimal",
        "route_base": github_connect_module.CURRENT_GITHUB_ROUTE_BASE,
    })

    assert ok is False
    assert len(client.records) == 1
    record = client.records[0]
    assert record["ok"] is False
    assert "missing connect/repos/git-credentials" in record["detail"]
    assert record["path"] == "/api/v1/github/status [lifecycle-parity]"


def test_phase_verify_connected_passes_workspace_scope_for_current_ts_route() -> None:
    client = _DummyClient([
        _response(
            200,
            {"configured": True, "connected": True, "installation_id": 42},
            url="https://example.test/api/v1/github/status",
        ),
    ])

    github_connect_module.phase_verify_connected(
        client,
        github_connect_module.CURRENT_GITHUB_ROUTE_BASE,
        "ws-current",
        42,
    )

    assert client.calls == [
        (
            "/api/v1/github/status",
            {
                "params": {"workspace_id": "ws-current"},
                "expect_status": (200,),
            },
        ),
    ]


def test_resolve_auth_mode_uses_capabilities_provider() -> None:
    assert github_connect_module._resolve_auth_mode("auto", {"auth": {"provider": "neon"}}) == "neon"
    assert github_connect_module._resolve_auth_mode("auto", {"auth": {"provider": "local"}}) == "dev"
    assert github_connect_module._resolve_auth_mode("dev", {"auth": {"provider": "neon"}}) == "dev"


def test_select_installation_prefers_expected_repo_owner() -> None:
    installations = [
        {"id": 1, "account": "hachej"},
        {"id": 2, "account": "boringdata"},
    ]

    selected = github_connect_module._select_installation(
        installations,
        requested_installation_id=None,
        expected_repo="boringdata/boring-ui-repo",
    )

    assert selected["id"] == 2


def test_select_installation_honors_requested_id() -> None:
    installations = [
        {"id": 1, "account": "hachej"},
        {"id": 2, "account": "boringdata"},
    ]

    selected = github_connect_module._select_installation(
        installations,
        requested_installation_id=1,
        expected_repo="boringdata/boring-ui-repo",
    )

    assert selected["id"] == 1


def test_smoke_git_helper_prefers_current_github_route() -> None:
    client = _DummyClient([
        _response(200, {"ok": True, "configured": True, "app_slug": "boring-ui-app"}),
    ])

    data = git_module.github_status(client, workspace_id="ws-123")

    assert data["configured"] is True
    assert client.calls == [
        (
            "/api/v1/github/status",
            {"expect_status": (200, 401, 404, 503)},
        ),
    ]


def test_smoke_git_helper_falls_back_to_legacy_route() -> None:
    client = _DummyClient([
        _response(404),
        _response(
            200,
            {"configured": True, "connected": True},
            url="https://example.test/api/v1/auth/github/status",
        ),
    ])

    data = git_module.github_status(client, workspace_id="ws-legacy")

    assert data["connected"] is True
    assert client.calls == [
        (
            "/api/v1/github/status",
            {"expect_status": (200, 401, 404, 503)},
        ),
        (
            "/api/v1/auth/github/status",
            {
                "params": {"workspace_id": "ws-legacy"},
                "expect_status": (200, 401, 503),
            },
        ),
    ]

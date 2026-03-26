from __future__ import annotations

import httpx

from tests.smoke.smoke_lib.client import SmokeClient


def test_smoke_client_report_redacts_sensitive_headers_and_json_fields(monkeypatch) -> None:
    response = httpx.Response(
        200,
        json={"ok": True},
        headers={"set-cookie": "boring_session=secret-token"},
        request=httpx.Request(
            "POST",
            "https://example.test/auth/token-exchange",
            headers={"Authorization": "Bearer secret", "Cookie": "boring_session=secret-token"},
            content=b'{"access_token":"secret-token","password":"hunter2"}',
        ),
    )

    def fake_request(self, method, path, **kwargs):
        return response

    monkeypatch.setattr(httpx.Client, "request", fake_request)

    client = SmokeClient("https://example.test", capture_details=True)
    client.post(
        "/auth/token-exchange",
        json={"access_token": "secret-token", "password": "hunter2"},
        expect_status=(200,),
    )

    report = client.report()
    step = report["steps"][0]
    assert step["request_headers"]["authorization"] == "<redacted>"
    assert step["request_headers"]["cookie"] == "<redacted>"
    assert step["response_headers"]["set-cookie"] == "<redacted>"
    assert step["request_body"] == {
        "access_token": "<redacted>",
        "password": "<redacted>",
    }


def test_smoke_client_report_includes_response_size_and_body_when_capture_enabled(monkeypatch) -> None:
    response = httpx.Response(
        400,
        text="bad request",
        request=httpx.Request("GET", "https://example.test/health"),
    )

    def fake_request(self, method, path, **kwargs):
        return response

    monkeypatch.setattr(httpx.Client, "request", fake_request)

    client = SmokeClient("https://example.test", capture_details=True)
    client.get("/health", expect_status=(200,))

    report = client.report()
    step = report["steps"][0]
    assert step["response_size"] == len(b"bad request")
    assert step["response_body"] == "bad request"


def test_smoke_client_omits_verbose_http_details_on_success_when_capture_disabled(monkeypatch) -> None:
    response = httpx.Response(
        200,
        json={"ok": True},
        headers={"set-cookie": "boring_session=secret-token"},
        request=httpx.Request(
            "POST",
            "https://example.test/auth/token-exchange",
            headers={"Authorization": "Bearer secret"},
        ),
    )

    def fake_request(self, method, path, **kwargs):
        return response

    monkeypatch.setattr(httpx.Client, "request", fake_request)

    client = SmokeClient("https://example.test")
    client.post("/auth/token-exchange", json={"access_token": "secret-token"}, expect_status=(200,))

    report = client.report()
    step = report["steps"][0]
    assert step["url"] == "https://example.test/auth/token-exchange"
    assert step["response_size"] > 0
    assert "request_headers" not in step
    assert "response_headers" not in step
    assert "request_body" not in step
    assert "response_body" not in step


def test_smoke_client_clears_deleted_cookie_from_set_cookie_header(monkeypatch) -> None:
    response = httpx.Response(
        302,
        headers={"set-cookie": 'boring_session=""; Max-Age=0; Path=/'},
        request=httpx.Request("GET", "https://example.test/auth/logout"),
    )

    def fake_request(self, method, path, **kwargs):
        return response

    monkeypatch.setattr(httpx.Client, "request", fake_request)

    client = SmokeClient("https://example.test")
    client.cookies["boring_session"] = "still-valid"

    client.get("/auth/logout", expect_status=(302,))

    assert "boring_session" not in client.cookies

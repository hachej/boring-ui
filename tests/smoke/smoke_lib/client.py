"""SmokeClient: httpx wrapper with cookie jar, base_url switching, and reporting."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx


_REDACTED_HEADERS = {"authorization", "cookie", "set-cookie", "x-api-key"}
_REDACTED_JSON_KEYS = {
    "access_token",
    "session_token",
    "token",
    "jwt",
    "password",
    "new_password",
    "client_secret",
    "api_key",
}


def _redact_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): ("<redacted>" if str(key).lower() in _REDACTED_JSON_KEYS else _redact_value(item))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_value(item) for item in value]
    return value


def _sanitize_headers(headers: httpx.Headers | dict[str, Any] | None) -> dict[str, str]:
    if not headers:
        return {}
    items = headers.items() if hasattr(headers, "items") else dict(headers).items()
    sanitized: dict[str, str] = {}
    for key, value in items:
        sanitized[str(key)] = "<redacted>" if str(key).lower() in _REDACTED_HEADERS else str(value)
    return sanitized


def _decode_body(content: bytes) -> str:
    if not content:
        return ""
    return content.decode("utf-8", errors="replace")


@dataclass
class StepResult:
    phase: str
    method: str
    path: str
    status: int
    ok: bool
    elapsed_ms: float
    detail: str = ""
    url: str = ""
    response_size: int = 0
    request_headers: dict[str, str] = field(default_factory=dict)
    response_headers: dict[str, str] = field(default_factory=dict)
    request_body: Any = None
    response_body: str = ""


class SmokeClient:
    """httpx.Client wrapper with cookie persistence, base_url switching, result collection."""

    def __init__(self, base_url: str, *, timeout: float = 30.0, capture_details: bool = False):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.capture_details = capture_details
        self.cookies = httpx.Cookies()
        self.results: list[StepResult] = []
        self._phase = "init"

    def set_phase(self, phase: str) -> None:
        self._phase = phase

    def _client(self) -> httpx.Client:
        # Use a plain dict for cookies so they are sent regardless of domain
        # (httpx.Cookies is domain-scoped and won't forward across base_url switches).
        cookie_dict = dict(self.cookies)
        return httpx.Client(
            base_url=self.base_url,
            cookies=cookie_dict,
            timeout=self.timeout,
            follow_redirects=False,
        )

    def _record(
        self,
        method: str,
        path: str,
        resp: httpx.Response,
        ok: bool,
        elapsed_ms: float,
        detail: str = "",
        *,
        request_body: Any = None,
    ) -> None:
        capture_http_details = self.capture_details or not ok
        response_body = resp.text if capture_http_details else ""
        self.results.append(StepResult(
            phase=self._phase,
            method=method,
            path=path,
            status=resp.status_code,
            ok=ok,
            elapsed_ms=elapsed_ms,
            detail=detail,
            url=str(resp.request.url),
            response_size=len(resp.content or b""),
            request_headers=_sanitize_headers(resp.request.headers) if capture_http_details else {},
            response_headers=_sanitize_headers(resp.headers) if capture_http_details else {},
            request_body=_redact_value(request_body) if capture_http_details and request_body is not None else None,
            response_body=response_body,
        ))

    def request(self, method: str, path: str, *, expect_status: int | tuple[int, ...] | None = None, **kw) -> httpx.Response:
        with self._client() as client:
            request_body = None
            if "json" in kw:
                request_body = kw["json"]
            elif "content" in kw:
                request_body = _decode_body(kw["content"] if isinstance(kw["content"], bytes) else str(kw["content"]).encode())
            elif "data" in kw:
                request_body = kw["data"]
            if kw.get("params") is not None:
                request_body = {
                    "params": _redact_value(dict(kw["params"])),
                    **({"body": _redact_value(request_body)} if request_body is not None else {}),
                }
            t0 = time.monotonic()
            resp = client.request(method, path, **kw)
            elapsed = (time.monotonic() - t0) * 1000
            # Persist any cookies set by the response
            self.cookies.update(resp.cookies)
            if expect_status is not None:
                if isinstance(expect_status, int):
                    expect_status = (expect_status,)
                ok = resp.status_code in expect_status
            else:
                ok = 200 <= resp.status_code < 400
            self._record(method, path, resp, ok, elapsed, request_body=request_body)
            return resp

    def get(self, path: str, **kw) -> httpx.Response:
        return self.request("GET", path, **kw)

    def post(self, path: str, **kw) -> httpx.Response:
        return self.request("POST", path, **kw)

    def put(self, path: str, **kw) -> httpx.Response:
        return self.request("PUT", path, **kw)

    def delete(self, path: str, **kw) -> httpx.Response:
        return self.request("DELETE", path, **kw)

    def switch_base(self, new_base_url: str) -> None:
        self.base_url = new_base_url.rstrip("/")

    def report(self) -> dict[str, Any]:
        passed = sum(1 for r in self.results if r.ok)
        failed = sum(1 for r in self.results if not r.ok)
        return {
            "ok": failed == 0,
            "passed": passed,
            "failed": failed,
            "total": len(self.results),
            "steps": [
                {
                    "phase": r.phase,
                    "method": r.method,
                    "path": r.path,
                    "status": r.status,
                    "ok": r.ok,
                    "elapsed_ms": round(r.elapsed_ms, 1),
                    "detail": r.detail,
                    "url": r.url,
                    "response_size": r.response_size,
                    **({"request_headers": r.request_headers} if r.request_headers else {}),
                    **({"response_headers": r.response_headers} if r.response_headers else {}),
                    **({"request_body": r.request_body} if r.request_body is not None else {}),
                    **({"response_body": r.response_body} if r.response_body else {}),
                }
                for r in self.results
            ],
        }

    def write_report(self, path: str | Path, *, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        report = self.report()
        if extra:
            report.update(extra)
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        return report

    def assert_all_passed(self) -> None:
        failures = [r for r in self.results if not r.ok]
        if failures:
            lines = [f"  {r.phase}: {r.method} {r.path} -> {r.status} ({r.detail})" for r in failures]
            raise AssertionError(f"{len(failures)} smoke test step(s) failed:\n" + "\n".join(lines))

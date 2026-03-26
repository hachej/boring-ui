from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from tests.smoke import smoke_full_journey


class FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, *, headers: dict | None = None):
        self.status_code = status_code
        self._payload = payload or {}
        self.headers = headers or {}
        self.text = json.dumps(self._payload)

    def json(self) -> dict:
        return self._payload


class FakeSmokeClient:
    def __init__(self, base_url: str, *, timeout: float = 30.0, capture_details: bool = False):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.capture_details = capture_details
        self.results: list[dict] = []
        self._phase = "init"
        self.logged_in = False
        self.user_email = ""
        self.workspace_counter = 0
        self.workspaces: dict[str, dict] = {}
        self.files: dict[str, dict[str, str]] = {}
        self.git_dirty: dict[str, set[str]] = {}
        self.user_settings = {"display_name": "User", "theme": "light"}
        self.workspace_settings: dict[str, dict[str, str]] = {}
        self.ui_states: dict[str, dict] = {}

    def set_phase(self, phase: str) -> None:
        self._phase = phase

    def switch_base(self, new_base_url: str) -> None:
        self.base_url = new_base_url.rstrip("/")

    def _workspace_from_base(self) -> str | None:
        path = urlsplit(self.base_url).path.strip("/")
        parts = path.split("/")
        if len(parts) >= 2 and parts[0] == "w":
            return parts[1]
        return None

    def _record(self, method: str, path: str, status_code: int, ok: bool) -> None:
        self.results.append(
            {
                "phase": self._phase,
                "method": method,
                "path": path,
                "status": status_code,
                "ok": ok,
                "elapsed_ms": 1.0,
                "detail": "",
                "url": f"{self.base_url}{path}",
                "response_size": 0,
            }
        )

    def _make_workspace_id(self) -> str:
        self.workspace_counter += 1
        return f"00000000-0000-4000-8000-{self.workspace_counter:012d}"

    def request(self, method: str, path: str, *, expect_status=None, **kw) -> FakeResponse:
        params = kw.get("params") or {}
        body = kw.get("json") or {}
        route = path
        parsed = urlsplit(path)
        if parsed.query:
            route = parsed.path
            params = {**{k: v[-1] for k, v in parse_qs(parsed.query).items()}, **params}

        workspace_id = self._workspace_from_base()
        response = self._dispatch(method.upper(), route, params=params, body=body, workspace_id=workspace_id)
        allowed = (
            tuple(expect_status)
            if isinstance(expect_status, tuple)
            else ((expect_status,) if isinstance(expect_status, int) else None)
        )
        ok = response.status_code in allowed if allowed is not None else 200 <= response.status_code < 400
        self._record(method.upper(), route, response.status_code, ok)
        return response

    def get(self, path: str, **kw) -> FakeResponse:
        return self.request("GET", path, **kw)

    def post(self, path: str, **kw) -> FakeResponse:
        return self.request("POST", path, **kw)

    def put(self, path: str, **kw) -> FakeResponse:
        return self.request("PUT", path, **kw)

    def delete(self, path: str, **kw) -> FakeResponse:
        return self.request("DELETE", path, **kw)

    def _dispatch(self, method: str, route: str, *, params: dict, body: dict, workspace_id: str | None) -> FakeResponse:
        if method == "GET" and route == "/health":
            return FakeResponse(200, {"status": "ok"})

        if method == "GET" and route == "/api/capabilities":
            return FakeResponse(
                200,
                {
                    "features": {"files": True, "git": True, "ui_state": True},
                    "routers": [{"name": "files"}, {"name": "git"}],
                    "auth": {"provider": "local"},
                },
            )

        if method == "GET" and route == "/__bui/config":
            return FakeResponse(200, {"app": {"id": "boring-ui"}, "frontend": {"data": {"backend": "http"}}})

        if method == "GET" and route == "/auth/session":
            if self.logged_in:
                return FakeResponse(
                    200,
                    {
                        "authenticated": True,
                        "user": {"email": self.user_email},
                        "email": self.user_email,
                    },
                )
            return FakeResponse(
                200,
                {
                    "authenticated": False,
                    "user": None,
                    "email": None,
                },
            )

        if method == "GET" and route == "/auth/logout":
            self.logged_in = False
            return FakeResponse(302, {}, headers={"location": "/auth/login"})

        if method == "POST" and route == "/api/v1/workspaces":
            workspace_id = self._make_workspace_id()
            name = str(body.get("name") or "Workspace")
            workspace = {"id": workspace_id, "workspace_id": workspace_id, "name": name}
            self.workspaces[workspace_id] = workspace
            self.files.setdefault(workspace_id, {})
            self.git_dirty.setdefault(workspace_id, set())
            self.workspace_settings.setdefault(workspace_id, {})
            return FakeResponse(201, {"ok": True, "workspace": workspace})

        if method == "GET" and route == "/api/v1/workspaces":
            return FakeResponse(200, {"ok": True, "workspaces": list(self.workspaces.values())})

        if method == "PATCH" and route.startswith("/api/v1/workspaces/"):
            target_id = route.split("/")[4]
            self.workspaces[target_id]["name"] = str(body["name"])
            return FakeResponse(200, {"ok": True, "workspace": self.workspaces[target_id]})

        if method == "DELETE" and route.startswith("/api/v1/workspaces/"):
            target_id = route.split("/")[4]
            self.workspaces.pop(target_id, None)
            self.files.pop(target_id, None)
            self.git_dirty.pop(target_id, None)
            self.workspace_settings.pop(target_id, None)
            return FakeResponse(200, {"ok": True, "deleted": True})

        if method == "PUT" and route == "/api/v1/files/write":
            path_value = str(params["path"])
            self.files.setdefault(workspace_id or "", {})[path_value] = str(body.get("content") or "")
            self.git_dirty.setdefault(workspace_id or "", set()).add(path_value)
            return FakeResponse(200, {"success": True})

        if method == "GET" and route == "/api/v1/files/read":
            path_value = str(params["path"])
            content = self.files.get(workspace_id or "", {}).get(path_value)
            if content is None:
                return FakeResponse(404, {"error": "not_found"})
            return FakeResponse(200, {"content": content})

        if method == "POST" and route == "/api/v1/files/rename":
            old_path = str(body["old_path"])
            new_path = str(body["new_path"])
            workspace_files = self.files.setdefault(workspace_id or "", {})
            workspace_files[new_path] = workspace_files.pop(old_path)
            dirty = self.git_dirty.setdefault(workspace_id or "", set())
            if old_path in dirty:
                dirty.remove(old_path)
                dirty.add(new_path)
            return FakeResponse(200, {"success": True})

        if method == "GET" and route == "/api/v1/files/list":
            entries = [{"name": name, "path": name} for name in sorted(self.files.get(workspace_id or "", {}).keys())]
            return FakeResponse(200, {"entries": entries})

        if method == "DELETE" and route == "/api/v1/files/delete":
            path_value = str(params["path"])
            self.files.get(workspace_id or "", {}).pop(path_value, None)
            self.git_dirty.get(workspace_id or "", set()).discard(path_value)
            return FakeResponse(200, {"success": True})

        if method == "POST" and route == "/api/v1/git/init":
            self.git_dirty.setdefault(workspace_id or "", set())
            return FakeResponse(200, {"initialized": True})

        if method == "POST" and route == "/api/v1/git/add":
            return FakeResponse(200, {"staged": True})

        if method == "POST" and route == "/api/v1/git/commit":
            self.git_dirty.setdefault(workspace_id or "", set()).clear()
            return FakeResponse(200, {"oid": "abc123"})

        if method == "GET" and route == "/api/v1/git/status":
            dirty_files = [
                {"path": path_value, "status": "untracked"}
                for path_value in sorted(self.git_dirty.get(workspace_id or "", set()))
            ]
            return FakeResponse(200, {"is_repo": True, "files": dirty_files})

        if method == "GET" and route == "/api/v1/git/diff":
            return FakeResponse(200, {"diff": "", "path": str(params.get("path") or "")})

        if method == "POST" and route == "/api/v1/exec":
            return FakeResponse(200, {"stdout": "hello journey", "exit_code": 0})

        if method == "POST" and route == "/api/v1/exec/start":
            return FakeResponse(200, {"job_id": "job-1"})

        if method == "GET" and route == "/api/v1/exec/jobs/job-1":
            return FakeResponse(200, {"job_id": "job-1", "done": True, "chunks": ["job-start\n", "job-done\n"], "cursor": 2, "exit_code": 0})

        if method == "PUT" and route == "/api/v1/me/settings":
            if "display_name" in body:
                self.user_settings["display_name"] = str(body["display_name"])
            self.user_settings.update({k: v for k, v in body.items() if k != "display_name"})
            return FakeResponse(
                200,
                {
                    "ok": True,
                    "settings": {k: v for k, v in self.user_settings.items() if k != "display_name"},
                    "display_name": self.user_settings["display_name"],
                },
            )

        if method == "GET" and route == "/api/v1/me/settings":
            return FakeResponse(
                200,
                {
                    "ok": True,
                    "settings": dict(self.user_settings),
                    "display_name": self.user_settings["display_name"],
                },
            )

        if method == "PUT" and route.startswith("/api/v1/workspaces/") and route.endswith("/settings"):
            target_id = route.split("/")[4]
            settings = self.workspace_settings.setdefault(target_id, {})
            settings.update({str(k): str(v) for k, v in body.items()})
            return FakeResponse(200, {"ok": True, "settings": dict(settings)})

        if method == "GET" and route.startswith("/api/v1/workspaces/") and route.endswith("/settings"):
            target_id = route.split("/")[4]
            return FakeResponse(200, {"ok": True, "settings": dict(self.workspace_settings.get(target_id, {}))})

        if method == "PUT" and route == "/api/v1/ui/state":
            client_id = str(body["client_id"])
            self.ui_states[client_id] = dict(body)
            return FakeResponse(200, {"ok": True, "state": dict(body)})

        if method == "GET" and route.startswith("/api/v1/ui/state/"):
            client_id = route.split("/")[5]
            state = self.ui_states.get(client_id)
            if state is None:
                return FakeResponse(404, {"error": "not_found"})
            return FakeResponse(200, {"ok": True, "state": dict(state)})

        if method == "DELETE" and route.startswith("/api/v1/ui/state/"):
            client_id = route.split("/")[5]
            self.ui_states.pop(client_id, None)
            return FakeResponse(200, {"ok": True, "deleted": client_id})

        raise AssertionError(f"Unhandled fake request: {method} {route} params={params} body={body} workspace={workspace_id}")

    def report(self) -> dict:
        passed = sum(1 for result in self.results if result["ok"])
        failed = sum(1 for result in self.results if not result["ok"])
        return {
            "ok": failed == 0,
            "passed": passed,
            "failed": failed,
            "total": len(self.results),
            "steps": list(self.results),
        }

    def write_report(self, path: str | Path, *, extra: dict | None = None) -> dict:
        report = self.report()
        if extra:
            report.update(extra)
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        return report


def test_smoke_full_journey_dev_mode_enforces_30_step_contract(monkeypatch, tmp_path: Path) -> None:
    evidence_out = tmp_path / "journey.json"

    def fake_dev_login(client, *, user_id: str, email: str, redirect_uri: str = "/") -> None:
        del user_id, redirect_uri
        client.logged_in = True
        client.user_email = email

    monkeypatch.setattr(smoke_full_journey, "SmokeClient", FakeSmokeClient)
    monkeypatch.setattr(smoke_full_journey, "dev_login", fake_dev_login)
    monkeypatch.setattr(
        "sys.argv",
        [
            "smoke_full_journey.py",
            "--base-url",
            "http://127.0.0.1:9999",
            "--auth-mode",
            "dev",
            "--evidence-out",
            str(evidence_out),
        ],
    )

    exit_code = smoke_full_journey.main()

    report = json.loads(evidence_out.read_text(encoding="utf-8"))
    assert exit_code == 0
    assert report["ok"] is True
    assert report["journey_total"] == 30
    assert report["journey_passed"] == 30
    assert report["journey_skipped"] == 0
    assert [step["name"] for step in report["journey_steps"][:5]] == [
        "Health check",
        "Capabilities check",
        "Runtime config",
        "Dev login",
        "Session check",
    ]
    assert report["journey_steps"][-1]["name"] == "Verify session invalid after logout"
    assert report["journey_steps"][-1]["detail"] == "authenticated=false"

#!/usr/bin/env python3
"""Comprehensive end-to-end journey smoke for boring-ui.

Exercises the critical path in one sequential flow:
health -> capabilities -> auth -> workspace -> files -> git -> exec ->
settings -> ui-state -> isolation -> logout.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_lib.auth import (  # noqa: E402
    assert_confirmation_callback_url,
    extract_confirmation_url,
    get_email,
    neon_signin_flow,
    random_password,
    wait_for_email,
)
from smoke_lib.client import SmokeClient  # noqa: E402
from smoke_lib.exec import run_exec, start_exec_job, wait_for_exec_job  # noqa: E402
from smoke_lib.files import delete_file, rename_file  # noqa: E402
from smoke_lib.git import check_git_status, git_add, git_commit, git_init  # noqa: E402
from smoke_lib.secrets import resend_api_key  # noqa: E402
from smoke_lib.session_bootstrap import resolve_neon_auth_url, dev_login  # noqa: E402
from smoke_lib.settings import (  # noqa: E402
    get_user_settings,
    get_workspace_settings,
    update_user_settings,
    update_workspace_settings,
)
from smoke_lib.workspace import create_workspace, list_workspaces  # noqa: E402


def _router_names(routers: list) -> set[str]:
    names: set[str] = set()
    for router in routers:
        if isinstance(router, str):
            names.add(router)
        elif isinstance(router, dict):
            name = str(router.get("name", "")).strip()
            if name:
                names.add(name)
    return names


def _record_step(
    journey_steps: list[dict[str, object]],
    number: int,
    name: str,
    fn,
):
    start = time.monotonic()
    try:
        detail = fn()
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        journey_steps.append(
            {
                "step": number,
                "name": name,
                "status": "pass",
                "elapsed_ms": elapsed_ms,
                **({"detail": detail} if detail else {}),
            }
        )
        print(f"[journey] PASS {number:02d}. {name} ({elapsed_ms}ms)")
    except Exception as exc:
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        journey_steps.append(
            {
                "step": number,
                "name": name,
                "status": "fail",
                "elapsed_ms": elapsed_ms,
                "detail": str(exc),
            }
        )
        print(f"[journey] FAIL {number:02d}. {name} ({elapsed_ms}ms): {exc}", file=sys.stderr)
        raise


def _skip_step(journey_steps: list[dict[str, object]], number: int, name: str, detail: str) -> None:
    journey_steps.append(
        {
            "step": number,
            "name": name,
            "status": "skipped",
            "elapsed_ms": 0.0,
            "detail": detail,
        }
    )
    print(f"[journey] SKIP {number:02d}. {name}: {detail}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--auth-mode", choices=["neon", "dev"], default="neon")
    parser.add_argument("--neon-auth-url", default="")
    parser.add_argument("--skip-signup", action="store_true")
    parser.add_argument("--email")
    parser.add_argument("--password")
    parser.add_argument("--recipient")
    parser.add_argument("--public-origin", default="")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--exec-timeout", type=float, default=30.0)
    parser.add_argument("--evidence-out", default="")
    args = parser.parse_args()

    root_base = args.base_url.rstrip("/")
    client = SmokeClient(root_base, capture_details=True)
    journey_steps: list[dict[str, object]] = []
    started_at = time.monotonic()

    state: dict[str, object] = {
        "email": args.email or args.recipient or "",
        "password": args.password or "",
        "workspace_id": "",
        "workspace_two_id": "",
        "git_file_path": "",
        "neon_auth_url": "",
    }

    try:
        def step_1_health():
            client.set_phase("journey-health")
            resp = client.get("/health", expect_status=(200,))
            if resp.status_code != 200:
                raise RuntimeError(f"/health returned {resp.status_code}")
            return "status=200"

        _record_step(journey_steps, 1, "Health check", step_1_health)

        def step_2_capabilities():
            client.set_phase("journey-capabilities")
            resp = client.get("/api/capabilities", expect_status=(200,))
            if resp.status_code != 200:
                raise RuntimeError(f"/api/capabilities returned {resp.status_code}")
            payload = resp.json()
            features = payload.get("features")
            routers = payload.get("routers")
            auth = payload.get("auth")
            if not isinstance(features, dict):
                raise RuntimeError(f"features is not a dict: {type(features).__name__}")
            if not isinstance(routers, list):
                raise RuntimeError(f"routers is not a list: {type(routers).__name__}")
            if not isinstance(auth, dict):
                raise RuntimeError(f"auth is not a dict: {type(auth).__name__}")
            return f"auth={auth.get('provider', 'none')}, routers={sorted(_router_names(routers))}"

        _record_step(journey_steps, 2, "Capabilities check", step_2_capabilities)

        if args.auth_mode == "neon":
            resolved_neon_url = resolve_neon_auth_url(root_base, args.neon_auth_url)
            state["neon_auth_url"] = resolved_neon_url
            app_origin = (
                args.public_origin
                or os.environ.get("BORING_UI_PUBLIC_ORIGIN")
                or os.environ.get("PUBLIC_APP_ORIGIN")
                or root_base
            ).rstrip("/")

            if not state["email"]:
                state["email"] = f"qa+journey-{int(time.time())}@boringdata.io"
            if not state["password"]:
                state["password"] = random_password()

            if args.skip_signup:
                _skip_step(journey_steps, 3, "Neon sign-up", "disabled via --skip-signup")
                _skip_step(journey_steps, 4, "Email verification", "disabled via --skip-signup")
                _record_step(
                    journey_steps,
                    5,
                    "Sign-in",
                    lambda: (
                        neon_signin_flow(
                            client,
                            neon_auth_url=resolved_neon_url,
                            email=str(state["email"]),
                            password=str(state["password"]),
                            redirect_uri="/",
                        ),
                        "signin ok",
                    )[1],
                )
            else:
                auth_ctx: dict[str, object] = {}

                def step_3_signup():
                    client.set_phase("journey-neon-signup")
                    auth_ctx["sent_after"] = time.time()
                    auth_ctx["origin"] = f"{urlparse(resolved_neon_url).scheme}://{urlparse(resolved_neon_url).netloc}"
                    resp = client.post(
                        "/auth/sign-up",
                        headers={"Origin": app_origin},
                        json={
                            "email": state["email"],
                            "password": state["password"],
                            "name": str(state["email"]).split("@")[0],
                            "redirect_uri": "/",
                        },
                        expect_status=(200,),
                    )
                    payload = resp.json()
                    if resp.status_code != 200 or not payload.get("ok"):
                        raise RuntimeError(f"signup failed: {resp.status_code} {resp.text[:300]}")
                    if not payload.get("requires_email_verification"):
                        raise RuntimeError(f"signup did not require verification: {payload}")
                    return f"email={state['email']}"

                _record_step(journey_steps, 3, "Neon sign-up", step_3_signup)

                def step_4_verify():
                    client.set_phase("journey-neon-verify")
                    email_summary = wait_for_email(
                        resend_api_key(),
                        recipient=str(state["email"]),
                        sent_after_epoch=float(auth_ctx["sent_after"]),
                        timeout_seconds=args.timeout,
                    )
                    email_id = str(email_summary.get("id") or "").strip()
                    if not email_id:
                        raise RuntimeError("verification email missing resend id")
                    email_details = get_email(resend_api_key(), email_id=email_id)
                    confirmation_url = extract_confirmation_url(email_details)
                    callback_url = assert_confirmation_callback_url(
                        confirmation_url,
                        expected_app_base_url=app_origin,
                        expected_redirect_uri="/",
                        require_pending_login=True,
                    )
                    verify_client = httpx.Client(
                        headers={"Origin": str(auth_ctx["origin"])},
                        timeout=30.0,
                        follow_redirects=True,
                    )
                    try:
                        verify_resp = verify_client.get(confirmation_url)
                        if verify_resp.status_code not in {200, 302}:
                            raise RuntimeError(
                                f"verification callback failed: {verify_resp.status_code} {verify_resp.text[:300]}"
                            )
                        token_resp = verify_client.get(f"{resolved_neon_url.rstrip('/')}/token")
                        if token_resp.status_code != 200:
                            raise RuntimeError(
                                f"neon /token failed: {token_resp.status_code} {token_resp.text[:300]}"
                            )
                        token = (token_resp.json() or {}).get("token")
                        if not isinstance(token, str) or not token.strip():
                            raise RuntimeError("neon /token did not return a JWT")
                        auth_ctx["access_token"] = token
                    finally:
                        verify_client.close()
                    return callback_url or "callback verified"

                _record_step(journey_steps, 4, "Email verification", step_4_verify)

                def step_5_token_exchange():
                    client.set_phase("journey-token-exchange")
                    resp = client.post(
                        "/auth/token-exchange",
                        json={"access_token": auth_ctx["access_token"], "redirect_uri": "/"},
                        expect_status=(200,),
                    )
                    payload = resp.json()
                    if resp.status_code != 200 or not payload.get("ok"):
                        raise RuntimeError(f"token exchange failed: {resp.status_code} {resp.text[:300]}")
                    return "token exchange ok"

                _record_step(journey_steps, 5, "Sign-in", step_5_token_exchange)

            def step_6_session():
                client.set_phase("journey-session")
                resp = client.get("/auth/session", expect_status=(200,))
                if resp.status_code != 200:
                    raise RuntimeError(f"/auth/session returned {resp.status_code}")
                payload = resp.json()
                actual_email = str((payload.get("user") or {}).get("email", "")).strip().lower()
                if actual_email != str(state["email"]).lower():
                    raise RuntimeError(f"session email mismatch: expected={state['email']} actual={actual_email}")
                return f"user={actual_email}"

            _record_step(journey_steps, 6, "Session check", step_6_session)
        else:
            def step_3_dev_login():
                ts = int(time.time())
                email = args.email or f"journey-dev-{ts}@test.local"
                state["email"] = email
                dev_login(
                    client,
                    user_id=f"journey-dev-{ts}",
                    email=email,
                    redirect_uri="/",
                )
                return f"email={email}"

            _record_step(journey_steps, 3, "Dev login", step_3_dev_login)
            _skip_step(journey_steps, 4, "Email verification", "not applicable in dev mode")
            _skip_step(journey_steps, 5, "Sign-in", "dev mode uses direct login")
            def step_6_dev_session():
                client.set_phase("journey-session")
                resp = client.get("/auth/session", expect_status=(200,))
                if resp.status_code != 200:
                    raise RuntimeError(f"/auth/session returned {resp.status_code}")
                payload = resp.json()
                actual_email = str((payload.get("user") or {}).get("email", "")).strip().lower()
                if actual_email != str(state["email"]).lower():
                    raise RuntimeError(f"session email mismatch: expected={state['email']} actual={actual_email}")
                return f"user={actual_email}"

            _record_step(journey_steps, 6, "Session check", step_6_dev_session)

        def step_7_create_workspace():
            ws_data = create_workspace(client, name=f"journey-{int(time.time())}")
            ws = ws_data.get("workspace") or ws_data
            workspace_id = ws.get("workspace_id") or ws.get("id")
            if not workspace_id:
                raise RuntimeError(f"workspace id missing: {ws_data}")
            state["workspace_id"] = workspace_id
            return str(workspace_id)

        _record_step(journey_steps, 7, "Create workspace", step_7_create_workspace)

        def step_8_list_workspaces():
            workspaces = list_workspaces(client, expect_id=str(state["workspace_id"]))
            return f"count={len(workspaces)}"

        _record_step(journey_steps, 8, "List workspaces", step_8_list_workspaces)

        workspace_base = f"{root_base}/w/{state['workspace_id']}"
        client.switch_base(workspace_base)

        def step_9_write_file():
            client.set_phase("journey-file-write")
            resp = client.put(
                "/api/v1/files/write",
                params={"path": "journey.txt"},
                json={"content": "journey file"},
                expect_status=(200,),
            )
            if resp.status_code != 200:
                raise RuntimeError(f"write failed: {resp.status_code} {resp.text[:300]}")
            return "journey.txt"

        _record_step(journey_steps, 9, "Write file via workspace boundary", step_9_write_file)

        def step_10_read_file():
            client.set_phase("journey-file-read")
            resp = client.get("/api/v1/files/read", params={"path": "journey.txt"}, expect_status=(200,))
            if resp.status_code != 200:
                raise RuntimeError(f"read failed: {resp.status_code} {resp.text[:300]}")
            content = resp.json().get("content")
            if content != "journey file":
                raise RuntimeError(f"unexpected content: {content!r}")
            return content

        _record_step(journey_steps, 10, "Read file back", step_10_read_file)
        _record_step(
            journey_steps,
            11,
            "Rename file",
            lambda: (rename_file(client, old_path="journey.txt", new_path="journey-renamed.txt"), "journey-renamed.txt")[1],
        )
        _record_step(
            journey_steps,
            12,
            "Delete file",
            lambda: (delete_file(client, path="journey-renamed.txt"), "deleted")[1],
        )
        _record_step(journey_steps, 13, "Git init", lambda: (git_init(client), "git init ok")[1])

        def step_14_git_add_commit():
            client.set_phase("journey-git-file-write")
            state["git_file_path"] = f"journey-git-{int(time.time())}.txt"
            write_resp = client.put(
                "/api/v1/files/write",
                params={"path": str(state["git_file_path"])},
                json={"content": "git journey content"},
                expect_status=(200,),
            )
            if write_resp.status_code != 200:
                raise RuntimeError(f"git file write failed: {write_resp.status_code} {write_resp.text[:300]}")
            git_add(client, [str(state["git_file_path"])])
            commit = git_commit(
                client,
                "journey smoke commit",
                author={"name": "Journey Smoke", "email": "journey@test.local"},
            )
            return commit.get("oid", "")

        _record_step(journey_steps, 14, "Git add + commit", step_14_git_add_commit)

        def step_15_git_status():
            status = check_git_status(client)
            dirty = [
                item
                for item in status.get("files", [])
                if item.get("status") not in (None, "") and not str(item.get("path", "")).startswith(".boring")
            ]
            if dirty:
                raise RuntimeError(f"git tree not clean: {dirty}")
            return "clean"

        _record_step(journey_steps, 15, "Git status clean", step_15_git_status)

        def step_16_exec_short():
            result = run_exec(client, command="printf 'hello journey'")
            stdout = str(result.get("stdout", ""))
            if "hello journey" not in stdout:
                raise RuntimeError(f"stdout mismatch: {stdout!r}")
            if result.get("exit_code") != 0:
                raise RuntimeError(f"unexpected exit_code: {result.get('exit_code')}")
            return stdout.strip()

        _record_step(journey_steps, 16, "Exec short command", step_16_exec_short)

        def step_17_exec_long():
            job = start_exec_job(
                client,
                command="printf 'job-start\\n'; sleep 1; printf 'job-done\\n'",
            )
            result = wait_for_exec_job(client, str(job["job_id"]), timeout_seconds=args.exec_timeout)
            output = str(result.get("combined_output", ""))
            if "job-start" not in output or "job-done" not in output:
                raise RuntimeError(f"job output mismatch: {output!r}")
            if result.get("exit_code") not in (0, None):
                raise RuntimeError(f"unexpected job exit_code: {result.get('exit_code')}")
            return output.strip()

        _record_step(journey_steps, 17, "Exec long-running command", step_17_exec_long)

        def step_18_user_settings():
            update_user_settings(client, display_name="Journey Smoke")
            settings = get_user_settings(client).get("settings", {})
            if settings.get("display_name") != "Journey Smoke":
                raise RuntimeError(f"display_name mismatch: {settings}")
            return "display_name=Journey Smoke"

        _record_step(journey_steps, 18, "User settings write + read back", step_18_user_settings)

        def step_19_workspace_settings():
            update_workspace_settings(
                client,
                str(state["workspace_id"]),
                settings={"journey": "ok", "theme": "midnight"},
            )
            settings = get_workspace_settings(client, str(state["workspace_id"])).get("settings", {})
            if "journey" not in settings or "theme" not in settings:
                raise RuntimeError(f"workspace settings missing keys: {settings}")
            return "journey/theme keys present"

        _record_step(journey_steps, 19, "Workspace settings write + read back", step_19_workspace_settings)

        def step_20_ui_state():
            client.set_phase("journey-ui-state-write")
            client_id = f"journey-ui-{int(time.time())}"
            write_resp = client.put(
                "/api/v1/ui/state",
                json={
                    "client_id": client_id,
                    "active_panel_id": "editor",
                    "open_panels": [{"id": "editor", "title": "Editor", "placement": "center"}],
                    "meta": {"journey": True},
                },
                expect_status=(200,),
            )
            if write_resp.status_code != 200:
                raise RuntimeError(f"ui-state write failed: {write_resp.status_code} {write_resp.text[:300]}")
            client.set_phase("journey-ui-state-read")
            read_resp = client.get(f"/api/v1/ui/state/{client_id}", expect_status=(200,))
            if read_resp.status_code != 200:
                raise RuntimeError(f"ui-state read failed: {read_resp.status_code} {read_resp.text[:300]}")
            state_payload = read_resp.json().get("state", {})
            if state_payload.get("active_panel_id") != "editor":
                raise RuntimeError(f"ui-state mismatch: {state_payload}")
            return client_id

        _record_step(journey_steps, 20, "UI state write + read back", step_20_ui_state)

        def step_21_workspace_isolation():
            client.switch_base(root_base)
            ws_data = create_workspace(client, name=f"journey-isolation-{int(time.time())}")
            ws = ws_data.get("workspace") or ws_data
            workspace_two_id = ws.get("workspace_id") or ws.get("id")
            if not workspace_two_id:
                raise RuntimeError(f"second workspace id missing: {ws_data}")
            state["workspace_two_id"] = workspace_two_id
            client.switch_base(f"{root_base}/w/{workspace_two_id}")
            read_resp = client.get(
                "/api/v1/files/read",
                params={"path": str(state["git_file_path"])},
                expect_status=(404,),
            )
            if read_resp.status_code != 404:
                raise RuntimeError(f"expected 404 for first workspace file, got {read_resp.status_code}")
            return str(workspace_two_id)

        _record_step(journey_steps, 21, "Create second workspace + verify isolation", step_21_workspace_isolation)

        def step_22_logout():
            client.switch_base(root_base)
            resp = client.get("/auth/logout", expect_status=(302,))
            if resp.status_code != 302:
                raise RuntimeError(f"logout returned {resp.status_code}")
            return resp.headers.get("location", "")

        _record_step(journey_steps, 22, "Logout", step_22_logout)

        def step_23_session_invalid():
            client.set_phase("journey-session-invalid")
            resp = client.get("/auth/session", expect_status=(401,))
            if resp.status_code != 401:
                raise RuntimeError(f"expected 401 after logout, got {resp.status_code}")
            return resp.json().get("code", "")

        _record_step(journey_steps, 23, "Verify session invalid after logout", step_23_session_invalid)
        exit_code = 0
    except Exception:
        exit_code = 1

    total_elapsed_ms = round((time.monotonic() - started_at) * 1000, 1)
    passed = sum(1 for step in journey_steps if step["status"] == "pass")
    failed = sum(1 for step in journey_steps if step["status"] == "fail")
    skipped = sum(1 for step in journey_steps if step["status"] == "skipped")

    report = client.report()
    summary = {
        "suite": "full-journey",
        "base_url": root_base,
        "auth_mode": args.auth_mode,
        "ok": exit_code == 0 and failed == 0 and report["ok"],
        "journey_steps": journey_steps,
        "journey_passed": passed,
        "journey_failed": failed,
        "journey_skipped": skipped,
        "journey_total": len(journey_steps),
        "journey_elapsed_ms": total_elapsed_ms,
        "email": state["email"],
        "workspace_id": state["workspace_id"],
        "workspace_two_id": state["workspace_two_id"],
        "neon_auth_url": state["neon_auth_url"],
    }

    if args.evidence_out:
        client.write_report(args.evidence_out, extra=summary)

    print(json.dumps({**report, **summary}, indent=2))
    if exit_code == 0 and report["ok"]:
        print(f"\nSMOKE FULL JOURNEY: ALL {passed}/{len(journey_steps)} JOURNEY STEPS PASSED")
        return 0
    print(
        f"\nSMOKE FULL JOURNEY: {failed} journey step(s) failed; raw_http_failures={report['failed']}",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

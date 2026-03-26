#!/usr/bin/env python3
"""GitHub connect E2E smoke test — real GitHub App + real repo.

Tests the full GitHub integration lifecycle:
  1. Verify GitHub App is configured
  2. List installations (requires app installed on target account)
  3. Connect workspace to installation
  4. List repos, verify test repo accessible
  5. Get git credentials, verify against GitHub API
  6. Git operations: clone test repo, push a file via credentials
  7. Disconnect workspace
  8. Verify cleanup

Prerequisites:
  - Backend running with GITHUB_APP_* env vars set
  - GitHub App installed on the target account (boringdata)
  - Test repo exists: boringdata/boring-ui-test

Usage:
    python3 tests/smoke/smoke_github_connect.py
    python3 tests/smoke/smoke_github_connect.py --base-url http://localhost:8000
    python3 tests/smoke/smoke_github_connect.py --base-url https://<app-url> --auth-mode neon
    python3 tests/smoke/smoke_github_connect.py --skip-git-push  # skip destructive push
    python3 tests/smoke/smoke_github_connect.py --installation-id 12345

Notes:
  - On older/minimal TS builds, this smoke fails fast with an explicit parity-gap
    error instead of cascading through removed Python-era routes.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time

from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from smoke_lib.client import SmokeClient
from smoke_lib.session_bootstrap import ensure_session

TEST_REPO = "boring-ui-repo"
TEST_ACCOUNT = "boringdata"
WORKSPACE_ID = "smoke-gh-test"
CURRENT_GITHUB_ROUTE_BASE = "/api/v1/github"
LEGACY_GITHUB_ROUTE_BASE = "/api/v1/auth/github"


# ── Helpers ─────────────────────────────────────────────────────────────

def _vault_get(path: str, field: str) -> str:
    """Fetch a secret field from Vault."""
    result = subprocess.run(
        ["vault", "kv", "get", "-field", field, path],
        capture_output=True, text=True, timeout=10,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Vault error for {path}/{field}: {result.stderr.strip()}")
    return result.stdout.strip()


def github_api(method: str, url: str, token: str, **kw) -> dict:
    """Make a GitHub API call and return JSON."""
    import httpx
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
    }
    resp = httpx.request(method, url, headers=headers, timeout=15, **kw)
    if resp.status_code >= 400:
        raise RuntimeError(f"GitHub API {method} {url} → {resp.status_code}: {resp.text[:200]}")
    return resp.json()


def _resolve_auth_mode(requested: str, caps: dict) -> str:
    mode = str(requested or "auto").strip().lower()
    if mode != "auto":
        return mode

    provider = str(caps.get("auth", {}).get("provider", "")).strip().lower()
    if provider == "neon":
        return "neon"
    if provider in {"local", "dev"}:
        return "dev"
    return "dev"


def _uses_minimal_ts_github_surface(data: dict) -> bool:
    return bool(data.get("ok")) and "connected" not in data and "installation_connected" not in data


def _legacy_workspace_params(route_base: str, workspace_id: str | None) -> dict:
    if route_base != LEGACY_GITHUB_ROUTE_BASE or not workspace_id:
        return {}
    return {"workspace_id": workspace_id}


def _status_workspace_params(workspace_id: str | None) -> dict:
    if not workspace_id:
        return {}
    return {"workspace_id": workspace_id}


def _select_installation(
    installations: list[dict],
    requested_installation_id: int | None,
    expected_repo: str,
) -> dict:
    if requested_installation_id is not None:
        match = next((item for item in installations if item["id"] == requested_installation_id), None)
        if not match:
            raise RuntimeError(f"Installation {requested_installation_id} not found in discovered installations")
        return match

    expected_owner = str(expected_repo).split("/", 1)[0].strip().lower()
    if expected_owner:
        owner_match = next(
            (item for item in installations if str(item.get("account", "")).strip().lower() == expected_owner),
            None,
        )
        if owner_match:
            return owner_match

    return installations[0]


# ── Test phases ─────────────────────────────────────────────────────────

def phase_capabilities(client: SmokeClient) -> dict:
    """Verify backend is up and GitHub feature is enabled."""
    client.set_phase("capabilities")
    resp = client.get("/api/capabilities", expect_status=(200,))
    caps = resp.json()
    github_enabled = caps.get("features", {}).get("github", False)
    print(f"[smoke] Capabilities: github={github_enabled}")
    if not github_enabled:
        raise RuntimeError("GitHub feature not enabled — check GITHUB_APP_* env vars")
    return caps


def phase_github_status(client: SmokeClient, workspace_id: str | None = None) -> dict:
    """Check GitHub configuration/status and detect route surface."""
    client.set_phase("github-status")
    current_resp = client.get(
        f"{CURRENT_GITHUB_ROUTE_BASE}/status",
        expect_status=(200, 401, 404, 503),
    )
    if current_resp.status_code == 401:
        raise RuntimeError("GitHub status requires an authenticated session")
    if current_resp.status_code != 404:
        data = current_resp.json()
        surface = "ts-minimal" if _uses_minimal_ts_github_surface(data) else "ts-parity"
        print(
            f"[smoke] GitHub status ({surface}): "
            f"configured={data.get('configured')}, connected={data.get('connected')}"
        )
        return {
            "route_base": CURRENT_GITHUB_ROUTE_BASE,
            "surface": surface,
            "status": data,
        }

    legacy_resp = client.get(
        f"{LEGACY_GITHUB_ROUTE_BASE}/status",
        params=_legacy_workspace_params(LEGACY_GITHUB_ROUTE_BASE, workspace_id),
        expect_status=(200, 401, 503),
    )
    if legacy_resp.status_code == 401:
        raise RuntimeError("Legacy GitHub status requires an authenticated session")
    data = legacy_resp.json()
    print(f"[smoke] GitHub status (legacy): configured={data.get('configured')}, connected={data.get('connected')}")
    return {
        "route_base": LEGACY_GITHUB_ROUTE_BASE,
        "surface": "legacy-parity",
        "status": data,
    }


def phase_require_full_lifecycle_surface(client: SmokeClient, route_info: dict) -> bool:
    """Fail fast when the server only exposes the minimal TS GitHub surface."""
    if route_info.get("surface") != "ts-minimal":
        return True

    import httpx

    client.set_phase("github-lifecycle-parity")
    detail = (
        "TS server only exposes the minimal GitHub surface "
        "(/status, /oauth/initiate, /oauth/callback, /installations, /disconnect); "
        "missing connect/repos/git-credentials lifecycle routes required by this smoke"
    )
    client._record(
        "GET",
        f"{CURRENT_GITHUB_ROUTE_BASE}/status [lifecycle-parity]",
        httpx.Response(
            409,
            json={"error": "parity_gap", "detail": detail},
            request=httpx.Request(
                "GET",
                f"{client.base_url.rstrip('/')}{CURRENT_GITHUB_ROUTE_BASE}/status",
            ),
        ),
        False,
        0.0,
        detail,
    )
    print(f"[smoke] FAIL: {detail}")
    return False


def phase_list_installations(client: SmokeClient, route_base: str) -> list[dict]:
    """List GitHub App installations."""
    client.set_phase("installations")
    resp = client.get(f"{route_base}/installations", expect_status=(200,))
    installations = resp.json().get("installations", [])
    for inst in installations:
        print(f"[smoke]   Installation #{inst['id']} — {inst['account']} ({inst['account_type']})")
    if not installations:
        print("[smoke] No installations found.")
        print("[smoke] Install the GitHub App at: https://github.com/apps/boring-ui-app/installations/new")
    return installations


def phase_connect(client: SmokeClient, route_base: str, workspace_id: str, installation_id: int) -> dict:
    """Connect a workspace to a GitHub App installation."""
    client.set_phase("connect")
    resp = client.post(
        f"{route_base}/connect",
        json={"workspace_id": workspace_id, "installation_id": installation_id},
        expect_status=(200,),
    )
    data = resp.json()
    assert data.get("connected") is True, f"Expected connected=True, got {data}"
    assert data.get("installation_id") == installation_id
    print(f"[smoke] Connected workspace={workspace_id} to installation={installation_id}")
    return data


def phase_verify_connected(client: SmokeClient, route_base: str, workspace_id: str, installation_id: int) -> None:
    """Verify workspace shows as connected."""
    client.set_phase("verify-connected")
    resp = client.get(
        f"{route_base}/status",
        params=_status_workspace_params(workspace_id),
        expect_status=(200,),
    )
    data = resp.json()
    assert data["configured"] is True
    assert data["connected"] is True
    assert data["installation_id"] == installation_id
    print(f"[smoke] Verified: connected=True, installation_id={installation_id}")


def phase_list_repos(
    client: SmokeClient,
    route_base: str,
    installation_id: int,
    expected_repo: str | None = None,
) -> list[dict]:
    """List repos accessible to an installation."""
    client.set_phase("list-repos")
    resp = client.get(
        f"{route_base}/repos",
        params={"installation_id": installation_id},
        expect_status=(200,),
    )
    repos = resp.json().get("repos", [])
    print(f"[smoke] {len(repos)} repo(s) accessible to installation")
    for r in repos[:10]:
        print(f"[smoke]   {r['full_name']} ({'private' if r.get('private') else 'public'})")

    if expected_repo:
        found = any(r["full_name"] == expected_repo for r in repos)
        assert found, f"Expected repo {expected_repo} not found in {[r['full_name'] for r in repos]}"
        print(f"[smoke] Verified: {expected_repo} is accessible")
    return repos


def phase_get_credentials(client: SmokeClient, route_base: str, workspace_id: str) -> dict:
    """Get git credentials for a connected workspace."""
    client.set_phase("credentials")
    resp = client.get(
        f"{route_base}/git-credentials",
        params={"workspace_id": workspace_id},
        expect_status=(200,),
    )
    creds = resp.json()
    assert creds["username"] == "x-access-token", f"Expected username='x-access-token', got {creds['username']}"
    assert creds.get("password"), "Expected non-empty password (installation token)"
    print(f"[smoke] Got git credentials: username={creds['username']}, token=****{creds['password'][-4:]}")
    return creds


def phase_verify_credentials(client: SmokeClient, creds: dict) -> None:
    """Verify git credentials work against the GitHub API."""
    client.set_phase("verify-credentials")
    import httpx
    resp = httpx.get(
        "https://api.github.com/installation/repositories",
        headers={
            "Authorization": f"Bearer {creds['password']}",
            "Accept": "application/vnd.github+json",
        },
        timeout=15,
    )
    # Record in client for reporting
    client._record("GET", "github.com/installation/repositories", resp, resp.status_code == 200, 0)
    assert resp.status_code == 200, f"GitHub API auth failed: {resp.status_code}"
    repos = resp.json().get("repositories", [])
    print(f"[smoke] Credentials valid — {len(repos)} repo(s) visible via installation token")


def phase_git_push(client: SmokeClient, creds: dict, repo_full_name: str) -> str:
    """Clone test repo, write a file, commit, and push using installation credentials.

    Returns the file path that was pushed.
    """
    import tempfile
    import os

    client.set_phase("git-push")
    ts = int(time.time())
    file_name = f"smoke-test-{ts}.txt"
    clone_url = f"https://x-access-token:{creds['password']}@github.com/{repo_full_name}.git"

    with tempfile.TemporaryDirectory(prefix="smoke-gh-") as tmpdir:
        # Clone
        result = subprocess.run(
            ["git", "clone", "--depth=1", clone_url, "repo"],
            cwd=tmpdir,
            capture_output=True, text=True, timeout=30,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
        assert result.returncode == 0, f"Clone failed: {result.stderr}"
        print(f"[smoke] Cloned {repo_full_name}")

        repo_dir = os.path.join(tmpdir, "repo")

        # Write a test file
        with open(os.path.join(repo_dir, file_name), "w") as f:
            f.write(f"Smoke test at {ts}\nGenerated by smoke_github_connect.py\n")

        # Configure git identity
        subprocess.run(["git", "config", "user.email", "smoke@test.local"], cwd=repo_dir, check=True)
        subprocess.run(["git", "config", "user.name", "Smoke Test"], cwd=repo_dir, check=True)

        # Add and commit
        subprocess.run(["git", "add", file_name], cwd=repo_dir, check=True)
        result = subprocess.run(
            ["git", "commit", "-m", f"smoke test {ts}"],
            cwd=repo_dir,
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode == 0, f"Commit failed: {result.stderr}"

        # Push
        result = subprocess.run(
            ["git", "push", "origin", "main"],
            cwd=repo_dir,
            capture_output=True, text=True, timeout=30,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
        assert result.returncode == 0, f"Push failed: {result.stderr}"
        print(f"[smoke] Pushed {file_name} to {repo_full_name}")

    # Record success
    class _FakeResp:
        status_code = 200
    client._record("POST", f"git-push/{repo_full_name}", _FakeResp(), True, 0, f"pushed {file_name}")

    return file_name


def phase_verify_push(client: SmokeClient, repo_full_name: str, file_name: str) -> None:
    """Verify the pushed file exists on GitHub."""
    client.set_phase("verify-push")
    pat = _vault_get("secret/agent/boringdata-agent", "token")
    data = github_api("GET", f"https://api.github.com/repos/{repo_full_name}/contents/{file_name}", pat)
    assert data.get("name") == file_name, f"Expected {file_name}, got {data.get('name')}"
    print(f"[smoke] Verified: {file_name} exists on GitHub")
    class _FakeResp:
        status_code = 200
    client._record("GET", f"github.com/{repo_full_name}/{file_name}", _FakeResp(), True, 0)


def phase_disconnect(client: SmokeClient, route_base: str, workspace_id: str) -> None:
    """Disconnect workspace from GitHub."""
    client.set_phase("disconnect")
    resp = client.post(
        f"{route_base}/disconnect",
        json={"workspace_id": workspace_id},
        expect_status=(200,),
    )
    data = resp.json()
    assert data.get("disconnected") is True
    print(f"[smoke] Disconnected workspace={workspace_id}")


def phase_verify_disconnected(client: SmokeClient, route_base: str, workspace_id: str) -> None:
    """Verify workspace shows as disconnected."""
    client.set_phase("verify-disconnected")
    resp = client.get(
        f"{route_base}/status",
        params=_status_workspace_params(workspace_id),
        expect_status=(200,),
    )
    data = resp.json()
    assert data["configured"] is True
    assert data["connected"] is False
    print(f"[smoke] Verified: connected=False after disconnect")


def phase_creds_after_disconnect(client: SmokeClient, route_base: str, workspace_id: str) -> None:
    """Verify git-credentials returns 404 after disconnect."""
    client.set_phase("creds-after-disconnect")
    resp = client.get(
        f"{route_base}/git-credentials",
        params={"workspace_id": workspace_id},
        expect_status=(404,),
    )
    assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
    print("[smoke] Credentials correctly return 404 after disconnect")


# ── Main ────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--base-url", default="http://localhost:8000",
                        help="Backend base URL (default: http://localhost:8000)")
    parser.add_argument("--auth-mode", choices=["auto", "neon", "dev"], default="auto")
    parser.add_argument("--neon-auth-url", default="")
    parser.add_argument("--skip-signup", action="store_true")
    parser.add_argument("--email")
    parser.add_argument("--password")
    parser.add_argument("--recipient")
    parser.add_argument("--public-origin", default="")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--workspace-id", default=WORKSPACE_ID,
                        help=f"Workspace ID to use (default: {WORKSPACE_ID})")
    parser.add_argument("--installation-id", type=int, default=None,
                        help="GitHub App installation ID (auto-detected if omitted)")
    parser.add_argument("--test-repo", default=f"{TEST_ACCOUNT}/{TEST_REPO}",
                        help=f"Test repo full name (default: {TEST_ACCOUNT}/{TEST_REPO})")
    parser.add_argument("--skip-git-push", action="store_true",
                        help="Skip git clone/push operations (API-only test)")
    args = parser.parse_args()

    client = SmokeClient(args.base_url)

    # ── Phase 1: Capabilities ──────────────────────────────────────────
    caps = phase_capabilities(client)

    # ── Phase 2: Auth bootstrap ────────────────────────────────────────
    auth_mode = _resolve_auth_mode(args.auth_mode, caps)
    ensure_session(
        client,
        auth_mode=auth_mode,
        base_url=args.base_url,
        neon_auth_url=args.neon_auth_url,
        email=args.email,
        password=args.password,
        recipient=args.recipient,
        skip_signup=args.skip_signup,
        timeout_seconds=args.timeout,
        public_app_base_url=args.public_origin or None,
    )

    # ── Phase 3: GitHub status (pre-connect) ───────────────────────────
    route_info = phase_github_status(client, workspace_id=args.workspace_id)
    status = route_info["status"]
    if not status.get("configured"):
        print("[FAIL] GitHub App not configured. Set GITHUB_APP_* env vars.", file=sys.stderr)
        return 1

    if not phase_require_full_lifecycle_surface(client, route_info):
        report = client.report()
        print(json.dumps(report, indent=2))
        return 1

    route_base = route_info["route_base"]

    # ── Phase 4: List installations ────────────────────────────────────
    installations = phase_list_installations(client, route_base)
    if not installations and not args.installation_id:
        print("\n[FAIL] No GitHub App installations found.", file=sys.stderr)
        print("[FAIL] Install the app at: https://github.com/apps/boring-ui-app/installations/new",
              file=sys.stderr)
        report = client.report()
        print(json.dumps(report, indent=2))
        return 1

    selected_installation = _select_installation(
        installations,
        args.installation_id,
        args.test_repo,
    )
    installation_id = selected_installation["id"]
    account = selected_installation.get("account", "unknown")
    print(f"\n[smoke] Using installation #{installation_id} (account: {account})")

    # ── Phase 5: Connect workspace ─────────────────────────────────────
    phase_connect(client, route_base, args.workspace_id, installation_id)

    # ── Phase 6: Verify connected ──────────────────────────────────────
    phase_verify_connected(client, route_base, args.workspace_id, installation_id)

    # ── Phase 7: List repos ────────────────────────────────────────────
    phase_list_repos(client, route_base, installation_id, expected_repo=args.test_repo)

    # ── Phase 8: Get credentials ───────────────────────────────────────
    creds = phase_get_credentials(client, route_base, args.workspace_id)

    # ── Phase 9: Verify credentials against GitHub API ─────────────────
    phase_verify_credentials(client, creds)

    # ── Phase 10: Git push (optional) ──────────────────────────────────
    if not args.skip_git_push:
        file_name = phase_git_push(client, creds, args.test_repo)

        # ── Phase 11: Verify push ──────────────────────────────────────
        phase_verify_push(client, args.test_repo, file_name)
    else:
        print("[smoke] Skipping git push (--skip-git-push)")

    # ── Phase 12: Disconnect ───────────────────────────────────────────
    phase_disconnect(client, route_base, args.workspace_id)

    # ── Phase 13: Verify disconnected ──────────────────────────────────
    phase_verify_disconnected(client, route_base, args.workspace_id)

    # ── Phase 14: Credentials 404 after disconnect ─────────────────────
    phase_creds_after_disconnect(client, route_base, args.workspace_id)

    # ── Report ─────────────────────────────────────────────────────────
    report = client.report()
    print(json.dumps(report, indent=2))

    if report["ok"]:
        print(f"\nSMOKE GITHUB CONNECT: ALL {report['total']} STEPS PASSED")
        return 0
    else:
        print(f"\nSMOKE GITHUB CONNECT: {report['failed']}/{report['total']} STEPS FAILED",
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

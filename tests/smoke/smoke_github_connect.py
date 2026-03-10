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
    python3 tests/smoke/smoke_github_connect.py --skip-git-push  # skip destructive push
    python3 tests/smoke/smoke_github_connect.py --installation-id 12345
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

TEST_REPO = "boring-ui-repo"
TEST_ACCOUNT = "boringdata"
WORKSPACE_ID = "smoke-gh-test"


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
    """Check GitHub configuration and connection status."""
    client.set_phase("github-status")
    params = {}
    if workspace_id:
        params["workspace_id"] = workspace_id
    resp = client.get("/api/v1/auth/github/status", params=params, expect_status=(200,))
    data = resp.json()
    print(f"[smoke] GitHub status: configured={data.get('configured')}, connected={data.get('connected')}")
    return data


def phase_list_installations(client: SmokeClient) -> list[dict]:
    """List GitHub App installations."""
    client.set_phase("installations")
    resp = client.get("/api/v1/auth/github/installations", expect_status=(200,))
    installations = resp.json().get("installations", [])
    for inst in installations:
        print(f"[smoke]   Installation #{inst['id']} — {inst['account']} ({inst['account_type']})")
    if not installations:
        print("[smoke] No installations found.")
        print("[smoke] Install the GitHub App at: https://github.com/apps/boring-ui-app/installations/new")
    return installations


def phase_connect(client: SmokeClient, workspace_id: str, installation_id: int) -> dict:
    """Connect a workspace to a GitHub App installation."""
    client.set_phase("connect")
    resp = client.post(
        "/api/v1/auth/github/connect",
        json={"workspace_id": workspace_id, "installation_id": installation_id},
        expect_status=(200,),
    )
    data = resp.json()
    assert data.get("connected") is True, f"Expected connected=True, got {data}"
    assert data.get("installation_id") == installation_id
    print(f"[smoke] Connected workspace={workspace_id} to installation={installation_id}")
    return data


def phase_verify_connected(client: SmokeClient, workspace_id: str, installation_id: int) -> None:
    """Verify workspace shows as connected."""
    client.set_phase("verify-connected")
    resp = client.get(
        "/api/v1/auth/github/status",
        params={"workspace_id": workspace_id},
        expect_status=(200,),
    )
    data = resp.json()
    assert data["configured"] is True
    assert data["connected"] is True
    assert data["installation_id"] == installation_id
    print(f"[smoke] Verified: connected=True, installation_id={installation_id}")


def phase_list_repos(client: SmokeClient, installation_id: int, expected_repo: str | None = None) -> list[dict]:
    """List repos accessible to an installation."""
    client.set_phase("list-repos")
    resp = client.get(
        "/api/v1/auth/github/repos",
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


def phase_get_credentials(client: SmokeClient, workspace_id: str) -> dict:
    """Get git credentials for a connected workspace."""
    client.set_phase("credentials")
    resp = client.get(
        "/api/v1/auth/github/git-credentials",
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


def phase_disconnect(client: SmokeClient, workspace_id: str) -> None:
    """Disconnect workspace from GitHub."""
    client.set_phase("disconnect")
    resp = client.post(
        "/api/v1/auth/github/disconnect",
        json={"workspace_id": workspace_id},
        expect_status=(200,),
    )
    data = resp.json()
    assert data.get("disconnected") is True
    print(f"[smoke] Disconnected workspace={workspace_id}")


def phase_verify_disconnected(client: SmokeClient, workspace_id: str) -> None:
    """Verify workspace shows as disconnected."""
    client.set_phase("verify-disconnected")
    resp = client.get(
        "/api/v1/auth/github/status",
        params={"workspace_id": workspace_id},
        expect_status=(200,),
    )
    data = resp.json()
    assert data["configured"] is True
    assert data["connected"] is False
    print(f"[smoke] Verified: connected=False after disconnect")


def phase_creds_after_disconnect(client: SmokeClient, workspace_id: str) -> None:
    """Verify git-credentials returns 404 after disconnect."""
    client.set_phase("creds-after-disconnect")
    resp = client.get(
        "/api/v1/auth/github/git-credentials",
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
    phase_capabilities(client)

    # ── Phase 2: GitHub status (pre-connect) ───────────────────────────
    status = phase_github_status(client)
    if not status.get("configured"):
        print("[FAIL] GitHub App not configured. Set GITHUB_APP_* env vars.", file=sys.stderr)
        return 1

    # ── Phase 3: List installations ────────────────────────────────────
    installations = phase_list_installations(client)
    if not installations and not args.installation_id:
        print("\n[FAIL] No GitHub App installations found.", file=sys.stderr)
        print("[FAIL] Install the app at: https://github.com/apps/boring-ui-app/installations/new",
              file=sys.stderr)
        report = client.report()
        print(json.dumps(report, indent=2))
        return 1

    installation_id = args.installation_id or installations[0]["id"]
    account = next(
        (i["account"] for i in installations if i["id"] == installation_id),
        "unknown",
    )
    print(f"\n[smoke] Using installation #{installation_id} (account: {account})")

    # ── Phase 4: Connect workspace ─────────────────────────────────────
    phase_connect(client, args.workspace_id, installation_id)

    # ── Phase 5: Verify connected ──────────────────────────────────────
    phase_verify_connected(client, args.workspace_id, installation_id)

    # ── Phase 6: List repos ────────────────────────────────────────────
    phase_list_repos(client, installation_id, expected_repo=args.test_repo)

    # ── Phase 7: Get credentials ───────────────────────────────────────
    creds = phase_get_credentials(client, args.workspace_id)

    # ── Phase 8: Verify credentials against GitHub API ─────────────────
    phase_verify_credentials(client, creds)

    # ── Phase 9: Git push (optional) ───────────────────────────────────
    if not args.skip_git_push:
        file_name = phase_git_push(client, creds, args.test_repo)

        # ── Phase 10: Verify push ──────────────────────────────────────
        phase_verify_push(client, args.test_repo, file_name)
    else:
        print("[smoke] Skipping git push (--skip-git-push)")

    # ── Phase 11: Disconnect ───────────────────────────────────────────
    phase_disconnect(client, args.workspace_id)

    # ── Phase 12: Verify disconnected ──────────────────────────────────
    phase_verify_disconnected(client, args.workspace_id)

    # ── Phase 13: Credentials 404 after disconnect ─────────────────────
    phase_creds_after_disconnect(client, args.workspace_id)

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

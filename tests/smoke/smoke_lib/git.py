"""Git sync smoke helpers."""
from __future__ import annotations

from .client import SmokeClient


def check_git_status(client: SmokeClient) -> dict:
    """GET /api/v1/git/status and return the response data."""
    client.set_phase("git-status")
    resp = client.get("/api/v1/git/status", expect_status=(200,))
    if resp.status_code != 200:
        raise RuntimeError(f"Git status failed: {resp.status_code} {resp.text[:300]}")
    data = resp.json()
    print(f"[smoke] Git status: is_repo={data.get('is_repo')}, files={len(data.get('files', []))}")
    return data


def git_init(client: SmokeClient) -> dict:
    """POST /api/v1/git/init."""
    client.set_phase("git-init")
    resp = client.post("/api/v1/git/init", expect_status=(200,))
    if resp.status_code != 200:
        raise RuntimeError(f"Git init failed: {resp.status_code} {resp.text[:300]}")
    data = resp.json()
    assert data.get("initialized") is True, f"Expected initialized=True, got {data}"
    print("[smoke] Git init OK")
    return data


def git_add(client: SmokeClient, paths: list[str] | None = None) -> dict:
    """POST /api/v1/git/add."""
    client.set_phase("git-add")
    resp = client.post("/api/v1/git/add", json={"paths": paths}, expect_status=(200,))
    if resp.status_code != 200:
        raise RuntimeError(f"Git add failed: {resp.status_code} {resp.text[:300]}")
    data = resp.json()
    print(f"[smoke] Git add OK: paths={paths}")
    return data


def git_commit(client: SmokeClient, message: str, author: dict | None = None) -> dict:
    """POST /api/v1/git/commit."""
    client.set_phase("git-commit")
    body = {"message": message}
    if author:
        body["author"] = author
    resp = client.post("/api/v1/git/commit", json=body, expect_status=(200,))
    if resp.status_code != 200:
        raise RuntimeError(f"Git commit failed: {resp.status_code} {resp.text[:300]}")
    data = resp.json()
    oid = data.get("oid", "")
    assert len(oid) > 0, f"Expected non-empty oid, got {oid!r}"
    print(f"[smoke] Git commit OK: oid={oid[:8]}...")
    return data


def git_add_remote(client: SmokeClient, name: str, url: str) -> dict:
    """POST /api/v1/git/remote."""
    client.set_phase("git-remote-add")
    resp = client.post("/api/v1/git/remote", json={"name": name, "url": url}, expect_status=(200,))
    if resp.status_code != 200:
        raise RuntimeError(f"Git remote add failed: {resp.status_code} {resp.text[:300]}")
    data = resp.json()
    print(f"[smoke] Git remote add OK: {name} -> {url}")
    return data


def git_list_remotes(client: SmokeClient) -> list[dict]:
    """GET /api/v1/git/remotes."""
    client.set_phase("git-remotes-list")
    resp = client.get("/api/v1/git/remotes", expect_status=(200,))
    if resp.status_code != 200:
        raise RuntimeError(f"Git remotes list failed: {resp.status_code} {resp.text[:300]}")
    data = resp.json()
    remotes = data.get("remotes", [])
    print(f"[smoke] Git remotes: {len(remotes)} configured")
    return remotes


def git_nothing_to_commit(client: SmokeClient) -> None:
    """Verify commit on clean tree returns an error (400 or 500)."""
    client.set_phase("git-nothing-to-commit")
    resp = client.post(
        "/api/v1/git/commit",
        json={"message": "should fail"},
        expect_status=(400, 500),
    )
    if resp.status_code not in (400, 500):
        raise RuntimeError(f"Expected 400/500, got {resp.status_code}")
    detail = resp.json().get("detail", "").lower()
    assert "nothing to commit" in detail or "git error" in detail, \
        f"Expected error about nothing to commit, got {detail!r}"
    print(f"[smoke] Git nothing-to-commit returns {resp.status_code} as expected")


def github_status(client: SmokeClient, workspace_id: str | None = None) -> dict:
    """GET current TS GitHub status, falling back to the legacy Python route."""
    client.set_phase("github-status")
    resp = client.get("/api/v1/github/status", expect_status=(200, 401, 404, 503))
    if resp.status_code == 401:
        raise RuntimeError("GitHub status requires an authenticated session")
    if resp.status_code != 404:
        data = resp.json()
        configured = data.get("configured", False)
        print(f"[smoke] GitHub status: configured={configured}, connected={data.get('connected', False)}")
        return data

    params = {}
    if workspace_id:
        params["workspace_id"] = workspace_id
    legacy_resp = client.get("/api/v1/auth/github/status", params=params, expect_status=(200, 401, 503))
    if legacy_resp.status_code == 401:
        raise RuntimeError("Legacy GitHub status requires an authenticated session")
    data = legacy_resp.json()
    configured = data.get("configured", False)
    print(f"[smoke] GitHub status: configured={configured}, connected={data.get('connected', False)}")
    return data


def full_git_cycle(client: SmokeClient, file_path: str = "smoke-test.txt", content: str = "smoke test content") -> dict:
    """Run a full git cycle: init → write file → add → commit → verify status clean.

    Returns the commit data (with oid).
    """
    # 1. Init repo
    git_init(client)

    # 2. Write a file
    client.set_phase("git-cycle-write")
    write_resp = client.put(
        "/api/v1/files/write",
        params={"path": file_path},
        json={"content": content},
        expect_status=(200,),
    )
    if write_resp.status_code != 200:
        raise RuntimeError(f"Write failed: {write_resp.status_code}")

    # 3. Check status shows dirty
    status = check_git_status(client)
    assert status.get("is_repo") is True
    files = status.get("files", [])
    dirty_paths = [f["path"] for f in files if f.get("status") != "C"]
    assert len(dirty_paths) > 0, f"Expected dirty files after write, got {files}"
    print(f"[smoke] {len(dirty_paths)} dirty file(s) detected")

    # 4. Add
    git_add(client, [file_path])

    # 5. Commit
    commit_data = git_commit(client, "smoke test commit", author={
        "name": "Smoke Test",
        "email": "smoke@test.local",
    })

    # 6. Verify clean (ignore .boring/ — workspace metadata, always untracked)
    status_after = check_git_status(client)
    clean_files = [
        f for f in status_after.get("files", [])
        if f.get("status") not in (None, "") and not f.get("path", "").startswith(".boring")
    ]
    assert len(clean_files) == 0, f"Expected clean status after commit, got {clean_files}"
    print("[smoke] Git cycle complete — status is clean")

    return commit_data


def full_git_remote_cycle(client: SmokeClient) -> None:
    """Test remote add → list → verify → add (replace) cycle."""
    # 1. Add remote
    git_add_remote(client, "origin", "https://github.com/test/repo.git")

    # 2. List remotes
    remotes = git_list_remotes(client)
    assert len(remotes) == 1, f"Expected 1 remote, got {len(remotes)}"
    assert remotes[0]["remote"] == "origin"
    assert remotes[0]["url"] == "https://github.com/test/repo.git"

    # 3. Replace remote
    git_add_remote(client, "origin", "https://github.com/test/repo-v2.git")
    remotes = git_list_remotes(client)
    assert len(remotes) == 1
    assert remotes[0]["url"] == "https://github.com/test/repo-v2.git"
    print("[smoke] Git remote cycle complete")


def git_security_checks(client: SmokeClient) -> None:
    """Verify security validations are in place."""
    client.set_phase("git-security")

    # Flag injection via remote name
    resp = client.post("/api/v1/git/remote", json={
        "name": "--upload-pack=/bin/sh",
        "url": "https://github.com/test/repo.git",
    }, expect_status=(400,))
    assert resp.status_code == 400, f"Expected 400 for flag injection remote, got {resp.status_code}"
    print("[smoke] Flag injection blocked for remote name")

    # Clone without URL
    resp = client.post("/api/v1/git/clone", json={}, expect_status=(400,))
    assert resp.status_code == 400
    print("[smoke] Clone without URL returns 400")

    # Remote add without required fields
    resp = client.post("/api/v1/git/remote", json={"name": "test"}, expect_status=(400,))
    assert resp.status_code == 400
    print("[smoke] Remote add without URL returns 400")

    print("[smoke] Security checks passed")

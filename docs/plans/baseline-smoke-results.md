# Baseline Smoke Results

Baseline recorded for `bd-f4iu0.2` at `2026-03-25T15:22:10Z` on commit `e56e712f01395e77da331b720e861b25781198da`.

## How this baseline was captured

- Local isolated Python servers were started via `boring_ui.app_config_loader:app`.
- Temporary workspace roots lived under `/tmp` to avoid mutating the repo checkout.
- A temporary `/tmp/boring-ui-smoke.toml` override set `frontend.data.backend = "http"` so smoke checks matched the deployed HTTP filesystem path.
- Three profiles were used:
  - `local-dev-httpfs`: local control plane + dev auto-login
  - `local-neon-httpfs`: Neon auth + prod DB/session settings
  - `local-dev-httpfs-github`: local control plane + dev auto-login + real GitHub App credentials

## Executed suites

### Passed

- `smoke_health.py` on `local-dev-httpfs`
- `smoke_capabilities.py` on `local-dev-httpfs`
- `smoke_filesystem.py` on `local-dev-httpfs`
- `smoke_settings.py` on `local-dev-httpfs`
- `smoke_ui_state.py` on `local-dev-httpfs`
- `smoke_core_mode.py` on `local-dev-httpfs`
- `smoke_edge_mode.py` on `local-dev-httpfs` with `--skip-sprite --skip-agent`
- `smoke_health.py` on `local-neon-httpfs`
- `smoke_capabilities.py` on `local-neon-httpfs`
- `smoke_github_connect.py` on `local-dev-httpfs-github` when pinned to installation `115315424` (`boringdata`) and run with `--skip-git-push`

### Failed

- `smoke_workspace_lifecycle.py` on `local-dev-httpfs`
  - Workspace creation, listing, setup, runtime, boundary runtime, and root checks passed.
  - The rename step failed with `404 Not Found`.

- `smoke_git_sync.py` on `local-dev-httpfs`
  - The suite failed its post-commit clean-state assertion.
  - Observed unexpected git status: `smoke-fs-persist.txt` remained `U`.
  - This looks like workspace/file persistence leaking across suites or incorrect workspace scoping for git state.

- `smoke_agent_ws.py` on `local-dev-httpfs`
  - Workspace-scoped websocket handshake to `/w/<workspace_id>/ws/agent/normal/stream` was rejected with HTTP `403`.

- `smoke_neon_auth.py` on `local-neon-httpfs`
  - Signup reached email delivery and received the verification message.
  - Verification then failed with `403 {"code":"INVALID_CALLBACKURL","message":"Invalid callbackURL"}` for `http://127.0.0.1:<port>/auth/callback?...`.
  - This blocked running the rest of the Neon-authenticated suite family locally against that callback origin.

### Skipped

- `smoke_child_app.py`
  - Needs a real child-app target or deployed child-app URL to exercise extension behavior meaningfully.

- `smoke_backend_agent.py`
  - Needs backend-agent placement / sidecar runtime, which was not launched for this baseline session.

- `smoke_pi_workspace.py`
  - Needs the PI workspace runtime/profile; not part of the Python-only local servers used here.

## Important notes

- `smoke_github_connect.py` is sensitive to installation selection.
  - The first run auto-selected the `hachej` installation and failed because the accessible repo set did not include `boringdata/boring-ui-repo`.
  - Re-running with `--installation-id 115315424` (`boringdata`) passed.

- This baseline is intentionally mixed:
  - local-dev proves the current Python server contract without hosted auth
  - local-neon proves the current Neon-backed server wiring and exposes the auth callback problem
  - local-dev-github proves GitHub App integration independently of the Neon callback issue

## Evidence

- Local dev suite run: `.agent-evidence/beads/bd-f4iu0.2/dev-run.log`
- Local dev summary: `.agent-evidence/beads/bd-f4iu0.2/dev-run/summary.json`
- Core mode run: `.agent-evidence/beads/bd-f4iu0.2/core-mode-dev.log`
- Edge mode run: `.agent-evidence/beads/bd-f4iu0.2/edge-mode-dev.log`
- Neon health: `.agent-evidence/beads/bd-f4iu0.2/neon-run/health.log`
- Neon capabilities: `.agent-evidence/beads/bd-f4iu0.2/neon-run/capabilities.log`
- Neon auth failure: `.agent-evidence/beads/bd-f4iu0.2/neon-run/neon-auth.log`
- GitHub connect auto-selection failure: `.agent-evidence/beads/bd-f4iu0.2/github-connect.log`
- GitHub connect pinned-installation pass: `.agent-evidence/beads/bd-f4iu0.2/github-connect-boringdata.log`

## Recommended follow-up beads

- Fix local workspace rename route so `smoke_workspace_lifecycle.py` can pass.
- Investigate workspace isolation / git scoping leak behind `smoke_git_sync.py`.
- Fix auth or workspace-boundary handling for `/w/<workspace_id>/ws/agent/normal/stream`.
- Resolve the Neon callback allowlist/origin problem so `smoke_neon_auth.py` can run locally against the canonical Python server.

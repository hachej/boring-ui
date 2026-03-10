# GitHub Integration — Setup & Smoke Tests

## Overview

boring-ui integrates with GitHub via a **GitHub App** (`boring-ui-app`) for workspace-level git operations. The App provides installation tokens that grant per-repo access without user PATs.

## Architecture

```
User → boring-ui frontend → boring-ui backend → GitHub API
                                 │
                          GitHubAppService
                          ├── JWT (from private key)
                          ├── OAuth (client_id/secret)
                          └── Installation tokens (1hr, cached)
```

**Backend modules:**
- `src/back/boring_ui/api/modules/github_auth/service.py` — JWT, OAuth, installation tokens
- `src/back/boring_ui/api/modules/github_auth/router.py` — API endpoints

**Frontend:**
- `src/front/components/GitHubConnect.jsx` — `useGitHubConnection` hook + full settings UI
- `src/front/panels/FileTreePanel.jsx` — GitHub connect icon in sidebar header

## GitHub App: `boring-ui-app`

| Field | Value |
|-------|-------|
| App ID | `3045223` |
| Slug | `boring-ui-app` |
| Owner | `hachej` |
| Visibility | Private |
| Permissions | `contents:write`, `metadata:read` |
| Vault path | `secret/agent/services/boring-ui-app` |

### Vault fields

```bash
vault kv get secret/agent/services/boring-ui-app
# Fields: app_id, client_id, client_secret, pem, slug, owner, permissions
```

### Environment variables

The backend reads these from env:

| Env var | Vault field |
|---------|-------------|
| `GITHUB_APP_ID` | `app_id` |
| `GITHUB_APP_CLIENT_ID` | `client_id` |
| `GITHUB_APP_CLIENT_SECRET` | `client_secret` |
| `GITHUB_APP_PRIVATE_KEY` | `pem` |
| `GITHUB_APP_SLUG` | `slug` |

### Starting backend with GitHub enabled

```bash
export GITHUB_APP_ID=$(vault kv get -field=app_id secret/agent/services/boring-ui-app)
export GITHUB_APP_CLIENT_ID=$(vault kv get -field=client_id secret/agent/services/boring-ui-app)
export GITHUB_APP_CLIENT_SECRET=$(vault kv get -field=client_secret secret/agent/services/boring-ui-app)
export GITHUB_APP_PRIVATE_KEY="$(vault kv get -field=pem secret/agent/services/boring-ui-app)"
export GITHUB_APP_SLUG=$(vault kv get -field=slug secret/agent/services/boring-ui-app)
export ANTHROPIC_API_KEY=$(vault kv get -field=api_key secret/agent/anthropic)

python3 -c "from boring_ui.api.app import create_app; import uvicorn; app = create_app(); uvicorn.run(app, host='0.0.0.0', port=8000)"
```

## Installing the App

The app is **private** — only the owner (`hachej`) can see the install page.

1. Log into GitHub as `hachej`
2. Visit: https://github.com/apps/boring-ui-app/installations/new
3. Select the target account (e.g., `boringdata`)
4. Grant access to specific repos (at minimum: `boring-ui-test`)

To make the app public (allows any user to install):
1. Go to https://github.com/settings/apps/boring-ui-app
2. Under "Make this GitHub App public" → enable

### Callback URL

The GitHub App must have this callback URL registered:

```
http://<your-host>/api/v1/auth/github/callback
```

For local dev: `http://213.32.19.186:5175/api/v1/auth/github/callback`

## API Endpoints

All under prefix `/api/v1/auth/github`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/status` | Check if GitHub is configured + workspace connection status |
| `GET` | `/authorize` | Start OAuth flow (redirects to GitHub) |
| `GET` | `/callback` | Handle OAuth callback (returns HTML with postMessage) |
| `POST` | `/connect` | Connect workspace to installation |
| `POST` | `/disconnect` | Disconnect workspace |
| `GET` | `/installations` | List all app installations |
| `GET` | `/repos` | List repos accessible to an installation |
| `GET` | `/git-credentials` | Get `x-access-token` + installation token |

## Test Repo: `boringdata/boring-ui-test`

Private repo under the `boringdata` GitHub account, used by smoke tests.

| Field | Value |
|-------|-------|
| Full name | `boringdata/boring-ui-test` |
| Visibility | Private |
| Purpose | Smoke test target for GitHub integration |
| PAT access | `secret/agent/boringdata-agent` (field: `token`) |

## Smoke Test: `smoke_github_connect.py`

Location: `tests/smoke/smoke_github_connect.py`

### Prerequisites

1. Backend running with `GITHUB_APP_*` env vars
2. `boring-ui-app` installed on `boringdata` account
3. Installation has access to `boring-ui-test` repo

### Phases (13 steps)

| # | Phase | What it tests |
|---|-------|---------------|
| 1 | `capabilities` | Backend up, `github: true` in features |
| 2 | `github-status` | `/status` returns `configured: true` |
| 3 | `installations` | `/installations` returns at least one |
| 4 | `connect` | `POST /connect` links workspace to installation |
| 5 | `verify-connected` | `/status?workspace_id=...` shows `connected: true` |
| 6 | `list-repos` | `/repos` includes `boringdata/boring-ui-test` |
| 7 | `credentials` | `/git-credentials` returns valid token |
| 8 | `verify-credentials` | Token works against `api.github.com` |
| 9 | `git-push` | Clone, commit, push via installation token |
| 10 | `verify-push` | File exists on GitHub (verified via PAT) |
| 11 | `disconnect` | `POST /disconnect` removes connection |
| 12 | `verify-disconnected` | `/status` shows `connected: false` |
| 13 | `creds-after-disconnect` | `/git-credentials` returns 404 |

### Running

```bash
# Full E2E (requires app installed)
python3 tests/smoke/smoke_github_connect.py

# Custom backend URL
python3 tests/smoke/smoke_github_connect.py --base-url http://localhost:8000

# Skip git push (API-only)
python3 tests/smoke/smoke_github_connect.py --skip-git-push

# Override installation ID
python3 tests/smoke/smoke_github_connect.py --installation-id 12345

# Custom test repo
python3 tests/smoke/smoke_github_connect.py --test-repo boringdata/boring-ui-test
```

### Output

JSON report with pass/fail per step:

```json
{
  "ok": true,
  "passed": 15,
  "failed": 0,
  "total": 15,
  "steps": [
    {"phase": "capabilities", "method": "GET", "path": "/api/capabilities", "status": 200, "ok": true},
    ...
  ]
}
```

## Other Smoke Tests

| Test | File | Description |
|------|------|-------------|
| Core mode | `smoke_core_mode.py` | Auth → workspace → files → agent |
| Edge mode | `smoke_edge_mode.py` | Full edge deployment: signup → provisioning → sprite |
| Git sync | `smoke_git_sync.py` | Git init → commit → remotes → security |
| Settings | `smoke_settings.py` | User + workspace settings CRUD |
| Signup | `smoke_supabase_resend_signup.py` | Supabase signup + email verification |
| **GitHub** | `smoke_github_connect.py` | GitHub App connect/disconnect lifecycle |

### Smoke lib (`tests/smoke/smoke_lib/`)

| Module | Purpose |
|--------|---------|
| `client.py` | `SmokeClient` — httpx wrapper with cookie persistence + reporting |
| `auth.py` | Supabase signup/signin flows |
| `workspace.py` | Workspace creation + runtime polling |
| `files.py` | File CRUD operations |
| `git.py` | Git operations + GitHub status checks |
| `agent.py` | Agent WebSocket roundtrips |
| `resend.py` | Email polling + confirmation URL extraction |
| `secrets.py` | Vault + env var secret loading |
| `settings.py` | Settings CRUD helpers |

## Troubleshooting

**"GitHub feature not enabled"**
- Check `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` env vars are set
- Verify: `curl http://localhost:8000/api/capabilities | jq .features.github`

**"No installations found"**
- The app needs to be installed on the target account
- Visit: https://github.com/apps/boring-ui-app/installations/new (as `hachej`)

**"boring-ui-app is a private GitHub App"**
- The app is private — only the owner can see the install page
- Either make it public in GitHub App settings, or log in as `hachej`

**OAuth callback fails**
- Check the callback URL is registered in the GitHub App settings
- For dev: `http://213.32.19.186:5175/api/v1/auth/github/callback`

**Installation token 404**
- The installation may have been revoked
- Re-install the app at the install URL

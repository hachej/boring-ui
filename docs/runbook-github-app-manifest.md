# Runbook: Create a GitHub App (Manifest Flow)

Reusable runbook for creating GitHub Apps for any boring-* service.
Uses the manifest flow — one browser click, everything else scripted.

## Quick Start

```bash
# 1. Generate the creation page
./scripts/github-app-create.sh \
  --name "Boring UI" \
  --homepage "https://github.com/boringdata/boring-ui" \
  --callback "https://your-domain.com/api/v1/auth/github/callback" \
  --vault-path "secret/agent/github-app-boring-ui"

# 2. Open the printed URL in your browser, click "Create GitHub App"
# 3. Paste the code from the redirect URL
# 4. Done — credentials stored in Vault
```

---

## How It Works

```
You run the script
  |
  v
Script generates an HTML page and serves it
  |
  v
You open the URL in your browser → auto-POSTs manifest to GitHub
  |
  v
GitHub shows "Create GitHub App" → you click it
  |
  v
GitHub redirects to redirect_url?code=XXXXX
  |
  v
You paste the code → script exchanges it for credentials via API
  |
  v
Credentials stored in Vault (app_id, client_id, client_secret, pem)
```

---

## Manual Steps (if the script isn't available)

### Step 1: Create the App

Open this HTML locally (save as a file, open in browser). Replace the 3
placeholders with your values:

```html
<!DOCTYPE html>
<html><body>
<h2>Create GitHub App</h2>
<form id="f" action="https://github.com/settings/apps/new" method="post">
  <input type="hidden" name="manifest" id="m">
  <button type="submit" style="font-size:18px;padding:10px 24px">
    Create GitHub App
  </button>
</form>
<script>
document.getElementById('m').value = JSON.stringify({
  "name":        "YOUR_APP_NAME",
  "url":         "YOUR_HOMEPAGE_URL",
  "description": "Git sync integration for YOUR_APP_NAME",
  "redirect_url":"YOUR_CALLBACK_URL",
  "callback_urls":["YOUR_CALLBACK_URL"],
  "public":       false,
  "default_permissions": {"contents":"write","metadata":"read"},
  "default_events": []
});
</script>
</body></html>
```

IMPORTANT: Do NOT include `hook_attributes` unless you need webhooks.
GitHub requires `hook_attributes.url` whenever the object is present,
even with `active: false`. Omit it entirely for apps that don't use webhooks.

Click the button. GitHub shows a confirmation page. Click "Create GitHub App".

After creation, GitHub redirects to `YOUR_CALLBACK_URL?code=v1.XXXXX`.
Copy the `code` value from the URL bar.

### Step 2: Exchange the Code for Credentials

The code is valid for 1 hour, single-use.

```bash
CODE="v1.XXXXX"  # paste your code here

gh api --method POST "/app-manifests/${CODE}/conversions" \
  > /tmp/github-app-creds.json

# Inspect what we got
python3 -c "
import json
c = json.load(open('/tmp/github-app-creds.json'))
print(f'App ID:        {c[\"id\"]}')
print(f'Slug:          {c[\"slug\"]}')
print(f'Client ID:     {c[\"client_id\"]}')
print(f'Client Secret: {c[\"client_secret\"][:8]}...')
print(f'PEM:           {len(c[\"pem\"])} bytes')
print(f'Webhook Secret:{c.get(\"webhook_secret\", \"(none)\")}')
"
```

### Step 3: Store in Vault

```bash
APP_ID=$(python3 -c "import json; print(json.load(open('/tmp/github-app-creds.json'))['id'])")
SLUG=$(python3 -c "import json; print(json.load(open('/tmp/github-app-creds.json'))['slug'])")
CLIENT_ID=$(python3 -c "import json; print(json.load(open('/tmp/github-app-creds.json'))['client_id'])")
CLIENT_SECRET=$(python3 -c "import json; print(json.load(open('/tmp/github-app-creds.json'))['client_secret'])")
PEM=$(python3 -c "import json; print(json.load(open('/tmp/github-app-creds.json'))['pem'])")
WEBHOOK_SECRET=$(python3 -c "import json; print(json.load(open('/tmp/github-app-creds.json')).get('webhook_secret',''))")

# Store (requires Vault write access)
vault kv put secret/agent/github-app-YOUR-APP \
  app_id="$APP_ID" \
  slug="$SLUG" \
  client_id="$CLIENT_ID" \
  client_secret="$CLIENT_SECRET" \
  private_key="$PEM" \
  webhook_secret="$WEBHOOK_SECRET"

# Verify
vault kv get secret/agent/github-app-YOUR-APP

# Clean up
rm -f /tmp/github-app-creds.json
```

### Step 4: Verify the App Works

```bash
# Generate a JWT from the private key
JWT=$(python3 << 'PYSCRIPT'
import jwt, time, subprocess
app_id = subprocess.run(
    ['vault', 'kv', 'get', '-field=app_id', 'secret/agent/github-app-YOUR-APP'],
    capture_output=True, text=True).stdout.strip()
pem = subprocess.run(
    ['vault', 'kv', 'get', '-field=private_key', 'secret/agent/github-app-YOUR-APP'],
    capture_output=True, text=True).stdout.strip()
now = int(time.time())
token = jwt.encode({'iat': now - 60, 'exp': now + 600, 'iss': app_id}, pem, algorithm='RS256')
print(token)
PYSCRIPT
)

# Check the app identity
curl -s -H "Authorization: Bearer $JWT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/app | python3 -c "
import json,sys
app = json.load(sys.stdin)
print(f'App: {app[\"name\"]} (id={app[\"id\"]})')
print(f'Slug: {app[\"slug\"]}')
print(f'Permissions: {json.dumps(app.get(\"permissions\",{}), indent=2)}')
"
```

### Step 5: Register Callback URL

The app needs a callback URL registered before OAuth will work.
**This cannot be done via API** — must be set in the web UI.

1. Go to `https://github.com/settings/apps/<SLUG>`
2. Under **"Callback URL"**, add your callback URL:
   - Local dev: `http://<host>:<port>/api/v1/auth/github/callback`
   - Production: `https://your-domain.com/api/v1/auth/github/callback`
3. Save changes

Without this, GitHub will show: *"The redirect_uri is not associated with this application."*

### Step 6: Make the App Public (Recommended)

By default, new apps are **private** — only the owner can see the install page.
Make it public so users/orgs can install it:

1. Go to `https://github.com/settings/apps/<SLUG>/advanced`
2. Scroll to **"Make this GitHub App public"**
3. Click the button, confirm

Verify:
```bash
# Should return 200 (not 404)
curl -s -o /dev/null -w "%{http_code}" https://api.github.com/apps/<SLUG>
```

### Step 7: Install on Repos

```bash
SLUG=$(vault kv get -field=slug secret/agent/github-app-YOUR-APP)
echo "Install at: https://github.com/apps/${SLUG}/installations/new"
```

Open that URL, select the target account, grant access to repos, click Install.

### Step 8: Run the GitHub Connect Smoke Test

Once the app is installed and a test repo exists, run the E2E smoke test:

```bash
# Ensure backend is running with GITHUB_APP_* env vars (see Step 3 above)

# Full E2E: connect → repos → credentials → git push → disconnect
python3 tests/smoke/smoke_github_connect.py --base-url http://localhost:8000

# API-only (no git push)
python3 tests/smoke/smoke_github_connect.py --skip-git-push

# Override auto-detected installation
python3 tests/smoke/smoke_github_connect.py --installation-id 12345

# Custom test repo
python3 tests/smoke/smoke_github_connect.py --test-repo myorg/my-test-repo
```

The test validates 13 phases: capabilities, status, installations, connect,
verify-connected, list-repos, credentials, verify-credentials, git-push,
verify-push, disconnect, verify-disconnected, creds-after-disconnect.

For boring-ui specifically, the test repo is `boringdata/boring-ui-test` (private).

### Step 9: Get an Installation Token (for git ops)

```bash
# List installations
curl -s -H "Authorization: Bearer $JWT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/app/installations \
  | python3 -c "
import json,sys
for i in json.load(sys.stdin):
    print(f'  id={i[\"id\"]}  account={i[\"account\"][\"login\"]}')
"

# Create installation token
INSTALLATION_ID="<from above>"
TOKEN=$(curl -s -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")

echo "Installation token: ${TOKEN}"
echo "Valid for 1 hour. Use as git password with username x-access-token."

# Test: clone a private repo
git clone "https://x-access-token:${TOKEN}@github.com/OWNER/REPO.git" /tmp/test-clone
```

---

## Token Lifecycle

```
App Private Key (permanent, in Vault)
    |  sign JWT (valid 10 min)
    v
App JWT
    |  POST /app/installations/{id}/access_tokens
    v
Installation Token (valid 1 hour, auto-renewable)
    |  used as git credential
    v
git push / pull / clone
```

Backend should:
- Cache installation tokens in memory
- Refresh when < 5 min remaining
- Map workspace_id -> installation_id in DB/config

---

## Permissions Reference

| Permission | Level | Use case |
|---|---|---|
| `contents` | `write` | Push, pull, clone, read files |
| `contents` | `read` | Clone, read files only |
| `metadata` | `read` | List repos, check access (always included) |
| `pull_requests` | `write` | Create/update PRs |
| `pull_requests` | `read` | Read PR status |
| `issues` | `write` | Create/update issues |
| `actions` | `read` | Read CI status |

Only request what you need. Users see the permission list during installation.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Manifest error: "url wasn't supplied" | Remove `hook_attributes` entirely. GitHub requires `hook_attributes.url` whenever the object is present. |
| Code exchange fails | Code is single-use, 1-hour TTL. Re-create the app if expired. |
| `bad credentials` on JWT | Check PEM key. Check system clock (JWT uses `iat`). |
| `resource not accessible` | App not installed on that repo. Run Step 7. |
| `suspended` installation | User revoked. Prompt to re-install. |
| Installation token expired | Tokens last 1 hour. Backend must auto-refresh. |
| "redirect_uri is not associated" | Callback URL not registered. Set it in app settings (Step 5). **Cannot be set via API.** |
| "is a private GitHub App" | App is private. Make it public (Step 6) or log in as the owner. |
| `PATCH /app` returns 404 | Callback URLs and public/private toggle can only be changed via the GitHub web UI, not the API. |
| No installations after making public | Users must visit `https://github.com/apps/<slug>/installations/new` to install. |

---

## Rollback

```bash
# Delete the app (irreversible — all installations removed)
SLUG=$(vault kv get -field=slug secret/agent/github-app-YOUR-APP)
JWT="<generate as above>"
curl -X DELETE -H "Authorization: Bearer $JWT" \
  "https://api.github.com/app"

# Or via web: https://github.com/settings/apps/<slug>/advanced -> Delete

# Remove from Vault
vault kv delete secret/agent/github-app-YOUR-APP
```

---

## Git Sync Engine — Setup Guide

### Architecture Overview

```
Frontend (browser)                    Backend (FastAPI)
┌──────────────────────┐             ┌──────────────────────┐
│ httpProvider.js      │ ─ HTTP ─→   │ git/router.py        │
│   .git.init()        │             │   POST /git/init     │
│   .git.add(paths)    │             │   POST /git/add      │
│   .git.commit(msg)   │             │   POST /git/commit   │
│   .git.push()        │             │   POST /git/push     │
│   .git.pull()        │             │   POST /git/pull     │
│   .git.clone(url)    │             │   POST /git/clone    │
│   .git.status()      │             │   GET  /git/status   │
│   .git.addRemote()   │             │   POST /git/remote   │
│   .git.listRemotes() │             │   GET  /git/remotes  │
│                      │             │                      │
│ github provider      │             │ github_auth/         │
│   .github.status()   │ ─ HTTP ─→   │   GET  /auth/github/ │
│   .github.connect()  │             │     status           │
│   .github.push/pull  │             │   POST .../connect   │
│     (with creds)     │             │   GET  .../git-creds  │
└──────────────────────┘             └──────────────────────┘
                                            │
                                            ▼
                                     ┌──────────────┐
                                     │ git CLI       │
                                     │ (subprocess)  │
                                     └──────────────┘
```

### Step 1: Start the Backend (Core Git — No GitHub)

Core git operations (init, add, commit, status, diff, remotes) work without
any GitHub configuration. This is the minimal setup:

```bash
cd boring-ui

# Install backend
pip3 install -e . --break-system-packages

# Start (git features are always enabled)
python3 -c "
from boring_ui.api.app import create_app
import uvicorn
app = create_app()
uvicorn.run(app, host='0.0.0.0', port=8000)
"
```

Verify:
```bash
curl http://localhost:8000/health | python3 -m json.tool
# Should show: "git": true in features
```

### Step 2: Run the Git Smoke Test

```bash
python3 tests/smoke/smoke_git_sync.py --base-url http://localhost:8000
```

This tests: health check, git init, file write, git add, commit, status,
nothing-to-commit guard, remote add/list/replace, and security validations.

### Step 3: Enable GitHub App Integration (Optional)

GitHub App auth is **opt-in**. It only activates when both `GITHUB_APP_ID`
and `GITHUB_APP_PRIVATE_KEY` environment variables are set. When disabled:

- Core git operations work normally (init, add, commit, status, diff)
- Push/pull work with any credentials the user provides manually
- The `github` feature flag is `false` in `/api/capabilities`
- GitHub auth endpoints return 503 ("GitHub App not configured")

To enable, follow the GitHub App creation steps above, then:

```bash
# From Vault (if credentials are stored there)
export GITHUB_APP_ID=$(vault kv get -field=app_id secret/agent/github-app-boring-ui)
export GITHUB_APP_CLIENT_ID=$(vault kv get -field=client_id secret/agent/github-app-boring-ui)
export GITHUB_APP_CLIENT_SECRET=$(vault kv get -field=client_secret secret/agent/github-app-boring-ui)
export GITHUB_APP_PRIVATE_KEY=$(vault kv get -field=private_key secret/agent/github-app-boring-ui)

# Or set directly
export GITHUB_APP_ID="12345"
export GITHUB_APP_CLIENT_ID="Iv1.abc123"
export GITHUB_APP_CLIENT_SECRET="your-secret"
export GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----"

# Start backend — GitHub auth endpoints are now active
python3 -c "
from boring_ui.api.app import create_app
import uvicorn
app = create_app()
uvicorn.run(app, host='0.0.0.0', port=8000)
"
```

Verify:
```bash
curl http://localhost:8000/health | python3 -m json.tool
# Should show: "github": true in features

curl http://localhost:8000/api/v1/auth/github/status
# Should show: {"configured": true, "connected": false}

# Run smoke test with GitHub checks
python3 tests/smoke/smoke_git_sync.py --base-url http://localhost:8000 --with-github
```

### Step 4: Child App Setup

Each child app (boring-sandbox, boring-macro, etc.) can have its own
GitHub App or share the parent's. To create a new app for a child service:

1. Run the manifest flow (see Quick Start above) with the child's name
2. Store credentials in Vault at `secret/agent/github-app-<child-name>`
3. Set the 4 env vars in the child's deployment config
4. The feature activates automatically — no code changes needed

---

## API Reference

### Core Git Endpoints (Always Available)

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/api/v1/git/status` | GET | — | File status (is_repo, files array) |
| `/api/v1/git/diff` | GET | `?path=file.txt` | Diff for a file |
| `/api/v1/git/show` | GET | `?path=file.txt` | Show file at HEAD |
| `/api/v1/git/init` | POST | — | Initialize git repo |
| `/api/v1/git/add` | POST | `{"paths": ["file.txt"]}` | Stage files (null = add all) |
| `/api/v1/git/commit` | POST | `{"message": "...", "author": {...}}` | Commit staged changes |
| `/api/v1/git/push` | POST | `{"remote": "origin", "branch": "main"}` | Push to remote |
| `/api/v1/git/pull` | POST | `{"remote": "origin", "branch": "main"}` | Pull from remote |
| `/api/v1/git/clone` | POST | `{"url": "https://...", "branch": "main"}` | Clone into workspace |
| `/api/v1/git/remote` | POST | `{"name": "origin", "url": "https://..."}` | Add/replace remote |
| `/api/v1/git/remotes` | GET | — | List configured remotes |

### GitHub Auth Endpoints (Requires GitHub App Config)

| Endpoint | Method | Body/Params | Description |
|---|---|---|---|
| `/api/v1/auth/github/status` | GET | `?workspace_id=ws-1` | Connection status |
| `/api/v1/auth/github/authorize` | GET | — | Get GitHub OAuth URL |
| `/api/v1/auth/github/callback` | GET | `?code=...&state=...` | OAuth callback |
| `/api/v1/auth/github/connect` | POST | `{"workspace_id": "...", "installation_id": 123}` | Link workspace |
| `/api/v1/auth/github/disconnect` | POST | `{"workspace_id": "..."}` | Unlink workspace |
| `/api/v1/auth/github/installations` | GET | — | List user's installations |
| `/api/v1/auth/github/repos` | GET | `?installation_id=123` | List repos for installation |
| `/api/v1/auth/github/git-credentials` | GET | `?workspace_id=ws-1` | Get git credentials |

### Security Validations

- **Path traversal**: All paths validated to stay within workspace root
- **Flag injection**: Remote names, branch names reject leading dashes
- **URL validation**: Only `http://`, `https://`, `ssh://`, `git://`, and SCP-style URLs allowed
- **`--` separators**: All subprocess git commands use `--` to prevent argument injection

---

## Testing

### Unit Tests

```bash
cd boring-ui
python3 -m pytest tests/unit/test_git_write_routes.py tests/unit/test_github_auth_routes.py -v
```

### Smoke Test (Against Running Backend)

```bash
# Core git only
python3 tests/smoke/smoke_git_sync.py

# With GitHub auth checks
python3 tests/smoke/smoke_git_sync.py --with-github

# Custom backend URL
python3 tests/smoke/smoke_git_sync.py --base-url http://my-server:8000
```

### Frontend Integration

The `httpProvider.js` data provider exposes all git operations:

```javascript
import { createHttpProvider } from './providers/data/httpProvider'

const provider = createHttpProvider()

// Core git
await provider.git.init()
await provider.git.status()
await provider.git.add(['file.txt'])
const { oid } = await provider.git.commit('my message', { author: { name: 'Me', email: 'me@x.com' } })

// Remotes
await provider.git.addRemote('origin', 'https://github.com/org/repo.git')
const remotes = await provider.git.listRemotes()

// Push/pull (requires credentials via GitHub App or manual config)
await provider.git.push({ remote: 'origin', branch: 'main' })
await provider.git.pull({ remote: 'origin', branch: 'main' })

// GitHub auth (when configured)
const status = await provider.github.status('workspace-id')
if (status.configured && !status.connected) {
  const { url } = await provider.github.authorize()
  // redirect user to url for OAuth
}
```

---

## For boring-ui Specifically

Vault path: `secret/agent/github-app-boring-ui`
App name: `boring-ui-app` (slug: `boring-ui-app`)
App ID: `3045223`

Backend env vars:
```bash
export GITHUB_APP_ID=$(vault kv get -field=app_id secret/agent/github-app-boring-ui)
export GITHUB_APP_CLIENT_ID=$(vault kv get -field=client_id secret/agent/github-app-boring-ui)
export GITHUB_APP_CLIENT_SECRET=$(vault kv get -field=client_secret secret/agent/github-app-boring-ui)
export GITHUB_APP_PRIVATE_KEY=$(vault kv get -field=private_key secret/agent/github-app-boring-ui)
```

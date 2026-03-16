# Smoke Test Suite

Use these smoke scripts to validate specific surfaces of `boring-ui` and child-app deployments. The goal is to avoid one giant opaque smoke and instead run the smallest suite that proves the surface you changed.

## Structure

Smoke tests live in `tests/smoke/` and share helpers from `tests/smoke/smoke_lib/`.

There are three levels:

1. focused subsystem smokes
2. integration smokes
3. full deployment smokes

## Standard CLI Shape

All new smoke scripts should follow this shape:

```bash
python3 tests/smoke/<script>.py \
  --base-url https://<app-url> \
  --auth-mode neon \
  --evidence-out .agent-evidence/smoke/<name>.json
```

Common flags:

- `--base-url`: app origin to test
- `--auth-mode`: `neon`, `supabase`, or `dev`
- `--skip-signup --email --password`: reuse an existing account
- `--timeout`: email polling timeout for verify-first auth flows
- `--evidence-out`: optional JSON artifact path

## Smoke Matrix

| Script | Surface | Typical use |
|---|---|---|
| `smoke_neon_auth.py` | 19-phase auth suite: signup, email delivery, signin, session, identity, workspace, logout, re-signin, wrong password, invalid/missing token, input validation, forged cookie, auth guard, duplicate signup, page rendering | auth changes, Neon deploy validation |
| `smoke_supabase_resend_signup.py` | Supabase signup + email verification | legacy auth validation |
| `smoke_workspace_lifecycle.py` | auth -> workspace create/list/setup/runtime/root/rename | control-plane and workspace routing |
| `smoke_settings.py` | user settings + workspace settings persistence | settings pages and persistence |
| `smoke_filesystem.py` | workspace-scoped files list/write/read/rename/delete | filesystem APIs and browser workspace wiring |
| `smoke_git_sync.py` | local git init/status/commit/remotes/security | core git API without GitHub |
| `smoke_github_connect.py` | GitHub App installation/repo/credentials/connect/disconnect | GitHub integration |
| `smoke_core_mode.py` | end-to-end core mode | pre-release full-stack smoke |
| `smoke_edge_mode.py` | end-to-end edge mode | edge/sandbox deploy validation |

## Recommended Sequence

### Child app deploy smoke

For a child app deployed on top of the shared `boring-ui` contract, run:

1. auth smoke
2. workspace lifecycle smoke
3. filesystem or settings smoke, depending on what the app uses
4. git/github smoke if the app exposes repo integration
5. one app-specific smoke for the child app's primary action

Minimum recommended sequence:

```bash
python3 tests/smoke/smoke_neon_auth.py --base-url https://<app-url>
python3 tests/smoke/smoke_workspace_lifecycle.py --base-url https://<app-url> --auth-mode neon
python3 tests/smoke/smoke_filesystem.py --base-url https://<app-url> --auth-mode neon
```

If the app exposes settings:

```bash
python3 tests/smoke/smoke_settings.py --base-url https://<app-url>
```

If the app exposes GitHub sync:

```bash
python3 tests/smoke/smoke_github_connect.py --base-url https://<app-url> --skip-git-push
```

If you need the highest confidence before shipping:

```bash
python3 tests/smoke/smoke_core_mode.py --base-url https://<app-url>
```

## Focused Scripts

### Neon Auth (smoke_neon_auth.py)

Systematic 19-phase auth test covering positive flows, negative validation, and security:

| Phase | Test | What it proves |
|-------|------|----------------|
| 1 | Signup + Email | Account creation, verification email delivery |
| 2 | Signin | Password auth → JWT → token exchange → session cookie |
| 3 | Session Check | Cookie validity, user data in session |
| 4 | Identity | `/api/v1/me` resolves correct user |
| 5 | Workspace | Session gates API access |
| 6 | Logout | Cookie cleared, 401 after logout |
| 7 | Re-Signin | Session round-trip after logout |
| 8 | Wrong Password | 401 rejection |
| 9 | Invalid Token | Garbage JWT rejected at token-exchange |
| 10 | Missing Token | 400 for empty token-exchange |
| 11 | Signup Validation | No email, no password, empty body, invalid JSON |
| 12 | Signin Validation | No email, no password |
| 13 | Resend Validation | No email, invalid JSON |
| 14 | No-Cookie Session | 401 SESSION_REQUIRED |
| 15 | Forged Cookie | 401 SESSION_INVALID |
| 16 | API Auth Guard | `/api/v1/me` and `/api/v1/workspaces` require auth |
| 17 | Duplicate Signup | Same email rejected |
| 18 | Login Page | HTML renders |
| 19 | Signup Page | HTML renders |

Supports both link-based and OTP-based Neon Auth configurations.
With `--skip-signup`, skips phase 1 and runs phases 2-19 against an existing account.

```bash
# Full suite with signup (requires Resend API key in Vault)
python3 tests/smoke/smoke_neon_auth.py --base-url https://<app-url>

# Skip signup, use existing account
python3 tests/smoke/smoke_neon_auth.py --base-url https://<app-url> \
  --skip-signup --email user@test.com --password Pass123
```

### Workspace lifecycle

Validates:

- auth/session established
- workspace creation
- workspace listing
- `/w/<workspace_id>/setup`
- `/w/<workspace_id>/runtime`
- `/w/<workspace_id>/`
- workspace rename + readback

Note:
- `/w/<workspace_id>/setup` may be JSON when you hit the backend directly
- on app/dev-server URLs it may be the frontend setup page and return HTML
- the smoke accepts either as long as the route is reachable and returns `200`

Example:

```bash
python3 tests/smoke/smoke_workspace_lifecycle.py \
  --base-url http://127.0.0.1:5176 \
  --auth-mode dev
```

### Filesystem

Validates:

- workspace-scoped file tree
- write/read
- rename
- delete

Use `--include-search` only when you specifically want to validate the file search route as part of the smoke.

Example:

```bash
python3 tests/smoke/smoke_filesystem.py \
  --base-url http://127.0.0.1:5176 \
  --auth-mode dev
```

## Evidence

Use `--evidence-out` to persist the JSON result:

```bash
python3 tests/smoke/smoke_workspace_lifecycle.py \
  --base-url https://<app-url> \
  --auth-mode neon \
  --evidence-out .agent-evidence/smoke/workspace-lifecycle.json
```

The artifact contains:

- suite name
- base URL
- auth mode
- workspace id when applicable
- step-by-step pass/fail results

## Guidance For New Child Apps

Do not start with one giant app-specific smoke.

Instead:

1. reuse the shared auth/session bootstrap in `tests/smoke/smoke_lib/session_bootstrap.py`
2. reuse shared helpers from `smoke_lib/`
3. add exactly one child-app smoke for the primary user action
4. compose it with the shared smokes above

That keeps child deploy validation comparable across apps instead of creating one-off, incompatible smoke suites.

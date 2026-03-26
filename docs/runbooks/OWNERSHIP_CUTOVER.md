# Ownership Migration Cutover and Rollback

This runbook defines production rollout and rollback for the ownership split:

- `boring-ui` core is the single authority for auth/session, user/workspace, collaboration (members/invites), and workspace filesystem/git operations.
- `boring-macro` adds domain routes only (`/api/v1/macro/*`).
- `boring-sandbox` is optional edge pass-through only (routing/provisioning/token injection), with no duplicated workspace business logic.

For the Python backend-agent architecture, the canonical deployment path is direct `boring-ui` deployment on a Linux host. The `boring-sandbox` path remains supported only as a legacy compatibility option when an edge proxy is still required.

## Deployment Modes

| Mode | Frontend API target | Backend ownership path |
| --- | --- | --- |
| Frontend-only workspace (single backend) | `boring-ui` URL | Frontend -> `boring-ui` direct |
| Front + back workspace with edge proxy | `boring-sandbox` URL | Frontend -> `boring-sandbox` -> `boring-ui` (pass-through) |

`boring-sandbox` remains optional. If not needed, remove it from request path entirely.

For local containerized mode checks owned by this repo:
this compose setup validates deployment topology and routing before rollout.

```bash
# Core mode
docker compose -f deploy/core/docker-compose.yml up --build backend frontend

# Edge mode (sandbox artifact service + frontend)
mkdir -p artifacts
BUNDLE_OUTPUT="$PWD/artifacts/boring-macro-bundle.tar.gz" \
  bash deploy/edge/scripts/build_macro_bundle.sh /home/ubuntu/projects/boring-macro
docker compose -f deploy/edge/docker-compose.yml up --build sandbox frontend
```

Modal deploy helpers:

```bash
# Core mode
modal deploy deploy/core/modal_app.py

# Edge mode (control plane + sandbox data plane)
bash deploy/edge/deploy.sh
```

## Pre-Cutover Checklist

1. Deploy `boring-ui` with canonical control-plane routes enabled.
2. Confirm frontend deployment mode:
   - Core mode: `python3 scripts/run_full_app.py --deploy-mode core`
   - Edge mode: `python3 scripts/run_full_app.py --deploy-mode edge --edge-proxy-url <proxy-url>`
3. Confirm sandbox allowlist (if enabled) only proxies these families:
   - `/auth/*`
   - `/api/v1/me*`
   - `/api/v1/workspaces*`
   - `/api/v1/files/*`
   - `/api/v1/git/*`
   - `/w/{workspace_id}/*`
4. Confirm macro service only owns `/api/v1/macro/*`.

## Cutover Procedure

1. Shift frontend API base to the selected mode target (`boring-ui` direct or `boring-sandbox` proxy).
2. Run control-plane health checks:

```bash
curl -i http://<api>/health
curl -i http://<api>/auth/session
curl -i http://<api>/api/v1/me
curl -i http://<api>/api/v1/workspaces
```

3. Run collaboration checks (authenticated session):

```bash
curl -i --cookie "boring_session=<cookie>" http://<api>/api/v1/workspaces/<ws>/members
curl -i --cookie "boring_session=<cookie>" http://<api>/api/v1/workspaces/<ws>/invites
curl -i --cookie "boring_session=<cookie>" -X POST http://<api>/api/v1/workspaces/<ws>/invites
```

4. Run workspace filesystem/git authority checks:

```bash
curl -i --cookie "boring_session=<cookie>" "http://<api>/api/v1/files/tree?path=."
curl -i --cookie "boring_session=<cookie>" http://<api>/api/v1/git/status
```

5. Run boundary checks:
   - Forbidden direct routes static guard.
   - Ownership proof suites (pytest, vitest, e2e) for canonical route usage.
6. Monitor for 30-60 minutes after cutover:
   - Error envelope drift on control-plane APIs.
   - Unauthorized spikes on session/workspace routes.
   - Workspace navigation and invite acceptance regressions.

## Rollback Triggers

Rollback if any of the following occurs and cannot be corrected quickly:

1. Session/auth outage on `/auth/session` or `/auth/logout`.
2. Workspace lifecycle/settings routes failing at elevated rates.
3. Collaboration actions (member upsert, invite create/accept) failing at elevated rates.
4. Filesystem/git authority violations or incorrect proxy rewriting by sandbox.

## Rollback Procedure

1. Freeze rollout and stop further traffic shifting.
2. Route frontend traffic back to last known healthy API target.
   - Core mode: previous `boring-ui` deployment.
   - Edge mode: previous edge config that is known-good.
3. Re-run fast validation:

```bash
curl -i http://<api>/health
curl -i http://<api>/auth/session
curl -i http://<api>/api/v1/workspaces
```

4. Confirm macro endpoints still isolated (`/api/v1/macro/*` only).
5. Document incident + cause before next cutover attempt.

## Rollback Rehearsal

Before relying on rollback during a cutover, rehearse the exact Python path that would be used as the fallback.

Required env:

- `DATABASE_URL`
- `BORING_UI_SESSION_SECRET`
- `BORING_SETTINGS_KEY`
- `NEON_AUTH_BASE_URL`
- `NEON_AUTH_JWKS_URL`
- `RESEND_API_KEY` for verify-first signup rehearsals

Single-command local proof:

```bash
python3 scripts/rehearse_python_rollback.py \
  --summary-out .agent-evidence/beads/bd-tpbk6.3/local-summary.json
```

The script owns the parity env for the rehearsal:

- `LOCAL_PARITY_MODE=http`
- `AUTH_SESSION_SECURE_COOKIE=false`
- `BORING_UI_PUBLIC_ORIGIN=http://127.0.0.1:5176` by default
- `BORING_UI_STATIC_DIR=$PWD/dist`
- `BORING_UI_WORKSPACE_ROOT=/tmp/boring-ui-rollback-workspaces`
- `BUI_APP_TOML=$PWD/boring.app.toml`
- `PYTHONPATH=$PWD/src/back`

Useful flags:

- `--skip-signup --email <email> --password '<password>'` for repeat runs against an existing account
- `--public-origin <origin>` if the trusted callback origin must differ from the local smoke target
- `--dry-run` to print the exact commands without executing them

Hosted rollback preview:

```bash
python3 scripts/rehearse_python_rollback.py \
  --dry-run \
  --skip-sync \
  --skip-build \
  --skip-smoke \
  --print-hosted-commands \
  --hosted-url https://boring-ui-frontend-agent.fly.dev
```

That preview prints the exact hosted rollback deploy sequence:

```bash
bash deploy/fly/fly.secrets.sh boring-ui-frontend-agent
fly deploy -c deploy/fly/fly.frontend-agent.toml --remote-only
```

The direct cutover path uses that same Fly app/config, but it now points at the TypeScript backend image (`deploy/shared/Dockerfile.ts-backend`).
Treat `deploy/fly/fly.frontend-agent.toml` as canonical; `deploy/fly/fly.ts-backend.toml`
is only a compatibility alias and must stay identical.

Then run the printed hosted smoke command against the rollback target URL. Treat the rollback path as unproven until both the deploy and the smoke pass, and record the full wall-clock time from deploy start through smoke completion. Target: under 5 minutes.

## No-Retro-Compat Policy

This migration path assumes no retro-compat shims are required. Rollback is operational (traffic + deployment) rather than contract-bridging.

## Verification Commands

```bash
# Ownership verification runner (full matrix)
PW_E2E_PORT=44173 PW_E2E_API_PORT=48000 python3 scripts/bd_3g1g_verify.py

# Bead metadata lint
br lint
```

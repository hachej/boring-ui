# Ownership Migration Cutover and Rollback

This runbook defines production rollout and rollback for the ownership split:

- `boring-ui` core is the single authority for auth/session, user/workspace, collaboration (members/invites), and workspace filesystem/git operations.
- `boring-macro` adds domain routes only (`/api/v1/macro/*`).
- `boring-sandbox` is optional edge pass-through only (routing/provisioning/token injection), with no duplicated workspace business logic.

## Deployment Modes

| Mode | Frontend API target | Backend ownership path |
| --- | --- | --- |
| Frontend-only workspace (single backend) | `boring-ui` URL | Frontend -> `boring-ui` direct |
| Front + back workspace with edge proxy | `boring-sandbox` URL | Frontend -> `boring-sandbox` -> `boring-ui` (pass-through) |

`boring-sandbox` remains optional. If not needed, remove it from request path entirely.

For local containerized mode checks owned by this repo:

```bash
# Core mode
docker compose -f deploy/docker/docker-compose.yml up --build backend frontend-core

# Proxy mode
docker compose -f deploy/docker/docker-compose.yml --profile sandbox-proxy \
  up --build backend edge-proxy frontend-sandbox-proxy
```

## Pre-Cutover Checklist

1. Deploy `boring-ui` with canonical control-plane routes enabled.
2. Confirm frontend deployment mode:
   - Core mode: `python3 scripts/run_full_app.py --deploy-mode core`
   - Sandbox-proxy mode: `python3 scripts/run_full_app.py --deploy-mode sandbox-proxy --sandbox-proxy-url <proxy-url>`
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
   - Sandbox-proxy mode: previous edge config that is known-good.
3. Re-run fast validation:

```bash
curl -i http://<api>/health
curl -i http://<api>/auth/session
curl -i http://<api>/api/v1/workspaces
```

4. Confirm macro endpoints still isolated (`/api/v1/macro/*` only).
5. Document incident + cause before next cutover attempt.

## No-Retro-Compat Policy

This migration path assumes no retro-compat shims are required. Rollback is operational (traffic + deployment) rather than contract-bridging.

## Verification Commands

```bash
# Ownership verification runner (full matrix)
PW_E2E_PORT=44173 PW_E2E_API_PORT=48000 python3 scripts/bd_3g1g_verify.py

# Bead metadata lint
br lint
```

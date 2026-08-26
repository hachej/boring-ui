# Deploy a Vertical Agent — Golden Path (as it exists today)

How to stand up a privately-hosted, single-tenant vertical agent from the
`apps/full-app` reference shape **using only what is implemented today**.
This doc records reality, not intent: known gaps are listed at the bottom,
unresolved. Deployment-shaped reference: `apps/full-app/README.md`; the repo
does not publish or deploy images (`apps/full-app/README.md` § Container
reference) — the deploying app owns image, secrets, migrations, and proof.

## 1. Build

```bash
# web image (default target)
docker build -t my-vertical-agent -f apps/full-app/Dockerfile .

# worker image (provider-neutral remote worker; excludes frontend)
docker build --target worker-runtime -t my-vertical-agent-worker -f apps/full-app/Dockerfile .
```

- Multi-stage `apps/full-app/Dockerfile`: deps → build (ordered package builds
  + dist-drift assertion) → `runtime` (web, default) / `worker-runtime`.
  Non-root uid 10001, bubblewrap installed, `/data/workspaces` + `/data/pi-sessions`
  volume roots, healthcheck `/health`, EXPOSE 3000.
- Entrypoints: `apps/full-app/docker/web-entrypoint.sh` repairs mounted-volume
  ownership then drops privileges; `apps/full-app/docker/worker-entrypoint.sh`
  applies bwrap resource limits via env.

## 2. Secrets & env contract

Source of truth: `apps/full-app/.env.example` + env table in
`apps/full-app/README.md`. Validation lives in
`packages/core/src/server/config/loadConfig.ts` (fails closed on missing
secrets outside dev).

Required:

| Secret | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `BETTER_AUTH_SECRET` | Auth secret |
| `BETTER_AUTH_URL` | Base URL — also drives CORS defaults, secure cookies, CSP-upgrade-insecure when https (`loadConfig.ts`) |
| `WORKSPACE_SETTINGS_ENCRYPTION_KEY` | 32-byte hex; encrypts per-workspace settings at rest (`PostgresWorkspaceStore.ts`) |
| `MAIL_FROM`, `MAIL_TRANSPORT_URL` (`console://` for dev; Resend via `RESEND_API_KEY`) | Verification/reset mail |

Model + runtime (typical vertical):

| Var | Notes |
| --- | --- |
| `INFOMANIAK_API_TOKEN` + `BORING_AGENT_INFOMANIAK_PRODUCT_ID/_MODEL` or `BORING_AGENT_DEFAULT_MODEL_PROVIDER/_ID` | Default chat model (`packages/agent/src/server/models/modelConfig.ts`) |
| `BORING_AGENT_MODE=vercel-sandbox` | Production requires a remote mode unless `BORING_ALLOW_UNSAFE_AGENT_MODE=1` (`apps/full-app/src/server/productionSafety.ts`). Blaxel additionally needs `BL_WORKSPACE`/`BL_API_KEY`/`BORING_BLAXEL_REGION` and still requires the unsafe-mode override pending its security gate (`apps/full-app/README.md`) |
| `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` (+ `VERCEL_TOKEN` where OIDC unavailable) | Vercel sandbox credentials |
| `BORING_AGENT_WORKSPACE_ROOT=/data/workspaces`, `BORING_AGENT_SESSION_ROOT=/data/pi-sessions` | Durable host anchors (sibling roots; see `AGENTS.md` rule 9) |
| `CORS_ORIGINS` | Explicit origin list |
| Optional integrations | `BORING_MCP_ENABLED` + `COMPOSIO_API_KEY` (server-only), `BORING_MANAGED_AGENT_MCP_*` for external agent access |

## 3. Migrations

```bash
pnpm --filter full-app migrate   # runs apps/full-app/src/server/migrate.ts
```

Applies core migrations plus additional plugin migrations (currently boring-
automation) via `runCoreMigrationsFromEnv` against `DATABASE_URL`.

## 4. Hostname configuration (exact-hostname rules)

No DNS automation exists in-repo; hostname is pure config, TLS terminates at
the platform.

- `BETTER_AUTH_URL` sets the canonical base URL; secure-cookie and
  CSP-upgrade-insecure flip on automatically when it is https; `CORS_ORIGINS`
  must include the served origins (`loadConfig.ts` security projection).
- Signup default agent: `BORING_SIGNUP_AGENT_DEFAULTS_JSON` maps **exact**
  lowercase hostnames (no wildcards) to an initial `defaultAgentTypeId` for a
  newly created default workspace only — boot-validated
  (`packages/core/src/server/schema.ts` config schema), applied through the
  signup post-hook (`packages/core/src/server/signupAgentDefaults.ts`,
  `postSignupHook.ts`; Decision 28). Exact match is load-bearing: hostname
  never grants authority beyond this initialization.
- Presentation-only landing per hostname may be declared statically (Decision
  30, `docs/DECISIONS.md` §30): hostname selects pixels, never routing,
  membership, or persisted defaults.

## 5. Verify (smoke scripts)

```bash
pnpm --filter full-app smoke:mcp-managed-agent   # route/protocol/binding contract, no live model call
pnpm --filter full-app smoke:remote-worker       # remote-worker contract/isolation
pnpm --filter full-app e2e                       # Playwright incl. e2e/smoke spec
```

Manual checks after first deploy: sign-up flow lands on the expected default
agent (per §4 mapping); chat transcript persists across restart under
`/data/pi-sessions/<workspaceId>`; `/health` passes container healthcheck;
sandbox files appear in Vercel `/workspace`, not `/data/workspaces/<id>`
(`apps/full-app/README.md` § Container reference).

## 6. Rollback

**Rollback = redeploy the previous image tag.** Keep every deployed image
tagged; there is no in-repo release automation to lean on
(`.github/workflows/release.yml` does not publish these images).

Data safety before rollback:

- Fly.io volume snapshots are enforced daily by
  `.github/workflows/fly-worker-volume-backup.yml` +
  `apps/full-app/scripts/fly-worker-volume-backup.mjs` (requires `FLY_API_TOKEN`;
  snapshots app `boring-sandbox-worker`, volume `worker_workspace_data`,
  retention configurable, manual dispatch supported). Take an immediate
  snapshot via workflow_dispatch before any risky redeploy.
- Postgres: use your platform's PITR/snapshot tooling; nothing in-repo backs up
  the database.
- Durable state locations to snapshot: `/data/pi-sessions` (transcripts),
  `/data/workspaces` (host anchor, normally near-empty in sandbox mode),
  `.boring/ask-user.json` inside each workspace root, and Postgres itself.

## 7. Honest gaps (as of this writing)

1. **No provisioner.** Every step above is manual: platform console for app/
   volume creation, hand-delivered secrets, migrations run as a one-off
   command, smoke as script-not-pipeline. `.agents/skills/boring-app-setup/SKILL.md`
   codifies the playbook but no idempotent provisioner exists.
2. **Installing an agent package requires restart.** Boot-time server plugins
   and fleet changes are static composition; adding/changing an agent package
   means a rebuild + process restart — no hot reload for server contributions
   (`packages/workspace/docs/PLUGIN_STRUCTURE.md`; only `.pi/extensions`
   front/Pi resources hot-reload).
3. **BYOK model keys do not flow.** The vault library
   (`packages/agent/src/server/credentials/vault/`) is tested but unwired; a
   vertical shares the host's env-level provider key today (issue #820,
   plan-only).
4. **Per-agent MCP grants dormant.** `packages/agent/src/server/agent-host/mcpGrants.ts`
   exists but the core composition root does not thread grant options
   (`packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`); connector
   authorization rests on boring-mcp actor scoping alone.
5. **Blaxel production requires `BORING_ALLOW_UNSAFE_AGENT_MODE=1`** pending
   its security gate — restricts worker placement choices today
   (`apps/full-app/src/server/productionSafety.ts`).
6. **MCP managed-agent receipt/status state is process-local**, lost on
   restart (`apps/full-app/README.md` § Managed Agent MCP Endpoint).
7. **Credential rotation UX absent**: vault rewrap/version rotation exist in
   library form with no routes/UI.

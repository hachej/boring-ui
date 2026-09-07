# Agent Development Map

Canonical "where do I X" map for agent development in this repo. Every path
below is verified against `main`. Depth lives beside the code: package docs are
indexed in [`docs/README.md`](./README.md); contracts live next to their types.

## Where things live

| Concern | Path | Entry points |
| --- | --- | --- |
| Agent runtime | `packages/agent/src/server/` | `createStandaloneAgentApp.ts` (standalone), `agent-host/` (session host + HTTP projection), `harness/pi-coding-agent/createHarness.ts` (Pi loop), `runtime/mode.ts` (`direct`/`local`/`blaxel`/`vercel-sandbox`), `models/modelConfig.ts` (provider registration) |
| Agent UI (chat) | `packages/agent/src/front/` | `ChatPanel` — see `packages/agent/docs/README.md` |
| Workspace UI / Workbench | `packages/workspace/src/front/` | Dockview workbench: `chrome/artifact-surface/SurfaceShell.tsx`; bridge dispatch: `front/bridge/uiCommandDispatcher.ts` |
| UI primitives | `packages/ui/` | ~50 shadcn-style components; `packages/ui/README.md` |
| Plugins (package shape) | `plugins/<name>/` | `src/front/index.ts` = `definePlugin(...)`, `src/server/index.ts` = `defineServerPlugin(...)` — layout: `packages/workspace/docs/PLUGIN_STRUCTURE.md`, contract: `packages/workspace/docs/PLUGIN_SYSTEM.md` |
| Plugins (runtime/hot-reload) | `.pi/extensions/<name>/` | Scaffolded via `boring-ui-plugin scaffold <name>` (`packages/plugin-cli/`) |
| Agent/persona packages | `.agents/personas/<seat>/` (`instructions.md`, `knowledge/`, `package.json`) | Fleet roster: `.agents/factory/fleet.yaml`; loader: `packages/agent/src/server/agentDefinition/loadConfiguredAgentFleet.ts`; stage contract: `.agents/factory/README.md` |
| Credentials | BYOK vault library: `packages/agent/src/server/credentials/vault/` (+ `hostResolver.ts`, `withResolvedCredential.ts`) — **library only, not yet wired into a running app** (issue #820, plan-only). What actually carries secrets today: env config via `packages/core/src/server/config/loadConfig.ts` (`WORKSPACE_SETTINGS_ENCRYPTION_KEY`), per-workspace settings encryption in `packages/core/src/server/db/stores/PostgresWorkspaceStore.ts` |
| Persistence | Postgres schema + stores: `packages/core/src/server/db/{schema.ts,migrate.ts,stores/}`; migrations runner used by apps: `apps/full-app/src/server/migrate.ts`. Chat transcripts: Pi JSONL under `BORING_AGENT_SESSION_ROOT` (`packages/agent/src/server/harness/pi-coding-agent/sessions.ts`). Ask-user answers: `<workspaceRoot>/.boring/ask-user.json` (`plugins/ask-user/src/server/askUserStore.ts`) |
| App composition root | `apps/full-app/src/server/main.ts` → `createCoreWorkspaceAgentServer()` (`packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`) |

## How to add an agent (persona + fleet)

1. Create a persona package under `.agents/personas/<seat>/` with
   `instructions.md`, optional `knowledge/`, and a `package.json` — copy the
   shape of an existing seat such as `.agents/personas/orchestrator/`.
2. Add a `seats:` entry to `.agents/factory/fleet.yaml`: `seat`,
   `agentTypeId`, per-seat `skills` with pinned sha256 digests. Skill digest
   pins are refreshed via `pnpm check:skill-digests` /
   `scripts/refresh-skill-digests.mjs --write` — a stale pin silently drops
   the seat.
3. The fleet loads when `BORING_AGENT_FLEET=1` via
   `loadConfiguredAgentFleet()` (`packages/agent/src/server/agentDefinition/loadConfiguredAgentFleet.ts`);
   model tiers come from `models.tiers` in `fleet.yaml` resolved through
   `.agents/factory/policy.yaml`.
4. Roster changes are owner-ratified (see the header comments in
   `.agents/factory/fleet.yaml`).

## How to add a tool

1. Preferred path: a server plugin's `agentTools` array —
   `defineServerPlugin({ agentTools: [{ name, description, parameters,
   execute }] })` (`packages/workspace/src/server/plugins/defineServerPlugin.ts`);
   tools are projected into the session at
   `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`
   (`extraTools`). Reference implementations:
   `plugins/ask-user/src/server/askUserServerPlugin.ts`,
   `plugins/boring-mcp/src/server/serverPlugin.ts`.
2. Compose the plugin where it is needed: app shells register server plugins
   statically (`apps/full-app/src/server/plugins.ts`, consumed by
   `apps/full-app/src/server/main.ts`); playground apps pass them to
   `createWorkspaceAgentServer`.
3. Server plugin changes require restarting the workspace process (no hot
   reload for boot-time plugins — `packages/workspace/docs/PLUGIN_STRUCTURE.md`).
4. Built-in tool catalog (non-plugin): `packages/agent/src/server/tools/` and
   `packages/agent/src/server/catalog/`.

## How to add a Workbench surface

1. Front plugin registers a panel + surface resolver:
   `definePlugin({ panels, surfaceResolvers, ... })`
   (`packages/workspace/src/shared/plugins/frontFactory.ts`); resolvers are
   hot-loaded through `packages/workspace/src/front/agentPlugins/registerAgentPlugin.tsx`.
2. Surface types live in `packages/workspace/src/shared/types/surface.ts`
   (`SurfaceOpenRequest`, resolver descriptors with `metaSchema`/`examples`
   advertised to agents).
3. Agents open surfaces with the `exec_ui` tool (`openSurface` kind) —
   `packages/workspace/src/server/ui-control/tools/uiTools.ts`; dispatch flows
   over the UiBridge SSE/poll transport (`packages/workspace/src/server/ui-control/http/uiRoutes.ts`)
   into the dockview panel activation in
   `packages/workspace/src/front/chrome/artifact-surface/SurfaceShell.tsx`.
4. Validate the resolver component against the PanelRegistry — unknown
   components fail loudly in `SurfaceShell.tsx`.

## How to add an integration

Two shapes exist:

- **Consume external MCP/tool sources** → extend or compose the `boring-mcp`
  plugin (`plugins/boring-mcp/src/server/`): per-app connector configs live in
  `apps/full-app/src/server/boringMcp.ts`; server-only secrets resolve through
  the managed connector secret resolver (`COMPOSIO_API_KEY`, never mirrored as
  `VITE_*`). Governed read-only calls + source registry:
  `plugins/boring-mcp/src/server/appServerBinding.ts`.
- **Expose an agent to external MCP clients** → the bearer-token managed-agent
  endpoint `/mcp/managed-agent` (`apps/full-app/src/server/managedAgentMcp.ts`),
  dark by default, enabled via `BORING_MANAGED_AGENT_MCP_ENABLED=1` plus token/
  workspace/user vars (`apps/full-app/README.md` § Managed Agent MCP Endpoint).
- New first-party plugin packages: `boring-ui-plugin create <name> --path plugins`
  (template: `packages/plugin-cli/templates/plugin/`), then compose per "How to
  add a tool". Per-agent connector grants (`packages/agent/src/server/agent-host/mcpGrants.ts`)
  exist but are not threaded through the core composition root yet — treat as
  dormant.

## How to test

```bash
pnpm test                 # build packages, then all workspace suites (root package.json)
pnpm test:changed         # affected workspaces only (scripts/test-changed-workspaces.mjs)
pnpm --filter full-app typecheck
pnpm --filter full-app e2e            # Playwright suite: apps/full-app/e2e/
pnpm --filter workspace-playground e2e # playground e2e incl. bridge specs
pnpm --filter full-app smoke:mcp-managed-agent
pnpm --filter full-app smoke:remote-worker
```

CI wiring: `.github/workflows/ci.yml` (affected unit tests via `test:changed`,
package-scoped jobs, e2e gated by path filter). Package tests sit beside code
under `__tests__/`.

## How to deploy

The repo ships images but does not publish/deploy them — production apps own
image, secrets, migrations, and post-deploy proof (`apps/full-app/README.md`
§ Container reference). Golden path:

1. Build: `apps/full-app/Dockerfile` — default target `runtime` (web);
   worker image via `--target worker-runtime`. Entrypoints repair mounted
   volume ownership then drop privileges (`apps/full-app/docker/web-entrypoint.sh`).
2. Configure from `apps/full-app/.env.example` (contract table:
   `apps/full-app/README.md` § Env vars).
3. Migrate: `pnpm --filter full-app migrate` (`apps/full-app/src/server/migrate.ts`).
4. Production gate: remote agent mode required unless overridden —
   `apps/full-app/src/server/productionSafety.ts`.
5. Verify with the smoke scripts above; details and honest gaps:
   [`DEPLOY-VERTICAL-AGENT.md`](./DEPLOY-VERTICAL-AGENT.md).

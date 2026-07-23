# Plugin contribution model across multi-agent hosts (#909 analysis)

Status: owner-reviewed analysis, 2026-07-23. Companion to `plan.md`; feeds the
catalog lane, MIG-DEL, and v2/PL1. Grounded in two code inventories
(2026-07-23): `plugins/boring-automation` (boring-ui) and the MacroAnalyst
plugin (`~/projects/boring-macro`).

## Verified inventories (what the two exemplars actually contribute)

**boring-automation** — app-anchored console plugin, smaller than assumed:

- Front: one center **panel** + open **command** + runtime provider. No
  left-rail `workspaceSources`, no `appLeftActions` (`src/front/index.tsx:9-35`).
- Server: **routes only** (12 under `/api/v1/boring-automation`); **zero
  `agentTools`, zero prompts/skills** — "agent controls automations" does not
  exist yet.
- State: dual store — file `workspaceRoot/.pi/automation/store.json` (CLI) vs
  Postgres `boring_automation_*` tables scoped by workspace+owner (hosted),
  selected by `ctx.trusted.sql` presence (`server/index.ts:68-97`).
- Runs: timerless `DueRunService`, externally triggered (`POST /due`
  loopback-only; `/due/hosted` bearer token). Both paths and manual run share
  `ManualRunExecutor`, which invokes the agent through the in-process
  **`WorkspaceAgentDispatcherResolver.send()`** (`manualRunExecutor.ts:81-94`)
  — exactly the facade MIG-DEL replaces with `AgentGateway`.

**MacroAnalyst** — agent-anchored product plugin, the rich case:

- Front: Chart/Deck panels, Series data-catalog, commands, surface resolvers.
- Server: 4 `agentTools` calling `DataService` **in-process**; long
  `systemPrompt` (one of **three** competing prompt injection paths:
  `server/index.ts` string, `package.json pi.systemPrompt`,
  `.pi/APPEND_SYSTEM.md`); provisioning `templateDirs` + Python SDK.
- State: **external** (ClickHouse) + FRED; workspace files for decks/transforms.
- The already-shipped split: in `vercel-sandbox` mode the sandboxed `bm` CLI
  reaches the plugin backend **over HTTP with a provisioning-injected
  process-lifetime bearer token** (`server/bridgeToken.ts`,
  `/api/macro/workspace-bridge/call`). The host↔plugin-backend channel the v2
  split needs already exists in production form.
- Debt found: host app imports plugin server internals directly
  (`macroCatalogWakeup.ts`); reserved-namespace workaround
  (`/api/v1/macro-bridge/call`); loopback/dev auth bypasses; a vestigial
  parallel REST surface.

## The model

### 1. Every contribution has an anchor

- **App-anchored (console plugins)** — automation, MCP manager, task inbox:
  pane/backend/state belong to the product, not to any agent. Visible per app
  composition; survive any agent's removal. Their executors (scheduler) are
  ordinary **AgentGateway consumers**.
- **Agent-anchored (agent plugins)** — macro: front contributions appear
  because that agent is in the workspace's fleet; removed with the agent.

**Owner ruling (2026-07-23): the anchor split becomes a first-class plugin
`kind`** declared in the plugin manifest, because the two classes differ in
distribution, trust, and lifecycle — not just placement:

| | `kind: platform` (console-core) | `kind: vertical` (domain) |
| --- | --- | --- |
| Examples | automation, MCP manager, task inbox, session browser | macro, deck, bi-dashboard |
| Ships with | the console/app release; internalized control-plane features that happen to use the plugin API | an agent or branded app; the **unit of marketplace distribution** |
| Activation | default-on per app composition (child apps may toggle off) | via fleet — an agent spec or app composition selects it |
| Trust | first-party, in-process, forever | trust-ladder tier (in-process first-party today; sandboxed/own-host rungs later) |
| Versioning | moves with the platform release | independently versioned, pinned by digest (PL1), registry-published |
| May contribute agent tools | yes — offered into any agent (class-2 product tools) | yes — usually to its own agent |

A platform plugin is not a marketplace item and never appears in the registry;
a vertical plugin is exactly what the registry lists. This also cleans the
mental model for child apps: MacroAnalyst = base console (platform plugins per
curation) + one vertical plugin + one agent binding.

**Console rule:** what a user sees = platform plugins (per app
composition) ∪ front halves of vertical plugins selected by the workspace
fleet's agent specs. Front halves dedupe by plugin id+version; hosts contribute
nothing visible. Signup via `macro.senecapp.ai` (391 D1 flow) therefore
yields: MacroAnalyst shell + base workbench + macro's panes/catalog + the
macro default agent — and no automation/MCP panes unless that app's
composition includes them.

### 2. Plane assignment per contribution field

| Contribution field | Plane | Note |
| --- | --- | --- |
| `panels`, `workspaceSources`, `appLeftActions`, `commands`, `catalogs`, `surfaceResolvers`, `providers`, `toolRenderers` | control plane (front) | always; served from pinned packages, never from hosts |
| `routes` | control plane (server) | console backend; hosts never serve product routes |
| `systemPrompt`, `skills`, `piPackages`, `extensionPaths`, `provisioning` | agent host | agent-behavior composition, selected per `AgentHostAgentSpec`; macro's three prompt paths must collapse into the plan's single precedence chain (harness base → definition → static append → dynamic) |
| `agentTools` | **split by tool class** (below) | |
| `workspaceBridgeHandlers` | control plane | UI-command/bridge side |
| state | **by authority** (below) | |

### 3. Three tool classes

1. **Environment tools** (files/shell/workspace bytes) → run host-side, near
   the Environment. Non-negotiable.
2. **Product tools** (act on a plugin's control-plane state — the future
   "create/pause automation" tools) → **executed control-plane-side,
   projected into the agent**: the host carries only the schema; invocation
   round-trips. v0 embedded: the round-trip is a function call, zero cost.
   v2: the authenticated plugin-backend channel (macro's bearer-token bridge,
   formalized with per-run brokered tokens per P5). MCP semantics, in-house.
3. **External-service tools** (macro's `execute_sql` → ClickHouse) → choice
   per credential custody: host-side with operator-injected creds
   (first-party trust) or round-trip like class 2. Both stay valid; pushed
   third-party hosts get their own creds in their own artifact.

### 4. State by authority

| State kind | Authority | Example |
| --- | --- | --- |
| Product state | control-plane store (Postgres) | automation hosted store — already correct |
| Environment state | workspace files on the host's Environment | macro decks/transforms, automation CLI file store (acceptable CLI-only) |
| External service | the service itself; reachable from either plane | ClickHouse, FRED |

One authority regardless of host count: two agents on two hosts with
automation tools still see one automation list, because the tools are
projections of one control-plane service.

### 5. Multi-host rules

- Front halves resolve on the control plane from **pinned plugin packages**;
  per-host runtime halves must match the app's **composition digest** (#905
  PL1) — version skew fails admission, never silently diverges.
- Schedulers/executors consume `AgentGateway`; in v2 the pool routes their
  runs to whichever host serves the target agent — cross-host automation for
  free.
- **Loopback trust is a single-process assumption and dies with v2**:
  automation's `/due` loopback gate and macro's dev bypass must become
  token/service-identity checks before any remote host exists.

### 6. Workspace scope is the universal partition (owner ruling 2026-07-23)

The app's existing workspace isolation is the one cutting key across every
plane — anchors decide **where** a contribution lives; workspace scope decides
**how it partitions and authenticates** there:

- Plugin stores partition on `workspaceScopeId` (automation's
  `workspace_id + owner_user_id` Postgres scoping is already the reference
  implementation; the CLI file store inherits it via the workspace root).
- Host-side runtime bindings already key on
  `(agentTypeId, workspaceScopeId, runtimeScopeKey)`; sessions and
  Environment placement carry the same scope.
- **The plugin-backend channel carries the same workspace scope capability as
  the gateway** — plugin routes/tool round-trips/SDK calls are authorized by
  the app's scope verifier and enforce the store partition, replacing every
  per-plugin invention (macro's process-lifetime global bearer token,
  automation's loopback gate, dev bypasses). One isolation mechanism,
  platform-owned, everywhere.
- Consequence for shared hosts: a plugin serving five workspaces is isolated
  by construction (same key partitions state, sessions, bindings, files), not
  by plugin-author discipline.

## Marketplace transition and entry-point exploration

The marketplace is not a new architecture — it is the moment the **fleet stops
being app-static code and becomes workspace-scoped data**. Staged path, each
stage already reserved:

1. **v0**: fleet = static `agents:` array in the app's composition root
   (operator-curated). Already data-shaped — that is the seam.
2. **Catalog lane**: definitions become content-addressed versioned artifacts —
   publishable objects exist.
3. **v2**: hosts deploy separately (shared/dedicated/pushed) — the supply side
   exists; PL1 digests make plugin front halves resolvable per id+version from
   a registry instead of a monorepo checkout.
4. **Marketplace** = three additions, no rework: a **registry** (published
   definitions + host bindings + plugin front bundles, by digest); a
   **workspace agent-binding store** (control-plane, workspace-scoped — the
   fleet becomes mutable per workspace, and `createAgentHost`/pool read
   bindings from it instead of code); an **install flow** ("add agent" =
   write binding + pool routing entry + activate front halves), with
   billing/metering attribution on `(workspace, agentTypeId, session)` per
   the #809/#819 seams and the trust ladder deciding tier (spec-only →
   sandboxed tools → own host).

The marketplace UI itself is just an **app-anchored console plugin** over the
registry API — the model dogfoods itself.

**Entry points and cross-discovery.** A hostname entry point
(`macro.senecapp.ai`, 391 D1) selects: app shell + workspace + *initial* fleet
binding (default agent). Because the console rule composes from the fleet,
exploration is natural: an "agent store" pane lists registry agents; adding
one appends a workspace binding — same gateway, pool routes to whichever host
serves it, its front halves join the console. Whether exploration is exposed
is **per-app product curation**: focused child apps may lock the fleet
(macro-only); the Seneca console exposes the full store. Adding an agent never
grants it trust beyond its ladder tier, and hostname selection still never
grants membership.

**Do-not-preclude checklist for v0 lanes:** keep `agents:` purely data (done);
no code path may assume the fleet is process-constant after startup beyond the
current frozen-fleet validation (reload path already exists for plugins);
`AgentSummary.definition` digest is the registry's future join key.

## Concrete follow-ups this analysis creates

1. **MIG-DEL scope note**: `ManualRunExecutor`'s dispatcher call is a
   delegation-caller migration target (automation becomes an early gateway
   consumer).
2. **Automation agent tools** (when built): class-2 product tools —
   control-plane-executed, schema-projected; never host-side store access.
3. **Prompt-path consolidation**: macro's three systemPrompt sources → the
   plan's single precedence chain (catalog lane touchpoint).
4. **Formalize the plugin-backend channel**: promote macro's bearer-token
   bridge pattern into a platform primitive (per-run brokered token, P5
   custody rules) instead of each plugin inventing routes/tokens.
5. **Kill loopback trust** in plugin routes before v2 tracer.
6. **Macro repo cleanup** (its own repo): host→plugin-internal imports,
   vestigial parallel REST surface, reserved-namespace workaround.

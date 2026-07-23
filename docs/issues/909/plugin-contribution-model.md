# Plugin contribution model across multi-agent hosts (#909 analysis, v2)

Status: owner analysis, revised 2026-07-23 after a 3-round adversarial dialogue
with gpt-5.6-sol (xhigh); round table at the end. Companion to `plan.md`;
feeds the catalog lane, MIG-DEL, and v2/PL1. Grounded in code inventories of
`plugins/boring-automation` and MacroAnalyst (`~/projects/boring-macro`),
corrected in review.

## Verified inventories

**boring-automation** — the console exemplar (inventory corrected in review):

- Front: `providers` (runtime provider), **`appLeftActions`** ("automations"
  overlay, order 45, `front/index.tsx:26`), center panel + open command.
- Server: 12 routes under `/api/v1/boring-automation`; **one agent tool**
  `createBoringAutomationTool` (`server/index.ts:50`, on unless
  `agentToolEnabled === false`), actor-scoped via
  `resolveAutomationOperationsForActor` (per-actor store + executor).
- State: file store `workspaceRoot/.pi/automation/store.json` (CLI) vs
  Postgres `boring_automation_*` scoped by `workspace_id + owner_user_id`
  (hosted), chosen by `ctx.trusted.sql` presence.
- Runs: timerless `DueRunService` (loopback `/due`, bearer `/due/hosted`);
  `ManualRunExecutor` invokes the agent through the in-process
  `WorkspaceAgentDispatcherResolver.send()` — the facade MIG-DEL replaces.

**MacroAnalyst** — the vertical exemplar:

- Front: Chart/Deck panels, Series catalog, commands, surface resolvers.
- Server: 4 agent tools calling `DataService` in-process; **three competing
  systemPrompt paths**; provisioning `templateDirs` + Python SDK whose `bm`
  CLI reaches the plugin backend **over HTTP with a provisioning-injected
  bearer token** — the host↔backend split already shipping in
  `vercel-sandbox` mode.
- State: external (ClickHouse, FRED) + workspace files.
- Debt: host imports plugin internals; namespace workaround; loopback/dev
  bypasses; vestigial parallel REST surface.

## The model

### 1. Trust and identity are platform-granted, two-layered

Authors **request**; the platform **grants**. Nothing trust-bearing is an
author-declared manifest field (self-attested privilege is the failure mode).

- **Artifact layer** (per plugin artifact): publisher identity, signature,
  registry channel, immutable digest — resolved by registry/loader policy
  into a platform-owned `PluginArtifactDescriptorV1` at catalog/installation
  time.
- **Contribution layer** (per contribution): execution plane, isolation mode,
  granted capabilities, code-trust mode. An installation's effective risk is
  its most privileged activated contribution.

**Canonical semantics (owner ruling, 2026-07-23): there are exactly two kinds
of plugin, plus libraries which are not plugins.** "Plugin" is only the
packaging (`definePlugin`/`defineServerPlugin`); the kind is defined by what
the thing is anchored to and what removing it takes away:

| Term | Extends | Lifecycle | Examples |
| --- | --- | --- | --- |
| **Workspace plugin** | the console/workspace | installed at app/workspace level; exists independent of any agent; may offer tools to *all* agents (having tools does not make it an agent plugin) | automation, MCP manager, task inbox, agent store |
| **Agent plugin** | one agent | bound via the agent spec; comes and goes with the agent; the marketplace unit | macro |
| **Library** (not a plugin) | other plugins | developer dependency — never user-installed or user-visible; resolved and reference-counted at artifact resolution like any package; content-identity deduped | deck, diagram viewers |

The vocabulary mirrors the architecture: workspace plugins extend the control
plane; agent plugins travel with the agent composition; libraries are
dependency resolution, not product objects. Provenance
(`platform | registry | workspace-generated`) and granted trust remain
orthogonal resolved axes underneath — a workspace-generated plugin can be
either kind. Resolved axes underneath:
provenance (`platform | registry | workspace-generated`), activation
(`app | workspace-installation | agent-binding`), per-contribution trust.
Deck is registry-provenance, workspace-installation-activated, referenced by
macro's binding (reference-counted; version-graph resolution is
marketplace-stage).

**Only v0 code hardening**: validate one canonical plugin ID across
`package.json#boring.id`, `definePlugin({id})`, `defineServerPlugin({id})` —
the future descriptor's join key. When `boring.id` is omitted, the resolved
fallback is the package name; any mismatch across the three sites fails at
preflight/startup, before any contribution registers. No manifest axis
fields in v0.

### 2. Plane assignment per contribution field

| Contribution | Plane | Note |
| --- | --- | --- |
| `panels`, `workspaceSources`, `appLeftActions`, `commands`, `catalogs`, `surfaceResolvers`, `providers`, `toolRenderers` | control plane (front) | **native execution = signed first-party only**; third-party fronts are declarative UI or separate-origin iframes with CSP + capability-scoped IPC; front trust mode is an install-time gate |
| `routes` | control plane (server) | first-party raw Fastify is a named trusted exception; target = scoped route/state adapters binding authorization before plugin code runs; installable backends sit behind one stable versioned proxy keyed by (installation, digest); direct Fastify registration is platform-release-only |
| `systemPrompt`, `skills`, `piPackages`, `extensionPaths`, `provisioning` | agent host | per-agent composition; macro's three prompt paths collapse into the plan's single precedence chain |
| `agentTools` | by **per-operation effect authority** (§3) | |
| `workspaceBridgeHandlers` | control plane | |
| workspace-generated plugins | artifact pipeline | sandbox build/scan → immutable bundle in a control-plane artifact store → served under front trust mode (#905 PL1's snapshot sub-gateway, generalized); their backends follow the installed-backend proxy rule |

Console rule: what a user sees = **workspace plugins** (per app composition)
∪ front halves of **agent plugins** brought by the workspace fleet's
bindings/installations (libraries render only inside whichever plugin
references them).
**Artifact identity is content identity, not semver**: exactly one resolved
artifact per plugin ID per workspace/console generation; dedupe only
identical `(pluginId, artifactDigest)`; conflicting versions of one plugin ID
are rejected at resolution, never co-loaded. Hosts serve nothing visible.

### 3. Tool authority is per operation, not per tool

Class labels (environment / product / external-service) are **descriptive**.
The binding rule: **every tool operation declares its effect authorities**;
single-authority operations are the v0 norm and placement follows the
authority (environment → host; product state → control-plane-executed,
schema-projected into the agent; external service → either plane per
credential custody).

- **Projected mutations** get idempotency via a **`PluginToolInvocationLedger`**
  — the same state machine and semantics as the plan's `AgentRequestLedger`
  (prepare/admit/in-flight/complete/outcome-unknown, digest conflict), but a
  **separate interface**. Its key contains **stable identifiers only**:
  `(workspaceScopeKey, authSubjectId, installationId, sessionRef, toolCallId,
  toolContractDigest)`; `prepare(key, canonicalInvocationPayloadDigest)`
  separates the payload digest from the contract digest. Mutable claims
  (roles, permissions) never participate in idempotency identity — they are
  re-verified on every attempt. v0 ledger durability follows the plan's
  owner-descoped floor: process-lifetime in-memory, upgraded to durable at
  Level D with the streaming lane. The frozen gateway types are never widened
  by plugin tools.
- **Composite operations are the named exception, not a lint pass.**
  Automation `run` is composite today (run-record write + agent dispatch).
  Its v0 contract: run record admitted first **in the automation store (the
  durable side — Postgres hosted / file store CLI), which is where the
  invocation→run receipt lives**; the agent dispatch uses a gateway
  `requestId` derived from the run ID (so gateway-level idempotency makes the
  dispatch retry-safe); the dispatch receipt is stored back on the run
  record; `outcome-unknown` on ambiguity — a two-step saga durable on the
  store side even while the tool ledger is process-lifetime. **Restart
  ambiguity is terminal, never retried**: if the process dies between
  dispatch and receipt, the durable run record's `dispatching` state resolves
  to `outcome-unknown` on restart and is never automatically redispatched
  (the Level-B gateway ledger cannot vouch for the dispatch across restart);
  only an explicit new run creates a new dispatch. Post-MIG-DEL, the dispatch
  leg is a plain `AgentGateway` create/send.
- **Automation's existing tool is the first class-2 *migration source*** —
  its closure-based in-process execution is not yet a clean schema-projection
  boundary; the conformance case is the migration, not a claim it's done.
- **v0 proof obligation (F7)**: an in-process projected-tool conformance test
  proving `onUpdate`/`AbortSignal` survive projection. The offset-addressed
  frame protocol (streaming/cancel/backpressure/reconnect) is a requirement
  of the **v2 plugin-backend channel primitive**, where the process boundary
  appears.

### 4. State: declared scope levels over one authorization context

"Workspace scope everywhere" was too coarse — automation's `owner_user_id`
already proves it. Rules:

- Every plugin **state collection declares its scope level**:
  `workspace | user | org | installation | global`.
- Plugin authorization carries one **auth context** (org, workspace, subject,
  roles, installation) — used by scoped adapters to bind partitions before
  plugin code runs. **The gateway's `AuthorizedAgentScope` is never widened**
  with org/installation fields; plugin auth context is a separate,
  control-plane concern.
- The plugin-backend channel (tool round-trips, SDK calls like macro's `bm`)
  authenticates with this context via platform machinery — replacing
  per-plugin tokens, loopback gates, and dev bypasses (all of which die
  before the v2 tracer).
- Authority placement per state kind stands: product state → control-plane
  store; environment state → host workspace files; external services →
  themselves.

### 5. Multi-host and upgrade rules

- Front halves resolve control-plane-side from pinned artifacts; per-host
  runtime halves must match the composition digest (#905 PL1).
- **Hosts are immutable generations; the pool owns upgrades.** Marketplace
  installs mutate control-plane bindings and route *new* sessions to a new
  host generation — never hot-mutate a live host's fleet
  (`CreateAgentHostOptions.agents` + `AgentFleetCompiler.compile()` stay
  freeze-at-startup). Existing sessions stay pinned to their stored runtime
  scope until drained.
- Strengthened plan inputs (documentation-level, no interface change), with
  a deliberate split so Environment sharing survives: **the full PL1
  composition digest** — artifact descriptors/digests, validated
  configuration, contribution grants and placement/isolation modes,
  tool-contract digests, provisioning generation — lives in
  `ResolvedAgentRuntimeScope.identity` and the host-generation identity. The
  same artifact under different grants is a different composition.
  **`ResolvedEnvironmentScope.provisioningFingerprint` is restricted to
  environment-mutating inputs and the provisioning generation** — two agents
  with identical provider bytes but different tool grants still share one
  Environment lease (different runtime identities, same fingerprint), never
  spuriously failing `AGENT_SHARED_ENVIRONMENT_UNAVAILABLE`. Existing
  sessions retain their resolved generation until drained.
- Until a per-plugin atomic mount boundary exists, a plugin **requiring any
  structural contribution (providers, bindings, appLeftActions,
  toolRenderers) is rejected as marketplace-installable outright** — never
  silently loaded with only its hot-swappable subset; structural
  contributions ship via app releases.
- `AgentSummary` never carries installation/marketplace/health state — the
  marketplace platform plugin reads its own control-plane API.

## Marketplace transition and entry-point exploration

The marketplace is the moment the fleet stops being app-static code and
becomes workspace-scoped data. Stages: v0 static `agents:` data (the seam) →
catalog lane (content-addressed definitions) → v2 (independently deployed
hosts; PL1 digests) → marketplace = registry (`PluginArtifactDescriptorV1` +
definitions + host bindings + front bundles by digest), a workspace
agent/plugin **installation store**, and an install flow with
billing/metering attribution per #809/#819 and trust decided by the granted
axes. Marketplace-stage requirements (staged, in the do-not-preclude list):
installation entity with desired/observed lifecycle and idempotent phases;
version-graph resolution + reference counting; lockfiles/generations/
migrations/rollback metadata; front ABI/import-map/SRI/budgets.

**Entry points**: a hostname (391 D1) selects app shell + workspace +
*initial* binding. Exploration = an "agent store" platform plugin appending
bindings; new panes join the console; per-app curation decides whether the
store is exposed. Hostname selection never grants membership; adding an agent
never grants trust beyond its granted axes.

## Concrete follow-ups

1. **MIG-DEL**: migrate `ManualRunExecutor` dispatcher call to the gateway;
   implement automation `run`'s two-step saga contract on that occasion.
2. **Automation tool**: first class-2 migration case (closure execution → 
   schema projection + `PluginToolInvocationLedger`).
3. **Canonical plugin ID validation** across the three declaration sites (v0).
4. **In-process projected-tool conformance test** (`onUpdate`/`AbortSignal`).
5. **Prompt-path consolidation** (macro's three sources → one precedence
   chain; catalog lane).
6. **Kill loopback/dev-bypass trust** in plugin routes before the v2 tracer;
   plugin-backend channel adopts the platform auth context.
7. **Plan doc strengthening**: document plugin-artifact inputs of
   `ResolvedAgentRuntimeScope.identity` / `provisioningFingerprint`.
8. **Macro repo cleanup**: host→plugin-internal imports, vestigial REST
   surface, namespace workaround.

## Review log (gpt-5.6-sol xhigh, 2026-07-23)

| Round | Outcome |
| --- | --- |
| R1 | REVISE — 1 P0 (native marketplace fronts breach console trust), 14 P1/P2 incl. false automation inventory, kind-conflation, per-tool authority too coarse, workspace-scope too coarse, install/upgrade lifecycle gaps |
| R2 | Converging — dispositions largely accepted; corrections: platform-granted axes (no self-attested trust), separate `PluginToolInvocationLedger`, per-operation authority (automation `run` composite), immutable host generations condition, no `AuthorizedAgentScope` widening, no manifest axis fields in v0 |
| R3 | NOT READY — 2 P1 identity fixes (content-identity dedupe + full PL1 composition-digest coverage; stable-identifier ledger key with payload/contract digest separation) + 3 P2 polish (ID preflight fallback, saga receipt location/durability, structural-front outright rejection). All applied in this revision. |
| R4 | **READY** — no P0/P1 remain; "content-identity, PL1 composition, ledger-key, saga durability, ID preflight, and structural-front blockers are resolved in §§1–5; marketplace-only lifecycle/ABI work is clearly staged without widening the frozen gateway or host interfaces." Ready for catalog, MIG-DEL, and PL1 lanes. |

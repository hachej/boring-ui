# Plugin contribution model across multi-agent hosts (#909 analysis, v2)

Status: owner analysis, converged through R1–R9 adversarial hardening plus
the D1–D2 direction review (full round table at the end); final owner pass
2026-07-23 restored three owner-ruled sections a hardening restructure had
silently dropped (territories, folder split, one-machinery). Companion to `plan.md`;
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

**Canonical semantics (owner ruling, final, 2026-07-23): an X plugin plugs
into an X.** Three nouns, perfectly regular:

| Noun | What it is | Plugs into | Examples |
| --- | --- | --- | --- |
| **Agent** | definition + selected agent plugins + model policy — **the product and marketplace unit** | a workspace (fleet binding) | macro |
| **Agent plugin** | a pluggable unit of agent behavior/UI: tools, prompts, panels, skills | an **agent** (selected in its spec via `AgentHostAgentSpec.plugins[]` — the field name is already exact) or referenced by another agent plugin | deck, bi-dashboard, web-search — and macro's own package, an agent plugin with a single consumer (its own agent) |
| **Workspace plugin** | console extension, agent-independent; may offer tools to *all* agents (that does not make it agent-bound) | the **workspace/console** (app-level activation) | automation, MCP manager, task inbox, agent store |

**The two kinds have distinct, typed contributions.** The loading machinery
is shared, but the activation path determines which contributions are used.
**For v0** this is applied at the activation site over today's unchanged
`definePlugin`/`defineServerPlugin`: app composition considers only
workspace-oriented contributions; an agent's spec selection considers only
agent-oriented contributions.

**For the marketplace stage, the ruling stands (owner + adjudicated review,
2026-07-23): two typed entrypoints via package subpaths** — a hardening pass
proposed a single namespaced `definePlugin({workspace,agent})` and was
reverted; its premise (that the split prevents both-parts packages) is false:

```ts
// package exposes either or both, via SEPARATE subpath entrypoints:
// "./workspace" → export const workspace = defineWorkspacePlugin({ ... })
// "./agent"     → export const agent     = defineAgentPlugin({ ... })
```

Why subpaths beat a unified object: the console imports only `./workspace`
and the Host only `./agent`, so the unused plane is never bundled or
evaluated (module physics as the trust boundary); the two halves of one
artifact can be granted/certified/disabled independently; authors see only
the vocabulary of their plane. The loader normalizes both entrypoints into
one internal descriptor under one artifact ID/digest — the unified shape is
an implementation detail, never the author-facing API.

**Macro is an agent, not a plugin**: at agent granularity the package is the
agent's body, and the product object is the agent itself. Plugin-to-plugin
package dependencies (macro's package → deck) are plain dependency
resolution — reference-counted, content-identity deduped, no product name.
The marketplace therefore lists **agents** (and agent plugins for builders),
never bare "plugins." Underneath, the resolved axes stay orthogonal to kind:
provenance (`platform | registry | workspace-generated`), activation
(`app | workspace-installation | agent-binding`), per-contribution trust — a
workspace-generated package can be either kind. Deck: registry-provenance,
workspace-installation-activated, referenced by macro's binding
(reference-counted; version-graph resolution is marketplace-stage).

**One machinery, two front doors:** the kinds share ONE loading/management
system — discovery, artifact/digest pipeline, integrity, reload, registries,
trust granting, ID preflight are singular. The split exists only in the
typed contribution contract and the activation path. No lane may build a
second loader (AH0's one-machinery invariant test enforces this). The only
duplicated loading is the plane split (control plane loads front halves,
hosts load runtime halves — PL1), which exists independent of kinds.

**Repo layout follows the taxonomy:** first-party plugins split into
`plugins-workspace/` (automation, MCP manager, inbox, agent store) and
`plugins-agent/` (deck, bi-dashboard, web-search); full agents (macro) live
in their own repos. A mechanical move (bead `.17`), not a v0 gate — and its
acceptance proves two roots do not become two loaders.

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
∪ front contributions of the **agent plugins selected by the workspace
fleet's agents** (an agent plugin referenced only by another agent plugin
renders inside its consumer).

**The two UI territories: the screen mirrors the architecture.** The
**app-left control pane** is the control plane made visible —
workspace-plugin territory: the controls, plus the console-level management
panels they open in the main area (automation's panel opens *from* its left
action; a management pane is still workspace furniture wherever it renders).
The **workbench** is the work surface — agent-plugin territory: explorers/
sources beside Files/Sessions (macro's Series catalog), panels, viewers,
renderers, all arriving and leaving with their agent. *Left pane = what you
control; workbench = what you work on.* Territories are contextual ownership,
not permanent screen coordinates — layouts may change; the
agent-bound-vs-workspace-management distinction survives. The UX layering
above them: app composition decides what exists; the console shell is
singular; the workbench is one frame whose furniture is supplied by the
active agent's plugins (per-agent *contents*, never per-agent interfaces).
**Artifact identity is content identity, not semver**: exactly one resolved
artifact per plugin ID per workspace/console generation; dedupe only
identical `(pluginId, artifactDigest)`; conflicting versions of one plugin ID
are rejected at resolution, never co-loaded. Hosts serve nothing visible.
Precise coexistence rule (direction review 2026-07-23): one version per
plugin ID **within one Agent release composition** and one native module
graph **per immutable Host generation**; multiple *generations* may stay
live for a workspace while old sessions drain; one native front version per
plugin ID per console generation (separate-origin iframe fronts are the only
true coexistence exception). Version diversity lives across generations,
never inside one realm.

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

## Deferred: the control-plane design lane (reserved, not designed)

Direction review (2 rounds, gpt-5.6-sol xhigh, 2026-07-23) ranked the future
concerns; per owner directive they are **parked** behind the multi-agent
unlock and belong to one new control-plane design lane (own issue,
pre-marketplace, gating dynamic installation — never v0 or the frozen
Gateway):

1. Release/install/decommission lifecycle + data custody, one spine:
   `AgentProduct → AgentRelease → WorkspaceInstallation → AgentBinding →
   RuntimeGeneration` (channels, rollout, rollback, `retain|export|transfer|
   delete` dispositions, tombstones). v0 already reserves everything needed
   (fleet as data, digests, immutable generations, pinned sessions);
   `agentTypeId` stays a binding name, never marketplace identity.
2. Per-contribution invocation envelope (identity + rate/budget/attribution/
   audit on every tool/backend call).
3. Governed shared semantic memory — the one truly unreserved seam from the
   agent-run-company scenario. A first-party **workspace plugin**:
   `MemoryCandidate` proposed by agents → policy-promoted `MemoryRecord`
   (scope, provenance, confidence, sensitivity, TTL, supersession);
   retrieval explicit and policy-filtered, never ambient injection.
4. Marketplace assurance: digest-bound certification evidence, quarantine,
   revocation, kill-switch.
5. Attention contract completion = **extension of #380's inbox plugin**
   (already owns durable items/intake): add trusted source identity,
   severity, `needs-input|FYI`, dedupe, action receipts; agents get a
   projected `attention.emit` tool offer. Never a `PiChatEvent` addition.
6. Experience projection (`WorkspaceExperienceProfile`): per-user
   navigation/default-surface/layout over one installed composition — never
   per-user plugin activation or code loading.

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
| R5 | REVISE — 1 P1 (ambiguity). The "Two UI Territories" rule was inconsistent with the `boring-automation` exemplar, which is a Workspace plugin but contributes a center panel (workbench territory). The rule was refined to clarify that Workspace plugins can open console-level management panels in the main workbench area, distinct from the agent-bound work surfaces owned by Agent plugins. |
| R6 | REVISE — 1 P1 (missing detail). The model for "tool offers carrying... prompt fragment[s]" lacked a defined composition strategy, creating risk of unpredictable agent behavior and prompt conflicts. The rule was updated to specify that fragments are composed into a dedicated prompt section in a stable, deterministic order (alphabetical by plugin ID). |
| R7 | REVISE — 1 P1 (flawed future architecture). The proposed future split into `defineWorkspacePlugin`/`defineAgentPlugin` would prevent a single package from providing both kinds of features, harming reusability. The section was rewritten to clarify that v0 uses the existing `definePlugin` and activation context to select contributions. For the future, it now proposes a single `definePlugin` with namespaced `workspace` and `agent` blocks, which is a more flexible and robust design. |
| R8 | **READY** — No P0/P1 issues found. A full document review confirmed that recent revisions have resolved all previously identified inconsistencies. The model is now internally consistent, aligned with `plan.md` and code exemplars, and specifies a robust future-state API design. |
| R9 | **READY** — No P0/P1 issues found. A second full review confirmed the document's clarity and robustness. No significant ambiguities or inconsistencies remain. The hardening process is converged. |
| D1 | Direction review (fresh sol xhigh) — direction CONFIRMED; top-5 missing concerns ranked; **adjudicated R7's unified `definePlugin` against the owner's two typed entrypoints: R7's premise false (two functions do not prevent both-parts packages); owner ruling restored with subpath-entrypoint refinement** (`./workspace`/`./agent`; unified descriptor internal-only). Bead amendments confirmed. |
| D2 | Direction review round 2 — G2 downgraded (attention = #380 extension, per owner correction); G1 semantic memory confirmed as the one unreserved seam; version coexistence narrowed to per-generation isolation; release/install spine = new control-plane lane with zero v0 type changes; scenario answers (inbox-as-plugin, CoS-as-agent, composition-not-silos, experience projection) validated. Dialogue closed at owner directive; deferred items parked in the control-plane lane section. |

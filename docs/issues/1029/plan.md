---
github: https://github.com/hachej/boring-ui/issues/1029
issue: 1029
state: in-progress
updated: 2026-07-31
track: owner
---

# gh-1029 Full AgentHost cutover

## Problem

Issue #909 established the canonical `createAgentHost()` runtime, Gateway, addressed HTTP projection, fleet compiler, session inventory, admission ledger, environment lease manager, and binding lifecycle. The production cutover stopped one layer too early.

Workspace, CLI, agent-playground, and Core already create a `CreatedAgentHost`, but they still depend on compatibility composition to mount and operate the application:

- Workspace, CLI, and agent-playground pass the Host into `registerAgentRoutes()`.
- Core directly constructs `AgentHostLegacyRoutePolicy`.
- `registerAgentRoutes()` is now a small wrapper, but `agentHostLegacyRouteRuntime.ts` is a second 1,000+ line binding/cache/lease/health/provisioning authority around the canonical Host.
- `createAgentApp()` owns a second legacy mount order through `agentRouteBindingProfile.ts`.
- Legacy Pi-chat aliases and several agent-runtime routes have no addressed replacement.
- App/environment routes currently borrow the legacy runtime to reach the Host-owned `Workspace` and hold transport leases.

The result is not a complete AgentHost architecture: one Host exists, but a compatibility runtime still controls how production scopes, leases, provisioning, app routes, runtime-capability routes, dispatcher access, and shutdown reach it.

## Goal

Make `CreatedAgentHost` the sole production authority for agent fleet, runtime bindings, canonical Environment leases, session inventory/storage resolution, admission/ledger, agent runtime capabilities, addressed session routes, dispatcher operations, drain, and close.

Delete the compatibility composition completely. Breaking TypeScript APIs and legacy HTTP paths are explicitly approved. Do not retain aliases, fallback switches, deprecation wrappers, or parallel route mount orders.

## Solution

Perform one atomic cutover PR with internally reviewable commits:

1. Freeze an executable route-and-consumer disposition matrix with zero unclassified routes or callers.
2. Complete the direct Host contract where compatibility code currently supplies missing capabilities:
   - complete request authorization + runtime-scope minting;
   - addressed attachments;
   - agent runtime-capability routes;
   - lease-bearing Environment/Workspace projection for app routes;
   - trusted dispatcher resolution over the same Host lease;
   - one provisioning/reload generation lifecycle.
3. Cut over Core first because it is the deployed full-app production composition and sole direct legacy-policy consumer.
4. Cut over Workspace, CLI, playground, standalone bin/dev, test hosts, eval/smoke scripts, plugins, and plugin-cli.
5. Make `agentTypeId` mandatory in every chat/session client and remove the legacy wire.
6. Delete both compatibility mount systems, compatibility types/helpers/WeakMaps, old exports, tests, and docs.
7. Run adversarial architecture, lifecycle/security, spec, and thermonuclear reviews before owner handoff.

No intermediate dual production composition may merge to `main`.

## Decisions

### Authority and ownership

- `CreatedAgentHost` exclusively owns:
  - fleet compilation;
  - scope verification;
  - Agent runtime bindings;
  - canonical Environment leases/provider instances;
  - provisioning generations;
  - session inventory and storage resolution;
  - admission, request ledger, effects, and subscriptions;
  - addressed Agent HTTP routes;
  - runtime-capability routes that require harness/tools/readiness;
  - dispatcher operation leases;
  - drain and close.
- Core/Workspace/CLI remain composition roots. They authenticate requests, resolve membership/storage/workspace policy, collect trusted plugins, and normalize complete runtime-scope inputs before minting an authorized capability.
- Files, tree, search, FS events, Git, share links, workspace membership, auth, UI bridge, and frontend fallback remain application/environment HTTP surfaces as required by #909. They consume a lease-bearing Environment projection from the Host; they never create a second `RuntimeModeAdapter` result or access harness/session internals.
- The Host does not absorb the entire application server.

### Canonical authorization and runtime-scope funnels

Fleet authorization and Agent runtime resolution remain separate; fleet-wide routes must never invent a default Agent.

Every composition root implements exactly two contracts:

1. `authorizeAgentRequest(request): Promise<AuthorizedAgentScope>`
   - authenticates the actor;
   - validates workspace membership and storage selection;
   - mints a host-neutral, provenance-checked capability;
   - supports fleet listing and filtered session inventory without selecting an Agent.
2. `resolveAuthorizedAgentRuntimeScope({ authorizedScope, verifiedClaim, agentTypeId, intent }): Promise<ResolvedAgentRuntimeScope>`
   - runs only after Host verification/revocation checks;
   - receives the original provenance-checked capability because the verified claim alone intentionally contains only actor/workspace identifiers and cannot recover issuer-held storage/runtime context;
   - resolves workspace root, Pi options, tools, filesystem binding resolver, prompt contribution, session namespace, semantic identity, physical binding identity, and provisioning contract from issuer-held context associated with `authorizedScope`;
   - uses `intent` to distinguish new Agent binding, pinned existing-session resolution, environment access, and reload without changing identity rules.

The Host passes both the original verified capability and its verified claim plus `agentTypeId` to the second contract. Only the capability may recover normalized storage/workspace context; request data is never re-read to reconstruct it. Existing-session mutations first resolve the pinned session authority and may not substitute the currently selected/default Agent. No route, dispatcher, or plugin reconstructs runtime identity independently.

### Direct Environment projection

The exact host-neutral Environment and dispatcher contracts are normative in `composition-lifecycle-dag.md`.

`CreateAgentHostOptions` separately receives `resolveAuthorizedEnvironmentScope({ authorizedScope, verifiedClaim, intent })`; generic files/tree/search/Git routes do not select an Agent. `CreatedAgentHost.acquireEnvironment(...)` verifies the capability, resolves issuer-held Environment context, and returns an `AgentHostEnvironmentLease` containing only app-safe `Workspace`, filesystem bindings, readiness, and idempotent `release()`—never `AgentHarness`, `PiSessionStore`, or mutable composition internals.

Finite app handlers release in `finally`; streaming transports wrap iteration and release on completion, cancellation, or error. Acquisition is fenced after drain. Calling `RuntimeModeAdapter.create()` from an app route composer is forbidden.

### Direct dispatcher projection

`CreatedAgentHost.runWithWorkspaceAgent(...)` requires a trusted explicit `agentTypeId`, authorized capability, request ID, normalized dispatcher context, and optional matching request. It verifies authorization, acquires the canonical Environment and Agent binding, and invokes a void callback with lease-guarded `{ workspace, signal, dispatch, interrupt, stop }`. `dispatch(input, onEvent)` internally consumes the complete Gateway iterator before resolving; no raw dispatcher or `AsyncIterable` escapes callback scope. Callback completion/error releases both leases. Retained wrappers reject every method after release and drain aborts `signal`.

The old unbounded `resolveWithWorkspace()` return is deleted. Hosted automation, managed MCP, and plugins migrate to callback-scoped access so `Workspace` cannot outlive its lease. No legacy dispatcher callback or secondary lifecycle survives.

### HTTP route ownership

Slice 1 freezes every route into exactly one category:

1. **Addressed Host session route**
   - `/api/v1/agents`
   - `/api/v1/agents/:agentTypeId/sessions/...`
   - create/list/read/state/events/rename/delete/prompt/follow-up/queue-clear/interrupt/stop;
   - addressed attachment bytes.
2. **Addressed Host runtime-capability route**—requires Host binding/harness/tools/readiness and mounts through the canonical Host projection:
   - reload;
   - models, with app-provided filter/catalog policy injected into the Host route;
   - skills;
   - commands and command execution;
   - tool catalog;
   - system prompt;
   - session changes;
   - Agent readiness.
3. **App/environment route**—mounted by Core/Workspace/CLI or its owning package through the Host Environment lease where required:
   - files, tree, search, FS events, Git;
   - share links;
   - workspace membership/meta;
   - health/ready;
   - auth, UI bridge, plugin routes, frontend fallback.
4. **Deleted route**—only after the matrix proves there is no source or external contract that must survive.

Canonical addressed routes use one queue-clear spelling selected by the matrix; duplicate aliases are deleted.

### Attachments

Before legacy Pi-chat deletion, add:

`GET /api/v1/agents/:agentTypeId/sessions/:sessionId/attachments/:messageId/:index`

Snapshot/event attachment URL generation becomes projection-aware and always emits the addressed URL. Authorization verifies actor, workspace/storage scope, agent, session, message, and attachment index. Existing transcript bytes are not rewritten.

### Provisioning and reload

- All runtime provisioning executes through `ResolvedEnvironmentScope.provisionRuntime` and `EnvironmentLeaseManager`.
- Workspace pre-provisioning, CLI `runtimeProvisioningByWorkspace`, Core policy provisioning, and legacy runtime provisioning are inventoried and reduced to one Host-owned generation authority.
- Reload follows one sequence: authorize/verify → side-effect-free refresh and immutable input snapshot → compute candidate identity/fingerprint and canonical digest → atomic ledger ownership claim → classify before mutation → for executable same-identity reload perform strong admission/begin/effect/receipt; for identity-changing reload record restart-required rejection before admission/effect.
- **Hot-resource reload:** candidate semantic identity and provisioning fingerprint are unchanged. The Host keeps the current Environment provider/generation, reloads harness/plugin resources under a binding operation fence, publishes readiness, and admits no second provisioning call.
- **Environment/semantic reload:** candidate identity or fingerprint changes. Hot reload fails before mutation with stable `AGENT_RUNTIME_RESTART_REQUIRED`; it does not mutate/provision the current provider, rewrite a session pin, or create a second provider. Restart creates the new canonical Environment/runtime identity. Existing sessions remain pinned and become read-only on genuine mismatch unless an exact operator-authorized migration exists.
- Workspace/CLI reload hooks stop provisioning independently; they return immutable refreshed inputs/diagnostics to the Host classifier.
- Environment generations own their provider. Outside rejected identity-changing hot reload, lifecycle replacement may hold one published/current provider-generation plus fenced retiring provider-generations for pre-existing leases. New acquisitions never receive retiring generations.
- The state machine is explicit: prepare immutable inputs → validate/classify → for same-identity hot resources reload atomically in place under fences; otherwise reject restart-required → on ordinary lifecycle replacement atomically publish successor → retire previous after final lease.

### Strong admission for reload and command execution

Extend the closed Agent request contract explicitly:

- `AgentGatewayEffect` adds `agent.reload` targeting `{ kind: "agent", agentTypeId }` and `session.command.execute` targeting the full `{ kind: "session", ref }`.
- Reload request body is `{ requestId, sessionId? }`; command execution body is `{ requestId, sessionId, name, args }`. `requestId` is caller-generated, non-empty, and bounded to 128 safe characters. Session ID is mandatory for command execution.
- Before reload ledger preparation, the Host performs only side-effect-free plugin/runtime input discovery, computes the candidate identity/fingerprint, and canonicalizes a digest over agent/session target plus immutable candidate-input digest. `requestId` is excluded.
- Command digest covers session ref, command name, and args; `requestId` is excluded.
- Order for executable effects is authorize/verify → validate → metering/policy gate → ledger prepare → strong admission → begin effect → execute → typed receipt → complete.
- `AgentRequestLedger.prepare` becomes an atomic ownership claim returning `{ ownership: "created" | "existing", record }`. Only `created` may proceed to admission/effect. Existing terminal same-digest returns its recorded receipt; existing pending/admitted/in-flight same-digest returns stable `AGENT_REQUEST_IN_PROGRESS` without executing; same key/different digest returns `AGENT_REQUEST_CONFLICT`. This durable claim—not a process-local map—is the at-most-once authority.
- Reload restart-required is recorded as a gateway rejection from `pending-admission` before strong admission/beginEffect because no mutation is allowed.
- Reload receipt is `{ ok: true, sessionId?, reloaded, diagnostics?, restartWarnings? }`; command receipt is `{ ok: true, sessionId, name }`.
- Add stable `AGENT_RUNTIME_RESTART_REQUIRED` and `AGENT_REQUEST_IN_PROGRESS`, both HTTP `409`. Restart-required uses `{ error: { code, message, details: { currentIdentity, candidateIdentity, currentFingerprint, candidateFingerprint } } }`; in-progress identifies only operation/target/requestId. Details contain hashes/identifiers only, never host paths or secrets.
- Metered command execution remains fail-closed before ledger/admission until metering support exists.

Proof includes atomic created/existing claims across competing callers, same-digest terminal replay, in-progress retry, conflicting digest, concurrent duplicate, admission rejection, metering rejection, restart-required-before-mutation, and receipt replay.

### Transcript and storage preservation

Breaking API/wire changes do not authorize transcript movement or rewriting.

- `{ agentTypeId: "default", legacyDefault: true }` is a load-bearing storage contract, not removable compatibility scaffolding.
- Every migrated default Agent retains that spec.
- Explicit `sessionDir`, `sessionRoot/sessionNamespace`, native Pi default directory encoding, and `BORING_AGENT_SESSION_ROOT` behavior remain byte-identical.
- The compatibility-named storage fields may be renamed only if semantics and resolved absolute paths remain identical.
- Core host-volume inference `/data/workspaces` → sibling `/data/pi-sessions` remains unchanged.
- No copy, move, reserialization, wildcard identity migration, or second writer.

### Breaking contraction

The owner explicitly authorized removal of legacy code and breaking APIs in this conversation. The intended deletion manifest includes, subject to the Slice 1 zero-consumer matrix:

- `registerAgentRoutes.ts`;
- `createAgentApp.ts`;
- `agentRouteBindingProfile.ts`;
- `agentHostLegacyRouteRuntime.ts`;
- `agentHostLegacyRoutePolicy.ts`;
- `agentHostLegacyRouteMount.ts`;
- `agentHostLegacyRouteOptions.ts`;
- `agent-host/legacyPiChatCompatibility.ts`;
- legacy projection types and compatibility WeakMaps/helpers;
- `/api/v1/agent/pi-chat/*` and other `/api/v1/agent/*` compatibility routes;
- public exports, examples, tests, scripts, and docs that expose those APIs.

A replacement standalone composition helper is allowed only if it is a thin application factory that directly creates one Host and mounts the same canonical Host/app route modules. It may not own bindings, provisioning, harnesses, session stores, or an alternate route order.

## Route/consumer matrix gate

No consumer migration begins until Slice 1 commits a generated/checked matrix covering at least:

| Surface | Known consumers requiring disposition |
| --- | --- |
| Legacy Pi-chat sessions/events/effects | Agent front, Workspace front, CLI front, eval/bin, first-party plugins, E2E/smoke fixtures |
| Attachments | `HarnessPiChatService`, chat rendering, persisted snapshots/events |
| Reload | Workspace front, agent-playground, plugin-cli, slash commands |
| Skills | Agent front hooks, Workspace Skills page |
| Commands | Agent front hooks and execution callers |
| Models | Agent model selection, automation/model discovery, app filtering |
| System prompt | Debug drawer |
| Ready status | Workspace background boot and preload |
| Workspace plugin client | Workspace plugin runtime and reload |
| First-party plugins | tasks, GitHub PR tracker, ccusage dashboard, ask-user tests |
| Standalone composition | bin, dev server, custom-tool example, test host, eval scripts, remote-worker smoke |
| Production composition | Core/full-app, Workspace, CLI workspaces mode, agent-playground |
| Non-agent routes | files, raw files, FS events, tree, search, Git, share links, health/ready |

The normative matrix is committed at `docs/issues/1029/route-consumer-matrix.json`, validated against a checked JSON schema, and records current path, method, auth/public policy, request/response contract, owner, final path, implementation slice, proof test, and explicit deletion/retention status. A CI checker derives the legacy-route denylist and verifies source callers plus composed route tables.

A separate `docs/issues/1029/composition-lifecycle-dag.md` records construction and teardown ordering for Core, Workspace, CLI folder mode, CLI workspaces mode, agent-playground, and standalone. It reproduces Core's 18 audited edges and each other composition's applicable auth, plugin, scope, provisioning, route, frontend-fallback, lifecycle-registration, drain, and close edges.

Construction ownership is explicit: the composition root owns and must close a newly created Host until canonical lifecycle hooks register successfully; after successful registration Fastify owns drain/close. A second projection mount on the same Fastify/Host pair is rejected deterministically before duplicate routes or lifecycle hooks are installed.

## Flag / abstraction / rollback

- Feature flag: none. A dual path violates the target.
- Delivery: one branch and one PR with independently reviewable commits; nothing merges until the complete contraction is green and explicitly owner-approved.
- Rollback: revert the eventual merge commit. Pre-cutover transcripts and all legacy-default Agent transcripts remain readable because the cutover never rewrites them. No claim is made that pre-cutover code can discover sessions newly created after cutover under configured multi-Agent namespaces; rollback proof explicitly distinguishes byte preservation from backward discoverability.

## Test seams

### Highest public seams

- `CreatedAgentHost.registerRoutes()` through Core/full-app, Workspace/playground, CLI, and standalone compositions.
- Direct trusted dispatcher resolver through hosted automation/manual runs.
- App file/tree/search/git routes through the Host Environment lease.

### Existing evidence

- #909 Gateway conformance and `agent-host/__tests__/*` suites surviving `7b4ee0067`.
- `AH0-ASSEMBLY-AUDIT.md` route and Core ordering inventories.
- Existing four-layout `legacyTranscriptCompatibility.test.ts`.
- Reduced workspace-playground golden route surviving the Wave 1 revert.

The addressed full-app fleet and expanded playground fixtures removed by the Wave 1 revert must be re-established before being cited as proof.

### Required lifecycle matrix

Test shutdown with each active independently:

- addressed event stream;
- FS event stream;
- Agent readiness stream;
- dispatcher stream/operation;
- stuck admitted effect;
- pending provisioning;
- concurrent reload;
- Host created but not mounted;
- projection mounted twice.

Assert admission fencing, bounded grace, transport lease lifetime, generation fencing, late-callback rejection, and exactly-once composition/environment/adapter disposal.

### Required authorization matrix

For Core, Workspace, and CLI prove:

- valid actor/workspace/storage scope;
- cross-workspace header;
- hostile raw-file workspace query;
- foreign storage scope;
- forged scope;
- revoked membership;
- two actors with actor-varying tools/files/prompt;
- two storage scopes in one workspace;
- public health/ready policy;
- addressed attachment cross-agent/session denial.

## Acceptance

### Architecture

- `CreatedAgentHost` is the only agent runtime/binding/provisioning/session/admission/lifecycle authority.
- Exactly one Agent route mount order exists.
- No production consumer holds `AgentHarness`, `HarnessPiChatService`, or `PiSessionStore`.
- No app composer creates a parallel Environment/provider for HTTP routes.
- Core, Workspace, CLI folder mode, CLI workspaces mode, playground, standalone, scripts, and test host directly compose the canonical Host path.
- Workspace owns replacement public option types; it no longer extends `CreateAgentAppOptions` or indexes `RegisterAgentRoutesOptions`.
- Managed MCP, hosted automation/manual runs, `boring-automation`, and plugin-cli self-test use the canonical dispatcher/routes.
- The legacy `createAgent`/`AgentLiveEventBuffer` dispatcher facade assigned to #909 MIG-DEL is either deleted or proven to be a thin Gateway-only facade with no second buffer/runtime authority; the route matrix records the exact disposition.

### Wire and clients

- No registered route or payload contains `/api/v1/agent/pi-chat`.
- Every runtime chat/session caller supplies an `agentTypeId` and uses addressed APIs.
- Addressed create/list/state/events/rename/delete/prompt/follow-up/queue-clear/interrupt/stop/attachments work.
- Required runtime-capability routes have addressed contracts and migrated consumers.
- Required app/environment routes retain their paths unless the route matrix explicitly approves a breaking replacement.

### Runtime/lifecycle

- One canonical provider exists per compatible Environment placement.
- At most one generation is published/current; fenced retiring generations survive only for pre-existing leases and reject new acquisition.
- Reload, concurrent boot, failure cleanup, health, drain, and close use the Host lifecycle only.
- Dispatcher and streaming app routes hold Host leases until completion/transport close.
- Host and adapter disposal are exactly-once.

### Auth/admission

- Scope authorization uses one complete app-owned funnel and Host verification.
- Session effects, commands, and reload execute through strong `AgentEffectAdmission` and request ledger.
- Legacy admission projection is deleted, not silently bypassed.
- Public health/ready endpoints remain intentionally public; Agent/runtime routes remain authorized.

### Storage

- Explicit `sessionDir` fixture lists/reads/streams with byte-identical path and bytes.
- `sessionRoot/sessionNamespace` fixture does the same.
- CLI native Pi default with `BORING_AGENT_SESSION_ROOT` unset does the same.
- CLI native Pi default with `BORING_AGENT_SESSION_ROOT` set does the same.
- Core sibling durable-volume inference remains identical.
- Rollback code discovers and reads every pre-cutover compatibility fixture and every legacy-default transcript.
- Post-cutover configured multi-Agent transcript bytes remain unchanged, but backward discovery of newly namespaced sessions by pre-cutover code is explicitly not guaranteed.
- Rollback deployment drains/stops the cutover writer before reverted code starts, preserving the single-writer invariant.

### Contraction

- Delete the approved compatibility files and exports.
- Delete `createAgentApp` as a composition authority.
- Remove compatibility WeakMaps/helpers including legacy effect execution.
- Remove stale examples, scripts, tests, docs, aliases, and invariant allowlists.
- Source and route-table gates prove zero hidden compatibility path.

## Proof

### Source contraction gate

Use GNU-compatible grep on this host, not the `rg --glob` form:

```bash
if grep -rnE \
  "registerAgentRoutes|AgentHostLegacy|agentHostLegacyRoute|legacyPiChatCompatibility|runLegacyCompatibilityEffect|createAgentHostLegacyPiChatCompatibilityService|createAgentApp|/api/v1/agent/pi-chat" \
  packages apps plugins scripts \
  --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.mts' \
  --exclude-dir=dist --exclude-dir=node_modules; then
  echo "legacy compatibility remains" >&2
  exit 1
fi
```

Historical documentation is either updated/deleted or explicitly listed in a reviewed docs-only allowlist. The generated matrix checker additionally scans export maps, executable/config fixtures, server-generated URLs, legacy runtime-capability route modules, and all non-chat `/api/v1/agent/*` paths; symbol grep alone is not authoritative.

### Positive route-table gate

For composed Core, Workspace, CLI, playground, and standalone apps, enumerate Fastify routes and assert:

- no `/api/v1/agent/pi-chat` route;
- no unclassified `/api/v1/agent/*` route;
- all matrix-required addressed and app routes exist exactly once;
- auth/public policy matches the matrix.

### Automated suites

- Agent Gateway conformance, Host HTTP, lifecycle, authorization, attachment, and transcript matrices.
- `pnpm --filter @hachej/boring-agent test`
- `pnpm --filter @hachej/boring-workspace test`
- `pnpm --filter @hachej/boring-core test`
- `pnpm --filter @hachej/boring-cli test`
- `pnpm --filter @hachej/boring-plugin-cli test`
- affected first-party plugin suites.
- Agent, Workspace, Core, CLI, plugin-cli, playground, and full-app typechecks.
- alignment and golden-path invariants, updated to forbid rather than allow compatibility.
- full-app E2E and workspace-playground addressed E2E re-established on the post-revert base.

## Slices

### Slice 1 — Route matrix and complete direct-Host contract

**Delivers:**

- validate and implement the already-frozen schema-validated `route-consumer-matrix.json` and `composition-lifecycle-dag.md`; no route or lifecycle disposition is authored ad hoc during implementation;
- an additive, separately named final direct projection contract while the compatibility union remains available only inside this unmerged branch; the old union collapses/deletes in Slice 6 after every consumer moves;
- separate host-neutral `authorizeAgentRequest` and verified per-Agent `resolveAuthorizedAgentRuntimeScope` contracts;
- lease-bearing Environment projection;
- trusted dispatcher resolver;
- addressed attachment route and URL generation;
- Host runtime-capability route projection;
- every still-compatible composition mounts the final addressed session and runtime-capability modules exactly once through its existing compatibility branch, without a second full Host projection or duplicate lifecycle hooks; this is temporary only inside the unmerged cutover branch and is the hard prerequisite for Slice 2 client migration;
- one queue-clear route spelling;
- strong admission for reload/commands;
- deterministic duplicate-mount rejection and construction ownership transfer;
- corrected source/export/invariant/route-table gates;
- restored addressed proof fixtures needed by later slices.

**Blocked by:** None.

**Proof:** focused Host HTTP, environment lease, dispatcher, attachment, scope, route-table, type-level API, and lifecycle tests.

**Hard gate:** no consumer migration begins until CI validates the frozen matrix with zero unclassified routes and the composition DAG reproduces Core's 18 audited edges plus applicable Workspace/CLI/playground/standalone edges.

### Slice 2 — Addressed client and plugin migration

**Delivers:** while the existing production mounts still expose both wires inside the unmerged branch, make `agentTypeId` required and migrate all callers to the Slice 1 addressed/runtime-capability routes in reviewable commits:

1. Agent front transport/session/hooks and event URL builder;
2. Workspace front/preload/plugin client and replacement Workspace-owned option types;
3. CLI front in folder and workspaces modes;
4. first-party plugins, managed MCP/automation, `boring-automation`, and plugin-cli self-test;
5. eval/bin/scripts/E2E fixtures.

No payload, URL builder, fallback, or default constant emits `/api/v1/agent/pi-chat`.

**Blocked by:** Slice 1.

**Proof:** front unit suites, plugin suites, URL contract tests, and addressed E2E against the still-compatible servers.

### Slice 3 — Core/full-app production cutover

**Delivers:** Core mounts canonical addressed/runtime-capability Host routes and app/environment routes in the audited order, with no `AgentHostLegacyRoutePolicy`.

**Preserves:** auth proxy ordering, membership/storage scope, plugin trust/discovery, strong admission, dispatcher publication, managed MCP/automation, workspace meta, UI/bridge/plugin route ordering, frontend fallback, durable session root inference, remote-worker pairing.

**Blocked by:** Slices 1–2.

**Proof:** complete Core server/plugin/provisioning/workspace-bridge suites and full-app E2E with addressed clients.

### Slice 4 — Workspace direct cutover

**Delivers:** Workspace removes `registerAgentRoutes`, uses the complete scope funnels, canonical Host route projections, Environment lease for app routes, direct dispatcher publication, and Workspace-owned option types. CLI folder mode inherits this path and is tested explicitly.

**Preserves:** plugin collection, UI tools/bridge, runtime contribution identity, external-plugin policy, workspace authorization, provisioning, readiness, and shutdown.

**Blocked by:** Slices 1–2.

**Proof:** Workspace server tests, CLI folder-mode tests, authorization/lifecycle matrices, and addressed workspace-playground E2E.

### Slice 5 — CLI workspaces, playground, standalone, test-host, eval, and smoke cutover

**Delivers:** direct Host composition for:

- CLI workspaces mode (CLI folder mode is proven through Slice 4);
- agent-playground;
- standalone bin/dev server;
- custom-tool example;
- test-host helpers;
- capability-readiness and Vercel smoke scripts;
- eval/provisioning scripts;
- remote-worker smoke.

`createAgentApp` and its alternate mount order have no remaining consumer.

**Blocked by:** Slices 1–2.

**Proof:** CLI, playground, Agent standalone/test-host, smoke, native Pi transcript, and remote-worker suites with addressed clients.

### Slice 6 — Compatibility deletion and contraction

**Delivers:** execute the approved deletion manifest; collapse public Host types; delete both mount orders and compatibility helpers; update docs/examples/invariant gates; prove the positive route table and negative source scan.

**Blocked by:** Slices 2–5.

**Proof:** full package tests/typechecks/invariants plus contraction gates.

### Slice 7 — Adversarial review and closure

**Delivers:** independent standards, spec, lifecycle/security, API, and thermonuclear reviews; accepted fixes; re-review; current complete proof and owner handoff.

**Blocked by:** Slice 6.

## Dependency graph

```text
Slice 1 direct-Host contract/matrix
             │
             ▼
Slice 2 addressed clients/plugins
├── Slice 3 Core cutover ───────────┐
├── Slice 4 Workspace cutover ──────┼── Slice 6 contraction/deletion
└── Slice 5 remaining hosts ────────┘             │
                                                  ▼
                                     Slice 7 review/proof/handoff
```

Slice 2 begins only after Slice 1 is reviewed and frozen. Slices 3, 4, and 5 may execute in parallel only in isolated worktrees after Slice 2 has migrated shared clients. Core remains the first integrated production-host commit and its audited ordering proof is reviewed before the other host-cutover commits are accepted. One coordinator integrates; no two writers share a worktree.

## Out of scope

- Remote AgentHost transport/protocol.
- New chat UX or multi-chat behavior.
- Runtime identity v2 changes beyond preserving current storage semantics.
- New plugin features.
- Compatibility period, aliases, fallback flags, or dual runtime ownership.

## Resolved contraction decisions

No owner-intent question remains: breaking APIs and complete legacy deletion are approved.

The reviewed matrix and DAG freeze these decisions before implementation:

- runtime capabilities use addressed paths under `/api/v1/agents/:agentTypeId/...`;
- models become an addressed Host route with app-provided filtering policy;
- share links remain app-owned at `/a/:id`;
- `/health` and `/ready` remain public app probes; Agent readiness becomes authorized and addressed;
- canonical queue clearing is `/queue/clear`; `/queue-clear` is deleted;
- `createAgentApp`, both alternate mount orders, legacy dispatcher callbacks, `createAgent`'s second live-event buffer, and all compatibility exports are deleted or reduced exactly as recorded by the matrix denylist;
- public API and legacy wire breakage is declared in the PR and package release notes with no deprecation period.

Implementers may not improvise a route disposition or lifecycle edge during migration.

## Plan review record

### Round 1 — independent read-only reviews

- Codex adversarial architecture review: **NOT READY**, identified missing Core slice, missing Environment lease projection, dispatcher gap, scope-minting circularity, missing addressed attachments/runtime-capability routes, incomplete consumers/provisioning/transcript/lifecycle/contraction proof.
- Claude Opus migration review: **NOT READY**, independently confirmed the same blockers and additionally identified the stale construction premise, alternate `createAgentApp` mount order, live plugin/client callers, unsafe proof grep, reverted E2E assumptions, and load-bearing `legacyDefault` storage sentinel.

All material Round 1 findings are integrated above.

### Round 2 — independent Codex review

Verdict: **NOT READY**, but Round 1 architecture gaps were judged conceptually resolved. Remaining findings were exact contract/sequencing/proof defects: host-neutral versus per-Agent authorization, premature projection-union collapse, server/client proof cycle, stale/double reload provisioning, unsafe generation cardinality wording, missing CLI-folder/public-type/automation/plugin-cli consumers, route matrix versus construction-DAG conflation, and overstated rollback/contraction gates.

All material Round 2 findings are integrated above.

### Round 3 — independent Codex convergence review

Verdict: **NOT READY**, with two remaining structural blockers and two major inconsistencies: issuer context was lost between Host verification and per-Agent runtime resolution; reload lacked a coherent provider/session-pin state machine; Slice 2 clients could not reach new capability routes through still-compatible mounts; rollback acceptance overclaimed discoverability.

Integrated revisions preserve the original authorized capability alongside the verified claim, define a two-class reload state machine (same-identity hot resource reload versus restart-required semantic/environment change), require temporary one-time addressed capability mounting inside the unmerged compatibility branch before client migration, and narrow rollback acceptance.

### Round 4 — independent Codex steady-state review

Verdict: **NOT READY**, with three remaining structural specification gaps: Environment/dispatcher signatures and Agent-selection rules were still conceptual; the normative matrix/DAG were deferred to implementation while public route decisions remained open; reload/command strong admission extended #909 without defining ledger keys, digests, receipts, or errors.

Integrated revisions now include exact host-neutral Environment and callback-scoped dispatcher contracts in a committed lifecycle DAG; a committed schema-validated route matrix with final paths/owners/consumers/proofs; resolved route decisions; and explicit reload/command effects, targets, request IDs, digests, transitions, receipts, metering order, and `AGENT_RUNTIME_RESTART_REQUIRED` mapping.

### Rounds 5–6 — narrow artifact reviews

Verdicts: **NOT READY**. The reviews found factual route errors and duplicate rows in the first matrix, missing per-operation filesystem authority, escapable dispatcher iterators, contradictory reload ordering, and non-atomic execution ownership. Revisions corrected exact route paths/contracts, added request-aware filesystem resolution, replaced escaping iterators with callback-consumed events and revocable wrappers, and made the durable ledger claim the atomic execution owner.

### Round 7 — final steady-state review

Verdict: **READY**. No unresolved BLOCKER or MAJOR defects. The reviewer explicitly confirmed that dispatcher iterators cannot escape lease scope, matrix routes are unique, and models are Host-owned with app-provided filtering policy. Remaining edits are marginal and non-blocking.

### Slice 1 implementation review

Seven adversarial code-review passes closed reload-before-mutation, durable-ledger, Environment-authority, session-pin, shutdown-race, attachment, scoped-change, readiness-stream, dispatcher-revocation, and composed-route proof defects. Final verdict: **READY**. The executable gate reconstructs the composed Fastify Agent route table for all seven named roots, requires every final Host route exactly once, and rejects duplicate or unclassified Agent routes against the normative matrix.

### Slice 2 implementation review

Three adversarial code-review passes closed addressed-envelope parsing, strict payload, workspace-scope, E2E fixture, detached-chat identity, pane-owner reload, selected-Agent propagation, automation durability, plugin self-test, provider-consumer, and deny-scan defects. Final verdict: **READY**. The matrix gate now records the 16 exact intentional legacy server/test survivors and rejects legacy Pi-chat URLs in migrated client, eval, bin, plugin, smoke, and E2E surfaces.

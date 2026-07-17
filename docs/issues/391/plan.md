---
github: https://github.com/hachej/boring-ui/issues/391
issue: 391
state: ready-for-human
updated: 2026-07-17
flag: not-needed
track: owner
---

# gh-391 Static multi-agent composition after AgentHost removal

## Authority

This file is the single active plan and dispatch authority for issue #391.

- Durable decisions: [`../../DECISIONS.md`](../../DECISIONS.md), especially Decision 25.
- Current status and ordering summary: [`runtime-refactor/INDEX.md`](runtime-refactor/INDEX.md).
- Strategic direction: [`runtime-refactor/VISION.md`](runtime-refactor/VISION.md).
- Cross-issue ownership: [`OWNERSHIP.md`](OWNERSHIP.md).
- Completed child-plan indexes: [`../805/plan.md`](../805/plan.md), [`../806/plan.md`](../806/plan.md), [`../807/plan.md`](../807/plan.md), [`../808/plan.md`](../808/plan.md), and [`../809/plan.md`](../809/plan.md).
- The remaining runtime-refactor files are classified as retired work, historical evidence, retained shared architecture, or independently tracked work packages. Their canonical documents have moved to #805–#809; former #391 paths are redirect stubs. Decision 25 controls only #391's static critical path and conflicting AgentHost/D1 ordering; it does not cancel child-issue work.

No implementation starts until the plan-reset PR is merged and the first implementation slice is explicitly marked `ready-for-agent`.

## Problem

Issue #391 accumulated several increasingly complex implementation paths:

1. runtime-free agents and broad package extraction;
2. content-addressed agent bundles and deployment resolution;
3. a durable AgentHost controller with revisions, publication, recovery, host routing, and CAS-like state;
4. marketplace, transport, sandbox, and control-plane follow-ons.

The AgentHost path produced useful contracts and evidence, but it became a second application/control plane before the product had proven the simpler need: multiple named agents composed over the existing authorized workspace runtime.

The owner therefore chose a simpler direction. PR [#794](https://github.com/hachej/boring-ui/pull/794) physically removed obsolete AgentHost controller/deployment assets from full-app. The old D1/AgentHost continuation is no longer a valid implementation queue.

The immediate product need is narrower:

- reusable packages can statically configure more than one named agent;
- Core authenticates the principal and verifies workspace membership before selecting an agent;
- one authorized workspace owns one Workspace + Sandbox runtime pair;
- agents inside that workspace intentionally share its filesystem/runtime trust domain;
- each agent still has distinct route, prompt, tool, session, and provenance identity;
- full-app remains behavior-compatible with one hidden `primary` agent;
- Seneca becomes the first real two-agent consumer after an exact package release.

## Solution

Add an opt-in, immutable, startup-time multi-agent composition seam to the existing Core/Workspace/Agent stack. Do not add a deployment controller or mutable registry.

A host supplies:

1. a frozen serializable set of static agent declarations; and
2. one trusted server-only behavior binding for each declaration.

The existing host authentication and workspace membership boundary resolves the workspace first. Only then may the request select one configured agent and resolve that agent's prompt, tools, sessions, readiness, and provenance over the workspace's existing runtime.

The implementation remains dark for full-app: it supplies exactly one `primary` binding and keeps existing unscoped routes and session behavior. Seneca opts into two agents only after the reusable package cohort is released.

## Current state

### Landed and retained

- Workspace-first authorization and runtime composition.
- `AgentDefinition` / `AgentDeployment` schemas, validators, and deterministic identity helpers.
- Agent-directory compilation and stateless deployment-resolution APIs.
- Request-scoped agent route composition in `registerAgentRoutes`.
- Durable Pi session roots and validated session namespaces.
- Workspace plugin composition, one `UiBridge.postCommand` dispatch source, and paired Workspace/Sandbox runtime adapters.
- Named filesystem bindings from #416.
- Managed MCP authorization patterns.
- PR #794 full-app cleanup and physical AgentHost asset removal.

Existing definition/compiler/resolver APIs are preserved during this plan. They may provide immutable identity/provenance, but they do not own runtime selection or imply CAS. Removing or changing a published API requires a separate consumer and semver audit; it is not a prerequisite for static multi-agent composition.

### Retired and not to be rebuilt

- AgentHost controller, revision engine, publication journal, active-collection pointer, host reconciler, desired-state store, or deployment management API.
- A new CAS, mutable agent registry, dynamic install/update API, runtime upload, watcher, or marketplace catalog.
- Per-agent hostname routing as an authorization mechanism.
- A second workspace/runtime composer.
- A sandbox per logical agent inside one workspace.
- Client-supplied workspace, root, runtime handle, behavior binding, or provenance authority.

Historical migrations remain in place. Their presence is not permission to restore the removed runtime.

## Binding decisions

### 1. Static means startup-only

The host configuration is immutable for one process lifetime. Supporting add/remove/update without restart would require lifecycle, cache invalidation, readiness, session migration, and authorization semantics that the first consumer does not need.

There is no mutation endpoint and no persistence store for the static set.

### 2. Existing agent definition contracts remain

Do not invent a competing canonical `AgentDefinition`. A static declaration may reference existing definition/deployment identities and add only host-composition metadata needed for selection, such as stable `agentId`, label, route base, and primary status.

An optional `AgentDeployment` is immutable provenance only. Its `agentId` and definition reference must match the static declaration, but runtime selection never follows it through a publication pointer, storage lookup, rollout state, or mutable registry. The trusted server behavior binding remains executable authority. Tests must prove a mismatch rejects and no deployment resolver is invoked during static selection.

Trusted behavior factories and runtime values remain server-only and never enter browser DTOs.

### 3. Authorization precedes selection

Required order:

```text
authenticate principal
-> validate workspace selector
-> load workspace
-> verify membership
-> select configured agent
-> resolve prompt/tools/session/runtime scope
-> execute
```

Unknown or malformed agent IDs fail after authorization but before runtime/session/tool side effects. Agent selection cannot grant workspace access.

### 4. One Workspace + Sandbox per workspace

All configured agents in a workspace use the same prepared Workspace and the same paired Sandbox/runtime adapter lifecycle.

This is logical host/workspace ownership, not a requirement to move the existing physical lifecycle between packages. Today the sole workspace-keyed runtime lifecycle is created and retired through Agent route registration composed by Core. The minimal implementation retains that single owner, adds logical agent children keyed by `(workspaceId, agentId)`, and forbids children from disposing the shared runtime. A package extraction requires a separate demonstrated dependency need.

Consequences:

- agents in one workspace can intentionally see the same filesystem and processes;
- per-agent tool lists and prompts are product behavior, not a security boundary;
- filesystem/runtime isolation requires a different workspace;
- disposing one logical agent must not dispose the shared runtime;
- disposing the workspace disposes the shared runtime exactly once.

### 5. Agent identity is distinct even when runtime is shared

The trusted selected `agentId` participates in:

- explicit route identity;
- prompt/instructions selection;
- tool catalog and execution attribution;
- session namespace and list/detail scope;
- readiness and runtime-cache scope where behavior differs;
- receipts, logs, UI bridge attribution, and other provenance.

A request body, browser header, model tool call, or stored session cannot override the server-selected agent.

### 6. Routes are explicit, with a compatibility alias

The explicit agent-owned route family is:

```text
/api/v1/agents/:agentId/...
```

Only agent-owned routes are scoped. Workspace, Core, plugin, file, and UI bridge APIs remain owned by their existing packages and must not be duplicated under every agent.

`registerAgentRoutes` currently aggregates Agent-owned chat/session/tool behavior with files, filesystem events/tree/search/deep links, git, models, and skills. Before route implementation, S1 freezes a route-ownership table. S3 extracts an internal agent-owned registrar from the legacy aggregate while retaining one runtime binding; S4 mounts only that owned subset under the explicit prefix. The legacy aggregate delegates its Agent-owned behavior to primary and continues to mount shared routes once.

Existing unscoped agent routes remain an alias to the host's single primary agent. Unknown explicit IDs never fall back to primary.

### 7. Session compatibility is load-bearing

On-disk Pi JSONL remains compatible.

- The full-app primary agent retains the byte-for-byte output of the existing `fullAppAgentSessionNamespace` resolver so historical sessions remain visible. No plan prose may reinterpret that output as a new namespace scheme.
- Non-primary agents use a deterministic collision-safe namespace derived from structured `(workspaceId, agentId)` inputs.
- Explicit primary routes and legacy unscoped routes resolve the same primary namespace.
- Newly written non-primary `boringSessionCtx` may add optional `agentId`; existing records with only workspace/user context remain valid.
- Session list/load/detail operations are scoped by trusted agent identity.
- After a selected-namespace miss, the server may perform a bounded lookup across the immutable configured-agent namespaces. A confirmed hit under another configured agent returns the stable identity-mismatch error; no hit returns the stable not-found result. No persistent ownership index or global session scan is added.
- Loading a non-primary session through another agent fails with a stable error before effects.
- Provenance records the selected agent and immutable prompt/config identity where the existing public seam supports it; historical provenance must not be reconstructed from current configuration.

The implementation must test delimiter-collision, traversal, bounded-lookup, and not-found-versus-mismatch cases rather than relying on string concatenation.

### 8. Browser catalog is a safe projection

After authentication and membership checks, an opted-in consumer may receive only the serializable view needed to render selection, for example stable ID, label, route base, and primary marker.

Catalog exposure is a host option that defaults to `false`. When disabled, no catalog route is mounted. It never receives behavior functions, prompts containing secrets, filesystem roots, sandbox handles, policies, provider facts, or deployment credentials.

Full-app leaves catalog exposure disabled and does not render a selector. The reusable conformance host enables it for proof; Seneca enables it only in N1.

### 9. Full-app remains the compatibility consumer

Full-app proves that the reusable seam does not disturb the existing application:

- exactly one static `primary` behavior;
- existing routes continue to work;
- existing sessions remain visible;
- no selector or public agent list is exposed;
- no AgentHost/controller/CAS edge returns;
- authentication, workspaces, files, plugins, MCP, and normal migration behavior remain green.

### 10. Seneca is the first product consumer

Seneca will configure exactly two named agents over one authorized workspace/runtime and prove:

- both use the same Workspace and Sandbox identity;
- a sentinel written by one can be read by the other;
- a second workspace receives a distinct runtime and cannot read the first;
- prompts, tool catalogs, sessions, routes, and provenance remain distinct;
- membership denial occurs before agent selection;
- the installed package versions are exact registry versions, not workspace links.

This is intentional shared trust, not same-workspace security isolation.

### 11. Release before Seneca integration

After reusable package conformance passes, publish only the exact affected package cohort through the repository-native release process.

Before publishing, R1 must obtain the Seneca repository/ref and its package-manager, typecheck, build, and test commands. Install S5 tarballs into a clean Seneca checkout or a demonstrably equivalent consumer fixture and run those commands without adding product configuration. Derive the cohort from the actual package dependency graph and publish in dependency-topological order. Then repeat the clean install/proof against registry artifacts.

Seneca pins exact versions and lockfile integrity. Rollback restores its previous exact cohort and single-primary configuration.

### 12. Later work stays later

The following do not block the Seneca static proof:

- JSON-defined custom tools executed inside a sandbox;
- native agent-to-agent delegation or external A2A;
- durable multi-channel transport;
- marketplace/contracted-agent behavior;
- generic environment attachment;
- provider extraction and S3/FUSE mounts;
- per-agent runtime isolation;
- dynamic registration or control-plane UX.

They may start only after the Seneca proof supplies a real consumer and a separate approved plan.

## Package ownership

### `@hachej/boring-agent`

Owns:

- stable agent IDs and browser-safe declaration/catalog types;
- existing definition/deployment references;
- trusted server behavior binding types;
- request-scoped agent identity;
- agent-owned route mounting;
- agent-scoped Pi/session/tool/readiness/provenance integration;
- stable errors.

It keeps zero value imports from boring-bash or boring-sandbox.

### `@hachej/boring-workspace`

Owns:

- the Workspace abstraction and paired runtime-mode contract;
- plugin contributions and one UI bridge;
- host-facing composition inputs needed to attach logical agents to the prepared workspace pair;
- conformance proof that the pair is shared across logical agents.

The existing physical workspace-keyed runtime lifecycle may remain in Agent route registration composed by Core; this plan does not force package movement. There is exactly one lifecycle owner regardless of file location. Workspace front/shared code keeps zero Agent value imports.

### `@hachej/boring-core`

Owns:

- principal authentication;
- workspace selection and membership authorization;
- host-supplied immutable catalog wiring;
- authorized agent selection and browser-safe catalog projection;
- compatibility routing to primary.

Core does not own agent bundle storage, deployment lifecycle, CAS, or sandbox internals.

### Host applications

Full-app and Seneca own concrete startup declarations and trusted behavior bindings. Environment parsing stays in host composition, not shared package contracts.

## Stable errors

Implementation must add errors to the canonical stable error registry rather than throwing ad-hoc messages. At minimum the behavior needs stable codes for:

- invalid static declaration;
- duplicate agent ID;
- missing/mismatched behavior binding;
- invalid primary configuration;
- unknown configured agent;
- agent/session identity mismatch.

Authorization failures continue using existing Core conventions so agent lookup cannot leak catalog membership.

## Test seams

### Highest public seams

- Agent declaration/behavior validation and optional catalog projection.
- The S1 route-ownership table and extracted Agent-owned route registrar.
- `registerAgentRoutes` resolved request scope and sole shared runtime lifecycle.
- Core workspace server authentication/membership/selection ordering.
- Workspace server shared runtime composition.
- Full-app compatibility behavior.
- Seneca's real authenticated two-agent flow.

### Existing prior art

- `packages/agent/src/shared/agent-definition.ts`
- `packages/agent/src/shared/__tests__/agent-definition.test.ts`
- `packages/agent/src/server/registerAgentRoutes.ts`
- `packages/agent/src/server/__tests__/registerAgentRoutes.test.ts`
- `packages/agent/src/server/harness/pi-coding-agent/sessions.ts`
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`
- `packages/workspace/src/server/__tests__/createWorkspaceAgentServer.test.ts`
- `packages/workspace/src/server/__tests__/createWorkspaceAgentServer.vercel-sandbox.test.ts`
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`
- `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.provisioning.test.ts`
- `apps/full-app/src/server/main.ts`
- `apps/full-app/src/server/plugins.ts`
- `apps/full-app/src/server/__tests__/production-safety.test.ts`

### Avoid testing

- Private helper implementation when the public composition seam can prove behavior.
- Separate mocked auth logic inside Agent; Core/host owns auth.
- Per-agent sandbox isolation, because it is explicitly not promised.
- Deleted AgentHost implementation or historical plan behavior.

## Acceptance

Issue #391's static multi-agent increment is complete when:

1. a host can supply at least two immutable startup agent bindings without platform package source edits;
2. Core authenticates and verifies membership before exact agent selection;
3. both agents use one Workspace + Sandbox pair for one workspace;
4. their routes, prompts, tools, sessions, and provenance are distinct;
5. same-workspace shared filesystem visibility and cross-workspace denial are both proven;
6. full-app remains behavior-compatible as one hidden primary agent;
7. exact package artifacts are published and Seneca pins them;
8. Seneca proves the authenticated two-agent flow through its normal deployment path;
9. no AgentHost/controller/CAS/mutable-registry path is introduced;
10. proof, independent standards/spec review, and rollback instructions are recorded for every slice.

## Proof

### Repository proof

Each slice records exact focused tests plus:

```bash
pnpm lint:invariants
pnpm typecheck
pnpm test
pnpm e2e
```

Use narrower package commands during iteration, but final package/release and Seneca integration gates must include the repository-required equivalents.

### Static conformance proof

A reusable package test must demonstrate:

```text
workspace W + agent primary + agent reviewer
-> one Workspace identity
-> one Sandbox/runtime identity
-> shared sentinel succeeds
-> distinct prompt/tool/session/provenance identity

workspace W2
-> distinct Workspace/Sandbox identity
-> W sentinel read denied/unavailable
```

### Full-app proof

- existing authenticated workspace/chat/files flow;
- legacy session visibility;
- existing unscoped routes;
- production build/image contains no AgentHost deployment subtree;
- no selector or secondary agent surface.

### Seneca proof

- exact package versions and integrity;
- authenticated safe catalog/selector;
- two agent turns with distinct identity;
- restart/session-load behavior;
- shared W sentinel and isolated W2 negative;
- rollback to prior exact package cohort.

## Slices

The implementation is dependency-ordered. Planning/review can run in parallel; overlapping writers cannot.

### P0 — Canonical decision and plan reset

**Delivers:** Decision 25, this canonical plan, audited retired/evidence/retained markers, child issue ownership #805–#809, current status/ordering summaries, tracker reconciliation, and issue-body alignment.

**Blocked by:** None; PR #794 is merged.

**Proof:** documentation link/authority grep, exact 8 retired / 29 evidence / 84 retained classification, tracker cycle check, robot insights, independent Sol xhigh plan review.

**Review budget:** 30–45 minutes. Planning only.

### S1 — Static declaration and behavior-binding contract

**Delivers:** one minimal immutable startup contract using existing definition/deployment identities only as validated provenance; server-only behavior bindings; browser-safe catalog DTO; default-off catalog exposure option; validation and stable errors; and a binding route-ownership table that classifies every route currently aggregated by `registerAgentRoutes` as Agent-owned or shared. No routes or runtime behavior change.

**Blocked by:** P0.

**Proof:** focused shared/server contract tests, browser-safe serialization/export audit, duplicate/invalid/missing-binding/primary/deployment-mismatch cases, no deployment-resolver invocation, and a complete reviewed route-ownership inventory.

**Rollback:** revert additive contract before release.

**Review budget:** 20–30 minutes.

### S2 — Agent-scoped request, session, and provenance identity

**Delivers:** trusted `agentId` in resolved Agent request scope, cache inputs, tool attribution, collision-safe non-primary session namespaces, byte-identical `fullAppAgentSessionNamespace` primary compatibility, optional agent provenance on new non-primary session context, and bounded mismatch detection without a persistent index.

**Blocked by:** S1.

**Proof:** two-agent session/prompt/tool tests; cross-agent load denial; legacy primary session fixtures; traversal/collision cases; bounded not-found-versus-mismatch lookup; no request-body override.

**Rollback:** revert before release; on-disk JSONL remains unchanged.

**Review budget:** 30–45 minutes.

### S3 — Shared Workspace + Sandbox composition

**Delivers:** multiple logical agent behavior children over the existing sole workspace-keyed runtime lifecycle, without moving physical package ownership or creating a second composer; an internal Agent-owned route registrar extracted from the legacy aggregate so shared routes remain mounted once.

**Blocked by:** S2.

**Proof:** factory/object identity counts, shared sentinel, W2 isolation, one final disposal, agent-local disposal does not terminate shared runtime, and route-registration tests proving shared file/git/model/skill/plugin/UI routes are not duplicated.

**Rollback:** remove opt-in multi-agent host input; retain single primary composition.

**Review budget:** 30–45 minutes.

### S4 — Core authorization, routing, and safe selection

**Delivers:** membership-before-selection ordering, explicit mounting of only the S1-classified Agent-owned routes, primary compatibility alias through the legacy aggregate, and a default-off authenticated browser-safe catalog projection.

**Blocked by:** S3.

**Proof:** unauthenticated/nonmember/foreign/unknown cases before side effects; explicit and legacy primary equivalence; body/header spoof denial; catalog enabled/disabled route behavior; full shared-route non-duplication matrix; catalog projection exactness.

**Rollback:** remove opt-in scoped routes; existing primary routes remain.

**Review budget:** 30–45 minutes.

### S5 — Package conformance and full-app freeze

**Delivers:** reusable two-agent conformance fixture and full-app single-primary compatibility wiring/tests. No visible full-app multi-agent UI.

**Blocked by:** S4.

**Proof:** package matrix, full-app build/typecheck/tests/E2E/image smoke, session compatibility, AgentHost absence, 404/no route for the disabled full-app catalog, and shared-W/isolated-W2 tracer in the opted-in conformance host.

**Rollback:** revert host wiring to existing single primary.

**Review budget:** 30–45 minutes.

### R1 — Exact package cohort release

**Delivers:** only the affected publishable package cohort through the native release procedure, with pre-publish Seneca consumer qualification, tarball evidence, dependency-topological publishing, and post-publish clean-install evidence.

**Blocked by:** S5 merged and green.

**Proof:** package dependency/export audit, S5 tarballs installed into a clean Seneca checkout or equivalent consumer fixture with its real package-manager/typecheck/build/test commands, registry metadata/integrity, repeated registry-artifact consumer proof, and full-app released-cohort smoke.

**Rollback:** publish a corrective cohort if necessary; never rewrite a published version.

**Review budget:** release-owner plus package reviewer, 20–30 minutes.

### N1 — Seneca two-agent integration and product proof

**Delivers:** exact released package pins; two static named agents in Seneca; safe selector; real authenticated shared-runtime/distinct-identity proof; rollback record.

**Blocked by:** R1.

**Proof:** Seneca typecheck/tests/E2E/image/deployment checks, W shared sentinel, W2 isolation, distinct session/prompt/tool/provenance, membership negatives, restart/history proof.

**Rollback:** prior exact package cohort and single-primary Seneca config.

**Review budget:** 45–60 minutes across package boundary, auth, runtime, and product proof.

## Tracker graph

```text
#794 merged
  -> P0 plan reset
  -> S1 static contract
  -> S2 agent identity/session/provenance
  -> S3 shared Workspace+Sandbox composition
  -> S4 Core authorization/routing/selection
  -> S5 conformance + full-app freeze
  -> R1 exact package release
  -> N1 Seneca two-agent proof

N1 -> later custom JSON sandbox tools (separate plan)
N1 -> later native agent-to-agent/A2A work (separate plan)
```

Only the first unfinished node is `ready-for-agent`. Later nodes remain blocked even if planning agents inspect them.

## Out of scope

- Restoring any physically removed AgentHost asset.
- Dynamic agent lifecycle or control plane.
- Runtime upload or marketplace catalog.
- Per-agent workspace/sandbox isolation.
- Hostname-based authority.
- New auth/identity server work.
- Durable transport redesign.
- Custom JSON tool execution.
- Native A2A or contracted-agent behavior.
- Full boring-bash/sandbox/package extraction.
- S3/FUSE mounts.
- Full-app multi-agent selector.

## Open questions and stop conditions

These do not block P0 or S1 planning, but the named slice must resolve them before implementation:

1. **Exact route-registration mechanics (S4):** scope only Agent-owned routes; stop if the proposed Fastify prefix duplicates Workspace/Core/plugin routes.
2. **Session namespace compatibility (S2):** verify all current full-app history paths before changing defaults; stop if primary history would disappear.
3. **Runtime ownership (S3):** verify the current composer really owns one Sandbox lifecycle per workspace; do not claim shared identity from mocks alone.
4. **Published consumer compatibility (S1/R1):** audit external imports before changing existing definition/compiler/resolver exports.
5. **Seneca inputs (N1):** confirm repository/ref, exact agent IDs, primary choice, prompts/tools, CI commands, deployment target, and observability before dispatch.
6. **Release authority (R1):** publishing credentials and release-owner approval are human gates.

A stop condition triggers plan amendment or owner review. It never authorizes a fallback controller, mutable registry, duplicate composer, or silent compatibility break.

---
github: https://github.com/hachej/boring-ui/issues/391
issue: 391
state: ready-for-human
updated: 2026-07-17
flag: not-needed
track: owner
---

# gh-391 Domain-routed agent workspaces, then multi-agent and runtime expansion

## Authority

This is the single active plan and dispatch authority for issue #391.

- Durable decision: [`../../DECISIONS.md`](../../DECISIONS.md), Decision 26.
- Agent/MCP/A2A modes: [`AGENT-CONSUMPTION-MODES.md`](AGENT-CONSUMPTION-MODES.md).
- Prebuilt work-package alignment: [`ROADMAP-ALIGNMENT.md`](ROADMAP-ALIGNMENT.md).
- Child programme ownership: [`OWNERSHIP.md`](OWNERSHIP.md).
- Completed plan-reset evidence: [`proof.md`](proof.md).

The older same-workspace-first S1–N1 plan and its Bead graph are superseded. No old work package is dispatchable merely because its file remains in the repository. Only the first unfinished Step 1A Bead may become `ready-for-agent` after this planning reset is reviewed and merged.

## Product goal

Seneca should host several focused agent products through one normal application deployment.

The first product shape is:

```text
request domain
-> statically configured workspace type
-> authenticated principal
-> existing or explicitly created authorized workspace of that type
-> exactly one statically configured agent type
-> normal workspace-backed agent experience
```

Example:

```text
insurance.senecaapp.ai
-> workspace type insurance-comparison
-> agent type insurance-analyst

legal.senecaapp.ai
-> workspace type contract-review
-> agent type legal-reviewer
```

A domain selects product configuration. It never grants workspace membership, selects an arbitrary workspace, or carries executable authority.

## Delivery roadmap

### Step 1 — Domain-routed single-agent workspace types

#### Step 1A — Web product routing

Persist a stable workspace type on every workspace. At startup, the host supplies immutable declarations mapping exact domains to workspace types and each workspace type to exactly one trusted server-only agent behavior.

After authentication, users see only authorized workspaces whose persisted type matches the request domain. One match opens automatically; several matches produce a workspace chooser; zero matches produce an explicit empty/create flow. Workspace creation is always an authenticated user action and the server stamps the type from the trusted domain declaration. Login and listing never create a typed workspace implicitly.

Full-app remains the compatibility consumer: one `default` workspace type, one `primary` agent, current implicit-default behavior, current routes, and current session history.

Seneca proves at least two domains, two workspace types, and two agent types through its normal deployment path.

#### Step 1B — Authenticated external MCP

After Step 1A, external MCP reaches the same authorized workspace and sole configured agent. MCP is an ingress surface, not an agent distribution mechanism. Its existing plans live under #806 and must be recut against the Step 1A authority before dispatch.

### Step 2 — Multiple agents inside one workspace

A workspace type may later declare several allowed agent types plus one default. The UI may render a selector. Agents share the workspace's one Workspace + Sandbox lifecycle and trust domain while retaining distinct prompts, tools, sessions, attribution, and routes.

Same-workspace delegation uses the existing native subagent mechanism. It does not serialize through MCP or external A2A.

### Step 3 — Durable runtime and external protocol expansion

Consumer-backed improvements may then add:

- durable task/event admission, receipts, replay, approvals, `input-required`, and restart recovery;
- external/cross-deployment A2A;
- hardened public MCP/A2A auth and transport;
- `boring-sandbox` and `boring-bash` extraction;
- bounded custom tools executed inside the workspace sandbox;
- additional channels and transports.

Contracted/service agents, marketplace, billing, generic environment attachment, and S3/FUSE mounts remain later, demand-gated work.

## Step 1A user journeys

### Existing single workspace

```text
1. User opens insurance.senecaapp.ai.
2. Server normalizes the trusted request hostname and resolves insurance-comparison.
3. User authenticates.
4. Server lists only the user's memberships in insurance-comparison workspaces.
5. Exactly one eligible workspace is found.
6. Server revalidates membership and workspace type.
7. insurance-analyst behavior is selected server-side.
8. Existing workspace/chat/files/plugins/session UI opens.
```

### Several eligible workspaces

```text
1. Domain and authentication resolve as above.
2. Server returns only authorized workspaces of the domain's workspace type.
3. User chooses one.
4. Server reloads it, revalidates membership and type, then starts the sole agent.
```

The chooser selects a workspace, not an agent. It remains reachable through the existing workspace switcher. When creation is enabled, the chooser may also expose the same explicit Create workspace action so users can add another workspace of that type.

### No eligible workspace

```text
1. Domain and authentication resolve as above.
2. No authorized workspace of that type exists.
3. UI renders an explicit empty state.
4. If creation is disabled, the UI says access must be granted by the product administrator and exposes no mutation action.
5. If creation is enabled, an authenticated user allowed by the existing Core workspace-create policy chooses Create workspace.
6. Server creates it using the current app and server-derived workspace type under an idempotency key.
7. Existing provisioning runs through the normal workspace creation path.
8. The new membership is established and the workspace opens.
```

No workspace is created merely by authentication, list refresh, MCP request, or agent resolution. The client cannot submit or override `workspaceTypeId`.

### Full-app compatibility

Full-app remains a standalone authenticated application. It does not enable typed-domain routing, so domain normalization/fail-closed product routing does not apply to localhost, preview hosts, or its normal deployment hosts:

- one compatibility default host path;
- workspace type `default`;
- one `primary` behavior;
- current default-workspace creation semantics;
- current unscoped routes and session namespace;
- no visible agent selector or agent catalog;
- no AgentHost, controller, CAS, or deployment resolver.

## Vocabulary and contracts

### Workspace type

A stable product classification persisted on `Workspace` as `workspaceTypeId`.

It determines which static workspace product declaration applies. It is not a role, app ID, deployment ID, runtime mode, or authorization grant.

V0 properties:

- canonical ASCII grammar `^[a-z][a-z0-9-]{0,62}$` with no case/Unicode normalization aliases;
- `default` is reserved for compatibility;
- immutable through public APIs;
- server-stamped during creation;
- queryable through membership-filtered workspace listing;
- compatibility default for existing rows;
- independent of hostname so MCP and A2A can address the same workspace later.

### Agent type

A stable host-owned key for one trusted behavior binding: prompt/instructions, tools, Pi behavior, plugins/contributions where supported, readiness, and session attribution.

It is not a mutable registry record or compiled deployment. Existing `AgentDefinition` and directory-authoring APIs may remain available, but Step 1A runtime selection does not require an `AgentDeployment`, definition digest, bundle digest, content-addressed store, or deployment resolver.

### Host declarations

Conceptually:

```ts
type StaticAgentProductConfig = {
  domains: readonly {
    hostname: string
    workspaceTypeId: string
  }[]
  workspaceTypes: readonly {
    workspaceTypeId: string
    label: string
    agentTypeId: string
    allowWorkspaceCreation: boolean
  }[]
  agentTypes: readonly {
    agentTypeId: string
    behavior: ServerOnlyAgentBehaviorBinding
  }[]
}
```

The exact API is finalized in Slice 1A.2 after checking existing package exports. This conceptual normalized graph is a server-only host composition shape, not a frozen public browser API. Step 1A must not implement several agents per type or persist the singular `agentTypeId`; Step 2 evolves only the host mapping to an allowed set plus default. Required semantics are fixed:

- frozen/defensively copied at startup;
- exact normalized hostnames only;
- one domain maps to one workspace type;
- one Step 1A workspace type maps to exactly one agent type;
- one agent type maps to exactly one behavior binding;
- duplicate/dangling/missing mappings fail startup;
- executable behavior never enters browser/shared DTOs;
- no mutation endpoint or backing registry exists.

## Binding decisions

### 1. Workspace type is persisted

Add `workspaceTypeId` to the canonical Workspace type, database schema, store mappers, and authenticated API projection.

Use a non-null compatibility default of `default` for existing rows and hosts. The migration must be additive and reversible at the application level; no down migration is required. Existing full-app rows continue to behave as before.

Static workspace-ID maps and classifier predicates are rejected as the product authority:

- a static ID map would require a deployment for every workspace creation;
- a classifier could silently change classification when unrelated mutable fields change;
- neither makes MCP/A2A workspace addressing independent of request hostname.

### 2. Domain is routing input, never authority

Use Fastify's derived hostname and existing explicit trusted-proxy policy. Do not independently trust `Host` forwarding headers.

The normalizer must define and test lowercase/IDNA behavior, terminal dot and port handling, IPv4/IPv6 behavior, malformed/multi-valued input, and duplicate normalized startup entries. V0 uses exact hostnames only—no wildcard or suffix matching.

Required order:

```text
normalize/resolve domain without workspace disclosure
-> authenticate principal
-> list/load current-app memberships
-> filter/revalidate persisted workspace type
-> derive the sole static agent type
-> prepare runtime/session/tools
-> execute
```

Unknown domains fail closed only when typed-domain routing is enabled. With the option disabled, existing hosts—including full-app localhost/preview hosts—retain current behavior.

Typed-domain mode and the surviving legacy `requestScopeResolver`/deployment-scoped request path are startup-mutually-exclusive. Resolver output, deployment IDs, revisions, digests, and request-scope headers cannot select a workspace or agent on a typed host.

Seneca uses host-only `Secure`/`HttpOnly` session cookies per product domain; users may authenticate separately on each domain. Shared parent-domain cookies are not introduced. Slice 1A.2 must prove Better Auth base URL/callback behavior, trusted origins, CSRF/SameSite behavior, logout/revocation, and forwarded scheme/host handling for both real domains. Social/OAuth login across several domains is not promised until those callbacks are separately configured and proven.

Body, query, arbitrary headers, browser state, stored sessions, model output, and tool calls cannot override the resolved domain/type/agent chain.

### 3. Workspace membership remains the only live workspace authority

A domain/type match cannot authorize a workspace. Every list/detail/select/create operation keeps existing Core app and membership checks.

For an explicit workspace selection:

1. load under the current app;
2. verify membership;
3. verify persisted workspace type matches the request domain;
4. only then resolve behavior/runtime/session state.

Foreign or mismatched IDs fail before files, plugins, UI bridge commands, provisioning, agent/runtime/session/tool side effects and follow existing non-disclosure conventions. Typed hosts therefore derive one post-auth typed request context/guard and apply it to every workspace-ID route, not only chat or workspace-list endpoints. Slice 1A.3 freezes a route inventory proving coverage.

### 4. Creation is explicit in typed-domain mode

Current Core listing and post-signup hook can implicitly create a default workspace. Step 1A typed-domain mode must not reuse either behavior during signup, login, list refresh, or invite acceptance.

- zero eligible: empty state and either administrator-contact guidance or an explicit Create action;
- one eligible: open automatically, with the existing switcher still available;
- several eligible: chooser, with Create available when allowed;
- `allowWorkspaceCreation` enables the product action but does not authorize the caller; the existing Core authenticated workspace-create policy remains authoritative in v0;
- explicit create: server stamps `workspaceTypeId` from the resolved domain and uses a durable idempotency key across concurrent requests/retries;
- response loss, provisioning failure, and retry must converge on one workspace, one owner membership, and at-most-one successful provisioning operation, with a retryable failed-provisioning state rather than silent duplicate rows;
- client-supplied type is rejected fail-closed;
- full-app compatibility mode retains its current implicit default behavior.

There is no generic provisioning controller or workspace-type mutation API.

### 5. Runtime behavior is selected only after authorization

The host's behavior binding is request/workspace-neutral at startup. It must not capture one concrete Workspace, Sandbox, user, root, or runtime handle.

After authorization, the selected binding composes through the existing Core -> Workspace -> Agent seams and the existing sole workspace-keyed Workspace + Sandbox lifecycle. A logical agent cannot create a second runtime owner or dispose the workspace runtime independently.

### 6. Step 1A has one agent per workspace

No in-workspace agent selector, catalog, `/agents/:agentId` product route family, cross-agent session lookup, or multiple logical runtime children are required.

Agent identity is nevertheless recorded from trusted server configuration in the places the current public seams support: prompt/tool attribution, sessions, logs/receipts, readiness, and future task provenance. The workspace row persists only `workspaceTypeId`, never the Step 1A singular agent mapping. Product attribution is useful; compiled deployment provenance is not required. Existing unscoped routes are compatibility behavior, not the permanent Step 2 multi-agent contract.

### 7. Session and history compatibility are load-bearing

- Full-app's current namespace output remains byte-compatible.
- Existing Pi JSONL remains readable.
- Existing rows backfilled to `default` retain visible history.
- A non-default agent type receives a deterministic collision/traversal-safe session namespace derived from trusted workspace and agent type identity using length-prefixing or a stable hash, never lossy character replacement.
- Session list/load/write remains scoped by authenticated workspace and the derived agent type.
- No unbounded global scan or persistent session ownership index is added.
- Stored history cannot override current authorization or selected behavior.

### 8. Existing authoring is input, not runtime deployment authority

Seneca currently validates `agents/<name>/agent.json`, but the resulting bundle is discarded and referenced tools are not runtime-bound. Step 1A connects Seneca-authored agent content to trusted host behavior explicitly: Seneca constructs the server-only behavior binding at startup/build composition from the validated authored directory's instructions and explicit tool references, resolving tools through an explicit Seneca-owned catalog. Prompt/tool content is not duplicated by hand in parallel configuration.

The compiler is an import-free validator/materializer, not a deployment system. Tests must prove an authored instruction/tool-reference change changes the bound runtime behavior. Do not add compiled bundle storage, digest resolution, `definitionRef`, `deploymentRef`, CAS, publication pointers, runtime upload, or a controller. Existing published compiler APIs remain unless separately audited, but Step 1A runtime selection does not use their digest as authority.

### 9. Full-app and Seneca prove different concerns

Full-app proves compatibility and absence of platform regressions.

Seneca proves the product:

```text
domain A -> type A -> authorized workspace A -> agent A
domain B -> type B -> authorized workspace B -> agent B
```

Required negatives:

- unauthenticated request;
- untrusted forwarded-host spoof;
- unknown domain;
- foreign workspace;
- workspace/type mismatch;
- attempted body/header/type/agent override;
- zero and several eligible workspaces;
- no implicit creation during auth/list;
- cross-product session/runtime leakage.

## Data and migration contract

### Schema

Add a stable non-null text workspace-type column using repository naming conventions. The implementation plan currently calls the API field `workspaceTypeId`; migration/schema naming follows existing snake_case conventions.

Migration requirements:

- additive column with compatibility default `default`;
- all existing rows become `default` without application downtime;
- existing uniqueness and membership constraints remain intact;
- no AgentHost tables or migrations are touched;
- no database enum is required; host declarations validate known values at runtime;
- public update routes cannot mutate the field in Step 1A;
- the internal `WorkspaceStore.create` contract accepts a trusted `workspaceTypeId` with `default` compatibility, and every production/local store mapper supports it;
- public create/update request schemas do not accept `workspaceTypeId`; typed creation supplies it from the resolved server context;
- populated-table, fresh-database, local-store, old-fixture, and prior-release-read compatibility are tested.

### API projection

Authenticated workspace DTOs may include `workspaceTypeId`. Lists remain membership-filtered. Typed-domain hosts return only matching workspaces through the new scoped selection seam; full-app's existing list semantics remain compatible.

### Static config updates

Configuration changes ship through a normal app build/deploy/restart. Startup validation fails before serving if declarations are malformed or conflict with required compatibility behavior.

Dynamic reassignment is not part of Step 1A. Existing workspaces are backfilled only to `default`; non-default product workspaces are explicitly created after typed routing is available. Retyping a workspace with existing history is out of scope because it would change agent/session behavior and requires a separate migration plan.

## Package ownership

### `@hachej/boring-core`

Owns:

- persisted `workspaceTypeId` and store/API mapping;
- trusted domain normalization and host declaration validation at the app/server boundary;
- authentication and membership-before-type/agent resolution;
- typed workspace list/select/create semantics;
- stable errors and safe browser projection;
- full-app compatibility path.

### `@hachej/boring-workspace`

Owns the existing Workspace abstraction, Workspace + Sandbox paired lifecycle, and host-facing composition needed to attach the sole selected agent behavior. It does not decide domain, membership, or agent product policy.

### `@hachej/boring-agent`

Owns server agent behavior contracts, trusted agent identity/session/tool/readiness integration, and existing authoring validators. It imports no runtime values from `boring-bash` or `boring-sandbox`.

### Host applications

Full-app and Seneca own concrete domain/workspace-type/agent-type declarations and trusted behavior bindings. Seneca owns its `agents/<name>/` content, product tools, deployment domains, branding, and deployment smoke.

## Stable errors

Use canonical package registries. At minimum Step 1A needs stable behavior for:

- invalid static product configuration;
- duplicate normalized domain;
- unknown domain;
- unknown workspace type declaration;
- missing/duplicate agent behavior binding;
- no eligible workspace;
- several eligible workspaces where explicit selection is required;
- workspace/type mismatch;
- selected agent/session identity mismatch where observable.

Existing auth/not-member/not-found conventions retain precedence so configuration membership is not leaked to unauthorized callers.

## Test seams

### Highest public seams

- Workspace schema/store/API round-trip and migration.
- Static declaration validation and hostname normalization.
- Core authenticated typed workspace list/select/create flow.
- Existing Core -> Workspace -> Agent composition root.
- Full-app compatibility.
- Seneca's real trusted-proxy/auth/domain deployment flow.

### Existing prior art

- `packages/core/src/shared/types.ts`
- `packages/core/src/server/db/schema.ts`
- `packages/core/src/server/app/types.ts`
- `packages/core/src/server/routes/workspaces.ts`
- `packages/core/src/server/auth/requireWorkspaceMember.ts`
- `packages/core/src/front/WorkspaceAuthProvider.tsx`
- `packages/core/src/server/app/createCoreApp.ts`
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`
- `packages/agent/src/server/workspaceAgentDispatcher.ts`
- `packages/agent/src/server/harness/pi-coding-agent/sessions.ts`
- `apps/full-app/src/server/main.ts`
- Seneca `scripts/compile-agents.mts`, `agents/`, `src/server/main.ts`, and `Caddyfile`.

### Avoid testing

- private helpers when a public server/store seam proves the behavior;
- hostname as authorization;
- per-agent sandbox isolation;
- deleted AgentHost behavior;
- compiled digests as runtime identity;
- Step 2 selectors/delegation or Step 3 durability in Step 1A tests.

## Step 1A acceptance

Step 1A is complete when:

1. every workspace has a stable persisted `workspaceTypeId` and existing rows/full-app behavior remain compatible;
2. an opted-in host statically maps exact domains to workspace types and each type to one trusted agent behavior;
3. authentication, current-app membership, and route-wide workspace-type checks precede every workspace/agent side effect;
4. typed-domain listing never creates a workspace implicitly;
5. explicit create follows existing Core create authorization, stamps the trusted domain's type, rejects client overrides, and is idempotent across retries/concurrency;
6. zero/one/several eligible workspace flows and creation-disabled guidance work;
7. one authorized workspace uses exactly one server-derived agent type with correct prompt/tool/session behavior;
8. full-app retains current routes, sessions, auth, files, plugins, MCP, migrations, and one-agent UI;
9. exact affected package artifacts are consumer-qualified and released normally;
10. Seneca proves two real domain/type/agent products through its normal deployment, restart, and rollback paths;
11. no AgentHost, CAS, controller, mutable registry, compiled runtime provenance, implicit typed provisioning, or Step 2/3 machinery is introduced;
12. every slice has exact proof and independent standards/spec/security review where applicable.

## Step 1A slices

Only one implementation writer may touch an overlapping package/worktree at a time.

### 1A.0 — Canonical plan and tracker reset

**Delivers:** Decision 26, this plan, the consumption-mode contract, all-work-package alignment, supersession of the same-workspace-first Beads, and a reviewed Step 1A graph.

**Blocked by:** None.

**Proof:** documentation links/authority grep, full work-package alignment review, `git diff --check`, `br dep cycles`, `bv --robot-insights`, and iterative Sol xhigh convergence.

**Review budget:** Planning only.

### 1A.1 — Persist workspace type safely

**Delivers:** additive `workspaceTypeId` schema migration; exact `^[a-z][a-z0-9-]{0,62}$` validation with reserved `default`; canonical Workspace DTO/store/Postgres/local-store mappings; internal `WorkspaceStore.create` trusted type parameter with `default` compatibility; public create/update schemas that cannot accept the field; compatibility backfill; and focused migration/store/route/prior-release-read tests. It does not add domain or agent routing.

**Blocked by:** 1A.0 merged.

**Proof:** migration tests; workspace create/list/get/update round trips; existing-row/default fixtures; full-app workspace tests; `pnpm --filter @hachej/boring-core typecheck`; focused Core tests; invariants; migration diff review.

**Rollback:** application can continue treating all rows as `default`; no down migration or destructive data action.

**Review budget:** 20–30 minutes. This is tomorrow's first implementation slice.

### 1A.2a — Static product declarations and trusted domain resolution

**Delivers:** server-only immutable domain/workspace-type/agent-type configuration contract; startup validation; exact hostname normalization through existing trusted-proxy behavior; typed-mode/legacy-request-scope mutual exclusion; stable errors; and disabled-by-default compatibility mode. No auth topology or workspace selection behavior changes yet.

**Blocked by:** 1A.1.

**Proof:** validation/normalization tables; proxy and legacy request-scope spoof negatives; duplicate/dangling/missing-binding tests; full-app disabled-option localhost/preview behavior; server-only export audit; no compiler/deployment-resolver invocation.

**Rollback:** remove/disable the opt-in host option and restart.

**Review budget:** 20–30 minutes.

### 1A.2b — Prove two-domain authentication topology

**Delivers:** host-only `Secure`/`HttpOnly` cookies on both exact domains; explicit origins/callback/base URL behavior; SameSite/CSRF; logout/revocation; forwarded scheme/host handling; and the explicit limitation on unconfigured social/OAuth callbacks.

**Blocked by:** 1A.2a.

**Proof:** highest public-seam or real-browser sign-in/session/logout on both domains, sibling-cookie isolation, origin/CSRF negatives, trusted/untrusted forwarding, and full-app compatibility.

**Rollback:** disable typed-domain product hosts; full-app auth is unchanged.

**Review budget:** 30–45 minutes with security review.

### 1A.3a — Typed request context, route inventory, and Core selection

**Delivers:** reviewed inventory of every workspace-backed route and auth hook; one post-auth typed request context; membership/type revalidation at Core list/detail/select seams; zero/one/several selection; and no implicit typed creation from listing. Post-signup/invite enforcement follows in 1A.3b.

**Blocked by:** 1A.2b.

**Proof:** inventory plus Core public tests/side-effect spies for auth, foreign app/workspace, mismatch/spoof, zero/one/several, and no-create-on-list-refresh.

**Rollback:** disable typed-domain mode; persisted types remain metadata.

**Review budget:** 30–45 minutes.

### 1A.3b — Enforce typed context across every workspace surface

**Delivers:** apply the shared guard to every remaining inventoried workspace/auth surface: post-signup/invite hooks, settings, file/search/tree/event, plugin, bridge, git/model/skill, session/agent, invite/member, cleanup, provisioning/retry, and streaming. Typed post-signup never creates/provisions a default workspace. Explicit invite acceptance may add membership only after current-app and server-derived workspace-type validation; it does not use legacy deployment request scope.

**Blocked by:** 1A.3a.

**Proof:** no unclassified route; no-create-on-post-signup; typed invite validation/membership tests; and before-effect mismatch tests across every route family, including streams; disclosure ordering remains compatible.

**Rollback:** keep typed product disabled until all route families are guarded.

**Review budget:** 30–45 minutes with auth/security review.

### 1A.4a — Durable typed-create admission

**Delivers:** explicit create under the current v0 policy (any authenticated principal may create when the static product flag permits); server-stamped type; durable scoped idempotency key and request fingerprint; atomic workspace/owner-membership replay; conflict/retention/redaction semantics; no provider call yet.

**Blocked by:** 1A.3b.

**Proof:** unauthenticated/product-disabled negatives; authenticated success; concurrent/restart/response-loss replay; same-key/different-payload conflict; exact workspace/membership counts.

**Rollback:** disable creation while retaining typed read/select.

**Review budget:** 30–45 minutes.

### 1A.4b — Idempotent provisioning and retry semantics

**Delivers:** provisioner consumes the durable operation identity; pending/error/ready and crash-window semantics; retry without duplicate successful provider resources; visible retryable failure. If the provider cannot deduplicate the operation, stop rather than claiming exactly-once.

**Blocked by:** 1A.4a.

**Proof:** failures before/during/after provider call and process restart; exact resource count; current full-app default provisioning remains green.

**Rollback:** keep product dark and creation disabled; retain failed workspace state for diagnosis/retry.

**Review budget:** 30–45 minutes with persistence/security review.

### 1A.5 — Typed workspace frontend flow

**Delivers:** authenticated empty/one/several workspace UX; administrator-contact state when creation is disabled; explicit Create in empty/chooser states when allowed; automatic one-workspace entry; existing switcher access; domain/logout reset behavior; and no agent selector/catalog.

**Blocked by:** 1A.4.

**Proof:** component/E2E tests for loading/auth errors, zero disabled/enabled, one, several, create retry, switch, deep link, foreign/mismatched selection, logout, and domain change.

**Rollback:** disable typed-domain host option; existing full-app workspace UI remains.

**Review budget:** 20–30 minutes plus visual/product review.

### 1A.6a — Select the sole behavior and preserve one runtime lifecycle

**Delivers:** after typed authorization, select the type's sole trusted behavior through existing Core -> Workspace -> Agent composition; preserve one Workspace+Sandbox lifecycle/disposal; add trusted identity to current behavior seams. No authoring materializer or session namespace change yet.

**Blocked by:** 1A.5.

**Proof:** two type/behavior fixture, spoof denial, guarded shared routes, and exact runtime/disposal counts.

**Rollback:** retain typed authorization and restore the last known-good type-specific behavior mapping—never map a non-default type to `primary`.

**Review budget:** 30–45 minutes.

### 1A.6b — Integrate A1 materialized source into the sole behavior binding

**Delivers:** thin mapping from A1's reviewed `MaterializedAgentSourceV1` into the exact behavior-input type from 1A.6a; final standard/authored/plugin tool collision policy `error`; prompt/tool/readiness/log attribution through the real runtime. It does not compile directories or resolve catalogs again.

**Blocked by:** 1A.6a and A1.2 under #805.

**Proof:** authored changes alter captured runtime prompt/tool behavior; final cross-source collisions fail; no second composer/catalog resolution; no bundle/CAS/deployment authority.

**Rollback:** restore the prior validated authored configuration and type-specific binding.

**Review budget:** 30–45 minutes with package/security review.

### 1A.7 — Agent session identity and history compatibility

**Delivers:** trusted acting-agent identity in current session/provenance seams; deterministic length-prefixed/hashed non-default namespace; byte-compatible full-app/default namespace; legacy JSONL visibility; scoped list/load/write; and bounded mismatch handling without a global index.

**Blocked by:** 1A.6.

**Proof:** exact default history fixtures; restart/load; traversal/delimiter/collision tests; cross-product load denial; old records remain readable; stored context cannot override current membership/type/agent selection.

**Rollback:** retain data and restore compatibility binding; no session rewrite.

**Review budget:** 30–45 minutes with session/security review.

### 1A.8a — Reusable conformance and full-app freeze

**Delivers:** package-level two-domain/type/agent conformance and full-app one-default-type/primary compatibility with typed mode disabled.

**Blocked by:** 1A.7.

**Proof:** package/full-app suites, build/E2E/image smoke, all domain/auth/type negatives, current sessions/files/plugins/MCP, and no AgentHost/CAS/resolver.

**Rollback:** product remains dark; prior compatible app behavior remains.

**Review budget:** 30–45 minutes.

### 1A.8b — Qualify the typed-aware rollback floor

**Delivers:** build and execute the compatibility rollback artifact against migrated DB, non-default rows, and histories. Once such rows exist, rollback preserves typed filtering and last-known-good type behavior/session mapping; it may disable creation/UI/domains but never run a pre-typed app.

**Blocked by:** 1A.8a.

**Proof:** forward use, rollback, hidden/non-exposed products, preserved history, and successful re-enable with an operator runbook.

**Rollback:** this bead defines the floor; production creates no non-default row before it passes.

**Review budget:** 30–45 minutes with migration/security review.

### 1A.9 — Exact package cohort qualification and release

**Delivers:** actual affected package cohort packed and tested in a clean Seneca checkout, then published through the repository-native process and re-proven from exact registry versions/integrity.

**Blocked by:** 1A.8b and #805 A1.5 (`wt-391-forward-c0u.7`) merged and green; release-owner credentials/approval.

**Proof:** dependency/export/tarball audit; Seneca real package-manager/typecheck/build/test commands against tarballs and registry packages; full-app released-cohort smoke; rollback-floor versions recorded.

**Rollback:** restore the typed-aware compatibility cohort/config after product enablement; publish corrective versions rather than rewriting artifacts.

**Review budget:** release owner plus package reviewer.

### 1A.10a — Seneca exact-pin two-product integration

**Delivers:** clean Seneca exact pins; two authored agents/tool catalogs; two static domain/type mappings; typed UX and application-level proof; no production enablement yet.

**Blocked by:** 1A.9.

**Proof:** Seneca typecheck/tests/E2E/build/image; authored-content runtime derivation; zero/one/several/create/switch; app-level auth/type/proxy negatives; exact lock integrity.

**Rollback:** revert Seneca integration/config before deployment.

**Review budget:** 45–60 minutes.

### 1A.10b — Seneca production two-domain proof and executed rollback

**Delivers:** normal deployment; real two-domain auth/cookie/proxy/product/restart/observability evidence; executed rollback to typed-aware floor and restore.

**Blocked by:** 1A.10a.

**Proof:** exact versioned production evidence, both-domain positive and negative smoke, cross-product isolation, restart/history, rollback/restore, CI and independent security/product/operations review.

**Rollback:** executed typed-aware compatibility cohort/config preserving non-default rows and histories.

**Review budget:** 45–60 minutes.

## Step 1A dependency graph

```text
1A.0 -> 1A.1
-> 1A.2a -> 1A.2b
-> 1A.3a -> 1A.3b
-> 1A.4a -> 1A.4b
-> 1A.5
-> 1A.6a -> 1A.6b
-> 1A.7
-> 1A.8a -> 1A.8b
-> 1A.9
-> 1A.10a -> 1A.10b

1A.10b -> Step 1B MCP recut (#806)
1A.10b -> Step 2 multi-agent recut (#391/#805)
Step 2 + named consumers -> Step 3 runtime/transport recuts (#807/#808/#809)
```

## Proof gates

Every slice runs focused tests plus applicable repository gates:

```bash
pnpm lint:invariants
pnpm typecheck
pnpm test
pnpm e2e
```

Release and Seneca slices must use clean checkouts and exact artifacts, not workspace links. Docker/deployment claims require executed evidence or an explicit waiver.

Every non-trivial code slice receives independent Standards and Spec review. Auth, domain/proxy, migrations, session isolation, MCP, and A2A edges require security-focused review.

## Rollout

1. Land package changes dark/default-compatible.
2. Migrate existing workspaces to `default` without behavior change.
3. Prove full-app unchanged.
4. Pack and test the exact cohort in Seneca.
5. Publish and pin exact registry versions.
6. Deploy Seneca with one compatibility mapping first.
7. Add the second exact domain/type/agent mapping.
8. Explicitly create new authorized typed workspaces; do not retype workspaces with existing history.
9. Smoke auth, selection, prompt/tool/session identity, restart, and negatives.
10. Record rollback to the typed-aware compatibility cohort/config; never run a pre-typed app after non-default workspaces exist.

## Out of scope for Step 1A

- Multiple agents inside one workspace or an agent selector.
- Native agent-to-agent dispatcher work beyond preserving existing subagents.
- External MCP or A2A endpoints.
- Contracted cross-workspace execution.
- Durable task/event stream, replay, approvals, or recovery.
- `boring-bash`/`boring-sandbox` extraction.
- Custom executable tool subprocess runtime.
- Dynamic workspace-type or agent-type registry/update APIs.
- AgentHost, CAS, revision/publication machinery, or controller.
- Compiled bundle/deployment provenance as runtime authority.
- Marketplace, billing, generic environments, FUSE/S3, channels, or fleet UX.

## Resolved assumptions

- Workspace type is persisted, not inferred from mutable workspace attributes.
- Existing rows use `default`.
- Typed-domain login/listing does not implicitly create.
- Explicit authenticated creation may be enabled per static workspace-type declaration, but the existing Core workspace-create authorization policy remains authoritative.
- Full-app retains its current implicit default compatibility behavior.
- Agent type is a host key for trusted behavior, not a second canonical `AgentDefinition` or deployment record.
- Seneca proves both Step 1A package consumption and the real product flow.
- EU-self-hostable defaults and optional provider policy remain binding principles.

## Stop conditions

Stop and amend this plan rather than improvising if:

1. the migration cannot preserve existing workspace/API behavior;
2. trusted proxy configuration cannot produce an unambiguous effective hostname;
3. current routes cannot separate typed-domain no-implicit-create behavior from full-app compatibility;
4. behavior selection would occur before membership/type validation;
5. existing session history would disappear or collide;
6. the proposed API requires client-supplied behavior/runtime authority;
7. Seneca needs workspace links, unpublished package paths, or a private runtime composer;
8. an implementation starts adding Step 2/3 machinery to complete Step 1A.

A stop condition never authorizes restoration of AgentHost, CAS, a mutable registry, compiled deployment resolution, or a second Workspace/Sandbox authority.

---
github: https://github.com/hachej/boring-ui/issues/806
issue: 806
state: ready-for-human
track: owner
flag: not-needed
updated: 2026-07-18
---

# gh-806 Authenticated external MCP for a typed Seneca workspace

## Authority and planning state

This is the canonical remaining-work plan for issue #806. It recuts only
Decision 26 **Step 1B**: authenticated external MCP ingress to the same
domain-routed, membership-authorized workspace and sole server-selected agent
that the web surface uses. The named consumer is **Seneca**.

Shared authority remains:

- [`../../DECISIONS.md`](../../DECISIONS.md), Decision 26, for delivery order
  and forbidden architecture;
- [`../391/plan.md`](../391/plan.md) for Step 1A's typed workspace and sole-agent
  contract;
- [`../391/AGENT-CONSUMPTION-MODES.md`](../391/AGENT-CONSUMPTION-MODES.md) for
  Mode 0 external MCP semantics;
- [`../391/AGENT-CLOUD-VISION.md`](../391/AGENT-CLOUD-VISION.md) for the
  non-binding execute-versus-data rule and control-plane/data-plane split;
- [`../391/ROADMAP-ALIGNMENT.md`](../391/ROADMAP-ALIGNMENT.md) for ownership and
  later-work triggers.

`AGENT-CLOUD-VISION.md` was absent from the initial planning base
(`7a21d3580`), so the planning agent first read it from commit `f65d9e2e3`.
During planning, that same document landed on `origin/main`; this branch will be
rebased onto the landing commit before publication. The vision is non-binding
by its own terms, but this recut adopts its load-bearing execute-versus-data
rule and control-plane/data-plane split. Decision 26 and the canonical #391
plan still win if they conflict.

The documents under [`runtime-refactor/work/`](runtime-refactor/work/) are
retained research only. Their old readiness claims, dependency graphs, and Bead
lists are non-dispatchable. This plan carries forward only the already-proven
MCP transport, auth-before-work, bounded-result, idempotency, and no-secret
ideas that still fit Decision 26.

This plan is ready for human review, not implementation dispatch. The first
implementation Bead remains blocked until the Step 1A production proof in
`#391` slice `1A.10b` is complete and its actual public composition seams are
re-verified on then-current main. It is also blocked until #805/#391 records a
concrete approved A1 gate proving either that Seneca ships no authored custom
handlers or that every such handler executes only through the
sandbox/Operations seam; the current A1 release label alone is insufficient.

## Problem

### Today

Main already contains much more MCP ingress than the stale M1/M2 plans assume:

- [`managedAgentMcpServer.ts`](../../../packages/agent/src/server/mcp/managedAgentMcpServer.ts)
  exposes `delegate_task`, `delegate_task_start`, and `delegate_task_status`
  over the MCP SDK's Streamable HTTP server transport.
- [`managedAgentDelegate.ts`](../../../packages/agent/src/server/mcp/managedAgentDelegate.ts)
  delegates through a host-resolved runner and authorized `Workspace`, keeps
  bounded process-local status, supports progress/polling, stops on abort, and
  returns final text plus at most one complete inline Markdown artifact.
- The existing limits are real code, not future work: 32 KiB brief, 96 KiB
  final text, 256 KiB Markdown, 384 KiB serialized result, 100 retained progress
  items, 100 controller records, and 15-minute terminal retention.
- Artifact bytes are read through the authorized `Workspace`, checked for a
  stable stat/read/stat snapshot, strict UTF-8, Markdown-only content, digest,
  and stable errors. No returned artifact path is needed.
- [`managedAgentMcp.ts`](../../../apps/full-app/src/server/managedAgentMcp.ts)
  mounts `/mcp/managed-agent` dark by default. When enabled, one server-only
  bearer maps to one configured user/workspace; the route checks current app,
  non-deleted workspace, and membership before resolving the existing
  `WorkspaceAgentDispatcher` plus the same `Workspace`.
- Full-app tests and `smoke:mcp-managed-agent` already prove a stock MCP client,
  invalid-bearer rejection, membership-before-dispatch, spoofed tool-argument
  irrelevance, polling progress, safe errors, and self-contained Markdown.
- [`shareEntryResources.ts`](../../../packages/agent/src/server/mcp/shareEntryResources.ts)
  already provides optional same-workspace MCP resources. That is useful
  existing AR1 work, but it is not required to deliver Step 1B task ingress.
- `@modelcontextprotocol/sdk` is already an exact `1.29.0` dependency of
  `@hachej/boring-agent`; no MCP package skeleton or second server owner is
  missing.

The missing product substrate is equally concrete:

- Main has no `workspaceTypeId` in `packages/` or `apps/`, so Step 1A's
  persisted type, exact-domain resolver, typed request guard, and sole
  `agentTypeId` selection do not exist yet.
- The full-app MCP binding is one static bearer/user/workspace tuple. It does
  not consume a typed-domain authorization result and cannot prove that MCP and
  web selected the same product behavior.
- `delegate_task` has no caller-stable idempotency key. A lost response retried
  under a new MCP/JSON-RPC request can start duplicate model work.
- Controller capacity is bounded, but there is no host-required per-credential
  rate/concurrency policy, no progress-item/retained-byte cap, and no 96 KiB
  polling-response cap.
- Seneca `origin/main` consumes exact boring package version `0.1.88`, has one
  authored `dummy` agent and one Caddy hostname, and does not mount the managed
  agent MCP ingress route. Its existing `boringMcp.ts` is the opposite
  direction: agents consuming external MCP providers.
- Current A1 materialization is a skeleton: `toolCatalog` is accepted but not
  used, `toolRefs` require later catalog work, and `mcpServerRefs` are rejected.
  Step 1B cannot paper over that prerequisite or execute authored handlers in
  the Seneca host process.

### Delta

Reuse the existing MCP server/controller and replace only the host binding and
missing admission guarantees:

```text
exact effective product hostname
-> Step 1A domain -> workspace-type resolution (no workspace disclosure)
-> pre-provisioned bearer -> principal + one bound workspace + exact audience
-> current app + membership + persisted workspace-type revalidation
-> Step 1A sole agent behavior resolution
-> existing WorkspaceAgentDispatcherResolver.resolveWithWorkspace(...)
-> existing workspace-keyed Workspace + Sandbox runtime pair
-> existing managed-agent MCP tools and bounded result
```

MCP v1 does not reproduce the web chooser. A Seneca operator provisions a
credential for one existing principal/workspace/product hostname. A user with
several eligible workspaces receives one explicit credential binding per
chosen workspace. MCP login, listing, or delegation never creates a workspace.

The result is deliberately narrow: an authenticated stock MCP client can send
a brief to its already-authorized typed workspace and receive bounded progress
and a bounded result from the same sole agent as web. It is not a general
agent registry, deployment system, task service, environment projection, or
public OAuth product.

## Solution

### Today: keep the proven protocol and runtime seams

The following existing pieces remain the implementation base:

1. `createManagedAgentMcpHttpHandler` and the current Streamable HTTP route
   shape;
2. `ManagedAgentMcpDelegateController` for one-shot delegation,
   progress/polling, abort, and bounded delivery;
3. `WorkspaceAgentDispatcherResolver.resolveWithWorkspace` as the sole bridge
   to agent execution and artifact `Workspace` access;
4. Core's current app/workspace/membership authority;
5. the workspace-keyed runtime binding lifecycle, which already leases and
   retires one runtime binding rather than composing a second runtime for MCP.

No Step 1B code may call `createAgent`, create a mode adapter, retain a raw
workspace root, or construct a second `Workspace` or `Sandbox`.

### Delta: one typed external-ingress binding

After Step 1A lands, add the smallest app-shell/server adapter that composes its
actual typed authorization seam with the existing managed MCP controller. Do
not invent a parallel public target type if Step 1A already exports one.

The semantic output needed by the MCP adapter is:

```ts
type AuthorizedTypedMcpTarget = {
  credentialId: string       // redacted stable identity, never the bearer
  principalId: string
  effectiveHostname: string  // exact normalized Step 1A product host
  workspaceId: string
  workspaceTypeId: string
  agentTypeId: string        // sole trusted Step 1A selection
}
```

This is a semantic planning shape, not a pre-authorized new API. Slice 1B.1
must reuse or minimally adapt the types that Step 1A actually lands.

Required resolution order:

1. derive the effective hostname through Step 1A's trusted-proxy and exact-host
   normalizer; body, query, arbitrary forwarding headers, and MCP tool input do
   not participate;
2. verify the bearer before loading or disclosing any workspace;
3. require the credential's exact audience hostname to match the normalized
   product hostname;
4. load the credential-bound workspace in the current app;
5. revalidate current principal membership;
6. revalidate that persisted `workspaceTypeId` matches the domain's static
   workspace type;
7. derive the sole `agentTypeId` and behavior from Step 1A server-only static
   declarations;
8. resolve the existing dispatcher plus `Workspace` for that authorized
   context and delegate.

Authorization is operation-specific; establishing an MCP transport never
caches authority past membership removal, credential removal, workspace
deletion, type mismatch, or host-config change:

| MCP operation | Required checks before any result | Must not happen |
| --- | --- | --- |
| HTTP connect/initialize/list-tools | effective hostname, bearer validity, exact audience | workspace disclosure, receipt creation, dispatcher/runtime/model work |
| `delegate_task` / `delegate_task_start` | full steps 1–7 above, including current membership/type/sole-agent binding | idempotency record, rate/concurrency admission, delegation receipt, dispatcher/model work before authorization |
| `delegate_task_status` | full current credential/audience/membership/type/sole-agent revalidation, then receipt lookup in that trusted scope | dispatcher/runtime resolution, model work, or cross-scope receipt disclosure |

Only an authorized new delegation proceeds to step 8. This intentionally moves
authorization ahead of today's controller behavior, which can create a record
and surface the start receipt before its later runner/workspace resolver runs.

Authorization is an **admission snapshot for one accepted turn**, not a
per-event or per-tool-call lease. Once an authorized delegation starts, a
concurrent membership/config change does not retroactively cancel that running
turn; the current dispatcher/tool seam has no such reauthorization hook. The
change blocks the next start/status operation. Emergency cancellation uses the
existing stop/restart path. Credential rotation in this private Step 1B shape
already requires a restart, which also terminates in-flight process-local work.
Mid-turn authorization leases/cancellation are a later hardened-transport need,
not an implicit Step 1B guarantee.

### Delta: private pre-provisioned authentication first

Step 1B uses a deployment-static, secret-backed credential verifier. Each
credential is bound server-side to a redacted `credentialId`, exact product
hostname, principal, and one workspace. The bearer value never appears in a
definition, browser DTO, log, error, receipt, or idempotency key.

This is intentionally not ID1/OAuth self-service. Revocation in Step 1B is an
operator removing or rotating the secret-backed binding and restarting the
deployment; the old bearer must fail on the next request. The endpoint stays
dark unless all of these exist and validate at startup:

- credential verifier/binding;
- exact audience hostname;
- Step 1A typed product declaration;
- finite per-credential start-rate and concurrency limits;
- global controller capacity/retention;
- redaction canaries for the bearer and host/runtime roots.

Configuration may choose the concrete finite rate and concurrency values; this
plan does not invent unmeasured production traffic numbers. Tests set small
values and prove exact over-limit behavior. Missing, zero, negative, or
unbounded values fail startup.

All auth/authz failures reject before dispatcher or model work and use stable,
non-disclosing codes from the canonical error registry. Cross-product,
foreign-workspace, removed-member, deleted-workspace, expired/removed
credential, and wrong-audience cases do not reveal which underlying binding
failed.

### Delta: retry-safe process-local admission

Add required `idempotencyKey` to both `delegate_task` and
`delegate_task_start`:

- non-empty ASCII `[A-Za-z0-9._:-]+`, at most 128 UTF-8 bytes;
- receipt scope is trusted
  `(credentialId, principalId, workspaceId, workspaceTypeId, agentTypeId,
  idempotencyKey)`;
- lookup occurs after current auth/authz revalidation but before start-rate,
  quota/concurrency admission or model work;
- same scope + same normalized brief returns the original running/completed
  receipt/result;
- same scope + different brief returns a stable conflict code;
- MCP session ids, JSON-RPC ids, and tool-call ids never become retry identity;
- the existing bounded process-local store and terminal retention remain the
  storage mechanism.

This protects same-process lost-response retries. It explicitly does not claim
restart or cross-replica exactly-once behavior. A host restart may lose the
receipt and re-run a retry; durable admission belongs to Decision 26 Step 3.

Keep today's payload caps. Add only the missing byte bounds from the retained
M1 research:

- each caller-visible progress message: at most 4 KiB UTF-8;
- all retained progress for one delegation: at most 64 KiB in addition to the
  existing 100-item cap;
- configured secret canaries remain absent from progress, status, results, and
  logs.

Do not duplicate the complete structured result into the MCP text-content
field. Keep the result in `structuredContent` and return only a bounded compact
text summary. Define the final wire/status cap from the retained component
budgets, not below them:

```text
MAX_MCP_STATUS_RESPONSE_BYTES
  = MAX_SERIALIZED_RESULT_BYTES (384 KiB)
  + MAX_RETAINED_PROGRESS_BYTES (64 KiB)
  + one explicit bounded envelope/summary budget
```

Slice 1B.2 freezes that envelope constant against the actual serializer and
adds exact/over stock-client tests. A maximum-valid result must remain
retrievable through `delegate_task_status`; the cap must measure the final
serialized MCP response, after `structuredContent` and `content` are assembled.
Oversize progress is coalesced to a safe fixed message where possible or fails
with a stable code before retention/serialization. The implementation must not
increase the existing brief/final/artifact/total limits.

## Control-plane / data-plane boundary

### Today

- The managed MCP protocol adapter, status records, and full-app bearer check
  run in the application host.
- The dispatcher resolver already joins MCP to the existing workspace-keyed
  agent/runtime binding instead of constructing a standalone MCP runtime.
- Runtime bundles already pair `workspace`, `sandbox`, and Operations-backed
  tool strategies in one `RuntimeModeAdapter` result.

### Delta

Treat Seneca as the control plane and the selected runtime bundle as the data
plane:

- **Control-plane data:** exact domain declarations, workspace type,
  membership, A1 definition/instructions/tool declarations, credential
  binding, session/receipt metadata, limits, redacted audit fields, and the
  trusted framework model-loop/orchestration code.
- **Data-plane execution:** every authored custom handler and every
  shell/file/repo/tool effect against tenant state. These cross through the
  selected workspace's existing Sandbox/Operations path.

Definitions remain data-only. Step 1B may pass the already-selected Step 1A
behavior to the dispatcher, but it may not import a tenant handler module,
accept an `execute` function from an authored definition, or run tenant code in
the Seneca host. If Step 1A's Seneca proof still imports
`agents/*/tools/*.ts` into the host process, Step 1B stops. The upstream A1 gate
may resolve this simply by shipping no authored custom handlers/tool refs in
the Step 1A Seneca products. If an authored handler is required, #805/#391 must
first finish and prove the A1 `toolCatalog` -> sandbox/Operations binding.

Invariant 5 remains literal: MCP and web for one workspace share the same
workspace-keyed `Workspace + Sandbox` pair and disposal lifecycle. Agent type
and MCP surface identity do not create another runtime owner.

## MCP egress interface acknowledgment

### Today

`plugins/boring-mcp` and Seneca's current `boringMcp.ts` let trusted app code
consume external MCP providers through a governed read-only bridge. Separately,
A1 definitions already have opaque `toolRefs` and `mcpServerRefs`, but current
materialization does not bind them.

### Delta for this plan

Step 1B changes none of that behavior. It records only this interface rule for
the owning #805/toolCatalog/sandbox plan:

```text
A1 toolRef / mcpServerRef declaration (data only)
-> trusted toolCatalog resolution (data/policy)
-> Operations-backed sandbox executor
-> external MCP transport from the data-plane execution context
```

No external MCP client object, transport closure, bearer, or executable
handler enters `AgentDefinition`/`MaterializedAgentSourceV1`. No Step 1B slice
implements MCP egress, migrates the existing trusted first-party plugin, or
adds outbound network policy. A named authored-agent egress need triggers its
own #805-aligned plan and must prove sandbox execution, secret injection,
timeout, and network allowlisting there.

## Decisions

1. **Reuse the existing managed MCP server.** Today has a working package
   implementation and stock-client proof; a new package/server would create a
   second protocol owner without a consumer need.
   `ManagedAgentMcpDelegateController` is retained only as a bounded
   process-local delegation/status helper; it is not the retired deployment
   controller/reconciler authority and may own no desired state, rollout, or
   runtime resolution.
2. **Use the same exact product hostname and the same Step 1A resolver as web.**
   MCP is a binding at the edge, not a second product/agent routing system.
3. **Bind one pre-provisioned bearer to one existing workspace.** This avoids a
   chooser protocol, implicit creation, workspace identifiers in tool input,
   and an early token-management product.
4. **Revalidate on every request.** Membership, workspace type, agent mapping,
   and credential config can change across requests; transport establishment
   is not durable authorization.
5. **Keep receipts process-local.** Same-process retry safety is valuable now;
   restart-durable admission would pull Step 3 into Step 1B.
6. **Require a caller-stable idempotency key.** The current protocol has no
   protection against lost-response duplicate model work, and JSON-RPC ids are
   not stable business identity.
7. **No visible workspace or agent selector.** Credential binding chooses the
   already-authorized workspace; Step 1A static type mapping chooses the sole
   agent.
8. **No new persistence or migration.** Step 1B uses Step 1A's workspace data
   and static secret-backed auth config. Turning credentials into runtime
   mutable records is a later identity/control-plane decision.
9. **No artifact expansion.** Today's final text plus optional inline Markdown
   is enough for the Seneca proof. Existing share resources stay optional;
   cross-workspace artifact transfer is not Step 1B.
10. **No authored code in the control plane.** Definitions/declarations are
    data; custom handlers execute only through the sandbox/Operations seam.

## Stable error contract

### Today

The controller already returns canonical stable codes for invalid brief,
artifact invalid/too-large/unavailable, abort, session-not-found, configuration,
model/runtime failures, and unauthorized host resolution.

### Delta

Reuse existing codes where their semantics match and add canonical codes only
for distinct externally actionable cases. At minimum the implementation must
freeze and test stable behavior for:

- missing/malformed/unknown/removed bearer;
- bearer audience/product-host mismatch;
- unauthorized or stale typed workspace binding;
- idempotency-key invalid;
- same-key/different-brief conflict;
- configured start-rate/concurrency exceeded;
- progress/status/final MCP response payload exceeded;
- Step 1A target/configuration invalid at startup.

Messages remain redacted. Tests assert codes and lack of side effects, not
sensitive explanatory text. HTTP authentication failure occurs before MCP tool
dispatch; tool/status failures use MCP error results without raw workspace,
agent, root, token, or session-store details.

## Flag / abstraction / rollback path

### Today

Full-app already uses a dark-by-default managed MCP host option and simply does
not register the route when disabled. The package MCP server/controller and
dispatcher/workspace resolver are the existing abstractions.

### Delta

- **New feature-flag framework:** not needed. Seneca uses the same
  deployment-static MCP-enabled/config-present gate.
- **Abstraction path:** minimally adapt the actual Step 1A typed target into the
  existing managed MCP and dispatcher/workspace seams. Do not create a second
  server, target registry, or runtime composer.
- **Rollback path:** disable MCP/remove credential bindings and restart. The
  Step 1A web products, workspace types, sessions, and runtime mode remain.

## Test seams

### Today

Highest existing seams:

- package controller tests in
  `packages/agent/src/server/mcp/__tests__/managedAgentDelegate.test.ts`;
- stock MCP SDK integration through `createManagedAgentMcpHttpHandler`;
- full-app route tests in
  `apps/full-app/src/server/__tests__/managedAgentMcp.test.ts`;
- deterministic `pnpm --filter full-app smoke:mcp-managed-agent`;
- runtime lifecycle tests proving workspace-keyed reuse and disposal.

### Delta

Extend those public seams rather than unit-testing new private helpers:

1. a two-domain/type/agent fixture consumes the actual Step 1A resolver;
2. web and MCP for the same principal/domain/workspace produce the same trusted
   `workspaceTypeId` and `agentTypeId` and enter the same dispatcher binding;
3. MCP never calls an agent/runtime constructor and does not increase runtime
   binding/disposal counts relative to web;
4. domain A credential succeeds only on domain A/workspace A/agent A; domain B
   does the symmetric case; cross-domain, cross-workspace, type mismatch,
   caller-supplied identifier, and forwarded-host spoof fail before dispatch;
5. member removal, workspace deletion, and credential removal fail on the next
   start **and** status request even after a prior successful MCP call; neither
   failure reaches dispatcher/runtime/model work. An already-admitted turn may
   finish under its admission snapshot and is not observable through status
   after authorization is removed;
6. same-key concurrent and lost-response retries produce one session; a
   different brief conflicts; scope differs by credential/workspace/agent;
7. dedupe happens before rate/concurrency admission, while a new key observes
   configured limits;
8. exact/over tests cover key, progress-item, retained-progress, the derived
   final MCP status/wire response, and all existing result limits; the maximum
   otherwise-valid result remains retrievable by a stock client;
9. secret canaries and raw roots/paths are absent from responses, progress,
   status, errors, and captured logs;
10. a static scan of changed Step 1B host/MCP files proves no retired
    deployment/runtime authority identifier and no authored handler import was
    added. The existing process-local MCP delegate helper is explicitly not a
    match for the retired deployment controller/reconciler topology.

Avoid testing:

- MCP SDK internals already covered by the stock-client test;
- a second model loop or second runtime owner;
- private hostname parsing if the Step 1A public resolver proves it;
- OAuth/ID1, durable replay, public demo, several agents, artifact transfer,
  or MCP egress behavior in Step 1B tests.

## Remaining-work slices

Every slice below states its Today/Delta boundary and has a machine-checkable
gate. Only one implementation writer may touch overlapping MCP/composition
files at a time.

### 1B.0 — Freeze the post-Step-1A binding contract

**Today:** The canonical Step 1A plan defines the required typed resolution,
but main does not yet contain its code. Existing MCP resolves only a static
full-app tuple.

**Delta:** On then-current main, inventory the exact Step 1A effective-host,
principal, typed workspace, sole behavior, dispatcher, and runtime-lifecycle
seams. Amend this plan only if the landed public seam cannot express the
required flow. Choose the smallest reuse path and record exact files/symbols;
do not add a duplicate resolver or compatibility shim.

**Blocked by:** This plan merged; #391 `1A.10b` complete with executed Seneca
two-domain proof; and a concrete approved #805/#391 A1 prerequisite Bead is
recorded, merged, and proven. That upstream Bead must choose and prove one of:
(a) Step 1A Seneca products declare no authored custom handlers/tool refs, so
no handler binding seam is needed, or (b) every authored handler is a data-only
catalog declaration whose execution enters the selected workspace's
Sandbox/Operations seam. The named binding implementation Bead is required only
for option (b); option (a) still needs an approved proof Bead recording the
zero-handler product contract. A generic “#805 A1 release” does not satisfy this
dependency.

**Acceptance gate:** A focused contract test or test fixture can obtain the
same authorized `{workspaceId, workspaceTypeId, agentTypeId}` for web and MCP
inputs without invoking a model; `git grep workspaceTypeId packages apps`
finds the canonical landed implementation; the Step 1A production proof shows
no tenant handler imported/executed in the Seneca control plane; the proof
record links the real upstream #805/#391 Bead id and its machine gate.

**Proof:** exact symbol inventory in the Bead/PR; focused Step 1A tests;
`git diff --check`; standards + security review.

**Rollback:** documentation/test-only contract freeze has no runtime effect.

### 1B.1 — Bind managed MCP to the authorized typed target

**Today:** Managed MCP transport/delegation exists; full-app statically binds
one bearer/user/workspace and rechecks app/membership.

**Delta:** Add the reusable app-shell binding described above, consume the real
Step 1A resolver, require exact-host audience, revalidate current app,
membership, persisted type, and sole agent on every request, then call the
existing dispatcher/workspace resolver. Keep the endpoint dark by default and
preserve full-app's one-default-product compatibility.

**Blocked by:** 1B.0.

**Acceptance gate:** Public-seam tests prove two positive domain/type/agent
bindings; unauthenticated, removed credential, wrong audience, untrusted
forwarding, deleted/foreign/mismatched workspace, removed membership, and
caller workspace/type/agent spoof all fail before dispatcher/model calls;
`delegate_task_start` cannot allocate or return a receipt before those checks;
`delegate_task_status` reauthorizes and scopes the receipt without resolving a
dispatcher/runtime; web/MCP share one runtime binding and disposal count.

**Proof:** focused Core/agent/full-app tests; `pnpm --filter
@hachej/boring-agent run typecheck`; affected Core/full-app typecheck/tests;
`pnpm lint:invariants`; import audit.

**Rollback:** disable the MCP host option and restart. Web typed routing and
persisted Step 1A data remain untouched.

### 1B.2 — Add retry-safe bounded admission

**Today:** Brief/result/artifact/controller counts are bounded and status is
process-local, but a retry can duplicate work and rate/progress/status byte
limits are incomplete.

**Delta:** Require/scoped-dedupe `idempotencyKey`, add dedupe-before-limit
single flight, host-required finite per-credential start-rate/concurrency,
4 KiB progress-item and 64 KiB retained-progress bounds, remove full-result
duplication from MCP text content, and enforce the derived final MCP
status/wire-response formula. Preserve all existing lower-level result caps and
the process-local durability statement.

**Blocked by:** 1B.1; serialized with it if files overlap.

**Acceptance gate:** concurrent same-key and lost-response retry under new MCP
request ids create exactly one session; same-key/different-brief conflicts;
cross-scope keys do not collide; same-key replay succeeds before rate checks;
new-key excess rejects before model work; exact/over byte tests pass; restart
loss is explicitly tested/documented without a durable claim; a stock client
retrieves a maximum-valid completed result through status without exceeding the
final wire cap.

**Proof:** package controller + stock-client tests; updated full-app smoke;
canonical error-code assertions; secret/log canary tests; typecheck/invariants.

**Rollback:** disable external MCP. No durable receipt or migration needs
rollback; process-local records disappear on restart by design.

### 1B.3 — Qualify and release the exact package cohort

**Today:** Boring main is `@hachej/boring-agent` `0.1.89`; Seneca main pins the
older exact `0.1.88` cohort and has no managed-ingress composition.

**Delta:** Determine the actual affected package cohort from 1B.1/1B.2, pack it,
install it in a clean Seneca checkout, and prove exports, types, tests, build,
and stock-client behavior before normal repository release. Publish and record
exact versions/integrity only through the existing release process and owner
approval.

**Blocked by:** 1B.2; release credentials/approval; Step 1A release floor still
available.

**Acceptance gate:** clean-checkout Seneca uses only tarballs, then only exact
registry versions—no workspace links or unpublished paths; `pnpm
agents:compile`, typecheck, test, build, and the Step 1B stock-client smoke pass;
package export/tarball audit confirms no missing MCP server symbols.

**Proof:** exact pack/install commands and lockfile integrity; affected Boring
package build/typecheck/test; Seneca clean-checkout gates; release record.

**Rollback:** keep the last Step-1A-compatible exact cohort and MCP disabled;
publish a corrective version rather than rewriting an artifact.

### 1B.4 — Integrate Seneca's two typed products

**Today:** Seneca main has one `dummy` agent, one Caddy product hostname, the
external-MCP-consuming plugin, and no managed-agent ingress registration.

**Delta:** On an isolated Seneca branch, compose the released Step 1B adapter
with the two Step 1A product declarations. Provision one secret-backed,
audience-bound MCP credential per explicit test workspace. Mount the same
managed endpoint path on each product domain. Add no per-agent endpoint,
chooser, implicit workspace creation, authored handler import, or second MCP
server implementation.

**Blocked by:** 1B.3; Seneca's Step 1A two-product branch/proof merged.

**Acceptance gate:** Seneca typecheck/test/build/E2E pass; a stock MCP SDK
client reaches domain A -> workspace/type/agent A and domain B -> B; cross-use,
unknown host, spoofed host, foreign workspace, removed member, and tool-argument
override fail before work; web and MCP report the same trusted agent identity;
runtime creation/disposal remains one per workspace.

**Proof:** exact Seneca lock versions; deterministic local SDK smoke; two-domain
auth/type negative suite; static grep proving no direct import of authored
`tools/*.ts` from the host composition.

**Rollback:** remove/disable Seneca MCP credential bindings and restart. Both
web products continue on the Step 1A cohort.

### 1B.5 — Production smoke, revocation, restart, and rollback

**Today:** Full-app has only a local deterministic MCP smoke; Seneca has no
production managed-ingress evidence.

**Delta:** Enable Step 1B through Seneca's normal deployment path, run real
stock-client positive/negative proof on both exact product domains, prove
restart behavior honestly, rotate/remove one credential and prove immediate
post-restart denial, execute MCP-disable rollback, then restore.

**Blocked by:** 1B.4; owner deployment/access approval; approved secret and
rate/concurrency values.

**Acceptance gate:** recorded production evidence covers both domains,
cross-product denial, bounded progress/result, same-process retry, membership
revalidation, credential revocation, restart receipt-loss limitation, MCP-off
rollback with web still healthy, and restore. Logs contain no credential,
workspace root, sandbox root, session-store root, or model secret.

**Proof:** client/version/commands with secrets redacted; deployment version
and exact package pins; health/web/MCP smoke; log-canary query; executed
rollback/restore; independent security and operations review.

**Rollback:** set Step 1B exposure off/remove bindings and restart. No schema or
workspace data is rolled back.

## Proposed Bead chain — proposal only

Do not edit `.beads` from this plan PR. Before this #806 chain is created, #805
or #391 must assign a real owner/Bead id to the A1 data-only/sandbox-handler
gate described in 1B.0; record that exact id in `BB806-1B-001`'s dependency.
After that prerequisite and 1A.10b fire the trigger, create this chain using
then-current Bead IDs if the suggested IDs are unavailable:

| Proposed id | Title | Depends on | Unblocks |
| --- | --- | --- | --- |
| `BB806-1B-001` | Freeze post-Step-1A typed MCP binding contract | plan merged; #391 `1A.10b`; real approved #805/#391 A1 data-only/sandbox-handler Bead | `BB806-1B-002` |
| `BB806-1B-002` | Bind managed MCP to authorized typed target | `BB806-1B-001` | `BB806-1B-003` |
| `BB806-1B-003` | Add retry-safe bounded MCP admission | `BB806-1B-002` | `BB806-1B-004` |
| `BB806-1B-004` | Qualify and release exact Step 1B package cohort | `BB806-1B-003`; release approval | `BB806-1B-005` |
| `BB806-1B-005` | Integrate Seneca two-product MCP ingress | `BB806-1B-004`; Seneca Step 1A proof | `BB806-1B-006` |
| `BB806-1B-006` | Prove Seneca production MCP, revocation, and rollback | `BB806-1B-005`; deployment approval | Step 1B complete |

The graph is intentionally linear because 1B.1 and 1B.2 overlap the existing
MCP/controller seams, release must qualify their combined contract, and Seneca
must consume exact released artifacts. Do not create speculative parallel
lanes.

## Acceptance

Step 1B is complete only when all of the following are true:

1. a stock MCP client authenticates to each Seneca product's exact domain and
   reaches one explicitly bound existing workspace;
2. current app, principal membership, persisted workspace type, exact domain,
   credential audience, and sole agent selection are revalidated before
   delegation admission/receipt creation and before each status lookup; an
   admitted turn uses the documented authorization snapshot rather than an
   unimplemented mid-turn lease;
3. MCP and web for the same domain/principal/workspace use the same trusted
   `workspaceTypeId`, `agentTypeId`, dispatcher binding, session namespace, and
   workspace-keyed Workspace+Sandbox lifecycle;
4. neither request fields nor MCP tool arguments can select/override domain,
   workspace type, workspace, agent, runtime, tool handler, or root;
5. no login, list, delegation, or retry implicitly creates/provisions a
   workspace;
6. missing/removed/wrong-audience credentials, unknown/spoofed domains,
   foreign/deleted/mismatched workspaces, and removed membership fail before
   work with stable redacted errors;
7. caller-stable idempotency dedupes concurrent/same-process lost-response
   retries before limits; mismatched payload conflicts; restart durability is
   not claimed;
8. per-credential rate/concurrency and all input/progress/status/result/final
   wire bounds are finite and exact-boundary tested; polling can retrieve a
   maximum-valid completed result without duplicating it in text content;
9. Seneca definitions remain data-only, and no authored handler executes or is
   imported in the control plane. If the Step 1A products declare no custom
   handlers/tool refs, that zero-handler contract is proven; if they do, the
   handler executes through a proven toolCatalog/Operations/sandbox seam;
10. full-app compatibility remains green with MCP dark by default;
11. exact affected package artifacts are qualified and consumed from the
    registry by Seneca without workspace links;
12. production proof includes two-domain isolation, revocation, restart
    limitation, secret-free logs, executed MCP-disable rollback, and restore;
13. no retired runtime/deployment authority or Step 2/3 machinery is introduced.

## Proof commands

Implementation PRs re-verify exact focused paths against then-current scripts.
The expected gate family is:

```bash
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run test
pnpm --filter full-app run typecheck
pnpm --filter full-app run test
pnpm --filter full-app smoke:mcp-managed-agent
pnpm lint:invariants
pnpm audit:imports
```

Run affected Core/workspace package tests when 1B.1 touches their composition
seams. Release/Seneca slices additionally run in a clean Seneca checkout:

```bash
pnpm agents:compile
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

Every auth/domain/MCP slice receives independent standards and security review.
The production slice also receives operations review. Exact production smoke
commands belong in the proof record with credentials and tenant identifiers
redacted.

## Rollout and rollback

### Today

Managed MCP is dark by default and has no database migration. The full-app
route proves a configuration-off rollback shape.

### Delta

1. Land package changes dark and keep full-app green.
2. Pack and test the exact affected cohort in a clean Seneca checkout.
3. Publish through the normal release process and pin exact versions.
4. Deploy Seneca with Step 1B disabled; verify both web products.
5. Add one pre-provisioned credential binding per explicit product workspace
   and finite limits; keep bearer values in the deployment secret store.
6. Enable MCP, then run the two-domain and cross-product negative smoke.
7. Restart and prove web remains healthy; document process-local receipt loss.
8. Remove/rotate one credential, restart, and prove the old bearer is denied.
9. Disable MCP and restart; prove both web products remain healthy.
10. Restore MCP and record the exact known-good package/config cohort.

Rollback never downgrades below Step 1A's typed-aware release floor and never
retypes a workspace. It only disables the optional MCP edge and removes its
static credential bindings.

## Explicit non-goals

- Step 2 multiple agents, agent selector/catalog, or same-workspace delegation.
- External A2A, durable tasks/events, receipts across restart/replicas, replay,
  approvals, recovery, or channel transport.
- Public demo or anonymous access.
- OAuth/ID1/CIMD/protected-resource metadata, self-service credential issuance,
  token database, admin token UI, or runtime credential mutation.
- A second tenant, shared-tenant wildcard routing, tenant lifecycle service, or
  a mutable deployment control plane.
- Any dependency on AgentHost, a deployment controller/reconciler,
  CAS/content-addressed rollout, publication journal,
  AgentDeployment/definitionRef, or a runtime mutable registry. The existing
  process-local MCP delegation/status helper is not such an authority.
- A new MCP server package, per-agent MCP endpoint, MCP-selected agent, second
  model loop, second Workspace/Sandbox owner, or MCP loopback between local
  agents.
- MCP egress implementation or migration of the existing trusted
  `plugins/boring-mcp` integration.
- Host-process imports/execution of authored custom tool handlers.
- AR1 cross-workspace artifact transfer, new share links/resources, preview
  rendering, E2 generic environment projection, raw filesystem/exec MCP tools,
  or live cross-workspace grants.
- Marketplace, billing, metering changes, generic environments, FUSE/S3,
  sandbox-provider extraction, farm/fleet UI, or deployment CLI work.

## Trigger conditions for deferred work

| Deferred work | Exact trigger | Required action before implementation |
| --- | --- | --- |
| A1 data-only/sandbox-handler prerequisite | #805/#391 approves a concrete slice proving either no authored custom handlers in Step 1A or sandbox/Operations-only execution | Record its real owner/Bead id, merge it, and attach its machine proof before creating `BB806-1B-001` |
| Step 1B implementation | #391 `1A.10b` completes the real Seneca two-domain web proof and the concrete A1 prerequisite above is merged | Run 1B.0 against then-current main; amend this plan if the actual seam differs |
| Step 2 several agents | A real workspace type needs two first-class selectable agents | Recut #391/#805 P7/#809 local consumption; keep delegation native, not MCP loopback |
| Second independently administered tenant | A second real tenant must share one Seneca deployment rather than use its own instance | Recut identity, credential lifecycle, per-tenant limits/secrets, operations, and isolation under #809; do not extend static Step 1B bindings ad hoc |
| Public/self-service MCP | A client must obtain/rotate credentials without an operator-managed binding | Activate #809 ID1 or an owner-approved replacement, including OAuth resource/audience and revocation proof |
| Restart/cross-replica retry guarantee | A named external workflow must survive Seneca restart or replica handoff without duplicate work | Recut #807 durable admission/events and hardened transport under Decision 26 Step 3 |
| Authored-agent MCP egress | A named A1 agent must call a specific external MCP server | Plan under #805's toolCatalog/sandbox seam; prove data-only declarations, sandbox execution, secret injection, timeout, and egress allowlist |
| Cross-workspace deliverable | A contracted/service-agent engagement must return an artifact to another workspace | Re-review and recut AR1 Lane X plus its protocol gate; no live grant |
| Generic environment projection | A named external agent needs governed raw environment access rather than delegation to the sole agent | Recut E2 under its own auth/Operations/no-leak contract; it is not Step 1B |

A trigger authorizes planning, not code. Each owner issue must have an approved
canonical plan and proof graph before dispatch.

## Review record

- **Tier 1 fresh-eyes — revised:** found five material issues in the first
  complete draft: an invalid 96 KiB status cap, receipt creation before full
  authorization, an untracked A1 sandbox-handler prerequisite, incorrect model
  loop plane placement, and ambiguous use of “controller.” All five were fixed
  in place.
- **Tier 2 architecture/security — revised:** found two remaining
  contradictions: mid-turn reauthorization was promised without a lease hook,
  and the zero-handler A1 option did not match final acceptance. The plan now
  uses explicit admission-snapshot semantics and the same conditional A1 gate
  throughout.
- **Tier 2 targeted re-review — clean:** confirmed both tier-2 findings are
  resolved. Residual risks are the deliberately deferred public identity,
  restart-durable admission, second-tenant policy, MCP egress, and generic
  environment/artifact work named above.
- **APR:** the high-risk planning reference was reviewed, but the `apr` command
  is not installed/configured in this environment. No `.apr` files were
  created; the repository-required tier-1/tier-2 review ladder supplied the
  independent convergence passes.

## Stop conditions

Stop and amend/route instead of improvising if:

1. Step 1A does not expose a reusable server-only typed authorization/binding
   seam and MCP would need a second resolver;
2. Seneca cannot map a pre-provisioned bearer to one explicit existing
   principal/workspace without a new mutable registry;
3. MCP would select behavior before current membership/type checks or would
   accept workspace/agent authority from tool input;
4. MCP needs to construct or dispose a runtime independently from the existing
   workspace-keyed binding;
5. A Seneca-authored tool handler would execute/import in the control plane;
6. the product requires OAuth/public self-service, several agents, durable
   multi-turn work, another tenant, raw environment access, or cross-workspace
   artifacts to call Step 1B complete;
7. full-app's existing managed MCP compatibility cannot migrate in the same
   package cohort;
8. stock-client proof requires workspace links, unpublished package paths, raw
   roots, secrets in commands/logs, or a second MCP implementation.

No stop condition authorizes restoration of a retired authority, a second
Workspace/Sandbox lifecycle, or host execution of tenant code.

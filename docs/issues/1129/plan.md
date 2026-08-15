---
github: https://github.com/hachej/boring-ui/issues/1129
issue: 1129
state: ready-for-human
updated: 2026-08-15
flag: not-needed
track: owner
---

# gh-1129 MCP ingress — external clients consume a boring-ui Workspace

Plan revision **r1** — gate 1. This replaces the obsolete implementation target in
`docs/issues/806/plan.md`; it does not implement product source or authorize a
production exposure.

## Problem

The repository already ships a dark managed-agent MCP server, but its remaining
plan still treats hostname and a typed Workspace domain as authorization and agent
selection. Decisions 28–30 and the shipped AgentGateway make that target invalid.
The useful protocol work should be retained, while authority must be recut around
the current Workspace, fleet, and gateway model.

## Today

### Shipped ingress

Current `origin/main` (`ee2017188`) already provides:

- `packages/agent/src/server/mcp/managedAgentMcpServer.ts`: stock MCP SDK
  Streamable HTTP server with `delegate_task`, `delegate_task_start`, and
  `delegate_task_status`;
- `managedAgentDelegate.ts`: AgentGateway-capable execution, process-local
  polling, abort, bounded results, stable errors, redaction canaries, and at most
  one complete inline Markdown artifact;
- coded limits of 32 KiB brief, 96 KiB final assistant text, 256 KiB Markdown,
  384 KiB serialized result, 100 retained progress items, 100 controller
  records, and 15-minute terminal retention;
- `apps/full-app/src/server/managedAgentMcp.ts`: a dark-by-default
  `/mcp/managed-agent` route where one static bearer maps to one configured
  user/workspace and membership is checked before dispatch;
- package, full-app, and `smoke:mcp-managed-agent` tests using the unmodified
  MCP SDK client and Streamable HTTP transport.

### Current authority

Decisions 28, 29, and 30 supersede the old typed-domain target:

- a Workspace durably persists `defaultAgentTypeId`; an unknown persisted value
  must fail stably rather than silently select another fleet Agent;
- `AgentGateway` is the sole session contract and `createAgentHost()` is the
  sole construction funnel;
- `AuthorizedAgentScope` is an issuer-owned runtime capability rechecked on
  every use, never a transport DTO;
- hostname may affect landing presentation and initialize a new default
  Workspace at signup, but it has no continuing membership, routing,
  selection, or authorization authority.

The full-app MCP adapter has not caught up completely: it hardcodes
`agentTypeId: 'default'` and uses the compatibility
`runWithWorkspaceAgent` bridge. Core's current helper also silently falls back
when a persisted default names an unknown fleet member, contradicting Decision
28's stable-failure rule. This code drift is evidence to reconcile, not authority
to extend into MCP.

### Remaining safety gaps

- The MCP edge returns a bespoke `running/completed/error` delegation shape
  instead of projecting Decision 22's canonical `AgentTask` v2 lifecycle,
  messages, principal, and actor.
- `delegate_task` and `delegate_task_start` have no caller-stable idempotency
  key, so a lost response retried with a fresh JSON-RPC id can start duplicate
  model work.
- Capacity is globally bounded, but there is no finite per-credential start
  rate/concurrency admission.
- Retained progress has an item cap but no per-message or aggregate byte cap.
- `resultTool()` duplicates the full structured result into text and no test
  freezes the final serialized MCP response boundary.
- The current smoke proves protocol plumbing through a fake dispatcher seam;
  it does not qualify persisted default-agent selection through the current
  AgentGateway authority.

### Direction boundary: where #1011 fits

This plan is **ingress from the external client's perspective**:

```text
external MCP client -> boring-ui MCP server -> Workspace AgentGateway -> Agent
```

Issue #1011 is the opposite, consumption-side direction:

```text
Workspace Agent -> per-Agent grant -> user-registered external MCP server
```

The two paths may compose during one turn: an externally connected client can
invoke a Workspace Agent, and that Agent may itself receive #1011-governed MCP
connector capabilities. They remain separate protocol edges, credentials,
authorization decisions, stores, and proof. This plan does not register an
external MCP server, resolve `mcpServerRefs`, edit per-Agent grants, or depend on
#1011 completion.

## Delta

Deliver a private, deployment-static MCP ingress binding aligned to today's
authority:

```text
static credential binding
  -> credentialId + existing principal + one existing Workspace
  -> current app / non-deleted Workspace / current membership
  -> strict Workspace defaultAgentTypeId resolution against static fleet
  -> binding-specific Core admitStart() / authorizeStatus() closures
  -> task lease for execution; separate scope for status disclosure
  -> existing AgentGateway
  -> existing managed MCP delegation and bounded delivery
```

The credential chooses one already-existing principal/Workspace pair. The
Workspace's persisted default chooses the Agent. Hostname chooses neither.
Tool input, MCP session id, JSON-RPC id, forwarded host, and request body grant
no authority.

Retry identity is a required caller-supplied `idempotencyKey`, scoped after
current authorization to the trusted credential/principal/Workspace/Agent
binding. Same scope + the exact bytes returned by the existing trimmed `parseBrief`
normalization returns the existing task while its record is retained; same key +
different normalized bytes conflicts. The guarantee lasts only for the
configured terminal-retention window in one process. Expiry, restart, or replica
handoff may lose the record and permit another run.

## Solution

### 1. Reconcile the task contract and harden the existing package edge

Extend, do not replace, `ManagedAgentMcpDelegateController` and its MCP server:

- make canonical `AgentTask` schema v2 the authoritative task projection in
  structured responses: principal and actor come from trusted binding data; the
  consumer brief and Agent output are canonical messages; task identity/state
  follows `submitted -> working -> completed|failed|canceled|rejected`;
- retain inline Markdown only as an edge delivery presentation alongside the
  task, not as a second lifecycle or a generic canonical artifact locator;
- require a non-empty ASCII `[A-Za-z0-9._:-]+` key of at most 128 UTF-8 bytes
  for both start tools;
- let the host supply a task-scoped lease for each new start: redacted admission
  identity, request-authorized `agentTypeId`, gateway scope, minimum artifact
  reader, and `release()`; retain it only through that task's asynchronous
  terminal result/artifact collection, then release on every outcome;
- authorize each status lookup separately with a disclosure scope that carries
  trusted record identity but no gateway or artifact capability;
- scope dedupe to credential/principal/Workspace/Agent/key plus the exact bytes
  of the existing trimmed `parseBrief` result;
- authorize first, then look up the scoped key, then apply new-work limits, then
  create a task/session;
- single-flight concurrent same-key starts; return the retained task for same
  payload and a stable conflict for different payload;
- require fixed-window options `maxStartsPerWindow` (1..10,000),
  `startWindowMs` (1,000..86,400,000), and
  `maxConcurrentPerCredential` (1..100); the fixed window begins at the first
  admitted new start and resets when `now >= windowStart + startWindowMs`;
  retries of retained keys bypass both limits; new starts increment the window
  and concurrency, and terminal tasks release concurrency; rate errors include
  bounded `retryAfterMs` to that reset;
- cap each visible progress message at 4 KiB and total retained progress at
  64 KiB in addition to the existing 100-item cap;
- keep `structuredContent` authoritative and return only a bounded compact text
  summary instead of duplicating the result;
- derive and test a final wire-response budget that can still carry the maximum
  otherwise-valid structured result plus retained progress and bounded envelope;
- never evict an unexpired idempotency record to admit new work: prune only at
  terminal retention expiry and reject new work when record capacity is full.

The same-process one-session claim is explicitly bounded by the retained record.
A retry after terminal TTL, process restart, or replica handoff may run again. No
new database, durable task service, second MCP server, or second model loop is
introduced.

### 2. Bind full-app through Core's current authority

Expose a binding-specific boot-time capability rather than a general scope
issuer. Full-app supplies Core one server-owned static
`{credentialId, principalId, workspaceId}` binding at composition time and
receives two non-parameterized closures, neither accepting caller-selected
identity: `admitStart()` and `authorizeStatus()`.

`admitStart()` rechecks the bound principal/Workspace/app/membership and strict
Workspace default, then returns one task-scoped lease:

```ts
type ManagedMcpTaskLease = {
  credentialId: string
  agentTypeId: string
  scope: AuthorizedAgentScope
  gateway: AgentGateway
  artifactReader: Pick<Workspace, 'stat' | 'readBinaryFile'>
  release(): Promise<void>
}
```

The package may retain this lease only for the admitted task, including work
that continues after `delegate_task_start` returns and later inline artifact
collection. It releases the lease after terminal success, failure, or cancel.
This is the explicit admission-snapshot boundary: membership removal does not
retroactively cancel the admitted task or its authorized artifact read.

`authorizeStatus()` independently rechecks the same bound identity and strict
default, then returns only a trusted disclosure key for receipt lookup. It has
no AgentGateway, scope-minting parameter, or artifact reader. If membership is
removed, new starts and later status disclosure fail; an already-admitted task
may finish under its lease, but its polling result is not disclosed until the
caller is authorized again (and only while retained).

Both closures accept no identity arguments. Core owns scope issuance and the
authorized Workspace reader; the app edge never receives a general function
that can mint arbitrary scope. The shared Core default resolver and web tests
are reconciled so web and MCP cannot silently fall back from an unknown
persisted Agent.

The route remains absent unless credential identity/binding and all three finite
admission options are complete. Full-app uses explicit server-only names
`BORING_MANAGED_AGENT_MCP_CREDENTIAL_ID`,
`BORING_MANAGED_AGENT_MCP_MAX_STARTS_PER_WINDOW`,
`BORING_MANAGED_AGENT_MCP_START_WINDOW_MS`, and
`BORING_MANAGED_AGENT_MCP_MAX_CONCURRENT`; enabled startup rejects missing,
non-integer, zero, negative, or out-of-range values. It remains a protocol binding at the edge under
Decision 22 and creates no second behavior resolver, filesystem authority, or
runtime owner.

### 3. Qualify the reference route with a stock client

Upgrade the deterministic full-app smoke to exercise the final binding through
an unmodified SDK client and prove:

- invalid bearer rejects before Workspace/gateway work;
- canonical `AgentTask` v2 is validated across submitted/working/terminal
  projection while edge-specific Markdown delivery remains bounded;
- strict persisted default Agent selection is used and an unknown persisted
  value fails without fallback or effect;
- a same-key retry within retained TTL creates one gateway session, while the
  post-TTL/restart duplicate limitation is explicit;
- removed membership or a deleted Workspace denies new starts and status
  disclosure without revealing target existence; an already-admitted polling
  task may finish and collect its artifact under its task lease, but the revoked
  caller cannot poll it; terminal cleanup always releases the lease;
- polling returns bounded progress and a bounded final result without secret,
  token, host root, session root, or artifact path;
- restart loss is documented honestly; and
- disabling MCP leaves ordinary web/Workspace authority intact.

This is reference/local qualification. A named production application owns its
credential provisioning, deployment, exact package release, post-deploy smoke,
and rollback approval.

## Decisions

1. **Retain the existing managed MCP server.** It already has stock-client,
   polling, bounded artifact, abort, and redaction proof; a new server creates a
   second protocol owner.
2. **Use Workspace default, not typed domain, to select the Agent.** Decision 28
   explicitly makes `defaultAgentTypeId` durable Workspace state and reduces
   any `workspaceTypeId` to inert compatibility metadata.
3. **Use canonical AgentTask v2 for task semantics and AgentGateway for session effects.**
   MCP is an edge projection of Decision 22's shared task contract; bespoke
   delivery metadata may not become a second lifecycle. Decision 29 makes the
   gateway the sole session contract and construction funnel.
4. **Use AgentGateway, not the compatibility dispatcher, for new ingress.**
   Decision 29 makes the gateway the sole session contract and construction
   funnel.
5. **Use one private pre-provisioned binding first.** The tracer needs no login,
   chooser, token-management UI, OAuth product, or implicit Workspace creation.
6. **Separate task admission from status disclosure.** Every new start gets one
   reauthorized task lease retained through terminal cleanup; every status lookup
   reauthorizes independently and receives no execution/artifact capability. An
   admitted turn and its artifact collection use the admission snapshot; this
   plan does not invent mid-turn revocation hooks.
7. **Keep retry state process-local and retention-bounded.** Same-process
   duplicate model work within retained TTL is the
   immediate defect. Restart-safe exactly-once work belongs to a durable-task
   plan, not this edge hardening.
8. **Hostname selects pixels, never authority.** Decision 30 is literal; no
   audience-by-domain, typed host resolver, or forwarded-host authorization is
   added.
9. **Keep #1011 orthogonal.** User-registered MCP servers and per-Agent grants
   are capabilities consumed by an Agent after ingress authorization, not part
   of authenticating the external caller.

## Flag / Abstraction

- **Needed?:** No new flag framework. Retain the existing
  `BORING_MANAGED_AGENT_MCP_ENABLED=1` plus complete-config startup gate.
- **Path:** Existing managed MCP package edge -> narrow Core-issued gateway
  capability -> full-app adapter.
- **Rollback:** Disable managed MCP/remove the static binding and restart. No
  Workspace data, persisted default, session schema, or web route is rolled
  back.

## Test Seams

- **Highest public seam:** unmodified `@modelcontextprotocol/sdk` `Client` +
  `StreamableHTTPClientTransport` calling the mounted full-app route.
- **Existing prior art:** package MCP controller/stock-client tests; full-app
  route tests; `smoke:mcp-managed-agent`; AgentGateway conformance and Core
  scope-authority tests.
- **Avoid testing:** MCP SDK internals, hostname parsing as authority, private
  map implementation, a second model loop, OAuth, production secrets, #1011
  connector execution, or cross-replica durability.

## Acceptance

- A stock external MCP client authenticates with one pre-provisioned credential
  and invokes the strictly validated persisted default Agent in one existing
  Workspace; an unknown persisted Agent fails with no fallback or effect.
- Current app, non-deleted Workspace, membership, strict fleet/default, and
  branded Core scope are checked before a new receipt/session/model effect; each
  status disclosure separately rechecks authority without execution capability.
- MCP structured responses use canonical `AgentTask` v2 for task identity,
  principal/actor, messages, and lifecycle; inline Markdown is only a bounded
  edge delivery projection.
- MCP uses the same AgentGateway, construction funnel, strict fleet/default,
  Workspace, and execution-environment lifecycle as web; the app receives a
  non-parameterized start/status closures; only a start lease contains the
  minimum artifact reader and it is released at terminal cleanup. Status receives
  disclosure identity only, never a general scope issuer, gateway, reader, or
  second resolver/composer.
- Hostname, body, tool args, MCP session ids, JSON-RPC ids, and forwarding
  headers cannot select principal, Workspace, Agent, runtime, root, or model.
- Same authorized scope + idempotency key + exact trimmed-brief bytes creates
  one session while the record is retained in the same process; changed payload
  conflicts; different trusted scopes do not collide; dedupe precedes new-work
  limits; expiry/restart may duplicate and is documented.
- Fixed-window admission uses required bounded `maxStartsPerWindow`,
  `startWindowMs`, and `maxConcurrentPerCredential`; exact boundary/reset,
  concurrency release, retry bypass, and bounded `retryAfterMs` are tested.
- Per-credential start/concurrency and all input/progress/result/final-response
  bounds are finite and exact-boundary tested; existing caps and secret
  redaction do not weaken.
- Maximum valid completion remains retrievable by polling through a stock
  client without duplicating the full result in text content. Revocation denies
  new starts/status, while an admitted task may finish and read its artifact under
  the bounded lease; terminal success/error/cancel always releases that lease.
- Route stays dark by default and fails startup on incomplete/unbounded config.
- Documentation states restart loss, private credential scope, local/reference
  proof, and the #1011 opposite-direction boundary without claiming public or
  production readiness.

## Proof

- Exact command: `pnpm --filter @hachej/boring-agent test -- src/server/mcp/__tests__/managedAgentDelegate.test.ts`
- Exact command: `pnpm --filter @hachej/boring-agent typecheck`
- Exact command: `pnpm --filter @hachej/boring-core test -- src/app/server/__tests__/createCoreWorkspaceAgentServer*.test.ts src/server/__tests__/defaultAgentType.test.ts`
- Exact command: `pnpm --filter @hachej/boring-core typecheck`
- Exact command: `pnpm --filter full-app test -- src/server/__tests__/managedAgentMcp.test.ts src/server/__tests__/production-safety.test.ts`
- Exact command: `pnpm --filter full-app typecheck`
- Exact command: `pnpm --filter full-app smoke:mcp-managed-agent`
- Exact command: `pnpm lint:invariants`
- Screenshot/demo: not required for this server/protocol slice; stock-client
  assertions and captured command output are stronger evidence.
- Manual steps: set the existing bearer/user/Workspace binding values plus the
  credential id and three finite limit values in a
  local full-app instance, connect a stock client to `/mcp/managed-agent`, call
  start/status with a stable idempotency key, then disable the route and verify
  ordinary web access remains healthy.
- Waiver if proof is not possible: production application deployment and
  restart/revocation evidence are not claimed by this repository plan; the app
  owner must create a separate deployment bead before exposing a real tenant.

## Slices

### Slice: Bounded retry-safe MCP ingress admission

**Bead:** `wt-391-forward-rjkl.3`
**Priority:** P1
**Delivers:** Canonical AgentTask v2 edge projection, a task lease retained only
through asynchronous terminal work/artifact collection plus separate status
disclosure authorization, caller-stable retention-bounded idempotency, exact
fixed-window/concurrency admission, progress byte caps, compact text projection,
and exact final-response proof.
**Blocked by:** planning bead `wt-391-forward-rjkl.1`; the orchestrator closes
that dependency only after gate-1 approval.
**File scope:** `packages/agent/src/server/mcp/managedAgentDelegate.ts`,
`managedAgentMcpServer.ts`, focused delegate test, and MCP exports only if
required.
**Proof:** focused agent MCP test, agent typecheck, invariants; exact/over,
state transitions/schema validation, task-lease lifecycle/release and
status-scope separation, per-request Agent selection, concurrency/retry/conflict, cross-scope, fixed-window reset, retention/expiry,
dedupe-before-limit, and stock-client assertions.
**Review budget:** Inside — one package controller/server seam and one focused
test file; fits one worker session.

### Slice: Bind MCP ingress to current Workspace AgentGateway authority

**Bead:** `wt-391-forward-rjkl.4`
**Priority:** P1
**Delivers:** Non-parameterized Core `admitStart()` task-lease and
`authorizeStatus()` disclosure closures; start returns branded scope, strict
resolved Agent, existing gateway, minimal artifact reader, and release; status
returns no execution/artifact capability; shared
unknown-default fallback drift is fixed for web and MCP; full-app reauthorizes
on start/status with no hostname authority.
**Blocked by:** `wt-391-forward-rjkl.3`.
**File scope:** Core app-server construction and strict default resolver plus
directly focused tests; full-app `managedAgentMcp.ts`, `main.ts`, `dev.ts`, managed MCP and production
safety tests. No package MCP implementation files.
**Proof:** focused Core/full-app tests, both package typechecks, invariants;
negative authorization/default/spoof tests prove no effect before authority.
**Review budget:** Inside — one Core composition callback and one app edge
adapter; fits one worker session.

### Slice: Stock-client full-app ingress qualification

**Bead:** `wt-391-forward-rjkl.5`
**Priority:** P2
**Delivers:** Deterministic external SDK-client qualification and operator docs
for canonical AgentTask + strict current authority, including retained-window
retry, start/status authority-lifetime separation, terminal lease release,
revocation, bounds,
redaction, rollback, restart limitation, and direction terminology.
**Blocked by:** `wt-391-forward-rjkl.4`.
**File scope:** `apps/full-app/scripts/managed-agent-mcp-smoke.ts`, full-app
script wiring only if needed, and `apps/full-app/README.md`. No package/Core or
route implementation files.
**Proof:** `pnpm --filter full-app smoke:mcp-managed-agent`, focused full-app
test, full-app typecheck, invariants, with pasted assertion counts.
**Review budget:** Inside — one deterministic smoke and its operator contract;
fits one worker session.

The graph is intentionally linear because the final app binding consumes the
package admission contract, and qualification must run against that exact
combined contract. File scopes do not overlap across writer beads.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Scope capability is exposed too broadly from Core | Medium | High | Boot-time narrow callback only; branded scope remains issuer-owned; focused misuse tests and fresh security review. |
| Retry key leaks or becomes caller authority | Low | High | Scope with redacted `credentialId` after authorization; bearer/JSON-RPC/MCP session ids prohibited from identity. |
| Task lease outlives revocation while status is denied | Medium | High | Explicit admission snapshot: lease is task-only and released terminally; status has no reader/gateway; test revoked polling denial plus admitted completion and cleanup. |
| Final response cap rejects a maximum valid artifact | Medium | Medium | Derive envelope from retained component budgets and prove exact maximum through a stock client. |
| Private reference route is mistaken for public/production auth | Medium | High | Dark default, static binding, explicit docs/non-goals, and separate app-owned deployment gate. |
| #1011 direction is conflated with ingress | Medium | Medium | Separate flow diagrams, credentials, file scopes, acceptance, and no dependency on connector registration/grants. |

## Out of Scope

- Typed Workspace domains, `workspaceTypeId` authorization, hostname audience,
  product routing, or hostname-selected Agent behavior.
- Public OAuth/self-service credentials, token UI/database, dynamic credential
  registration, login, Workspace chooser, or implicit Workspace creation.
- Durable tasks, restart/cross-replica exactly-once admission, replay across
  process loss, external A2A, or multi-turn `input-required` projection.
- User-registered external MCP servers, `mcpServerRefs`, per-Agent grant UX,
  connector credential custody, write-tool approval, or any #1011
  implementation.
- New MCP server package, per-Agent endpoint, caller-selected Agent, second
  AgentGateway/model loop/runtime owner, or AgentHost deployment/controller
  machinery.
- New artifact types, cross-Workspace projection, raw environment/filesystem
  exposure, production deployment, package publication, or Seneca-specific
  domain/product wiring.

## Open Questions

- **None for gate 1.** Current Decisions settle authority and direction. A
  production application must separately answer credential custody, release,
  deployment values, monitoring, and rollback before enabling the route for a
  real tenant.

## References

- GitHub #1129 — external clients consume a boring-ui Workspace.
- `docs/DECISIONS.md` Decisions 22, 28, 29, and 30.
- `docs/issues/806/plan.md` — historical typed-domain plan; protocol research
  retained, authority target superseded.
- GitHub #1011 and `docs/issues/1011/plan.md` if present — opposite
  Workspace-Agent-to-external-server direction.
- `packages/agent/docs/AGENT_GATEWAY_V0.md` — current gateway contract.
- Current ingress code/tests listed in Today and the three slice file scopes.

## Adversarial Review

- **Reviewer:** `openai-codex:gpt-5.6-sol` (fresh-context `reviewer`).
- **Mandate:** refute plan/graph against Decisions 22/28/29/30, current ingress
  code, #1011 direction, authority safety, executable slices, dependencies, and
  proof; read-only, never rewrite.
- **Target:** commit `3f7f740a6010ffb046b28576b5b1b92898c06945`.
- **Verdict:** revise.
- **Disposition:** fixed the gate dependency, strict unknown-default failure,
  package request-time Agent resolver, operation-scoped artifact reader,
  non-parameterized Core binding closure, retention-bounded idempotency,
  Decision 22 AgentTask projection, exact fixed-window contract, and whitespace.
  Second-pass verification targeted the resulting commit.
- **Pass 2 target:** commit `7638775f51c4f8bff1ac328be7b8a0b7a2abe40e`.
- **Pass 2 verdict:** revise.
- **Pass 2 findings/disposition:** made `.3` self-contained with the exact key
  grammar/byte limit, fixed-window reset, and `retryAfterMs`; corrected the HTML
  to state no unexpired-record eviction/capacity rejection and the exact package
  files; added the strict default resolver test to canonical/HTML proof.
- **Pass 3 target:** commit `0c56c8c938c48965f6ffc8376834a0669c40eff8`.
- **Pass 3 verdict:** revise.
- **Pass 3 findings/disposition:** resolved asynchronous authority lifetime with
  task-scoped `admitStart()` leases retained through terminal artifact/result
  collection plus separately reauthorized capability-free status disclosure;
  added `.1` Acceptance Criteria for lint; reordered/capped the gate HTML.
  A clean final pass is required before handoff.

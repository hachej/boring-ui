# AgentGateway v0 — the session contract

**Kind:** technical contract. **Governs:** the gateway surface only.
**Does not govern:** sequencing (see `docs/DIRECTION.md`), architecture rulings
(see `docs/DECISIONS.md`), or history (see `docs/issues/909/plan.md`).

This file supersedes `docs/issues/909/plan.md` §6 as the binding description of
the gateway contract. §6 was written before implementation and drifted; it is
retained there as a historical record, not as a build target.

Source of truth is the code: `packages/agent/src/shared/gateway/types.ts` and
`errors.ts`. If this file and those files disagree, the code wins and this file
is a bug. Keep them together — that colocation is the point. The v0 contract
lived in an issue folder nobody updated, and it silently stopped matching the
types within one release.

## Scope discipline

`AuthorizedAgentScope` is an **issuer-owned runtime capability, not a transport
DTO**. It carries a `unique symbol` brand, so it cannot be forged by spreading
an object across a boundary. It must be re-checked against issuer identity and
current membership on every use — possession is not authorization.

```ts
interface AuthorizedAgentScope {
  readonly workspaceScopeId: WorkspaceScopeId
  readonly authSubjectId: AuthSubjectId
  readonly [authorizedAgentScope]: true   // brand
}
```

Only the app-owned verifier returns identity facts, as
`VerifiedAgentScopeClaim`. `AgentSessionRef` deliberately carries **no
`hostId`** — session refs are `{ agentTypeId, sessionId }` and nothing else.

## The 7 methods (+ close)

```ts
interface AgentGateway {
  listAgents(input: ListAgentsInput): Promise<readonly AgentSummary[]>
  listSessions(input: AuthorizedAgentSessionQuery): Promise<AgentSessionPage>
  createSession(input: CreateAgentSessionInput): Promise<AgentSessionRef>
  connectSession(input: ConnectAgentSessionInput): Promise<AgentSessionConnection>
  readSessionState(input: ReadAgentSessionStateInput): Promise<AgentSessionStateSnapshot>
  renameSession(input: RenameAgentSessionInput): Promise<AgentSessionSummary>
  deleteSession(input: DeleteAgentSessionInput): Promise<void>
  close(): Promise<void>
}
```

### Input DTOs — scope is NESTED

**This is the correction.** §6 froze the scope fields as inherited
(`interface CreateAgentSessionInput extends AuthorizedAgentScope`). The shipped
contract nests scope under its own field on **every** input:

```ts
interface ListAgentsInput            { scope }
interface AuthorizedAgentSessionQuery{ scope; agentTypeId?; cursor?; limit? }
interface CreateAgentSessionInput    { scope; agentTypeId; requestId; title? }
interface ConnectAgentSessionInput   { scope; ref; cursor? }
interface ReadAgentSessionStateInput { scope; ref }
interface RenameAgentSessionInput    { scope; ref; requestId; title }
interface DeleteAgentSessionInput    { scope; ref; requestId }
```

Nesting keeps the branded capability a single indivisible value instead of
scattering its fields across every DTO, which is why callers adopted it. Code
written against §6's inherited form does not typecheck.

Note `listAgents` takes `ListAgentsInput`, not a bare `AuthorizedAgentScope`.

### Output DTOs

`AgentSummary` (`agentTypeId`, `label`, `description?`, `definition?{version,digest}`),
where `version` is the exact package declaration and `digest` is the computed
compiled-definition identity (not a re-hash of the response DTO),
`AgentSessionSummary` (`ref`, `title`, `status`, `createdAt`, `updatedAt`),
`AgentSessionPage` (`sessions`, `nextCursor?`), and the receipts
(`CommandReceipt`, `AgentSendReceipt`, `QueueClearReceipt`, `StopReceipt`) are
unchanged from §6, field for field.

Session activity is the extracted alias `AgentSessionActivity`:
`'idle' | 'running' | 'aborting' | 'error'`.

`AgentSessionStateSnapshot.state` is **`JsonSafe<PiChatSnapshot>`**, not the raw
snapshot §6 named — the transport boundary is expressed in the type.

`JsonSafe<T>` itself differs from §6's version: it hoists `unknown extends T` to
the top, maps functions to `never`, and terminates non-object/non-array at
`never`. Read it from `types.ts`; do not reimplement it from memory.

### Commands

`AgentPromptCommand` and `AgentFollowUpCommand` both require
**`{ requestId, clientNonce, content }`** — there is no `text` or `kind:'user'`
shorthand. Prompts add `displayContent?`, `model?`, `thinkingLevel?`,
`attachments?`; follow-ups add `clientSeq`.

## Error codes

Fifteen, exhaustive, order-stable, exported as both a const map and
`AGENT_GATEWAY_ERROR_CODES`:

`AGENT_TYPE_UNKNOWN` · `AGENT_SESSION_NOT_FOUND` · `AGENT_SCOPE_DENIED` ·
`AGENT_SESSION_REPLAY_GAP` · `AGENT_SESSION_CURSOR_AHEAD` ·
`AGENT_SESSION_CURSOR_EXPIRED` · `AGENT_SESSION_CURSOR_INVALID` ·
`AGENT_REQUEST_CONFLICT` · `AGENT_REQUEST_IN_PROGRESS` ·
`AGENT_REQUEST_OUTCOME_UNKNOWN` · `AGENT_RUNTIME_RESTART_REQUIRED` ·
`AGENT_COMMAND_INVALID_STATE` · `AGENT_SESSION_RUNTIME_SCOPE_MISMATCH` ·
`AGENT_SHARED_ENVIRONMENT_UNAVAILABLE` · `AGENT_GATEWAY_CLOSED`

HTTP mapping lives in `server/agent-host/httpProjection.ts`
(`statusForGatewayError`). Note `AGENT_SESSION_RUNTIME_SCOPE_MISMATCH`,
`AGENT_REQUEST_CONFLICT`, `AGENT_REQUEST_IN_PROGRESS`,
`AGENT_RUNTIME_RESTART_REQUIRED`, and `AGENT_COMMAND_INVALID_STATE` project to
**409**.

## Conformance levels

- **Level B** — bounded replay within a process lifetime, plus snapshot
  rehydrate. This is what ships. A cursor older than the replay window, or one
  from before a restart, yields `REPLAY_GAP` / `CURSOR_AHEAD` and the client
  refetches state. Never a silent gap.
- **Level D** — durable replay across restarts and processes. Specified,
  deliberately skipped, and owner-annotated in
  `server/agent-host/testing/gatewayConformance.ts`. Owned by the streaming
  lane (#1009).

The suite is parameterized by `replayLevel`/`paginationLevel`; a Level D host
must pass the same file with the flag raised.

## Keyset pagination

Cursors are HMAC-signed and bound to scope and filter; tampering or reuse under
a different filter yields `AGENT_SESSION_CURSOR_INVALID`. Ordering is total, so
a session mutated between pages shifts predictably rather than vanishing.

## Known descope

§10 of the 909 plan carries an unchecked acceptance box demanding recursive
JSON/size/depth validation of attachment and path leaves on the transport
boundary. §6.4 descoped exactly that to v2, and the conformance suite skips it
(`v2 remote wire validates JSON event leaves, paths, depth, and size`). The
plan is internally inconsistent on this point; the descope is what shipped.
Anything relying on recursive leaf validation must not assume it exists.

## Construction

`createAgentHost()` is the single construction funnel — see
`server/agent-host/createAgentHost.ts` and Decision 29. It is a
deployment-static composition helper that returns a gateway and a `close()`; it
is **not** the AgentHost deployment/publication machinery that Decisions 25–28
rejected. Future internal/external host tiers belong to #905, not here.

`scripts/check-alignment-invariants.mjs` enforces that nothing outside an
allowlist calls it.

---
github: https://github.com/hachej/boring-ui/issues/806
issue: 806
state: ready-for-owner
first-blocker: combined-plan-merge
flag: BORING_EXTERNAL_WORKSPACE_MCP_ENABLED
updated: 2026-08-26
---

# Issue #806 — inbound External Workspace MCP Access

## 0. Status and governance

This is the **candidate canonical implementation plan** for inbound MCP Access:
one remote MCP resource lets an external agent act as one authenticated human
user inside one selected workspace and use the Agents available there. It is
not dispatch authority until the combined inbound+outbound MCP planning PR
#1415 lands. That PR carries this plan, the owner direction amendment, the
pointer migration, and the companion outbound Composio plan atomically.

`docs/issues/806/plan.md` and `docs/issues/806/runtime-refactor/**` retain the
abandoned Decision-26 domain-routing history. PR #1415 marks those records
historical and points live authority here. Decision 28,
`docs/direction/DIRECTION.md`, and the frozen long-term architecture govern.

### Owner-ratified product decisions

1. **Inbound MCP Access and outbound MCP Connectors are different products.**
   This plan does not complete issue #1011 or A5's outbound client.
2. **One OAuth authorization binds one human account and one selected
   workspace.** Current membership is checked on every request.
3. **The public API is Agent-oriented.** Callers select one workspace-bound
   `agentId`; they do not pass `seatId`. The host resolves the unique current
   Seat and records server-derived `seatId` in envelopes, usage, artifacts, and
   audit provenance.
4. **One `/mcp` remote endpoint uses the current standard Streamable HTTP
   transport.** No stdio and no deprecated separate HTTP+SSE transport.
5. **Native direct calls execute the same resolved `AgentTool` instance** under
   the same runtime/workspace/sandbox binding. There is no LLM loop or tool
   reimplementation.
6. **Effective native capability is agent-declared ∩ workspace-granted.** There
   is no persistent MCP-specific tool allowlist and no new per-call approval
   system.
7. **Agent runs use the LLM; direct tools do not unless the native tool itself
   uses an LLM.** Billing follows actual usage, not effect authorization.
8. **Artifacts are live same-workspace references.** A live result may expose
   the same normalized workspace-relative path an internal Agent uses, plus an
   opaque id, `share:///` URI, and authenticated `/a/<id>` URL. Tombstones are
   path-free.
9. **Boring owns generic capability and usage facts; Seneca owns pricing,
   credits, checkout, margins, and `credits_status`.**
10. **The dark app-only `/mcp/managed-agent` tracer is unnecessary.** The owner
    explicitly authorizes its early narrow deletion after an exact reference
    audit. This authority does not extend to generic Agent MCP/share modules.
11. **Inbound Access cannot flatten outbound Connector execution.** It exposes
    the resident native `AgentTool` surface exactly as resolved. Connector
    discovery/proposal tools remain native tools, but an effectful provider
    operation keeps the Connector's existing authority, approval, accepted-work,
    first-class child identity, and outcome semantics. MCP Access adds no second
    approval layer and bypasses none.

### Combined-PR direction gate and frozen-DAG prerequisites

The owner explicitly requested one coherent inbound+outbound MCP planning PR.
PR #1415 therefore carries an amendment to `docs/direction/DIRECTION.md` that
activates **inbound MCP Access #806**, distinguishes it from outbound MCP
Connectors #900/#1011, and binds both plans to their shared C2/C5/C6/C7 seams
without conflating products. This issue plan remains subordinate; the amendment
becomes authority only when the combined PR lands.

### Pointer migration included in PR #1415

The same combined PR atomically:

1. marks `docs/issues/806/plan.md` as a historical Decision-26 record and points
   its canonical entry to `external-workspace-mcp-plan.md`;
2. points `docs/issues/806/runtime-refactor/README.md` here while retaining the
   work packages as history; and
3. tombstones `docs/issues/807/plan.md`: its duplicate Decision-26 task ledger
   becomes historical evidence at an exact commit, and current authority points
   to A2a/C6/C7 plus the #806/#900 plans.

Pointer-migration acceptance: exact searches find no live authority/index claim
that `docs/issues/806/plan.md` is canonical; the links resolve to this file;
historical runtime-refactor TODO links may remain explicitly historical and
non-dispatchable; #807 contains no live duplicate task-ledger dispatch language;
no product code or frozen DAG is changed.

When the combined direction amendment and pointer migration land, `P-1` remains the first
feature-implementation barrier; the owner-authorized removal-only Slice 0 is
not a target-architecture track item and remains independent of P-1. Frozen
items, including their transitive dependencies, gate these #806 capabilities:

| Frozen item | #806 dependency |
| --- | --- |
| `P-1` evidence-register barrier | feature Slices 1–8; it does not gate the separately authorized removal-only Slice 0 |
| `P0.4` runtime tool collision handling | native catalog/discovery |
| `A7` invocation-scoped `ModelCapabilityIssuer` | model listing and Agent runs |
| `A8` revocation epochs | active-stream and active-run revocation |
| `C5` durable pause | ordered predecessor to C6 |
| `C6` accepted-work/commit protocol | direct effects, Agent runs, durable status/cancel |
| `C7` Seat/session catalog | internal Agent→Seat resolution and provenance |

The #806 owner packet is an **additive C6/C7 acceptance amendment, not a DAG
reorder**:

- C6 must expose exactly one RequestKey-derived id per accepted effect,
  authoritative terminal status, and run-targeted cancellation. A cancel effect
  therefore has its own `cancelRunId` while naming the Agent run's
  `targetRunId`; neither is a second UUID. Today's prompt-acceptance receipt and
  session-wide stop are insufficient.
- C6 records immutable `originGrantId` separately from the human actor.
- C7 resolves a public `agentId` to one authorized Seat in the selected
  workspace and supplies stable internal `seatId` provenance.

If one workspace can expose multiple simultaneously addressable Seats for the
same `agentId`, implementation stops for an owner API ruling rather than adding
`seatId` to the public MCP contract.

This candidate auth/permissions/public-protocol/deletion/release plan is
`ready-for-owner`, blocked on the combined planning PR landing. Issue #806 is
currently closed and its 2026-08-05 owner comment absorbed the pre-Decision-28
plan into #391; the amendment in PR #1415 is the explicit owner-authorized
reactivation. Landing that PR establishes planning authority only. No slice,
including Slice 0, dispatches until a separate owner-approved implementation
tracker/brief names it; P-1 must additionally land before feature Slice 1.

## 1. Problem and current reality

### Problem

External coding agents need a supported way to discover and use the Agents and
native tools an authenticated user can already use in one Boring workspace.
The desired flow is:

```text
external MCP client
  -> OAuth grant for one human + one workspace
  -> current token/resource/membership checks
  -> public agentId -> host-resolved authorized Seat
  -> compact Agent/tool/model discovery
  -> same Host runtime capability binding
       -> exact native AgentTool.execute(...)      (direct, normally no LLM)
       -> canonical accepted Agent run             (LLM)
  -> bounded result + live same-workspace artifacts
```

### Verified current source

Source snapshot: `origin/main@98619e9b84538de25cb3eab7c41c8f5af1dd77f8`
(the main revision used when this combined PR was last reconciled). All paths and claims below were
rechecked against that revision rather than inherited from the old #806 plan.

- `packages/agent/package.json` is version `0.1.105` and pins
  `@modelcontextprotocol/sdk` `1.30.0`; this is current implementation evidence,
  not a claim that this SDK/version satisfies the protocol revision Slice 1
  will select.
- `packages/agent/src/server/mcp/managedAgentMcpServer.ts` exposes only
  `delegate_task`, `delegate_task_start`, and `delegate_task_status` through
  SDK 1.30.0. It does not project native tools.
- `packages/agent/src/server/mcp/managedAgentDelegate.ts` has useful bounds and
  gateway-oriented execution, but receipts are process-local and results are
  the legacy delegation shape.
- `apps/full-app/src/server/managedAgentMcp.ts` mounts the dark
  `/mcp/managed-agent` route, binds one static bearer/user/workspace, hardcodes
  `default`, and checks membership only inside later resolution. It is not the
  new authorization base.
- `AgentHostRuntimeCapabilityBinding` in
  `packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts` already
  supplies authorized `tools`, `workspace`, `runContext`, harness, readiness,
  and runtime facts. Its projection is private to Host composition.
- `AgentGateway` in `packages/agent/src/shared/gateway/types.ts` is
  session-oriented. It has no direct-tool or model-discovery method.
- Native `AgentTool` in `packages/agent/src/shared/tool.ts` contains name,
  description, JSON Schema, readiness requirements, and `execute`. Its trusted
  context carries abort, update, session/user/workspace/request identity.
- Core now supports trusted `getAgentExtraTools({ agentTypeId, ... })` and
  includes addressed tool contracts in runtime identity, so the new edge can
  reuse an Agent-scoped host binding rather than inventing one. However,
  `buildAgentComposition.ts` still concatenates standard and scoped extra tools;
  direct execution cannot safely search that raw array until P0.4 supplies
  canonical collision handling and a resolved catalog.
- `modelsRoutes` currently constructs a process-cached Pi `AuthStorage` and
  `ModelRegistry`. The frozen architecture identifies ambient model authority
  as a live BYOK bypass. MCP may not use that registry as source or fallback.
- Today's `AgentGateway.send` ledger effect completes when a prompt is accepted,
  while model work continues asynchronously. Current stop is session-wide.
  Neither is the required accepted-run lifecycle.
- `AgentMeteringSink` is Pi-chat-specific and currently has its own run-id
  convention. It must converge on canonical RequestKey identity before MCP
  claims joined run/usage facts.
- `ShareEntryV1`, `ShareEntryStore`, live/tombstone resolution,
  `shareEntryResources.ts`, and `/a/:id` already provide the semantic artifact
  seam. The Agent package only supplies an in-memory reference store; Core can
  accept an injected store, but durable production composition is not proven.
  Current comments/contracts prohibit public paths even for live entries; the
  owner-ratified #806 live-result path is an intentional narrow contract change
  that must update those claims and tests without ever adding a path to a URL,
  tombstone, foreign-id result, or default audit event.
- No `ModelCapabilityIssuer` or `originGrantId` implementation exists on this
  source snapshot. `AgentRequestKey`, the canonical host-owned
  `resolveRequestLedgerPath`, and in-memory/SQLite request ledgers exist, but
  their current lifecycle is not the full C6 contract required here.
- Ask User now preserves submitted answers without a live in-process waiter,
  but its coordinator remains process-local and is not the crash-safe C5×C6
  consume/admit handoff required by effectful Connector children.
- `SandboxProviderV1` is the current application seam. The sovereign sandbox
  direction keeps signing roots, reusable customer/model credentials,
  authorization, transcripts, and session history in the trusted control plane;
  each guest receives only its scoped runtime/storage capability. MCP must
  compose above this seam and may not become a guest-side authority.
- Generic MCP/share exports are public from `packages/agent/src/server/index.ts`.
  The owner-authorized deletion is app-specific, not package-wide.
- Draft PR #1415 (`plan/900-perfect-mcp` at `2f5fa4358`) is the outbound
  full-catalog Composio design, not this inbound protocol. Its executed #1226
  evidence shows that an outer `call_tool`/`mcp_tool_call` cannot anonymously
  dispatch an app-native provider tool: doing so loses child identity and
  approval semantics. The draft therefore blocks effectful full-catalog
  execution on C2's complete predecessor closure and preserves a first-class
  child. PR #1415 is alignment input only while unmerged/BLOCKER; it is not
  current dispatch authority.

### Delta

Build one inbound MCP edge over existing host authority and runtime seams. Do
not create another AgentGateway, runtime, Workspace, Sandbox, model registry,
tool registry, identity system, or request ledger. This aligns with the
sovereign sandbox direction: MCP remains a trusted control-plane edge, native
execution keeps the existing `SandboxProviderV1` binding, and no bearer or
control-plane credential enters the guest. There is no known conflict with that
direction. It also aligns with PR #1415's cross-plane boundary: the inbound
edge may call the exact resident Connector-facing `AgentTool`, but it neither
materializes a provider's full catalog as native tools nor replaces C2's
first-class child execution with an anonymous nested dispatch.

## 2. Terminology

| Term | Meaning |
| --- | --- |
| **MCP Access** | Inbound external client access to a Boring workspace. |
| **MCP Connector** | Outbound connection from a Boring Agent to an external MCP provider. |
| **authorization / connection grant** | One OAuth client authorization for one human and one workspace. Not a transport session. |
| **originGrantId** | Opaque immutable id of the grant that admitted work; used for connection-specific revocation, not actor identity. |
| **agentId** | Public workspace-bound Agent selector; initially compatible with current `agentTypeId`. |
| **Seat** | Internal host/workspace binding for an Agent. C7 resolves it; callers do not select it. |
| **runId** | Branded projection of canonical RequestKey, never a second UUID. |
| **sessionId** | Agent conversation identity; optional where supported and never authentication. |
| **artifact** | Live same-workspace `ShareEntryV1` reference, not a snapshot. |

New code/docs must qualify ambiguous “External MCP” as inbound MCP Access or
outbound MCP Connectors.

## 3. Ownership and trust boundaries

### Boring packages

- Agent owns the MCP adapter, public schemas, bounds, safe errors, a generic
  injected Seat-projection contract, native catalog/execution, and envelope
  consumption. It does not create Seats or own membership/grants.
- Workspace/C7 owns Seat creation, membership, role/grants, and the
  `agentId → authorized unique Seat` catalog projection.
- Core supplies authenticated human/workspace membership facts, token-verifier
  composition, and durable-store composition; the app shell injects Workspace's
  Seat projection into Agent's generic contract.
- Boring owns generic model/funding facts and metering hooks, never product
  pricing or credit semantics.

### Hydra authorization server + Seneca login/consent application

- Hydra owns authorization/token/device/introspection/revocation endpoints,
  access/refresh-token families, client policy, and authorization-server
  metadata. It is headless and does not own workspace UI or authorization.
- Seneca/Boring application code owns human login, workspace selection,
  consent, grant-record creation, product disconnect UI/API, canonical
  Host/Origin policy, rollout, and app durable topology.
- Hydra does not decide Agent, Seat, tool, model, workspace membership, or
  effects beyond issuing facts for the app-approved grant.

### Seneca commercial layer

- Funding labels/rates, payer policy, credits, checkout, margins,
  `credits_status`, and commercial rollout.

### Trust invariants

1. Validate Host/Origin and edge policy before all work; except for the public
   metadata endpoints in §4.1, validate bearer, issuer, expiry, exact resource/
   audience, and coarse scope before MCP handling.
2. Recheck grant, workspace existence/app/deletion, human membership, and Agent
   access on every request and every handle lookup.
3. Issue Agent scope with `authSubjectId = verified human subjectId`.
4. Record `originGrantId` separately on accepted work and index active work by
   it. Revocation stops active work from that connection only. A later grant by
   the same human/workspace can read human-owned durable history.
5. User, workspace, Agent access, Seat, payer, and paths are never trusted from
   tool arguments, session headers, Host, or forwarded headers.
6. Tokens are never forwarded to models, native tools, outbound MCP, browser
   URLs, or providers.
7. MCP can narrow existing authority but cannot add a tool, model, or Agent.
8. Static extra-tool name collisions fail server construction.

## 4. Public protocol and tool contracts

### 4.1 Transport, discovery, and edge freeze

The product contract is one canonical HTTPS resource such as
`https://app.example/mcp`. The exact byte-for-byte value is configured once and
reused for token resource/audience comparison, protected-resource metadata,
Bearer challenges, browser approval, and reverse-proxy policy; trailing-slash,
host-alias, forwarded-host, and scheme variants do not compare equal.

Slice 1 must pin the official MCP specification revision, supported stock
client, SDK package/version set, the metadata discovery URI derived by that
revision, and exact standard Streamable HTTP method/stream behavior. It must
quote/link the normative source and prove those requirements before handlers
land. This plan deliberately does not guess a well-known path, protocol header,
transport-session rule, dynamic-client feature, or custom mismatch behavior.
Only the product rules below are frozen now.

Normative-source matrix for Slice 1 (official text only; record revision/date
and exact applicable requirement):

| Concern | Source to pin/prove |
| --- | --- |
| MCP authorization and Streamable HTTP | selected official MCP specification revision |
| Bearer challenge/error semantics | RFC 6750 |
| protected-resource metadata and revision-required `resource_metadata` challenge | RFC 9728 plus selected MCP revision |
| resource indicator/audience binding | RFC 8707 |
| authorization-server metadata and issuer binding | RFC 8414 |
| PKCE verifier/challenge and S256 | RFC 7636 |
| authorization-response issuer validation, when used | RFC 9207 |
| optional device grant | RFC 8628 plus RFC 8707 and tested deployed-Hydra behavior |

Protected-resource and authorization-server metadata needed for discovery are
public and bypass bearer admission but still pass edge bounds/Host policy; all
MCP initialize/discovery/effect handlers require a bearer. Slice 1 distinguishes
missing/invalid bearer from `insufficient_scope` and tests each challenge field
at its source's actual MUST/SHOULD strength. It also records whether the pinned
stock client is manually preregistered or needs a standards-defined registration
mechanism; if the chosen client cannot operate without unapproved DCR/CIMD, stop
rather than inventing support.

Edge authority is configured, never derived from headers:

- resource metadata and generated URLs use only the configured canonical public
  resource/authority;
- direct TLS uses the parsed request authority; behind termination, forwarded
  authority/scheme are accepted only from an allowlisted immediate peer and
  only in one Slice-1-selected format;
- duplicate, multi-value, malformed, or conflicting `Host`, HTTP/2
  `:authority`, `Forwarded`, or `X-Forwarded-*` inputs fail closed; aliases,
  unexpected ports, and scheme mismatches fail exact public-authority matching;
- a present `Origin` is exact-parsed and allowlisted; `null`, malformed,
  duplicate, or conflicting Origin fails. Absent Origin is explicitly allowed
  for native MCP clients and receives no browser-origin privilege.

Fixed product rules:

- one `/mcp` endpoint;
- modern Streamable HTTP as specified by the pinned revision;
- no stdio, deprecated separate HTTP+SSE endpoint, token query parameters, or
  transport-session authentication;
- per-request bearer verification;
- explicit `runId`, `sessionId`, artifact ids, and cursors for application
  state, each reauthorized.

### 4.2 Token and coarse scopes

The AS adapter normalizes JWT/introspection to:

```ts
type VerifiedMcpAccessToken = {
  issuer: string
  clientId: string
  tokenId?: string
  subjectId: string           // human user id
  originGrantId: string       // exact host grant record id
  workspaceId: string         // bound by grant, never caller-selected
  audience: readonly string[]
  scopes: ReadonlySet<McpAccessScope>
  expiresAt: number
}

type McpAccessScope =
  | 'agents:read'
  | 'tools:call'
  | 'agents:run'
```

Every MCP Access grant and refresh token family includes baseline
`agents:read`; it cannot be dropped. `tools:call` and `agents:run` are optional
additive grants and are independently selectable.

| Operation | Required grant |
| --- | --- |
| initialize/discovery, `agent_models_list`, `agent_run_status`, resources list/read, safe app/account status | baseline `agents:read` |
| `agent_tool_call` | `agents:read` + `tools:call` |
| `agent_run`, `agent_run_cancel` | `agents:read` + `agents:run` |

App extras choose one of these three scopes according to effect; unknown scopes
fail construction. Partial-grant tests prove read-only, read+tools, read+runs,
and all-three behavior. Refresh preserves the baseline and cannot add an
optional scope. These scopes are coarse transport admission only. Current
membership, internal Seat authorization, effective tools, model capability,
and native policy remain fine-grained authority.

Invalid, expired, inactive, wrong-issuer, or wrong-resource tokens receive 401.
A valid active token missing the operation's coarse scope receives 403. Both
responses use the Bearer challenge fields required by the official sources
pinned in Slice 1; exact header syntax is intentionally not invented here.
MCP tool errors never substitute for these HTTP admission failures.

### 4.3 Shared wire shapes

```ts
type CursorPage<T> = { items: T[]; nextCursor?: string }

type AgentSummary = {
  agentId: string
  label: string
  description: string
  definitionDigest?: string   // opportunistic; never an availability gate
}

type ToolSummary = {
  agentId: string
  name: string
  description: string
  mayUseModel: boolean        // generic capability fact, never a credit claim
}

type ToolDescriptor = ToolSummary & {
  inputSchema: Record<string, unknown>
}

type ModelSummary = {
  provider: string
  id: string
  label: string
  available: true
  funding: {
    provenance: 'workspace' | 'personal' | 'platform-credits' | 'app'
    displayLabel: string
    rate?: { unit: string; amount: string; currencyOrCredits: string }
  }
}

type ArtifactRef =
  | {
      status: 'live'
      artifactId: string
      path: string
      uri: `share:///${string}`
      browserUrl: string
      mediaType?: string
      byteSize?: number
    }
  | {
      status: 'tombstoned'
      artifactId: string
      uri: `share:///${string}`
      browserUrl: string
      path?: never
    }

type ToolError = {
  code: string
  message: string
  retryable: boolean
  requestId?: string
  details?: Record<string, unknown> // per-code allowlisted schema only
}
```

Discovery never returns composed prompts, private instructions, instruction
locations, secrets, roots, or `toolCount`. A missing `definitionDigest` does
not hide an authorized Agent. Cursors are opaque and scoped to the current
human/workspace/query. `ToolError.details` is built only from a per-code
allowlisted schema; raw provider errors, stacks, paths, balances, headers, and
tokens are never copied through.

#### RequestKey, digest, and public run-id contract

Effect request ids are 1–128 ASCII characters matching
`[A-Za-z0-9._:-]+`. The canonical identity is always the complete frozen
RequestKey `(workspaceScopeId, authSubjectId, operation, target, requestId)`;
operation and target namespace otherwise identical caller nonces. C6 extends
its operation/target unions only as follows:

| Public action | C6 operation | Internal target | Admission behavior |
| --- | --- | --- | --- |
| direct tool | `agent.tool.execute` | `{kind:'seat-tool', seatId, agentId, nativeToolName}` | exact current object/revision is captured in digest |
| run in existing session | `session.prompt` | `{kind:'session', ref:{agentTypeId:agentId, sessionId}}` | existing session ownership is reauthorized before prepare |
| run without session | `agent.session.prompt.create` | `{kind:'seat', seatId, agentId}` | C6 admission atomically allocates and records `sessionId` in its receipt before dispatch; no second ledger/effect |
| cancel run | `run.cancel` | `{kind:'run', targetRunId}` | separate C6 effect whose own RequestKey projects to `cancelRunId`; replay/conflict/unknown-outcome rules apply |

The canonical payload digest is domain-separated by operation and covers
normalized public input plus all material server resolution: `agentId`,
`seatId`, authoritative runtime/definition identity even when public
`definitionDigest` is omitted, session, native tool name and schema/capability
revision, effective grants/readiness revision, and resolved model/default as
applicable. A resolution change therefore conflicts rather than replaying stale
authority. `originGrantId` is deliberately excluded from
RequestKey and digest so the same human can replay durable history after
reauthorization; the immutable grant that first admitted work remains stored as
provenance and is never overwritten.

Same complete RequestKey + same digest replays; same complete key + changed
digest conflicts; reuse of a nonce under another operation/target is a distinct
key. For cancel, the key is `(workspace, human, run.cancel,
{targetRunId}, requestId)` and its digest covers `targetRunId` plus the
reauthorized immutable target-run identity. Repeating that complete cancel key
and digest returns the same `cancelRunId` and receipt without issuing a second
cancel. A changed digest conflicts; the same request nonce aimed at a different
target run is a distinct RequestKey because the target differs.

Cancellation is advisory: `targetRunId` always identifies the Agent run being
stopped; `cancelRunId` identifies only the separate cancel effect. A
non-cooperative tool or external side effect may leave the target run completed,
failed, or `unknown-outcome`; `stopped: true` never claims an already-issued
external effect was reversed.

Public `runId` is a versioned, deterministic, opaque codec over the complete
RequestKey: a domain-separated SHA-256 digest of canonical key bytes, encoded
as bounded unpadded base64url with a fixed `brun_v1_` prefix. It is not raw JSON,
not reversible, not a second UUID, and is safe as one path segment. C6 keeps a
durable collision-checked `runId → complete RequestKey` index for authorized
lookup; this is an index over the one envelope, not a second ledger or identity.
`agent_run_status` accepts only a target Agent-run id (`session.prompt` or
`agent.session.prompt.create`); a `cancelRunId` is not a substitute and returns
the same non-disclosing run-not-found result as any wrong-kind id. Collision
handling fails closed. Raw `requestId` is never used in a path, URL, or log key.

### 4.4 Standard tools

Apps expose these standard names; static extras may be composed at construction
and collisions fail.

#### `agents_search`

```ts
input  = { query?: string, cursor?: string }
output = CursorPage<AgentSummary>
```

Lists only Agents currently available to the human in the selected workspace.

#### `agent_get`

```ts
input  = { agentId: string }
output = { agent: AgentSummary }
```

Unknown and unauthorized use the same `AGENT_NOT_FOUND` tool error.

#### `agent_tools_list`

```ts
input  = { agentId: string, query?: string, cursor?: string }
output = CursorPage<ToolSummary>
```

Compact summaries come from the exact resolved native catalog after internal
Seat resolution and effective-capability intersection.

#### `agent_tool_get`

```ts
input  = { agentId: string, toolName: string }
output = { tool: ToolDescriptor }
```

Returns current full JSON Schema on demand. There is no required schema digest
in `agent_tool_call`; the server validates against the current schema.

#### `agent_tool_call`

```ts
input = {
  agentId: string
  toolName: string
  arguments: Record<string, unknown>
  requestId: string
  sessionId?: string
}
output = {
  runId: string
  requestId: string
  agentId: string
  nativeToolName: string
  sessionId?: string
  content: Array<{ type: 'text'; text: string }>
  artifacts: ArtifactRef[]
  spilled: boolean
}
```

`runId` uses §4.3's canonical direct-effect RequestKey codec. The envelope
records server-resolved `seatId`, human `authSubjectId`, and immutable
`originGrantId`. Complete-key replay/conflict follows §4.3, including after
reauthorization. Revoking a grant aborts only active effects whose immutable
`originGrantId` matches it.

#### `agent_models_list`

```ts
input  = { agentId: string, cursor?: string }
output = CursorPage<ModelSummary> & {
  defaultModel?: { provider: string; id: string }
}
```

List and execution use the same A7 issuer and narrowing path but obtain a fresh
invocation-scoped capability independently on each call. Discovery is advisory;
`agent_run`'s freshly issued result is authoritative. No model-capability handle
or result is persisted. Ambient/process-cached Pi auth is neither source nor
fallback, and app policy may narrow but not widen each fresh issuer result.

#### `agent_run`

```ts
input = {
  agentId: string
  prompt: string
  requestId?: string
  sessionId?: string
  model?: { provider: string; id: string }
  mode?: 'wait' | 'background'
}
output = {
  runId: string
  requestId: string
  agentId: string
  sessionId: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'unknown-outcome'
  finalText?: string
  artifacts: ArtifactRef[]
  error?: ToolError
}
```

`wait` is default. `requestId` is optional: when omitted, the server mints the
operation nonce as part of the admission attempt and returns it with the
accepted result; a response lost before the client learns it is not safely
retryable, so clients needing lost-response replay supply their own. `wait` is
bounded by host policy and returns the current queued/running state when its
wait budget expires; `background` returns after durable admission. Closing the
transport cancels only the waiter, not durably accepted work. A supplied model
must be in the fresh A7 result issued for that `agent_run` invocation; omitted
uses that invocation's Agent/workspace default. Payer is never caller input.

#### `agent_run_status`

```ts
input  = { runId: string } // target Agent-run id; never cancelRunId
output = agent_run output
```

Status remains target-run based: it accepts only the `runId` returned by
`agent_run`, reauthorizes the current human/workspace, and can expose prior
durable human-owned history after reauthorization. It does not acquire a
runtime, restart work, or report a cancel-effect envelope.

#### `agent_run_cancel`

```ts
input = {
  targetRunId: string
  requestId: string
}
output = {
  targetRunId: string
  cancelRunId: string
  cancelStatus: 'completed' | 'unknown-outcome'
  targetStatus: 'canceled' | 'completed' | 'failed' | 'unknown-outcome'
  stopped: boolean
}
```

This handler cannot enable until C6 provides run-targeted cancel. It creates the
separate `run.cancel` effect in §4.3: `targetRunId` selects the authorized Agent
run, while `cancelRunId` is the deterministic projection of the cancel effect's
own complete RequestKey. Same complete key/digest replays the identical output;
a changed digest conflicts; a crash before authoritative cancel settlement
returns `cancelStatus: 'unknown-outcome'` and never silently issues another
cancel. Target status remains queryable only through
`agent_run_status({runId: targetRunId})`. Current session-wide stop is forbidden
because it could stop unrelated work.

### 4.5 Seneca extension

Seneca adds construction-time `credits_status` under `agents:read`:

```ts
input  = {}
output = {
  enabled: boolean
  balance?: string
  unit?: string
  addCreditsUrl?: string
}
```

Commercial fields remain Seneca-owned. Any URL is allowlisted HTTPS and carries
no token or secret.

## 5. OAuth and transport flows

### Authorization Code + PKCE

1. Client discovers protected-resource metadata and RFC 8414 AS metadata using
   the Slice-1-pinned MCP authorization revision.
2. Client uses the Slice-1-selected registration strategy and exact canonical
   resource. Manual preregistration is a deployment choice, not a universal MCP
   requirement.
3. The code flow uses RFC 7636 PKCE S256. Exact redirect matching, state, and
   RFC 9207 issuer-response validation (when selected) are attributed and tested
   against their own OAuth sources, not mislabeled as PKCE behavior.
4. Browser approval selects one currently accessible workspace and creates one
   grant record with immutable identity fields `{originGrantId, subjectId,
   clientId, workspaceId, resource, grantedScopes}` plus mutable lifecycle
   state (`active`/`revoked`, timestamps). Tokens and secrets are not stored in
   application audit payloads.
5. Token is resource/audience-bound and carries or introspects that grant id.
6. Boring requires exact equality between verified token facts and the current
   grant record, then checks current membership on every request.

A second workspace requires a second authorization. Refresh cannot widen human,
workspace, resource, or scopes.

### Headless RFC 8628 device flow

Device flow is an opt-in AS/client extension:

1. Client obtains device/user codes; canonical-resource propagation is an RFC
   8707 plus deployed-Hydra integration requirement, not a guarantee of RFC
   8628 alone.
2. It displays verification URL/code and respects expiry/poll interval.
3. User opens the browser, authenticates, selects one workspace, approves, and
   may close the page.
4. Client polls while honoring pending, slow-down, denial, and expiry.
5. Boring accepts the token only if the deployed Hydra version proves exact
   resource/audience and `originGrantId` propagation.

Hydra source proves device-grant support, not this resource propagation; the
integration test is release-blocking for headless support.

### Logout, token revocation, product disconnect, and race fence

- Plain network disconnect cancels neither the grant nor accepted work.
- AS/browser-session logout ends that login session only. It does not revoke an
  MCP connection or already-issued tokens.
- RFC 7009 token revocation asks Hydra to revoke a token; Slice 7 records and
  tests the exact access/refresh-token-family behavior of the deployed Hydra
  version. It does not by itself imply application-grant deactivation or
  immediate resource-server notification.
- Product **disconnect** is the connection-revocation contract: the app
  atomically marks `originGrantId` inactive, increments its A8 epoch/fence, and
  asks Hydra to revoke all associated refresh/access tokens. New admission
  reads the active grant/epoch in the same authorization-to-C6 fence; a request
  racing disconnect either commits admission under the prior epoch and is then
  targeted by revocation, or fails before admission—never escapes both.
- Boring rejects new calls, closes matching streams, and run-target-cancels only
  active work indexed to that grant. Slice 1/7 freezes a measured maximum
  propagation bound for introspection/cache expiry plus app event/callback if
  proven; no unproven Hydra webhook is claimed.
- Membership removal denies all grants for that human/workspace and safely
  stops active work under the host revocation mechanism.
- Reauthorization creates a new `originGrantId` but preserves access to durable
  human-owned workspace history.

V1 requires the disconnect API/operation but not a polished connections screen.
AS logout is not represented as disconnect.

## 6. Authorization and effective capability

Every operation follows:

```text
Host/Origin -> bearer/resource/coarse scope -> active originGrantId
-> human subject -> workspace exists/current app/not deleted
-> current membership -> public agentId -> unique authorized internal Seat
-> agent-declared ∩ workspace-granted binding -> operation validation
-> C6 admission for effects -> native tool or accepted Agent run
```

Rules:

- Read-only discovery creates no session, ledger effect, or model run.
- All effective resident native tools are the target: list/grep/read/write/edit/
  bash, custom, and granted outbound-Connector tools. A bounded catalog's
  provider operations are not falsely materialized as resident `AgentTool`s;
  its native search/describe/proposal tools are exposed instead.
- Existing readiness, sandbox, environment, network, tool policy, outbound MCP
  grants, provider/account authority, and C5/C2 approval/child policy remain
  authoritative.
- No persistent MCP per-tool allowlist or new MCP-Access approval system.
  Existing approval required by the invoked native tool or Connector still
  applies and cannot be bypassed.
- Optional `sessionId` must belong to the same human/workspace/Agent binding.
- Sessionless tools receive no fake session. A truly session-required tool
  returns a stable error.
- A native tool that may use an LLM is withheld only until host-owned
  classification and actual-usage reporting are available. This is a
  qualification failure, not a product ACL.

## 7. Native direct-tool execution and identity

P0.4/Agent owns one resolved native-tool catalog. It must:

- reject duplicate canonical names before serving;
- retain the exact original `AgentTool` object;
- carry current schema and host-owned deterministic/may-use-LLM classification;
- evaluate `readinessRequirements` against canonical readiness;
- be the single snapshot used by list/get/call.

Execution:

1. authorize human/workspace/`agentId` and resolve the unique internal Seat;
2. resolve the existing runtime binding and exact catalog object;
3. enforce readiness before C6 admission;
4. validate arguments against current schema;
5. admit one effect with human `authSubjectId`, internal `seatId`, and immutable
   `originGrantId` provenance;
6. invoke that exact object's `execute` once with trusted context;
7. preserve abort/update/native identity and map bounded results.

Trusted `ToolExecContext` derives user/workspace/session/request only from host
facts. Ordinary request closure aborts pre-admission work or the waiter after
admission. Revocation/host shutdown owns accepted-effect abort. Same-key replay
returns durable result or `unknown-outcome`, never a second non-idempotent
execution.

Audit/usage/artifact provenance records `{runId, originGrantId, subjectId,
workspaceId, seatId, agentId, nativeToolName, definitionDigest?}`. The public
result stays Agent-oriented and does not require `seatId`.

Direct deterministic tools invoke no model. A may-use-LLM tool reports actual
usage through a host-bound generic usage hook keyed to the canonical `runId`;
it cannot choose payer or run identity. Until instrumented, it is not externally
qualified. Outbound paid tools may also use app/provider billing.

For Connector-backed tools, “same native object” means the resident Agent tool,
not every provider-catalog child it may propose. Read-only catalog search and
describe can execute through that object. An effectful proposal such as #900's
future `mcp_tool_call` is externally qualified only after its own canonical
C5×C6 handoff and C2 predecessor closure are conformance-green. The outer
`agent_tool_call` may be the parent invocation, but it must not flatten the
provider operation: the real child retains C2's canonical identity, approval,
metering, audit, and terminal evidence. #806 consumes that contract unchanged
and defines no issue-local child event or second ledger. An inbound disconnect
or `originGrantId` revocation targets accepted work through canonical
cancellation; it never claims that an already-sent provider effect was reversed.

## 8. Agent-run lifecycle and durability

MCP does not wrap today's prompt-acceptance receipt in a second ledger. C6 first
lands one general accepted-run seam:

```text
prepared -> admitted -> in-flight
         -> rejected
in-flight -> completed | failed | canceled | unknown-outcome
```

For an existing session, canonical `session.prompt` remains in-flight until an
authoritative terminal Agent record event. For a sessionless public request,
`agent.session.prompt.create` atomically records its allocated `sessionId` in
the same admission receipt before dispatch; it does not nest `session.create`
and `session.prompt` ledgers. `runId` is §4.3's projection of the applicable
complete RequestKey. C6 stores human subject, workspace, internal Seat,
Agent/definition, resolved model, session, `originGrantId`, usage linkage,
bounded result/artifacts, and safe outcome.

Required behavior:

- complete RequestKey + same canonical digest replays; changed digest conflicts;
- terminal status survives configured durable-store restart;
- process crash does not imply mid-turn resumption; unreconciled effects become
  `unknown-outcome` and are never silently retried;
- run-targeted cancel does not stop another run in the same session;
- revocation indexes active work by `originGrantId` without changing human
  ownership of durable history;
- production fails startup with only process-local run/share stores;
- SQLite proof is single-node unless a shared adapter proves multiple replicas.

## 9. Models, funding, usage, and credits

Boring:

- projects only A7 invocation-scoped model capability;
- permits app policy to narrow, never widen;
- projects app-authored funding facts without interpreting price;
- threads RequestKey-derived `runId` through Agent and native-tool usage;
- emits generic reserve/record/settle/release facts and stable payment errors.

Seneca resolves payer from authenticated facts and owns balances, rates,
checkout, offers, and add-credit URL. Payer never appears in MCP input.

`PAYMENT_REQUIRED` is an MCP tool error (`isError: true`), not an HTTP redirect
or raw HTTP 402. It carries a safe app-authored add-credits URL when available.
After funding, retry uses a new requestId. This plan does not implement x402.

## 10. Live artifacts and large-result spill

A live artifact returns:

- normalized same-workspace relative `path`;
- opaque durable `artifactId`;
- `share:///<artifactId>`;
- host-built authenticated HTTPS `/a/<artifactId>` URL;
- optional safe media/size metadata.

The browser URL uses normal app session/membership and never an MCP token. MCP
resource reads use bearer plus current membership. Deleted targets return the
`tombstoned` union variant with no path. Foreign/nonexistent ids are
indistinguishable. Cross-workspace immutable transfer is separate work.

Prefer native pagination/limits. Never silently truncate. Oversized faithful
results may spill through the authorized workspace adapter:

- images: `assets/images/`;
- generic: `assets/artifacts/<opaque-runId>/`.

The segment is only §4.3's bounded `runId`, never raw `requestId`. Creation and
every dereference go through the authorized Workspace adapter's containment
checks; lexical normalization alone is insufficient. Exact/over tests cover
absolute paths, both separators, traversal/encoding, symlink escape and swap
races, adapter TOCTOU behavior, and cross-workspace handles.

Return a live artifact plus compact explanation. If faithful spill is
impossible, return `RESULT_TOO_LARGE` without partial success.

Slice 2 freezes measured caps using current code as the starting point: current
brief 32 KiB, final text 96 KiB, share read 256 KiB, and serialized result
384 KiB. Any new progress/page/artifact caps must be named, boundary-tested, and
justified in that slice rather than accumulated as speculative prose here.

## 11. Errors, security, and privacy

Protocol/auth errors use the pinned transport/OAuth layer. Recoverable
Agent/tool/model/payment/result failures use MCP `isError: true`. Freeze stable
codes at implementation time for unauthorized/forbidden, Agent/tool/model/
session/run not found, invalid arguments, request conflict, payment required,
result too large, canceled, unknown outcome, rate limited, and internal error.

Security gates:

- TLS outside local tests; immutable configured resource and §4.1's fail-closed
  direct-TLS/trusted-proxy authority algorithm;
- §4.1's MCP/RFC source matrix, public metadata exception, per-request bearer
  verification, and exact challenge tests;
- exact present-Origin validation; explicitly allowed absent Origin for native
  clients; reject null/malformed/conflicting Origin;
- no token passthrough or credentials in URLs/logs/errors;
- no prompt/private-instruction/root exposure;
- reauthorize every cursor/session/run/artifact handle;
- bound body, schema depth/properties, concurrency, wait, output, and retention;
- reject prototype-pollution keys and unsafe/non-JSON serialization;
- audit safe identity/digest/outcome, not content by default;
- revocation reaches active streams and run-targeted cancellation.

## 12. Migration, deletion, and early removal of `/mcp/managed-agent`

### Authorized app-only deletion

Slice 0 first runs exact symbol/path/config searches, then removes only live
app-specific tracer integration:

- `apps/full-app/src/server/managedAgentMcp.ts`;
- imports/registration in `apps/full-app/src/server/main.ts` and `dev.ts`;
- `apps/full-app/src/server/__tests__/managedAgentMcp.test.ts`;
- related assertions in `production-safety.test.ts`;
- `apps/full-app/scripts/managed-agent-mcp-smoke.ts`;
- `smoke:mcp-managed-agent` in `apps/full-app/package.json`;
- four `BORING_MANAGED_AGENT_MCP_*` config/deployment references;
- current README/development/deployment-map claims, including
  `apps/full-app/README.md`, `docs/AGENT-DEVELOPMENT-MAP.md`, and
  `docs/DEPLOY-VERTICAL-AGENT.md` where exact audit confirms live references.

This deletion does not wait for `/mcp` replacement-first coexistence. The owner
explicitly supersedes that default for this dark, unnecessary tracer.

### Retained generic seams

Do not delete `packages/agent/src/server/mcp/**`, its public exports, share-entry
resources, AgentGateway, dispatcher, runtime projection, deep link, workspace,
or metering infrastructure wholesale. A generic helper may be removed only
after an exact internal/external consumer audit and separate deletion authority.
Historical issue/architecture references remain historical records unless their
own maintenance policy requires a narrow correction.

Rollback is reverting Slice 0 while keeping the old route dark. Static bearer
MCP is never a product rollback target.

### Data migration and deletion contract

- Slice 0 is code/config/docs removal only. It has no database migration and
  deletes no sessions, runs, artifacts, workspaces, credentials, or user data.
- OAuth grant deletion is logical revocation first. Physical pruning follows
  the AS/app retention policy only after active-token and audit requirements;
  it never deletes the human's workspace history. A later authorization gets a
  new `originGrantId`.
- Workspace or membership deletion immediately fails current authorization,
  closes affected streams, and cancels affected active runs through A8/C6.
  Existing run/artifact rows follow their owning workspace retention/deletion
  policy and are never reassigned to another workspace or grant.
- Deleting a share entry makes its opaque handle not found. Deleting only the
  referenced file yields a path-free tombstone. Neither operation deletes or
  snapshots unrelated workspace bytes.
- Any C6/C7/grant/share schema added by a feature slice requires an explicit
  versioned migration, old-binary compatibility decision, and rollback proof in
  that slice. Prefer additive nullable columns/tables and dual-read/write where
  old and new binaries overlap; destructive contraction waits until rollback
  and retention windows close. There is no blanket migration waiver merely
  because SQLite is used in a single-node proof.
- Production disablement/revocation is reversible and data-preserving. Product
  data erasure remains the owning app's authenticated deletion workflow, not an
  MCP tool.

## 13. Package and file impact

### `packages/agent`

- current-standard MCP Access protocol/schema/transport module;
- `CreatedAgentHost.registerMcpAccessRoutes(options)` as the single composer,
  closing over the same private runtime projection;
- generic injected authorized-Seat projection contract; Agent consumes but does
  not create or catalog Seats;
- resolved native-tool catalog and direct executor;
- C6 envelope consumption, origin-grant provenance/index, and A7 model
  projection;
- share/artifact mapping, bounds, safe errors, and conformance tests;
- exact SDK dependencies determined by Slice 1's official-spec spike.

### `packages/workspace`

- C7-owned Seat creation/catalog/grants and required internal
  `agentId` → authorized unique Seat projection;
- no native-tool implementation or MCP-specific ACL store.

### `packages/core`

- OAuth resource-server verifier/grant adapter;
- scope issuance with human `authSubjectId`;
- authenticated membership/workspace facts, adapter composition, revocation
  signal, and durable store wiring;
- authenticated `/a/:id` composition as needed.

### `apps/full-app`

- Slice 0 removes the dark legacy tracer;
- later dark `/mcp` composition, canonical URL/Host/Origin config, and real-host
  stock-client smoke.

### Seneca repository

- Hydra config and approval UI;
- funding/credits/`credits_status`;
- durable/shared topology, rollout, smoke, rollback.

Any new persistent schema requires an explicit forward/backward or dual-read
migration in the owning C6/C7/app slice.

## 14. Serial implementation slices (≤1500 added/modified production LOC each)

**Global gate:** every slice, including Slice 0, depends on (1) a landed owner
amendment to `docs/direction/DIRECTION.md` activating inbound #806 separately
from outbound #1011, (2) the §0 pointer migration, (3) this candidate's review/
owner acceptance, and (4) a separate owner-approved implementation tracker or
brief dispatching that exact slice. This does not make Slice 0 depend on P-1.
The combined planning PR alone dispatches nothing, and no issue-plan wording can
waive the global gate.

After that gate, slices execute in order; a named frozen prerequisite may land
beforehand but not reorder this chain. Each slice is independently reviewable
and capped at 1500 added/modified production LOC. Tests/docs do not count toward
that LOC cap but still count toward review breadth. Slice 0 is the explicit
deletion-only exception because removed LOC is not implementation breadth.
Split any feature slice before review if it exceeds the cap; do not waive it in
the PR.

### Slice 0 — Delete the dark app-only tracer (deletion-heavy)

**Depends on:** global direction gate; plan accepted; exact reference/config
audit. This removal-only slice is explicitly exempt from P-1 by the owner
ruling; no feature seam lands.

Delete only §12's app route/config/tests/smoke/docs. Preserve generic package
MCP/share exports and outbound Connectors.

**Acceptance:** exact searches find no live app route/config/script reference;
full-app build/typecheck/tests and generic Agent MCP/share/outbound Connector
tests remain green; audit records any external deployment reference.

**Rollback:** revert Slice 0; keep route disabled.

### Slice 1 — Freeze official transport and OAuth resource shell (~900 LOC)

**Depends on:** global direction gate; Slice 0; P-1.

Pin §4.1's official-source matrix, stock client and registration strategy, exact
SDK package/version/coexistence strategy, and normative transport behavior. Add
dark `/mcp` shell, public metadata, resource checks, fail-closed edge algorithm,
baseline/additive scopes, and injected `VerifiedMcpAccessToken` verifier. No
product handlers.

**Acceptance:** official conformance and stock-client tests prove methods/
streaming/notifications; public metadata versus protected handlers; missing/
invalid bearer and insufficient-scope challenges; baseline read plus each
partial grant and refresh non-widening; wrong issuer/expiry/audience/resource;
direct TLS, trusted proxy, untrusted/duplicate/conflicting forwarding,
HTTP/2 authority, aliases/ports, and present/absent/null/malformed Origin; no
handler before auth. Existing outbound Connectors remain green.

**Rollback:** unregister route and remove new dependencies.

### Slice 2 — Single composer, Agent discovery, and native catalog (~1450 LOC)

**Depends on:** global direction gate; 1; P0.4; Workspace-owned C7 authorized
Seat projection.

Land `CreatedAgentHost.registerMcpAccessRoutes(options)`, public Agent-oriented
schemas, safe discovery, opaque cursors, compact/full tool discovery, unique
native catalog, readiness, billing classification, and measured bounds. Effect
handlers remain disabled.

**Acceptance:** full Core-host test proves one Host, Core-issued human scope
after membership, `agentId`-only API, unique internal Seat, safe metadata,
optional digest, no prompt/`toolCount`, exact object retention, collision
failure, not-ready exclusion, schema-on-demand, path-free tombstone schema, and
no legacy call path. Ambiguous same-Agent Seats fail qualification and stop for
owner review.

**Rollback:** disable route; no effect persistence.

### Slice 3 — Project C6 direct native effects (~1350 LOC)

**Depends on:** global direction gate; 2; A8; C6 direct-effect admission;
Workspace-owned C7 provenance.

Implement `agent_tool_call` over the exact catalog object and canonical C6
identity, including schema/readiness, trusted context, abort/update, replay,
origin-grant provenance, bounds, and native identity.

**Acceptance:** representative deterministic read/write/edit/bash/custom and
already-direct Connector fixtures prove same object/runtime/workspace/sandbox;
complete-key replay, cross-operation nonce isolation, changed-resolution/digest
conflict, disconnect replay to result/unknown outcome, and revocation only for
matching active origin grant; internal seat/native audit and zero model calls.
A full-catalog fixture exposes only its resident search/describe/proposal tools;
provider children are absent from `agent_tools_list`. Any effectful proposal
remains unqualified until C2's complete canonical predecessor closure and the
Connector's C5×C6/C2 conformance are green, then proves parent/child identity
without a #806-specific event or approval store. One fake
non-direct `remote-worker` `SandboxProviderV1` fixture proves execution uses the
exact returned Workspace/Sandbox pair and that bearer, `originGrantId`, signing
authority, and reusable credentials never cross the provider/guest boundary.
Non-cooperative cancel settles honestly rather than claiming effect reversal.
Uninstrumented may-use-model tools remain unqualified.

**Rollback:** disable direct-call handler; discovery remains.

### Slice 4 — Project A7 models and C6 Agent runs (~1450 LOC)

**Depends on:** global direction gate; 3; A7; C5 then C6 authoritative
accepted-run/status/targeted cancel; Workspace-owned C7 session/Seat catalog.

Implement `agent_models_list`, `agent_run`, status, and run-targeted cancel over
general A7/C6/C7 seams. Do not use ambient model registry, prompt-acceptance as
terminal, a second ledger, or session-wide stop.

**Acceptance:** ambient auth canary absent; list/run use the same issuer/path
but fresh capabilities, with run authoritative; default/allowed/denied model;
new-session admission atomically records its session and existing-session target
is reauthorized; complete RequestKey/digest/runId codec and bounded request ids;
authoritative terminal; waiter disconnect; background/status after
reauthorization; `targetRunId`/`cancelRunId` separation, cancel replay/conflict/
crash, wrong-kind status denial, and targeted cancel leaving another
same-session run active; human/origin-grant/internal-seat/model/usage identity
aligns.

**Rollback:** disable run/model handlers; direct deterministic calls remain.

### Slice 5 — Revocation, durable artifacts, and spill (~1450 LOC)

**Depends on:** global direction gate; 4; A8; C6/C7 durable stores; Seneca
topology decision.

Wire grant and membership revocation to streams/active work, durable
`ShareEntryStore`, `share:///`, authenticated `/a/:id`, live/tombstone mapping,
and bounded workspace spill.

**Acceptance:** two grants for one human do not cross-revoke; new grant reads
human-owned prior status; member/workspace deletion denies all and targets only
matching active work; restart yields terminal or honest unknown; live edit,
share-entry deletion→not-found, target-file deletion→path-free tombstone, and
cross-workspace denial; normal browser session; no token URL; image/generic
spill; exact/over bounds; forward migration plus old-binary/rollback decision;
production rejects process-local stores. Cross-instance proof is required when
Seneca deploys multiple replicas.

**Rollback:** flag off; use C6/C7 store migration compatibility.

### Slice 6 — Generic usage/payment and Seneca extension seam (~1000 LOC)

**Depends on:** global direction gate; 4, 5.

Converge metering on RequestKey run id, add actual-usage reporting for qualified
LLM-using tools, app-authored funding facts, in-band `PAYMENT_REQUIRED`, safe
add-credit action, and construction-time extras.

**Acceptance:** deterministic zero LLM usage; instrumented LLM tool actual
usage under canonical run; no uninstrumented tool exposure; Agent run
reserve/record/settle/release; payer spoof impossible; payment before effect;
no HTTP redirect; new-request retry; extra-name collision. Seneca separately
proves `credits_status` and funding rows.

**Rollback:** omit extras/funding and disable paid models/tools.

### Slice 7 — Hydra flows and full-app replacement composition (~1400 LOC Boring/app)

**Depends on:** global direction gate; 1–6; A8; pinned Hydra integration
environment.

Compose Authorization Code + PKCE, one-workspace approval, refresh, distinct AS
logout/token revocation/product disconnect, optional device flow, and dark
full-app `/mcp` route through the single Host composer. Add stock-client
real-host smoke.

**Acceptance:** code+PKCE with correctly attributed state/redirect/issuer/
resource checks; one workspace; immutable baseline read scope and refresh
non-widening; tested RFC 7009 token-family behavior; AS logout does not
disconnect; product disconnect atomically fences admission, deactivates the
grant, propagates within a measured bound, and targets matching active work;
real Host/native/run/artifact flow. When device flow is enabled, prove pending/
slow-down/deny/expiry and exact resource audience before enablement; failed
propagation leaves device flow off and does not block PKCE-only release. No
legacy tracer/controller path.

**Rollback:** disable `/mcp`, revoke grants/clients; normal web and outbound
Connectors remain healthy.

### Slice 8 — Seneca release and production canary (separate repository/ops)

**Depends on:** global direction gate; 7; exact published Boring cohort;
security/standards/operations review; deployment approval.

Qualify tarballs then registry versions in a clean Seneca checkout; configure
Hydra, workspace approval, funding/credits, durable/shared stores, flags, and
runbook; canary one internal workspace before widening.

**Acceptance:** Seneca compile/typecheck/test/build/E2E; stock-client PKCE and,
only when enabled, headless device smoke; multiple Agents; direct native tools;
model run/credits; live artifact; disconnect/reconnect; product connection
revocation versus AS logout and human history; log canaries; executed
disable/restore rollback; exact package integrity.

**Rollback:** flag off and revoke grants while browser Agents, workspaces,
sessions, and outbound Connectors remain healthy.

## 15. Flags and rollback

- `BORING_EXTERNAL_WORKSPACE_MCP_ENABLED=0` by default.
- Temporary narrow rollout switches may disable direct calls, Agent runs, or
  device flow; they are not authorization systems.
- Enabled production fails closed without canonical resource, verifier,
  Host/Origin policy, membership/Agent resolver, finite admission/bounds,
  revocation propagation, and required durable stores.
- Primary rollback is flag off + revoke grants. It does not delete human
  workspace history.
- The removed static-bearer tracer is never a supported rollback target.

## 16. Test seams and proof

Use public seams:

- official MCP/RFC matrix conformance + pinned stock client;
- `CreatedAgentHost.registerMcpAccessRoutes` with a real Core host and one Host
  construction assertion;
- two humans/workspaces/grants/Agents and current membership store;
- exact native object/readiness/collision tests;
- C6/C7 accepted-run and kill/restart tests;
- A7 issuer with ambient-auth canary;
- share-entry resource/deep-link tests with durable adapter;
- Seneca Hydra/credits/full-app integration.

Expected command family, confirmed per PR:

```bash
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run test
pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter @hachej/boring-workspace run test
pnpm --filter @hachej/boring-core run typecheck
pnpm --filter @hachej/boring-core run test
pnpm --filter full-app run typecheck
pnpm --filter full-app run test
pnpm lint:invariants
pnpm audit:imports
git diff --check
```

Auth/transport/revocation receives independent security/standards review;
direct-tool/durability receives architecture review; implementation PRs receive
normal thermo review.

## 17. Acceptance and proof matrix

| Requirement | Automated proof | Release proof |
| --- | --- | --- |
| Direction, pointers, and frozen prerequisites | landed inbound-#806 `DIRECTION.md` amendment; three-pointer migration; P-1/P0.4/A7/A8/C5/C6/C7 receipts | exact landed revisions and canonical links |
| Early tracer deletion | exact reference audit; full-app/generic/Connector tests | deployment config audit |
| Current transport | official conformance + pinned stock client | client/version request trace |
| OAuth/resource/scopes | public metadata; RFC 6750 challenges; wrong issuer/aud/resource; immutable read baseline and partial-grant/refresh matrix | real Hydra code exchange |
| Human/grant identity | human authSubject; origin-grant active index; reauth history | revoke one connection, retain human history |
| Agent-only API | no public seatId; internal unique Seat attribution | real multi-Agent workspace |
| Safe discovery | no prompt/toolCount/private fields; optional digest | inspect real response |
| Native catalog | exact resident object, collision, readiness, current schema; no provider-child materialization | real direct and Connector discovery tools |
| Connector child boundary | C2 predecessor/conformance gate; native parent plus first-class child identity; existing approval; no flattening/second store | approved/denied/unknown provider operation retains parent/child audit |
| Direct durability | complete RequestKey/digest/runId codec; cross-operation isolation; disconnect/replay; no duplicate effect | reconnect to accepted call |
| Models | fresh A7 capability per list/run through same issuer/path; ambient auth absent | real allowed/denied models |
| Agent runs | terminal-not-acceptance; wait/background; target-only status; distinct targetRunId/cancelRunId; cancel replay/conflict | disconnect/reconnect real run |
| Revocation | AS logout/token revocation/product disconnect separated; race fence; grant-only active stop; membership-wide denial | real disconnect versus logout/token revoke/member removal |
| Artifacts | live path, tombstone no path, cross-workspace denial, spill | `/a/id` login + `share:///id` |
| Usage/credits | actual usage, canonical run id, payer anti-spoof | exhaust/add/retry |
| Privacy/bounds | token/root/prompt canaries; exact/over tests | production log query |
| Rollback | flag/store compatibility | disable/revoke/restore; web + Connectors healthy |

Issue completion requires every automated row and applicable release row;
package-only tests do not close #806.

## 18. Release and Seneca integration

1. Determine exact affected package cohort from landed code.
2. Pack/install tarballs in clean Seneca; audit exports and contents.
3. Publish normally and install exact registry versions/integrity.
4. Run Seneca compile/typecheck/test/build/E2E and real MCP smoke.
5. Deploy dark, run PKCE and, when enabled, headless flows, then
   logout/token-revocation/product-disconnect/history proof.
6. Execute flag-off/revoke rollback and restore before widening.

Release notes use **inbound MCP Access**, distinguish outbound MCP Connectors,
name the pinned protocol/client, and explain live same-workspace artifacts.

## 19. Non-goals

- Outbound Connector registration/issue #1011 completion.
- Public `seatId` selection or generic multi-Seat disambiguation.
- Per-tool OAuth scopes or a new fine-grained MCP ACL.
- Cross-workspace live access/transfer or a second ACL system.
- Prompt/private-instruction disclosure.
- Persistent MCP per-tool allowlist or new approval UI.
- Tool/model/runtime/Workspace/Sandbox/AgentGateway reimplementation.
- Re-specifying #900's Composio catalog, C5 approval, or C2 child contract inside
  #806.
- stdio or deprecated separate HTTP+SSE transport.
- OAuth AS inside Boring, arbitrary DCR/CIMD without deployed evidence.
- x402 or caller-supplied payer.
- Polished connection-management UI in v1.
- Mid-turn process-crash resumption or automatic retry of uncertain effects.
- Package reorganization or unrelated/generic MCP deletion.

## 20. Stop conditions and open blockers

Stop if:

- `DIRECTION.md` has not landed an owner amendment activating inbound #806
  separately from outbound #1011;
- the three §0 live authority pointers have not migrated to this candidate;
- feature Slice 1–8 lacks P-1 or its named P0.4/A7/A8/C5/C6/C7 prerequisite;
- official transport/client evidence contradicts the selected implementation;
- authorization depends on Host/tool input/session id or skips membership;
- public Agent resolution is ambiguous across multiple Seats;
- `authSubjectId` is synthetic grant identity rather than the human;
- `originGrantId` cannot target active revocation without owning human history;
- direct execution cannot use the same unique resident native object, readiness,
  and runtime binding;
- Connector execution would materialize provider children as resident tools,
  bypass existing C5/provider authority, flatten C2 child identity, or create a
  #806-specific child event/approval store;
- model listing/execution uses ambient Pi auth;
- terminal means prompt accepted, cancel is session-wide, or cancellation
  claims reversal of a non-cooperative/external effect;
- implementation creates a second ledger/runtime/model/tool/workspace authority;
- may-use-LLM tool lacks actual-usage reporting;
- artifact exposes root/cross-workspace/tombstone path or token URL, or uses raw
  request identity/path concatenation rather than Workspace containment;
- result silently truncates or production uses process-local required stores;
- Seneca pricing moves into generic Boring packages;
- Slice 0 audit proposes generic MCP/share deletion without separate authority;
- a feature slice exceeds 1500 added/modified production LOC without splitting.

Open implementation/external blockers, not product decisions:

1. Landing combined PR #1415 establishes planning authority. A separate
   owner-approved implementation tracker/brief is the first dispatch barrier
   for each slice. P-1 is then first for feature work, with
   P0.4/A7/A8/C5/C6/C7 gating named slices.
2. Hydra device-flow RFC 8707 resource/audience propagation must be proven only
   before device flow is enabled.
3. C6 needs the §4.3 operation/target additions, separate `originGrantId`
   provenance/active index, atomic new-session admission receipt, and
   run-targeted cancellation while retaining human `authSubjectId`.
4. Workspace/C7's actual internal Agent→authorized-unique-Seat projection must
   be verified when it lands.
5. Seneca shared-store/cross-replica revocation topology and measured revocation
   propagation bound must be chosen/proven.
6. Effectful full-catalog Connector tools remain externally unqualified until
   C2's complete canonical predecessor closure and the Connector-specific
   C5×C6/C2 conformance (including #900.2 for Composio) are green.

## 21. Exact next action

**Complete owner review of combined planning PR #1415, resolve its recorded
outbound Gate-1 owner decisions, and land it.** It atomically carries the
inbound #806 direction amendment, pointer migration, this plan, and the outbound
#900 Composio plan. Until it lands, neither plane gains new dispatch authority.

Afterward, create or approve the exact Slice 0 implementation tracker/brief;
only that separate action may dispatch its reference audit/deletion. Complete/
verify P-1 in parallel or next; Slice 1 additionally requires its own dispatch
approval and cannot start until both Slice 0 and P-1 are complete. Outbound
slices remain independently blocked by #900's named gates.

## 22. Planning review record

### Owner decisions preserved

- Public selectors remain `agentId` only; Workspace/C7 resolves and records
  internal `seatId`, and ambiguity returns to the owner.
- Scope names remain exactly `agents:read`, `tools:call`, and `agents:run`; the
  review clarified grant composition without adding a scope.
- Human `authSubjectId` remains distinct from immutable `originGrantId`.
- `agent_run.requestId` remains optional with the lost-response limitation in
  §4.4 and atomic new-session admission in §8.
- App-only tracer deletion remains independent Slice 0 and not gated by P-1;
  the sequencing authority amendment is a separate global dispatch gate.
- A7, C6/C7, collision-safe native identity, actual-usage metering, live
  same-workspace artifact paths, and Boring/Seneca commercial ownership remain
  as stated in §0.

### Independent review packet — revise; dispositions

Target: this file against
`origin/main@98619e9b84538de25cb3eab7c41c8f5af1dd77f8`. Verdict received:
**NOT READY / BLOCK**. This revision accepts every P0/P1 and material P2 from
Reviews 1–2:

| Finding | Severity | Disposition |
| --- | --- | --- |
| Issue plan cannot activate work under `DIRECTION.md` | P0 | Accepted: §0, global slice gate, stop conditions, and §21 require a landed inbound-#806 direction amendment before acceptance or dispatch. |
| RequestKey/run identity omitted operation/target and sessionless admission | P0 | Accepted: §4.3 freezes full key, four operation/target contracts, atomic new-session receipt, canonical digest, and opaque deterministic run-id codec. |
| Slice 3 promised active revocation without A8 | P1 | Accepted: A8 is now a Slice 3 dependency. |
| List/run cannot share one invocation-scoped A7 result | P1 | Accepted: fresh capability per call through one issuer/narrowing path; run is authoritative and no handle persists. |
| Seat ownership conflicted with frozen Q4 | P1 | Accepted: Workspace/C7 owns Seat catalog/grants/projection; Agent only consumes an injected generic contract; Core composes authenticated facts. |
| Generic wire leaked credit ontology | P1 | Accepted: removed Agent credit flag and replaced tool credit field with generic `mayUseModel`; Seneca retains credits. |
| Three scopes were unusable independently | P1 | Accepted: every grant has immutable `agents:read`; tool/run scopes are additive; partial/refresh tests added. |
| Logout, RFC 7009 revocation, and disconnect were conflated | P1 | Accepted: §5 separates all three, defines product disconnect, token-family proof, propagation bound, and admission race fence. |
| Bearer/metadata normative sources were too broad | P1 | Accepted: §4.1 adds MCP plus RFC 6750/9728/8707/8414/7636/9207/8628 matrix and public metadata exception. |
| Host/Origin/proxy algorithm was underspecified | P1 | Accepted: §4.1 freezes configured authority, immediate-peer trust, one forwarding format, conflict rejection, HTTP/2, and Origin behavior. |
| Digest/cancel replay was underspecified | P1 | Accepted: §4.3 defines domain-separated material digest, cross-operation behavior, cancel as C6 effect, and honest advisory outcomes. |
| Public runId/spill path was unsafe | P1 | Accepted: bounded SHA-256/base64url codec, bounded request ids, no raw nonce paths, and adapter containment/TOCTOU tests. |
| Sovereign sandbox assertion lacked non-direct proof | P2 | Accepted: Slice 3 adds a fake remote-worker `SandboxProviderV1` pair and credential-boundary canaries. |
| Optional device flow became release-mandatory | P2 | Accepted: Slices 7–8 and release proof qualify headless checks by enablement; failure leaves device off, not PKCE blocked. |
| Hydra was assigned the approval UI | P2 | Accepted: ownership now separates headless Hydra from Seneca/Boring login, consent, grant, and disconnect UI/API. |
| RFC attribution/registration boundary was loose | P2 | Accepted: §4.1/§5 attribute PKCE/device/resource/issuer behavior separately and require a selected stock-client registration strategy. |
| Generic `ToolError.details` was a privacy seam | material residual | Accepted: details are per-code allowlisted; raw provider/path/balance/token data is forbidden. |
| Cancellation may be non-cooperative | material residual | Accepted: §4.3 and Slice 3 prohibit claiming reversal and allow completed/failed/unknown outcomes. |

Review 3 did not run: `x-ai/grok-code-fast-1` was absent from the active model
registry, so it supplied no findings or approval. The earlier author self-check
remains provenance only.

### Final plan-gate follow-up — FAIL; dispositions applied

| Gate finding | Severity | Disposition |
| --- | --- | --- |
| `DIRECTION.md` still marks #806 reference-only | P0 | Accepted: combined PR #1415 now carries the explicit inbound+outbound direction amendment; this file remains candidate-only until that PR lands. |
| Old canonical pointers remain in #806/#807 docs | P1 | Accepted: combined PR #1415 now carries all three pointer migrations atomically with both plans. |
| Cancel target and cancel-effect identity were conflated | P1 | Accepted: §4.3 and §4.4 separate `targetRunId` from RequestKey-derived `cancelRunId`, define replay/conflict/unknown outcome, and keep `agent_run_status` target-run-only. |

### PR #1415 outbound-Connector alignment

Owner follow-up designated PR #1415 as the single combined inbound+outbound
MCP planning PR.
Accepted alignment: §0/§1/§6/§7 now distinguish the exact resident Connector
`AgentTool` from provider-catalog children; preserve existing C5/provider
approval; require C2's complete predecessor/conformance gate for effectful
full-catalog execution; retain canonical parent/child identity; reuse the
existing app-owned Connector runtime; and forbid a #806-specific child event,
approval store, or anonymous nested dispatch. PR #1415 remains unmerged and
BLOCKER, so neither plan is dispatch authority yet.

The review packet and follow-up gate are integrated, but this candidate remains
`ready-for-owner` with `first-blocker: combined-plan-merge`. Review does not
substitute for resolving PR #1415's recorded owner decisions, owner acceptance,
or landing the combined amendment and plans.

---
github: https://github.com/hachej/boring-ui/issues/900
issue: 900
state: needs-info
updated: 2026-08-27
flag: flag:boring-mcp-composio-catalog
track: owner
---

# gh-900 Thin full-catalog Composio MCP for Seneca

## Status and source reconciliation

This plan supersedes the 2026-07-22 implementation sequence in this file, but
not the owner's product scope. PR #1415 is now the owner's single combined MCP
planning PR: this file remains the canonical **outbound Composio Connector**
plan, while [`../806/external-workspace-mcp-plan.md`](../806/external-workspace-mcp-plan.md)
owns **inbound MCP Access**. The plans share canonical kernel seams but not
transport direction, grants, provider registration, or product UI. This plan
reconciles:

- issue #900 and its owner comments;
- capability proof PR #910 / `docs/issues/900/composio-capability-spike.md`;
- PR #946's revert/reland rule: do not re-merge #937; reland in smaller slices
  around one application-owned atomic runtime and deterministic lifecycle;
- draft PR #1309 at `dca76921154c1f7fd5a682f5a03ce3fe27fcad93`, including its
  mandatory thermo and overnight findings;
- issue #1226's executed OpenCode/pi finding that an outer `call_tool` loses the
  real child's identity and approval semantics;
- the frozen long-term contracts in `VISION.md`, `ARCHITECTURE-PLAN.md`,
  `RECONCILIATION.md`, and `V2-PORT-HANDBOOK.md`.

**Planning result:** the live capability proof is complete, but Gate 1 remains
**BLOCKED**. Discovery-only 900.1 must reland as three small serial PRs: shared
Composio transport custody, an app-owned search tracer, then exact describe and
live qualification. General execution is deliberately **not** implementable on
today's outer-tool bridge. 900.2 consumes C2 only after C2's complete canonical
predecessor closure is implemented and proven; it may not create issue-local
approval, accepted-work, or child-event substitutes. This dependency does not
supersede #900 with #1226.

## Problem statement

Seneca needs one sellable Composio integration, not one Boring template per app.
Composio must remain authoritative for apps, tools, schemas, managed auth,
connected accounts, and provider execution. Boring must add only:

- current-principal/workspace isolation;
- server-only operator-secret custody and exact origin policy;
- bounded, redacted discovery and results;
- exact provider/account/tool authority at effect admission;
- durable, one-use human approval; and
- honest accepted-work and `unknown-outcome` semantics.

Current main exposes curated Notion/Airtable sources. It lists a complete source
tool set and locally filters it, and `mcp_readonly_call` executes only old static
read allowlists. That cannot expose Composio's full catalog without context and
memory bloat. PR #937 attempted the full-catalog backend and was reverted. PR
#1309 rebuilt discovery, but remains unreachable from production composition
and has unresolved runtime ownership, shutdown, cache-fencing, account-contract,
rate-window, cleanup-isolation, secret-retention, and synthetic-probe defects.

The tempting generic fix—one model-facing `call_tool` that invokes the selected
provider tool inside its handler—is invalid. The real pi 0.80.7 spike in #1226
proved that call/result/persistence events retain only the outer name. That
would erase the Composio child's first-class identity, approve the wrapper rather
than the operation, and break renderer, metering, audit, and accepted-work
semantics. The frozen architecture therefore forbids this shortcut.

## User outcome

### Discovery outcome (900.1)

A Seneca user sees one **Composio** source. The Agent can:

1. learn that Composio exists from `mcp_servers_list` without loading provider
   signatures into the resident tool list;
2. call `mcp_tools_search` with a bounded query and receive current full
   signatures for at most 20 matching app-native tools;
3. call `mcp_tool_describe` for an exact returned tool and receive its current,
   bounded input/output schema and revision identity; and
4. never see or invoke Composio execution, connection-control, workbench, or bash
   meta-tools.

Discovery may work before an app account is connected. It reports connection
requirements; it does not claim execution authority or synthesize provider
health. Curated Notion/Airtable consumers behave exactly as they do on current
main unless they explicitly select catalog mode.

### Sellable execution outcome (future 900.2+)

After the execution prerequisites land, the user can connect one account per
Composio toolkit and the Agent can propose any protocol-valid app-native tool.
Every call requires one exact current-user approval. Approval dispatches one
first-class child operation through accepted-work. Denial, expiry, wrong
principal/session, replay, revocation, or revision drift dispatches zero
provider calls. A timeout after possible provider acceptance settles as
`unknown-outcome` and is never automatically retried.

## Scope decisions and rationale

| Decision | Contract | Rationale |
|---|---|---|
| Provider model | One host-derived full-catalog Composio service per `(workspaceId, userId)`; never rehydrate privileged catalog provenance from user settings | Owner scope; prevents a forged row from selecting operator-secret-backed behavior |
| Catalog availability | Catalog-service availability is flag/config/operator-secret state, independent of whether any toolkit account is connected | Search-before-connect is required; account status is execution authority, not service identity |
| Catalog authority | Composio search/schema meta-tools, called internally | Thin wrapper; provider remains source of truth |
| Context strategy | Resident source summary + query-driven full signatures; no direct-tool materialization | Takes the useful OpenCode pattern without its interpreter |
| 900.1 boundary | Search/describe only; every Composio app-native result is blocked | Discovery performs no child effect |
| 900.2 boundary | No outer dispatcher on today's pi lifecycle | #1226 executed proof and frozen C2 rule |
| Shared transport custody | Curated product semantics remain unchanged, but every Composio consumer uses one exact-origin, bounded, abortable protocol layer | Existing curated code accepts arbitrary HTTPS before forwarding the operator key; security cannot remain compatible with that defect |
| Identity | Future immutable child plan retains canonical provider/tool/account identity and consumes C2's public event interface unchanged | Renderer, authority, metering, audit, and accepted-work need real identity |
| Authority | Host-issued, invocation-scoped, only narrows; possession of a source row/catalog result is never authority | Frozen R1/V2 Authority invariant |
| Approval | C5 durable pause produces one-use authority/evidence through a crash-safe C5×C6 handoff | Frozen C5/V2 Approval contract |
| Outcome | Admit before dispatch; no ordinary side-effect retry; ambiguous effects are `unknown-outcome` | Frozen C6 contract |
| Accounts | Exactly one active owned account per toolkit; zero = auth required, multiple = fail closed | PR #910 live pin proof |
| Runtime | Exactly one discriminated, closeable app-owned runtime shared by route and Agent surfaces | PR #946/#1309 lifecycle requirement |
| Probe | Catalog probe is explicitly unsupported in 900.1; no synthetic success | Avoid inventing an incompatible probe DTO |
| Compatibility | Curated product policy/UI stays default; shared Composio transport security is hardened | Prevents product broadening without preserving an exploitable custody gap |
| Port alignment | Consume frozen Authority/Approval/Run/C2 contracts; no new durable kernel noun | V2 handbook and “no parallel abstraction” rule |
| Inbound Access boundary | #806 may expose only the exact resident Connector-facing `AgentTool`; it cannot materialize app-native provider children, bypass C5/provider authority, or flatten C2 identity | Keeps the combined PR coherent without merging inbound and outbound products |

## Architecture

```text
CURRENT PRINCIPAL + WORKSPACE (host authority)
            |
            v
 requireCatalogSource (recompute; never trust stored provenance)
            |
 discriminated app-owned BoringMcpRuntime
 [accepting -> closing -> closed-clean | closed-pending-cleanup]
            |
 route + Agent discovery surfaces share fair scheduler/cache/cleanup
            |
 private abortable Composio operation client
            |
 persist create intent -> provider POST -> promote Session ID to lease -> validate exact origin
            |
 unfiltered Session; workbench disabled; SEARCH + SCHEMA only
            |
 delete + verify 404 -> remove lease -> bounded blocked DTO

FUTURE EFFECT PATH (not 900.1)
 C2 plus complete canonical predecessor closure
   -> immutable RFC 8785-backed plan + invocation-scoped authorization
   -> C5 durable approval
   -> recoverable C5×C6 consume/admit handoff (RunId=RequestKey)
   -> C2 canonical first-class child execution interface
   -> exact pinned-account Composio dispatch, one attempt
   -> settled(result digest) OR unknown-outcome
```

### Why Composio meta-tools are safe for discovery but not execution

`COMPOSIO_SEARCH_TOOLS` and `COMPOSIO_GET_TOOL_SCHEMAS` are internal mechanism
calls. Their bounded output is returned through the already named discovery
tools, and they cannot mutate provider state. `COMPOSIO_MULTI_EXECUTE_TOOL`,
`COMPOSIO_MANAGE_CONNECTIONS`, `COMPOSIO_REMOTE_WORKBENCH`, and
`COMPOSIO_REMOTE_BASH_TOOL` are never registered in the Agent catalog or
accepted from model/browser input. Future app-native execution is a child
capability, not a nested anonymous helper call.

## Exact 900.1 interfaces

900.1 separates bounded Composio protocol parsing from runtime scheduling,
cache, cleanup, and app composition. The private protocol layer is shared by
curated and catalog modes; it is not a new generic MCP transport.

```ts
type ComposioCatalogToolRef = {
  provider: "composio"
  toolkit: string            // 1..128, /^[A-Za-z0-9_.-]+$/
  slug: string               // 1..128, existing MCP tool-name grammar
  version?: string           // 1..128 when present
  schemaHash: `sha256:${string}`
  sourceRevision: `sha256:${string}`
}

type ComposioCatalogSearchInput = {
  query: string              // trimmed, 1..256 Unicode scalar values
  limit?: number             // integer 1..20, default 10
}

type ComposioCatalogTool = {
  ref: ComposioCatalogToolRef
  title: string              // 1..256 scalar values
  description?: string       // <=4,000 scalar values
  inputSchema: unknown
  outputSchema?: unknown
  providerSupplied: true
  execution: "blocked-pending-900.2"
  blockedReasons: ["MCP_APPROVAL_EXECUTION_UNAVAILABLE"]
}

interface ComposioOperationClient {
  // Persists a create intent before POST. A returned Session ID is validated and
  // atomically promotes that intent to a cleanup lease before caller exposure.
  createSessionWithTrackedIntent(input: CreateSessionInput, activeSignal: AbortSignal): Promise<{
    sessionId: BoundedComposioSessionId
    untrustedEndpoint: string
    untrustedHeaders?: unknown
  }>
  trustEndpoint(session: UntrustedLeasedComposioSession): ExactComposioEndpoint
  listSessionTools(endpoint: ExactComposioEndpoint, activeSignal: AbortSignal): Promise<unknown>
  callCatalogMetaTool(endpoint: ExactComposioEndpoint, name: CatalogMetaTool, input: unknown, activeSignal: AbortSignal): Promise<unknown>
  // Uses a fresh bounded drain signal, never the already-aborted active signal.
  deleteAndVerifySession(sessionId: BoundedComposioSessionId, drainSignal: AbortSignal): Promise<void>
}

interface ComposioCleanupLeaseStore {
  // Persist before provider POST; intentId is also the provider idempotency or
  // reconciliation key when the selected provider mechanism supports one.
  putCreateIntent(intent: {
    intentId: string
    workspaceId: string
    userId: string
    sourceId: string
    projectRevision: string
    credentialRevision: string
    secretResolverHandle: string // opaque host handle, never the key
    createdAt: string
  }): Promise<void>
  // One transaction: retain intent on failure; never expose an unleased Session.
  promoteIntentToLease(intentId: string, sessionId: string): Promise<void>
  deleteLeaseAfterVerified404(sessionId: string): Promise<void>
  resolveIntentAfterProviderProof(intentId: string, evidenceDigest: string): Promise<void>
  listForStartupReconciliation(): Promise<{
    intents: readonly ComposioCreateIntent[]
    leases: readonly ComposioCleanupLease[]
  }>
}

interface ComposioCatalogRuntime {
  readonly state: "accepting" | "closing" | "closed-clean" | "closed-pending-cleanup"
  requireCatalogSource(actor: McpActor, sourceId: string): Promise<McpSource>
  searchTools(actor: McpActor, sourceId: string, input: ComposioCatalogSearchInput, signal?: AbortSignal): Promise<readonly ComposioCatalogTool[]>
  describeTool(actor: McpActor, sourceId: string, ref: Pick<ComposioCatalogToolRef, "toolkit" | "slug"> & {
    version?: string
    expectedSchemaHash?: string
    expectedSourceRevision?: string
  }, signal?: AbortSignal): Promise<{
    tool: ComposioCatalogTool
    schemaDrifted: boolean
    sourceDrifted: boolean
  }>
  close(): Promise<{
    state: "closed-clean" | "closed-pending-cleanup"
    attemptedCleanup: number
    unresolvedCleanup: number
  }>
}

type BoringMcpRuntime =
  | { mode: "curated"; close(): Promise<CloseReport> }
  | { mode: "composio-catalog"; catalog: ComposioCatalogRuntime; close(): Promise<CloseReport> }
```

`requireCatalogSource` is host authority, not structural dispatch. On every
request it recomputes the deterministic source ID and immutable fields from
host app configuration plus the authenticated actor, and rejects any mismatch.
Catalog source identity is never read from `__serverBoringMcpSourcesV1`.
Flag-on with a missing operator secret or cleanup-store binding fails startup;
it never synthesizes a connected source. The service may be available while
zero toolkit accounts are connected.

`createBoringMcpRuntime(config)` is called once by the host. Catalog mode makes
`catalog` required. `createAgentTools` and `registerRoutes` require that same
runtime and never construct a backend. The host installs one close hook.
`mcp_server_probe` returns stable `MCP_OPERATION_UNSUPPORTED` in 900.1; a future
probe requires a separately specified public DTO.

The existing generic `McpTransportClient` remains unchanged because it cannot
propagate cancellation. Catalog operations use the private operation-scoped
`ComposioOperationClient`. For curated calls, 900.1a must also plumb the current
caller signal through the Composio-specific handler/app-composition seam into
that private client; it cannot claim caller abort through the generic transport.
This narrow signal plumbing must be added to 900.1a's bead scope before that
bead is undeferred. Active I/O combines caller, 15-second deadline, and runtime-
close signals. Cleanup uses a **fresh** drain controller with its own 15-second
request deadline and 30-second close/startup-drain budget, so closing active work
does not abort the cleanup required by close. No request may mutate cache or
remove a cleanup lease after its active signal aborts.

### Public DTO mapping

`McpToolCatalogEntry` gains only reusable fields:

```ts
sourceRevision?: string
providerSupplied?: boolean
toolVersion?: string
outputSchema?: unknown
executionMode?: "direct" | "approval-required" | "blocked"
```

For 900.1 Composio entries, `enabled=false`, `risk="unknown"`,
`executionMode="blocked"`, and blocked reason
`MCP_APPROVAL_EXECUTION_UNAVAILABLE`. Search returns full bounded signatures,
including schema hash and source revision, in 900.1b. The canonical internal ref
is identity; the displayed name grants nothing.

## Bounds and transport contract

- One canonical validator permits production MCP/API origin only
  `https://backend.composio.dev`; HTTPS, no URL credentials, no redirects. All
  headers—including Session headers and `x-api-key`—are withheld until this
  check passes. Tests include `https://evil.example` in flag-off curated mode.
- Session response parsing accepts an opaque Session ID only when its UTF-8
  encoding is 1..256 bytes, it is valid Unicode without lone surrogates, and it
  contains no C0/C1 controls or DEL. The exact ID is durably leased before URL
  validation. Every cleanup URL uses strict path-segment percent-encoding; the
  raw ID is never interpolated into a path. Oversized/control/path-confusion IDs
  fail closed and must not produce an unaddressable durable record.
- Session POST: `mcp:true`, no `toolkits`, connection management enabled, raw
  `workbench:{enable:false}`. Echo and required/forbidden meta-tool inventory are
  verified.
- Operation deadline: 15 seconds, combined with caller abort and runtime-close
  abort; fetch abortion is observed, not simulated with `Promise.race`.
- Body: 512 KiB declared and streamed maximum.
- Search: query 1..256 scalar values; limit 1..20. No launch offset, pagination,
  or model-controlled provider-refresh knob.
- Toolkit/slug/version/title bounds are defined in the interface. Description
  <=4,000 scalar values.
- Each schema <=64 KiB canonical UTF-8 JSON, maximum depth 32 and maximum 4,096
  object/array nodes; plain-object input schema required. Cycles, accessors,
  non-JSON values, lone surrogates, and duplicate-normalization hazards fail.
- Cache: app ceiling 128 search + 128 describe entries, per-principal ceiling 32
  of each, per-source ceiling 16 of each, TTL 60 seconds. No secret, Session
  material, OAuth value, or raw body enters cache.
- Fair scheduler: global 4 active/16 queued; per-workspace 2 active/8 queued;
  per-principal 2 active/4 queued. Fixed-window admission occurs **before**
  queueing. Queues use hierarchical round-robin—workspace, then principal—one
  dispatch per nonempty child per round. “Tenant” means workspace. Given four
  active and sixteen queued operations with a 15-second hard operation deadline,
  an admitted workspace B request completes or receives its own provider error
  within the conservative global worst-case bound of 75 seconds (five waves),
  not 30 seconds.
- Cleanup breakers are partitioned by `(workspaceId,userId,sourceId)` with 16
  unresolved leases per principal and an honest app-wide emergency ceiling of
  128. A partition at cap blocks that partition. The app-wide ceiling blocks all
  new Composio admission and reports emergency-unhealthy; the plan does not
  claim unrelated work continues in that state.
- Rate: fixed-window 60 admissions/minute per exact principal/source; writes do
  not extend reset time.
- Provider text is untrusted. Public errors contain stable code, safe phase,
  numeric status when useful, and host request ID—never raw URL/path/query/body
  or Session data.

## Identity and authority contracts

### Discovery source provenance

The host derives the catalog source from authenticated `(workspaceId,userId)`,
app configuration, flag/config revision, and operator-project binding. A stored
row with `provider:"composio"` or `credentialProvider:"composio-managed"` is
never sufficient. `requireCatalogSource` recomputes deterministic ID, provider,
source kind, owner kind, subject algorithm version, and availability on every
request. Forged rows, cross-actor IDs, and cross-workspace IDs fail before any
secret resolution or provider call.

Catalog-service availability is distinct from toolkit account status. The
catalog source may be available for search with zero connected accounts;
execution remains account-required.

### Exact source revision fence

`sourceRevision` is the JCS digest of exactly:

```text
deterministic source ID
workspace ID + user ID
provider ID + source-kind version
owner kind
status + revocation epoch
catalog flag/config revision
Composio project revision + credential revision
subject-algorithm version
```

It explicitly excludes display name/label, timestamps, Session IDs, connected
account IDs, cache generation, and provider prose. Secret rotation, project
switch, revocation, config change, or subject-algorithm change produces a new
revision. Source A generation remains independent of source B.

### Account authority and subject migration (future execution prerequisite)

Discovery does not pin an account. Before 900.2, exact account selection parses
only used live fields: row ID, user ID, toolkit slug, active/disabled state, and
pagination consistency. It scans at most 5 pages, 100 rows/page, 500 rows total,
within one 15-second resolution deadline. A continuation beyond any ceiling,
inconsistent totals, or timeout fails closed with
`MCP_RESOURCE_LIMIT_EXCEEDED`; partial results are never used to select an
account. Zero complete results returns account-required; multiple returns
conflict; one is pinned and echoed, then re-resolved after approval.

Current production subjects are legacy plaintext `${workspaceId}:${userId}`.
900.1 does **not** change them. Before 900.2 the subject scheme becomes
versioned. Migration must inventory legacy and proposed subjects, quarantine
cross-subject duplicate toolkit accounts, and require explicit relink or an
owner-approved migration. Project/key/algorithm rotation defines discovery,
connect, revoke, rollback, and conflict behavior. An unkeyed digest is only
opaque formatting, not authority or secrecy.

## Runtime and cleanup state machines

### Startup and shutdown

```text
startup-draining --leases resolved--> accepting
       | unresolved retained durably       |
       +-----------------------------------+
accepting --close()--> closing --bounded active wait + every lease attempted-->
                         closed-clean | closed-pending-cleanup
```

`createSessionWithTrackedIntent` durably writes a bounded creation intent before
the provider POST. If the provider returns a Session ID, the client validates it
and atomically promotes the intent to a lease before returning any untrusted
endpoint/headers; callers cannot observe an unleased Session. The lease is
removed only after verified GET 404. A crash after provider acceptance but
before response parsing/promotion leaves an unresolved intent, not a false
clean state. Startup reconciles both intents and leases before new Composio
admission. If the store
cannot be opened/read, Composio startup fails closed with a stable storage-
unavailable error and admits no curated or catalog Session. `close()` stops
admission, aborts queued/active work, waits a bounded interval, then uses a fresh
bounded drain signal to attempt every known lease. It always resolves one
idempotent `CloseReport`; concurrent/repeated closes share it.
`closed-pending-cleanup` is an honest local terminal state when cleanup, create
intent, reconciliation, or store access remains unresolved. Durable intents and
leases survive process death and retry next startup. The runtime never reports
clean while either remains or the store/provider cannot prove absence.

The provider must supply and the owner must select at least one production
reconciliation mechanism: idempotent create keyed by `intentId`, authoritative
Session listing/lookup by that key, or a documented finite provider TTL plus an
operator sweep/proof procedure. Until live evidence proves one, unresolved
intents block Composio admission indefinitely and 900.1 cannot ship. A local
intent cannot prove whether the remote Session exists.

The canonical app-owned durable storage binding, versioned
`secretResolverHandle -> credential revision` resolution, and provider
creation-reconciliation mechanism are Gate 1 owner blockers; the runtime must
not invent an unreviewed JSON file, retain raw keys, or claim orphan freedom.

### Discovery operation

```text
requested
 -> host requireCatalogSource
 -> fixed-window/per-principal admission
 -> fair queue
 -> persist bounded create intent
 -> provider POST using selected idempotency/reconciliation key
 -> receive response; validate Session ID
 -> atomically promote intent to lease before endpoint/header exposure
 -> receive untrusted endpoint/headers
 -> exact endpoint trust
 -> Session/meta-tool invariant checks
 -> bounded search+schemas
 -> DTO/canary/source-fence validation
 -> delete + verify 404
 -> delete durable lease
 -> source-fenced cache write
 -> success
```

Failure after Session creation leaves either a valid durable lease or an
unresolved durable create intent. No unleased endpoint is trusted. Startup stays
non-accepting until provider reconciliation proves the intent absent or promotes
it to a concrete lease and cleans it. Cleanup failure changes the owning request to
`MCP_PROVIDER_CLEANUP_FAILED`; only its breaker partition is affected until the
app emergency ceiling is reached. Abort/timeout/close prevents late success,
cache write, or lease deletion.

### Cache fencing

Each source has `{sourceRevision,generation}`. Refresh is host-controlled and
increments only that source. A request captures both after authority checks. It
may write only while runtime is accepting and both still match. Secret rotation,
project switch, revocation, and source change invalidate before write.

### Probe semantics

Catalog-mode `mcp_server_probe` returns `MCP_OPERATION_UNSUPPORTED` throughout
900.1. Search/describe themselves prove provider interaction. No
`{tools:[],resources:[]}` synthetic success and no incompatible health DTO.

## Future execution prerequisites (not Slice 900.1)

900.2 consumes **C2 plus its complete canonical predecessor closure**, as
ratified at implementation time. The minimum named path is:

```text
P-1 barrier
  -> all canonical upstream items needed by C3/C7
  -> C3 claim-based transport scope
  -> C5 durable pause
  -> C6 accepted-work + commit protocol
  -> C1 exec projection/protocol merge
  -> C2 first-class child execution

A2a -> A2b/C7 host session catalog -----------------------> C2
```

The closure also includes every remaining incoming edge in the frozen canonical
DAG (including A0/A1/A7/A8/A2a/C7 where the DAG makes it applicable) and any
ratified successor amendments. This plan does not shorten, reorder, or duplicate
that graph. Placeholder issue-local beads are not proof that predecessors exist.
The architecture Steward must provide exact bead/PR/conformance references
before 900.2 becomes `ready-for-agent`.

### Required semantic conformance from C2

900.2 consumes C2's eventual canonical public event and authorization interfaces
**unchanged**. This plan defines no issue-local child-event type. Conformance
must show the real Composio child slug, parent call identity, `RunId=RequestKey`, and
plan digest through call, paired result, durable record, renderer, metering, and
audit; pre-call authorization must operate on the real child. Today's canonical
chat events and C2's final contract—not an issue-local event spelling—govern
wire fields.

### Required C5×C6 durable handoff

C5 approval consumption and C6 admission need one transaction or recoverable
outbox binding `{approvalRef, RequestKey, planDigest}`. The handoff must make
approval reservation/consumption and `admitted` recording recoverable as one
state transition before child dispatch. There can be no crash gap where approval
is consumed but no Run exists.

Conformance fault-injects every boundary:

```text
approval answered
 -> handoff intent persisted
 -> approval reserved/consumed
 -> admitted envelope appended
 -> child call event appended
 -> provider send begins
 -> provider response/result event
 -> terminal envelope settlement
```

After each crash, recovery must deterministically resume the handoff, settle from
recorded evidence, or mark admitted ambiguous work `unknown-outcome`; it never
re-prompts or redispatches ordinary effects. Disabling execution flags stops new
admission only. Reconciliation of accepted work and cleanup continues.

### Invocation-scoped authority

The closure supplies host-issued execution context and revocation epochs. No
ambient env, provider metadata, catalog ref, account ID, or browser/model value
widens authority. C5's existing Ask User UI/store may be a compatibility
projection, but 900.2 cannot create an MCP-specific approval store or treat the
current process-local coordinator as durable authority.

## 900.2 execution contract (after prerequisites)

The model-facing `mcp_tool_call` is a proposal/admission surface, not an
anonymous dispatcher. Its exact input is:

```ts
type McpToolCallInput = {
  sourceId: string
  tool: {
    toolkit: string
    slug: string
    version?: string
    expectedSchemaHash: string
    expectedSourceRevision: string
  }
  arguments: unknown
}
```

The server converts arguments once to RFC 8785 JSON Canonicalization Scheme
(JCS) bytes. It rejects lone surrogates, non-finite numbers, `-0` ambiguity,
non-JSON/accessor/cyclic values, and all inputs that cannot round-trip through
the shared implementation. Approval display, argument digest, plan digest,
durable handoff, admission, and provider decode all consume those exact bytes;
no layer reserializes or adds defaults. Cross-process vectors cover Unicode,
escapes, exponent forms, key ordering, and numbers. Bidi/control characters are
losslessly escaped and visibly marked in approval UI. The server then
re-describes the exact tool, resolves the account, classifies the call
`approval-required`, and creates an immutable plan. The approval form uses only server-authored labels
and losslessly renders the canonical arguments. Provider prose/HTML/Markdown is
untrusted and cannot become instruction or policy.

```text
proposed
 -> validated-plan
 -> authorized-before-pause
 -> waiting-for-approval
 -> denied/expired/cancelled/stale (terminal, zero dispatch)
 OR approved(ApprovalRef)
 -> revalidate all revisions and principal/session
 -> durable C5×C6 handoff binds approvalRef + RequestKey + planDigest
 -> recoverably consume approval and append admitted(RunId=RequestKey, planDigest)
 -> first-class child dispatch (one attempt)
 -> settled-success | settled-failure | unknown-outcome
```

The approval binding includes actor/principal, workspace, Agent session,
parent/child tool-call IDs, source/account, toolkit/slug/version, schema,
policy/source/account/authority revisions, canonical argument digest, plan
digest, and expiry. Replay and concurrent consume have one winner. Revocation
before admission yields stale/denied with zero provider calls. Abort after
admission cannot assert non-execution; reconciliation determines terminal or
`unknown-outcome`.

`mcp_readonly_call` remains curated-only compatibility. It must never execute a
full-catalog Composio tool. Optional verified direct reads remain post-launch
and require a separate evidence-backed policy decision and flag.

## Failure semantics and stable errors

Add/freeze stable MCP codes (exact strings may use the existing registry naming
style):

- `MCP_CATALOG_QUERY_REQUIRED`, `MCP_CATALOG_METADATA_INVALID`,
  `MCP_OPERATION_UNSUPPORTED`;
- `MCP_CONNECTED_ACCOUNT_REQUIRED`, `MCP_CONNECTED_ACCOUNT_CONFLICT`;
- `MCP_PROVIDER_CLEANUP_FAILED`, existing provider timeout/error/resource and
  secret-leak codes;
- `MCP_APPROVAL_EXECUTION_UNAVAILABLE`, `MCP_APPROVAL_DENIED`,
  `MCP_APPROVAL_STALE`, `MCP_APPROVAL_EXPIRED`, `MCP_APPROVAL_CONFLICT`;
- `MCP_OUTCOME_UNKNOWN`.

| Failure point | Public result | Provider execution count |
|---|---|---:|
| Invalid query/schema/provider metadata | stable validation/catalog error | 0 app-native |
| Wrong actor/source or revoked source | not found/forbidden without existence leak | 0 |
| Session origin/workbench/meta-tool invariant fails | provider config error; cleanup attempted | 0 |
| Discovery timeout | provider timeout; cleanup attempted | 0 app-native |
| Session cleanup not verified | cleanup failed; no successful DTO | 0 app-native |
| Missing/multiple account | account required/conflict | 0 |
| Approval denied/cancelled/expired/wrong owner/replay/stale | matching stable approval error | 0 |
| Provider rejects before acceptance | settled provider failure | 1 attempt |
| Timeout/disconnect after dispatch may have been accepted | `MCP_OUTCOME_UNKNOWN` | 1 attempt; 0 retries |
| Restart with admitted work and no terminal child evidence | reconciled `unknown-outcome` | 0 automatic retries |

Audit/envelope records are value-free: IDs/digests/revisions, effect/outcome,
timestamps, safe provider code/status, and request ID. They do not contain
arguments, provider result values, API key, OAuth/session credentials, or raw
provider bodies. The durable approval UI may store the exact displayed business
arguments under its protected store contract, but never provider/operator
secrets or an executable approval capability.

## Flag, migration, rollout, and rollback

### Flag / abstraction

- **Needed:** yes.
- Existing outer switch: `BORING_MCP_PROD_ENABLED`.
- New catalog capability: `BORING_MCP_COMPOSIO_CATALOG_ENABLED=1` (server
  authoritative; exposed to UI through capability DTO).
- Future execution: `BORING_MCP_APPROVAL_EXECUTION_ENABLED=1`, unavailable until
  C2's complete canonical predecessor closure and 900.2 are present.
- No direct-read flag in launch scope.
- Abstraction path: discriminated `curated|composio-catalog` app runtime; catalog
  mode requires its catalog member. Generic `McpTransportClient` remains
  unchanged; the private Composio operation client owns abortable provider I/O.

### Migration

Discovery-only 900.1 requires no account credential migration. Existing stored
Notion/Airtable rows remain readable and keep curated product semantics while
the shared Composio transport is security-hardened. Catalog identity is
host-derived and never stored as privileged provenance. 900.2 **does** require
the versioned legacy-subject inventory/quarantine/relink or owner-approved
migration described above. Do not auto-promote personal authority. Any later shared-credential migration inventories/quarantines
personal sources and requires explicit owner policy.

PR #1309 is evidence/quarry, not a merge candidate. Reuse tests and verified
wire controls selectively; do not preserve its 788-line backend shape merely to
reduce diff. In particular remove the invented `word_id` contract, global cache
generation, sliding rate window, request-blocking cleanup drain, raw-secret
cleanup map, synthetic probe, and implicit optional construction.

### Rollout

1. Resolve Gate 1 owner blockers, assign Definition-of-Ready beads, and obtain
   clean independent T1 review.
2. Land 900.1a shared custody, 900.1b search tracer, then 900.1c exact describe;
   keep execution blocked.
3. Qualify package tarballs in Seneca; enable discovery for a synthetic user and
   disposable provider project only.
4. Complete C2's full canonical predecessor closure and conformance, then plan
   the subject migration and implement 900.2.
5. Implement one-Composio UI and connections after stable backend contracts.
6. Release/pin exact package versions in Seneca; enable flags in order:
   outer MCP -> catalog -> approval execution.
7. Prove managed auth, provider-setup-required, exact account, approval matrices,
   unknown outcome, revoke, and secret absence with test accounts.
8. Seneca #36 owns reversible domain cutover; boring-ui #877 retains legacy
   archive/deletion/billing gates.

### Rollback

1. Disable approval execution: discovery remains; all calls fail closed.
2. Disable catalog: curated consumers remain; Seneca hides Composio rather than
   pretending an unavailable catalog works.
3. Disable outer MCP: core Seneca/Ask User remain.
4. Close runtime: stop admission, abort/await bounded active work, attempt every
   durable cleanup lease, and report `closed-pending-cleanup` honestly when any
   remains; do not retry ambiguous app-native execution.

Rollback does not rewrite source authority, reconnect revoked accounts, delete
user data, retry effects, or promote personal credentials.

## Test seams

### Highest public seams

1. shared private Composio protocol client used by curated and catalog modes;
2. fake Composio HTTP + real MCP SDK fake Streamable HTTP with observed aborts;
3. host-only `requireCatalogSource` and discriminated app runtime;
4. durable create-intent/cleanup-lease store plus provider reconciliation across process restart;
5. fair scheduler under two-principal saturation;
6. source/catalog/bridge DTOs; and
7. future C2 plus complete predecessor conformance and clean Seneca tarball E2E.

### Mandatory 900.1 fault and mutation tests

- flag-off curated Session URL `https://evil.example` fails before any operator
  or Session header is forwarded;
- deleting the exact-origin guard makes the test fail;
- create intent is durable before POST; any bounded returned Session ID is
  promoted to a lease before malformed/evil endpoint rejection;
- oversized, control, lone-surrogate and path-confusion Session IDs fail; every
  cleanup path uses strict segment encoding;
- durable-store unreadable at startup admits no Composio Session;
- forged user-settings Composio row, wrong deterministic ID, cross-user and
  cross-workspace source all fail before secret/provider access;
- flag-on missing secret or cleanup store fails startup;
- workspace A fills active/queue quota while workspace B completes or receives
  its own provider error within the 75-second global worst-case bound;
- per-partition cleanup cap does not block B; app emergency ceiling honestly
  blocks all admission;
- kill before POST, after provider acceptance, after HTTP response but before
  intent promotion, and after promotion; restart must reconcile/prove absence or
  remain blocked, then verify 404 and delete the lease;
- repeated/concurrent close returns the same clean/pending report;
- timeout/abort/close is observed by fetch and produces no late success, cache
  write, or lease deletion;
- source A refresh cannot suppress B cache write;
- secret rotation, project switch, revocation, config change, and subject-version
  change invalidate revisions;
- exact describe supplies optional version and expected source revision;
  version mismatch and source drift reject/report deterministically;
- account resolution page/row/deadline ceilings fail rather than use partial
  uniqueness;
- toolkit/slug/version/title/depth/node/byte bounds and secret canaries;
- raw execution/control/workbench/bash meta-tools remain unreachable; and
- curated policy/results remain product-compatible after shared transport hardening.

### Future execution proof matrix

- complete canonical predecessor closure references and conformance are green;
- C5×C6 crashes at handoff intent, reserve/consume, admission, child append,
  provider-send boundary, result append, and terminal settlement;
- execution flag off blocks new admission but reconciliation continues;
- JCS cross-process vectors, Unicode/bidi/control display, plan/argument digest
  equality, and replay;
- legacy/new subject inventory, quarantine, migration/relink and rollback;
- exact account pin/revalidation and zero/one/multiple account behavior; and
- child slug/parent/Run/plan identity through call/result/record/renderer/
  metering/audit using C2's canonical interface.

### Avoid testing

Do not test provider fields Boring does not consume, mutable provider ordering,
private helper shape, fake account fields copied from code, nested dispatcher
returns as identity proof, or exactly-once provider execution claims.

## Acceptance

### Gate 1 blockers

900.1 is not `ready-for-agent` until:

1. the owner selects/approves the canonical app-owned durable cleanup persistence
   seam, versioned secret-resolver handle, and provider-supported creation
   idempotency/reconciliation or finite-TTL operator proof;
2. the shared curated+catalog exact-origin hardening scope is approved;
3. independent T1 review is clean on both artifacts;
4. the existing 900.1a-c Definition-of-Ready beads are undeferred only after
   their owner decisions and external gates are recorded; and
5. bead text matches this canonical plan for pre-POST create intent/provider
   reconciliation, curated caller-signal plumbing, bounded/encoded Session IDs,
   hierarchical fairness, exact describe version/source fence, and bounded
   account pagination; planning proof asserts these contracts before undefer.

### 900.1 discovery acceptance

1. 900.1a hardens all Composio Session consumers: durable intent before POST,
   provider-backed create-gap reconciliation, exact origin before any header,
   bounded/encoded Session ID atomically promoted to a lease before endpoint
   trust, explicit Composio-specific caller-signal plumbing, separate active/
   drain signals, and bounded protocol parser/client. Unreadable or unresolved
   durable state fails startup/admission.
2. Catalog source authority is host-recomputed; forged persisted provenance and
   cross-actor/workspace IDs never resolve secrets or call providers.
3. Catalog flag-on with missing secret/store fails startup; service availability
   does not require an account.
4. One discriminated app runtime is shared by routes/Agent tools and reaches
   honest `closed-clean|closed-pending-cleanup` with durable startup drain.
5. Hierarchical workspace→principal scheduling and partitioned quotas let an
   admitted workspace B request complete or receive its own provider error
   within the conservative 75-second global bound under workspace A saturation;
   the global emergency ceiling is reported honestly.
6. Search returns at most 20 full bounded signatures without launch pagination,
   provider-refresh input, or direct-tool materialization.
7. Describe accepts optional exact version and expected source revision from the
   search result, matches version when supplied, and deterministically reports
   or rejects source/schema drift; every Composio entry remains blocked pending
   900.2.
8. `mcp_readonly_call` and every raw Composio execution/control/workbench/bash
   path reject full-catalog calls.
9. Abort, timeout, close, revocation, project/key/config changes and source-local
   races cannot create late success/cache/lease mutation.
10. Catalog probe is explicitly unsupported; curated product semantics remain
    unchanged apart from mandatory shared transport security hardening.
11. The exact bounded Session ID is the sole Session value permitted in a
    durable cleanup lease. Session URL/headers, tokens, OAuth values, operator
    keys and all other secret canaries are absent from browser, Agent, cache,
    durable lease, error and logs.

### 900.2 execution acceptance

1. C2 and its complete canonical predecessor closure are implemented,
   referenced, and conformance-green; no issue-local substitutes.
2. C5×C6 durable handoff survives every named crash point without consumed-
   approval/no-Run gap or redispatch.
3. C2's canonical event/API preserves real child slug, parent, Run and plan
   identity through call/result/record/renderer/metering/audit.
4. RFC 8785 JCS bytes are identical across display, digests, handoff, admission,
   and provider input; malformed Unicode/non-JSON values fail closed.
5. Versioned subject migration inventories legacy/new accounts and quarantines
   conflicts before exact one-account authority can execute.
6. Every launch call has exact durable approval and post-approval authority,
   source, account, schema, policy, project, credential and subject revision
   revalidation.
7. Deny/cancel/expiry/replay/wrong owner/revocation/drift produce zero calls.
8. One dispatch attempt follows admission; flags cannot disable accepted-work
   reconciliation; ambiguous commit settles `unknown-outcome` without retry.

### Release acceptance

One-Composio Seneca UI, exact package pins, flags-off rollback, managed/provider-
setup states, disposable read/write/deny/stale/revoke/unknown-outcome proof,
project/vendor/operations acceptance, and Seneca #36 cutover are complete. The
issue remains open if only discovery ships.

## Proof

### Planning proof

```bash
python - <<'PY'
from html.parser import HTMLParser
from pathlib import Path
import json, subprocess

ids = {
    "wt-391-forward-gh900-composio-protocol-custody-ytk2",
    "wt-391-forward-gh900-composio-fair-search-96e7",
    "wt-391-forward-gh900-composio-exact-describe-0ijm",
    "wt-391-forward-gh900-composio-account-authority-84w5",
    "wt-391-forward-gh900-composio-jcs-proposal-wu5i",
    "wt-391-forward-gh900-composio-approved-child-usvx",
    "wt-391-forward-gh900-composio-discovery-ui-mrp0",
    "wt-391-forward-gh900-composio-approval-ui-mx5n",
}
expected_edges = {
    ("wt-391-forward-gh900-composio-fair-search-96e7", "wt-391-forward-gh900-composio-protocol-custody-ytk2"),
    ("wt-391-forward-gh900-composio-exact-describe-0ijm", "wt-391-forward-gh900-composio-fair-search-96e7"),
    ("wt-391-forward-gh900-composio-account-authority-84w5", "wt-391-forward-gh900-composio-exact-describe-0ijm"),
    ("wt-391-forward-gh900-composio-jcs-proposal-wu5i", "wt-391-forward-gh900-composio-account-authority-84w5"),
    ("wt-391-forward-gh900-composio-approved-child-usvx", "wt-391-forward-gh900-composio-jcs-proposal-wu5i"),
    ("wt-391-forward-gh900-composio-discovery-ui-mrp0", "wt-391-forward-gh900-composio-exact-describe-0ijm"),
    ("wt-391-forward-gh900-composio-discovery-ui-mrp0", "wt-391-forward-gh900-composio-account-authority-84w5"),
    ("wt-391-forward-gh900-composio-approval-ui-mx5n", "wt-391-forward-gh900-composio-approved-child-usvx"),
    ("wt-391-forward-gh900-composio-approval-ui-mx5n", "wt-391-forward-gh900-composio-discovery-ui-mrp0"),
}
expected_paths = {
    ".beads/issues.jsonl",
    "docs/direction/DIRECTION.md",
    "docs/issues/806/external-workspace-mcp-plan.md",
    "docs/issues/806/plan.md",
    "docs/issues/806/runtime-refactor/README.md",
    "docs/issues/807/plan.md",
    "docs/issues/900/plan-review.html",
    "docs/issues/900/plan.md",
}
merge_base = subprocess.check_output(
    ["git", "merge-base", "origin/main", "HEAD"], text=True
).strip()
actual_paths = set(subprocess.check_output(
    ["git", "diff", "--name-only", merge_base], text=True
).splitlines())
actual_paths.update(subprocess.check_output(
    ["git", "ls-files", "--others", "--exclude-standard"], text=True
).splitlines())
assert actual_paths == expected_paths, (actual_paths, expected_paths)
rows = {r["id"]: r for r in map(json.loads, Path(".beads/issues.jsonl").read_text().splitlines()) if r.get("id") in ids}
assert set(rows) == ids and all(r["status"] == "deferred" for r in rows.values())
for r in rows.values():
    assert 300 <= r["estimated_minutes"] <= 420 and r["acceptance_criteria"].strip()
    assert all(x in r["description"] for x in ["WHAT:", "PROOF PATH:", "FILE SCOPE:", "DEPENDENCIES:", "PR FIT:"])
actual_edges = {(r["id"], d["depends_on_id"]) for r in rows.values() for d in r.get("dependencies", []) if d["depends_on_id"] in ids}
assert actual_edges == expected_edges, (actual_edges, expected_edges)
bead_text = "\n".join(r["description"] + "\n" + r["acceptance_criteria"] for r in rows.values())
for token in [
    "create intent before provider POST",
    "provider-supported idempotent create",
    "75s global bound",
    "expected source revision",
    "5 pages, 100 rows/page, 500 rows total",
]:
    assert token in bead_text, token
md = Path("docs/issues/900/plan.md").read_text()
inbound = Path("docs/issues/806/external-workspace-mcp-plan.md").read_text()
direction = Path("docs/direction/DIRECTION.md").read_text()
html = Path("docs/issues/900/plan-review.html").read_text()
for token in ["BLOCKER", "C3", "C1", "C2", "durable cleanup", "exact-origin", "RFC 8785", *ids]:
    assert token in md and token in html, token
for token in ["inbound MCP Access", "outbound MCP Connectors", "first-class child"]:
    assert token in inbound and token in direction, token
assert ("ChildToolCall" + "Event") not in md
assert ("type:" + '"tool_call"') not in md
assert "<script" not in html
HTMLParser().feed(html)
PY
br dep cycles
br ready --json | jq -e '[.[] | select(.id | contains("gh900-composio"))] | length == 0'
bv --robot-insights | jq -e '.Cycles == null and .Stats.NodeCount == 254 and .Stats.EdgeCount == 282'
git diff --check
test -z "$(git diff --cached --name-only)"
```

The merge-base-to-working-tree check plus explicit untracked-file inventory
permits exactly the Beads export, combined
direction/pointer migration, both canonical plans, and the outbound review
artifact. HTML parity checks mirror verdict, actual bead IDs/edges, dependency
closure and critical risks; cross-plan tokens prove the inbound/outbound/C2
boundary appears in both the direction amendment and inbound plan.

### Per discovery reland PR

```bash
pnpm --filter @hachej/boring-mcp typecheck
pnpm --filter @hachej/boring-mcp test
pnpm --filter @hachej/boring-mcp build
pnpm --filter full-app typecheck
git diff --check
```

900.1c adds sanitized live search+describe+cleanup evidence with a synthetic
user and no account execution. Dependencies are absent in this worktree, so
package commands cannot support the planning artifact itself and must be rerun
before any reland PR claims readiness.

### Future execution proof

The architecture Steward supplies exact closure bead/PR/conformance commands.
900.2 then runs the C5×C6 crash matrix, C2 identity conformance, JCS vectors,
subject migration, exact-account live proof, no-retry unknown-outcome proof,
secret scan, package gates, and clean Seneca compile/typecheck/test/build/e2e.


## Beads graph and serial vertical slices

All eight implementation beads exist in `.beads/issues.jsonl` and are
**DEFERRED** while Gate 1 is blocked. Each carries WHAT, exact proof commands,
bounded file scope, dependencies, acceptance criteria, priority, and a one-
session 300–420 minute estimate. The Beads graph—not this summary—is dispatch
authority.

### Slice 900.1a — Shared Composio protocol custody

**Bead:** `wt-391-forward-gh900-composio-protocol-custody-ytk2` (P0, 6h,
DEFERRED)

**Delivers:** the shared private abortable/bounded Composio operation client and
parser for curated and future catalog Sessions: durable create intent before
POST, provider reconciliation key/proof, exact origin before any header, atomic
intent→Session lease before endpoint trust, raw workbench contract,
invalid-origin cleanup, and no catalog behavior.

**File scope:** `composioManagedConnector.ts`; new `composioProtocol.ts`; shared
MCP errors; `mcpSdkTransport.ts` only without generic semantic widening; narrow
Composio-specific caller-signal plumbing in `sourceHandlers.ts`, `agentTools.ts`
and `appServerBinding.ts`; focused curated/protocol/composition tests.

**Blocked by:** owner-approved durable intent/lease store, opaque secret handle,
provider reconciliation mechanism, and approval to harden curated Composio
consumers. No bead predecessor. The combined planning PR updates the bead with
caller-signal scope, Session-ID bounds, and the complete create-gap contract; it
remains deferred on the owner decisions.

**Proof:** bead commands plus evil-origin, origin-guard mutation, abort,
malformed-endpoint-after-ID, cleanup and canary faults.

### Slice 900.1b — Host-authoritative fair search tracer

**Bead:** `wt-391-forward-gh900-composio-fair-search-96e7` (P1, 7h, DEFERRED)

**Delivers:** discriminated app runtime, host-only catalog source, startup drain
and close report, hierarchical workspace→principal bounded scheduling/quotas
with a conservative 75-second global admitted-request bound, source-local
revision/cache, full-signature blocked search, unsupported probe, and zero raw
execution paths.

**File scope:** new `composioCatalogRuntime.ts`; catalog/source/Agent/app-binding
server seams; shared DTOs; focused runtime/catalog/app tests; compile-only
full-app composition if needed.

**Blocked by:** `wt-391-forward-gh900-composio-protocol-custody-ytk2`.

**Proof:** forged-source, missing-startup-config, workspace/principal fairness,
cleanup restart/close/store-unavailable, abort-late-write, source race/revision,
raw denial and package gates from the bead. The combined planning PR updates the
bead to hierarchical workspace→principal fairness and the conservative
75-second global bound.

### Slice 900.1c — Exact describe and live discovery qualification

**Bead:** `wt-391-forward-gh900-composio-exact-describe-0ijm` (P1, 6h,
DEFERRED)

**Delivers:** exact describe/drift using toolkit, slug, optional version,
expected schema hash and expected source revision; exact supplied-version match
and deterministic source-drift rejection/reporting; identifier and structural
schema bounds, source-fenced caches, stable errors/canaries, and sanitized live
search + describe + verified cleanup; no account execution or launch pagination.

**File scope:** catalog describe/cache; `toolCatalog.ts`, `agentBridge.ts`,
`sourceHandlers.ts`, shared DTOs/tests; capability script/record only for genuine
sanitized changes.

**Blocked by:** `wt-391-forward-gh900-composio-fair-search-96e7`. The combined
planning PR updates the bead with optional exact version and expected source
revision; it remains deferred on its predecessor and live qualification.

**Proof:** deterministic package gates, JCS revision vectors, stale-write and
pathological schema tests, raw denial, and sanitized live qualification.

### Slice 900.2a — Subject migration and exact account authority

**Bead:** `wt-391-forward-gh900-composio-account-authority-84w5` (P2, 6h,
DEFERRED)

**Delivers:** inventory/versioning of legacy/new subjects, conflict quarantine,
owner-selected relink or migration/rollback, minimal live account parser with
5-page/100-row/500-total/15-second ceilings, exact zero/one/multiple authority,
exact Session pin/echo, and post-approval re-resolution. Partial/over-limit scans
fail resource-limited and admit no call.

**File scope:** managed connector/source authority seams; focused new account-
authority module and tests; no catalog, proposal, child execution or UI.

**Blocked by:** `wt-391-forward-gh900-composio-exact-describe-0ijm` and the
owner's subject migration decision. The combined planning PR updates the bead
with 5-page/100-row/500-total/15-second ceilings and fail-closed partial scans;
it remains deferred.

### Slice 900.2b — Immutable JCS call proposal

**Bead:** `wt-391-forward-gh900-composio-jcs-proposal-wu5i` (P2, 6h, DEFERRED)

**Delivers:** non-dispatching `mcp_tool_call` proposal validation, exact
re-describe/account resolve, RFC 8785 bytes and digests, immutable revision-bound
plan, safe display, and stable execution-unavailable refusal. It creates no
approval store, event type, Run ledger or provider send.

**File scope:** MCP Agent bridge; focused execution-plan module/tests; reusable
DTO/errors; existing Ask User display adapter only, no store changes.

**Blocked by:** `wt-391-forward-gh900-composio-account-authority-84w5`.
Canonical dispatch remains externally blocked.

### Canonical external predecessor closure

No exact tracker IDs currently identify C2's complete canonical predecessor
closure. Therefore no false Beads edges were created. The architecture Steward
must identify implemented nodes for at least P-1/upstream,
C3→C5→C6→C1→C2 and A2a→A2b/C7→C2, plus every remaining frozen incoming edge,
then add those exact external edges to the approved-child bead. Placeholder text
or compatibility code is not satisfaction.

### Slice 900.2c — Exact approved canonical child execution

**Bead:** `wt-391-forward-gh900-composio-approved-child-usvx` (P2, 7h,
DEFERRED)

**Delivers:** a Composio provider adapter over canonical C5/C6/C1/C2 interfaces,
post-approval revalidation, recoverable consume/admit handoff, one provider-send
attempt, real child identity across all evidence surfaces, value-free audit,
continued reconciliation with flags off, and honest unknown outcome.

**File scope:** focused Composio provider adapter/tests and narrow bridge/shared
composition; no edits to generic stores, event schemas, runner lifecycle or UI.

**Blocked by:** `wt-391-forward-gh900-composio-jcs-proposal-wu5i` **and** C2's
complete canonical predecessor closure. The latter has no edge until exact
ratified tracker IDs are supplied.

### Slice 900.3a — One-Composio discovery and connection UI

**Bead:** `wt-391-forward-gh900-composio-discovery-ui-mrp0` (P2, 6h, DEFERRED)

**Delivers:** accessible one-Composio catalog/search/detail, honest account/setup
states, hosted connect, revoke-before-replace, server capability authority, and
blocked execution presentation while preserving curated mode.

**File scope:** boring-mcp front/shared browser DTOs and compile-only full-app
front composition; no server runtime, execution or generic Inbox work.

**Blocked by:** both
`wt-391-forward-gh900-composio-exact-describe-0ijm` and
`wt-391-forward-gh900-composio-account-authority-84w5`.

### Slice 900.3b — Existing Ask User approval projection

**Bead:** `wt-391-forward-gh900-composio-approval-ui-mx5n` (P3, 5h, DEFERRED)

**Delivers:** exact host-authored Composio plan projection into existing
Inbox/Questions, current-origin reauthorization, lossless safe arguments, and
stale/expired/replayed/unknown-outcome states. No second store/capability/modal.

**File scope:** existing Ask User front projection/tests and boring-mcp front
proposal adapter; no provider dispatch, store schema or generic Console redesign.

**Blocked by:** both
`wt-391-forward-gh900-composio-approved-child-usvx` and
`wt-391-forward-gh900-composio-discovery-ui-mrp0`.

### Exact current Beads edges

```text
wt-391-forward-gh900-composio-protocol-custody-ytk2
  -> wt-391-forward-gh900-composio-fair-search-96e7
  -> wt-391-forward-gh900-composio-exact-describe-0ijm
  -> wt-391-forward-gh900-composio-account-authority-84w5
  -> wt-391-forward-gh900-composio-jcs-proposal-wu5i
  -> wt-391-forward-gh900-composio-approved-child-usvx
  -> wt-391-forward-gh900-composio-approval-ui-mx5n

wt-391-forward-gh900-composio-exact-describe-0ijm
  -> wt-391-forward-gh900-composio-discovery-ui-mrp0
wt-391-forward-gh900-composio-account-authority-84w5
  -> wt-391-forward-gh900-composio-discovery-ui-mrp0
wt-391-forward-gh900-composio-discovery-ui-mrp0
  -> wt-391-forward-gh900-composio-approval-ui-mx5n
```

Arrows mean “blocks/required before.” `br dep cycles` reports no cycles. The
approved-child bead's absent external edge is deliberate and remains a blocker,
not permission to dispatch.

### Release and Seneca proof — no bead yet

900.4 remains specified in rollout/release acceptance but has no bead. Release,
publish, production proof and cutover are process/operator work; creating a
process-only bead was explicitly out of scope. Create implementation/release
tracking only when prerequisites, access and owner gates make it dispatchable.


## Out of scope

- Official MCP Registry, marketplace, custom/user-supplied MCP URLs, SSE/stdio,
  local servers, package execution, remote bash/workbench, arbitrary OAuth
  issuer, or second secret store.
- Loading generated direct Composio tools into model context.
- OpenCode's 4k-line host-process interpreter or any model-written host code.
- Rebuilding Composio catalog/search/schema/auth/execution.
- Multiple active accounts per toolkit or silent recent-account fallback.
- Automatic provider execution retries or provider exactly-once claims.
- Direct-read classifier on the sellable launch path.
- Multi-replica approval coordination before C5 provides it.
- Workspace-shared credential promotion or Constellation policy broadening.
- Generic #1226 catalog work beyond the ratified prerequisites.
- V2 kernel implementation in this issue; alignment is through contracts and
  conformance, not importing the new repo.

## Open owner questions / decisions

1. **BLOCKER — durable cleanup and create-gap reconciliation:** select the
   canonical app-owned durable store, approve versioned `secretResolverHandle`
   resolution, and prove provider-supported idempotent create, authoritative
   intent lookup/listing, or a finite-TTL operator sweep. Recommendation: a host
   durable control-plane store with startup access, not user settings or a
   plugin-local JSON file. Without remote reconciliation, unresolved intents
   block admission and no orphan-free claim is permitted.
2. **BLOCKER — shared transport security scope:** approve hardening the existing
   curated Composio path in 900.1a. Product semantics remain unchanged, but
   arbitrary HTTPS Session endpoints are rejected before key forwarding.
3. **BLOCKER — canonical predecessor ownership:** architecture Steward must
   assign exact beads/PRs for C2's complete predecessor closure and the C5×C6
   durable handoff. C5/C6/C2 shorthand is insufficient.
4. **900.2 migration:** after legacy/new subject inventory, choose explicit
   relink (safest) or approve a migration/rollback protocol. Conflicts are
   quarantined either way.
5. **Resolved — draft PR #1309:** the owner closed it on 2026-08-26. Its exact
   head `dca7692` remains quarry/evidence only and must never be merged or
   revived; reland only through this plan's reviewed slices.
6. **Release gates:** accept Composio project isolation attestation (the API did
   not prove it), DPA/subprocessors/residency/security/billing, and deployment
   ownership before 900.4.
7. **Tracker reconciliation outside this task:** GitHub #900 still carries
   `ready-for-agent` while the canonical plan and all eight beads are blocked;
   the owner must reconcile that state. PR #1309's cited
   `wt-391-forward-rjkl.2` is absent from the current and inspected historical
   tracker, so it confers no dependency or completion authority.

Until 1-3 are resolved and independent review is clean, Gate 1 remains blocked
and no implementation slice is `ready-for-agent`. Decision 4 additionally
blocks 900.2 even after discovery is approved.

## Adversarial review record

**Final independent OPUS verdict:** **BLOCKER**. **Final independent SOL
verdict:** **BLOCKER**. A prior OPUS routing attempt failed with
`Unknown agent: project.opus48-plan-reviewer`; that failed attempt is not review
evidence and is superseded only by the final OPUS report supplied here.

Accepted final-review corrections:

- exact describe now carries optional version and expected source revision,
  requires exact supplied-version match, and reports/rejects source drift;
- Session IDs are bounded to 1..256 UTF-8 bytes, valid non-control Unicode, and
  strict cleanup path-segment encoding, with mutation tests;
- Session creation now persists an intent before POST, promotes a returned ID to
  a lease before returning an untrusted endpoint, and treats the remote
  acceptance/local promotion crash gap as unresolved until provider proof;
- active-operation abort and fresh bounded cleanup-drain signals are distinct;
  unreadable durable storage fails Composio startup and yields no clean report;
- curated caller abort is narrowed to an explicit Composio-specific handler/app
  signal seam; no generic transport capability is claimed;
- fairness is hierarchical workspace→principal and uses the conservative
  75-second global admitted-request bound instead of an invalid 30-second claim;
- account uniqueness scans have 5-page/100-row/500-total/15-second ceilings and
  never select from partial results;
- the durable create intent carries no Session URL/header/token; the promoted
  lease permits the exact bounded Session ID only; every other
  Session URL/header/token/OAuth/operator value remains forbidden;
- planning proof now parses exactly eight deferred beads, checks Definition-of-
  Ready fields, compares the exact nine internal edges, verifies none are ready,
  runs cycle/graph checks, parses self-contained HTML, and checks artifact
  parity; and
- the combined planning PR updates ytk2/96e7/0ijm/84w5 to match the canonical
  create-gap, signal/bounds, fairness, exact-describe, and pagination contracts,
  with planning-proof token assertions before undefer.

Combined-program alignment retained: #806 inbound Access consumes only the
exact resident Connector tool, preserves this plan's C5/provider authority and
C2 first-class child identity, and creates no duplicate runtime, approval store,
ledger, or child event.

Confirmed retained decisions: exact-origin custody, host-only provenance,
source-revision fence, crash-safe C5×C6 handoff, C2's complete canonical
predecessor closure, no issue-local child event, versioned subject migration,
RFC 8785 JCS, three small 900.1 relands, PR #1309 as quarry, and
`unknown-outcome` without retry.

**Current verdict:** **BLOCKER**, not an approval recommendation. Material Gate-1
blockers remain durable cleanup storage/secret-handle authority, curated
transport hardening approval, exact canonical predecessor ownership/references,
and the documented owner gates. Subject migration policy remains a separate
blocker before 900.2. After those decisions,
rerun independent T1 falsification on the exact artifacts before changing state.

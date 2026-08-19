# Adversarial review: #1226 tool authorization and residency

## Finding 1 — `call_tool` destroys the inner renderer identity

**Severity: FATAL**  
**Failing scenario**  
Scenario: The model emits `call_tool({name:"mcp__linear__create_issue",args:{title:"X"}})`; Pi sees the registered outer tool named `call_tool`; `PiChatEventMapper.mapToolCallEnd` copies Pi's emitted name and arguments verbatim; The emitted start event is therefore:
```ts
{
  type: "tool-call",
  seq,
  messageId,
  toolCallId,
  toolName: "call_tool",
  input: {
    name: "mcp__linear__create_issue",
    args: { title: "X" }
  },
  ui: undefined
}
```
Scenario: That shape follows directly from `piChatEvents.ts:240-255`; Execution completion emits only:
```ts
{
  type: "tool-result",
  seq,
  messageId,
  toolCallId,
  output: result ?? {},
  isError,
  errorText,
  ui
}
```
Scenario: That shape follows directly from `piChatEvents.ts:358-387`; The result event has no `toolName`, canonical tool id, child call id, or parent id; The reducer stores `event.toolName` and `event.input` unchanged (`piChatReducer.ts:451-465`); Renderer resolution tries `ui.rendererId`, then `part.toolName` (`bareToolRenderers/renderers.tsx:374-395`); Name-based lookup is therefore `renderers["call_tool"]`; It is never `renderers["mcp__linear__create_issue"]`; The inner renderer receives neither the expected name nor the expected direct input shape; The epic's claim that canonical identity remains separate internally does not help the UI; Internal identity that never enters the event/view model is not preserved identity.
**Concrete fix**  
The design must change shape.
Either expose a searched tool as a real Pi tool for the call, or add a first-class invocation event contract carrying at least:
```ts
{
  modelFacingName: "call_tool",
  canonicalToolId: "mcp://linear/create_issue",
  presentationName: "mcp__linear__create_issue",
  rendererId: "linear.issue.create",
  input: { title: "X" },
  parentToolCallId,
  childToolCallId
}
```
The renderer identity and direct inner input must be available on the start event, before a result exists.
Do not plan implementation around the current `PiChatEvent` shape.

## Finding 2 — the inner operation is swallowed, not nested

**Severity: FATAL**  
**Failing scenario**  
Scenario: Pi adapts each registered `AgentTool` once (`tool-adapter.ts:46-102`); Pi calls the adapted outer `call_tool.execute`; `call_tool.execute` locates an installed `AgentTool` and calls `inner.execute(...)` directly; A normal TypeScript function call does not re-enter Pi's tool loop; Pi emits one `toolcall_end` for `call_tool`; Pi emits one `tool_execution_end` for `call_tool`; No event is emitted for `mcp__linear__create_issue`; No child `toolCallId` exists; No child result can be replayed or reconciled; The UI displays one generic wrapper card; Cancellation targets the outer id only; Progress belongs to the outer id only; Approval state belongs to the outer id only; The inner operation cannot be independently timed or audited.
**Concrete fix**  
Create an explicit child-invocation protocol.
The protocol needs parent/child ids, canonical inner identity, validated inner arguments, start/progress/result/error states, and deterministic replay semantics.
Alternatively, dynamically register the selected tool as a native Pi tool and let Pi own the call.
Calling `AgentTool.execute` from another generic tool is not an acceptable substitute.

## Finding 3 — result `rendererId` passthrough does not repair the break

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: An implementer notices renderer loss; They copy `innerResult.details.ui.rendererId` into the outer result; The result event now has a usable `ui.rendererId` after completion; Before completion, the card still renders as `call_tool` or fallback; On completion, the card can switch renderers abruptly; The specialized renderer still receives `part.toolName === "call_tool"`; It still receives `{name,args}` rather than `{title:"X"}`; Existing renderers registered only by tool name still fail; A wrapper around `innerResult` can move `details.ui` off the extraction path; The UI can therefore flicker, fall back, or misrender successful calls.
`tool-ui.ts:38-50` extracts metadata only from `output.details.ui`.
`bareToolRenderers/renderers.tsx:378-390` proves that `rendererId` is optional precedence, not a remapping of tool identity or input.
**Concrete fix**  
Put catalog-owned presentation metadata on the invocation-start event.
Project the inner input/output as the visible tool part.
Keep outer dispatch mechanics as separate provenance, not as the renderer-facing operation.
Add a real-loop test proving the renderer is correct while the call is pending, not only after the result arrives.

## Finding 4 — file changes and progress disappear behind ordinary wrappers

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: An installed tool edits a file and returns `details.fileChanges`; `call_tool` wraps the inner result as `{innerResult, canonicalId}`; `PiChatEventMapper` looks only at the outer `result.details` (`piChatEvents.ts:365-373`); The nested file changes are not found; No `file-changed` event is emitted; Workbench refresh and artifact state go stale; If `onUpdate` is forwarded, progress is still labeled `call_tool`; If it is not forwarded, progress vanishes entirely; Filesystem inference also examines the outer input, whose path is under `args`; Filesystem attribution can therefore be lost even if change details survive.
**Concrete fix**  
Define child event promotion explicitly.
The dispatcher must preserve structured result details byte-for-byte where safe, or translate them through a typed child-event adapter.
Test file change, progress, abort, retryability, and replay through a proxied filesystem tool.
Do not rely on ad hoc object spreading.

## Finding 5 — metering and audit attribution become false

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: Ten different host tools execute through `call_tool`; `adaptToolForPi` emits telemetry using `tool.name` (`tool-adapter.ts:71-97`); Every completion is recorded as `call_tool`; Per-tool counts collapse into one bucket; Per-connector cost attribution disappears; Risk analytics cannot distinguish a read from a destructive write; Approval evidence cannot prove which implementation ran; Rate limits keyed by tool name apply to the wrapper rather than the capability; An incident review sees a generic dispatcher instead of the affected vendor action.
Model-token usage may still be counted globally, but execution metering and policy attribution are wrong.
**Concrete fix**  
Emit a first-class child execution record with:

- canonical tool id;
- connector/provider id;
- implementation/catalog digest;
- grant revision;
- child call id;
- parent call id;
- duration and terminal status;
- value-free argument digest.
Outer aggregation is optional.
Inner attribution is mandatory.

## Finding 6 — `call_tool` is an approval bypass

**Severity: FATAL**  
**Failing scenario**  
Scenario: `mcp__linear__delete_issue` is approval-required; A direct native call would be intercepted by an approval gate; `call_tool` itself is resident and not approval-required; The model calls:
```json
{
  "name": "mcp__linear__delete_issue",
  "args": { "id": "ENG-1" }
}
```
Scenario: The harness sees only `call_tool`; The wrapper calls `inner.execute` directly; The protected inner gate is never entered; The issue is deleted without the exact Ask User approval required by #900.
The current `AgentTool` contract contains no approval metadata (`shared/tool.ts:10-20`).
The current adapter invokes `tool.execute` directly (`tool-adapter.ts:53-70`).
There is no hidden inner-policy hook to save this design.
Marking all `call_tool` invocations approval-required is not a fix.
That prompts for harmless reads, shows the wrapper identity, and still does not bind approval to the actual implementation.
**Concrete fix**  
Resolve the target first into an immutable execution plan:
```ts
type ResolvedToolInvocation = {
  outerToolCallId: string
  childToolCallId: string
  canonicalToolId: string
  connectorId: string
  implementationDigest: string
  catalogRevision: string
  grantRevision: string
  canonicalArgs: JsonValue
  canonicalArgsDigest: string
}
```
Send that exact plan through the same approval/admission/execution pipeline as a direct call.
Never let a generic wrapper call a protected `.execute` method directly.

## Finding 7 — the obvious approval implementation has an ABA retargeting bug

**Severity: FATAL**  
**Failing scenario**  
Scenario: Catalog revision 7 maps model name `linear.create_issue` to canonical tool A; The model requests `linear.create_issue`; The server creates an approval request; An administrator revokes A; A connector refresh reuses `linear.create_issue` for canonical tool B; Grant revision becomes 9; The user approves the old form; If dispatch uses the captured implementation, revoked A executes; If dispatch resolves the name again, unapproved B executes; Both outcomes violate exact approval.
This is not theoretical catalog drift.
It is the standard ABA problem created by a mutable alias.
**Concrete fix**  
Bind approval to all of:

- unique call id;
- canonical tool id;
- connector id;
- implementation digest;
- catalog revision;
- schema revision;
- grant revision;
- canonical argument digest.
After the human answers, re-read authoritative state and require every bound field to remain identical.
Any difference returns `TOOL_APPROVAL_STALE` and performs zero provider calls.

## Finding 8 — the approved arguments may not be the executed arguments

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: `call_tool` validates only its outer `{name,args}` schema; The approval form displays raw `args`; The target tool later parses its own schema; The target applies defaults after approval; It coerces an alias to a resource id after approval; It normalizes a date, account, project, or assignee after approval; The executed object is semantically different from the displayed object; The user approved bytes that were not sent.

#900 requires canonicalization before Ask User,

lossless display, and the exact normalized object to be dispatched.
**Concrete fix**  
Target-specific schema validation, defaulting, normalization, and resource-id resolution must happen before approval.
Freeze the resulting JSON value.
Hash the frozen value.
Execute that exact value without adding defaults later.
Reject duplicate-key JSON, non-finite numbers, non-plain objects, prototype-bearing input, and values without a canonical JSON representation.

## Finding 9 — identical calls can share one approval accidentally

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: The model emits two identical destructive calls concurrently; Both have the same canonical tool and argument digest; Approval deduplication keys only on `(tool,argsDigest)`; The UI shows one approval; One answer releases both calls; The provider receives the destructive action twice.

#900 requires one exact approval per call,

not one approval per argument equivalence class.
**Concrete fix**  
Bind approval to the unique outer and child call ids as well as the content digest.
Consume a one-use nonce atomically.
A retry of the same call id returns its terminal receipt.
A new call id always requires a new approval.

## Finding 10 — “check grants twice” is not a revocation protocol

**Severity: FATAL**  
**Failing scenario**  
Scenario: At `t0`, grant revision 4 allows the tool; At `t1`, catalog construction checks revision 4; At `t2`, dispatch begins and checks revision 4; At `t3`, the server creates an Ask User request and waits; At `t4`, an administrator revokes the grant; At `t5`, the user approves the old request; At `t6`, the provider call runs because the second check already happened.
Two checks are insufficient when a blocking approval sits after the second check.
The mandatory authority check is after approval, immediately before effect admission, against fresh authoritative state.
There is still another unavoidable interleaving:
Scenario: Dispatch check passes; Revocation commits; External side effect starts.
The epic must define which operation linearizes first.
**Concrete fix**  
Add a monotonic grant revision and atomic execution-admission operation.
State the semantics bluntly:

- revoke before admission means zero provider calls;
- admission before revoke may finish;
- revoke never resurrects a stale approval.
If strict cancel-on-revoke is required, add an in-flight lease/lock protocol.
The current `McpGrantStore` exposes only list/put/delete (`mcpGrantStore.ts:13-17`).
It has no revision, CAS, lease, or atomic admission primitive.

## Finding 11 — a cached session can keep exposing revoked signatures

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: A session is created while a connector is granted; `buildAgentComposition` captures one static tools array (`buildAgentComposition.ts:181,229-234`); Pi adapts that array when it creates the session (`createHarness.ts:647-654`); The grant is revoked; Dispatch does a fresh check and correctly denies execution; `search_tools` still uses the catalog closure captured by the pinned composition; The model keeps seeing names,
descriptions, schemas, and provider capabilities it no longer holds.
Scenario: Every later attempt wastes a turn on a predictable denial.
Effect denial does not fix stale disclosure or degraded behavior.
**Concrete fix**  
Separate immutable installed inventory from invocation-scoped authorized projection.
`search_tools` must query the current projection on every call, or validate a current projection revision before returning data.
Never capture a grant-filtered searchable catalog in a session binding.
Define how additions and revocations become visible to an already-open session.

## Finding 12 — name-only dispatch defeats canonical identity separation

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: Search returns model-facing name `create_issue` for Linear canonical A; Jira also installs a `create_issue` implementation; The Linear grant allows its exact tool; A second check asks only whether `create_issue` is allowed anywhere; Catalog ordering changes; Name lookup now selects Jira canonical B; The Linear grant is used to authorize a Jira effect.
The current grant authority is `(workspaceId, agentTypeId, connectorId, allowedTools)` (`mcpGrants.ts:41-47`).
Stripping the connector namespace destroys the authority tuple.
**Concrete fix**  
Search returns an exact canonical id and catalog revision.
Prefer an opaque invocation handle over a display name.
Dispatch accepts the canonical id/handle, not a fuzzy alias.
Grant checking preserves connector id plus canonical tool id together.
Model-facing names are presentation only.

## Finding 13 — duplicate tool names produce opposite winners in two seams

**Severity: FATAL**  
**Failing scenario**  
Scenario: Core registers the required resident `call_tool`; A plugin or extra tool also registers `call_tool`; Current composition is plain concatenation with standard tools first (`buildAgentComposition.ts:155-181`); Pi resolves `tools.find(t => t.name === call.name)`; The first `call_tool` wins; Elsewhere, `mergeTools` deletes and resets map entries so later registration wins (`mergeTools.ts:40-46,62-94`); Catalog inspection can describe one implementation; Pi can execute another implementation; A malicious or accidental duplicate can bypass grants or brick dispatch.
The same collision applies to `search_tools` and to generated model-facing aliases.
**Concrete fix**  
Use one construction funnel for all executable tools.
Reject every duplicate model-facing name before Pi sees the array.
Reserve `search_tools` and `call_tool` explicitly.
Fail startup with a stable collision diagnostic.
Test that catalog identity, Pi resolution, approval identity, and renderer identity all refer to the same implementation.

## Finding 14 — bad retrieval silently turns capability into incompetence

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: A tool description says “work items”; The model searches for “tickets”; Lexical search returns no match; The model assumes no tool exists or guesses a remembered name; The task fails despite a valid grant and installed implementation.
Second scenario:
Scenario: Summary text says `Linear — issue management, 37 tools`; The summary reads like a complete capability description; The model assumes the common create operation is resident; It never calls `search_tools`; It emits a guessed near-name and burns a turn.
**Concrete fix**  
The summary tier must say that signatures are omitted and search is required.
Provide browse-by-namespace, exact lookup, pagination, aliases/synonyms, and deterministic ranking.
Return omitted counts and query guidance.
Benchmark retrieval with real model queries and actual tool vocabularies.
Unit tests for substring matching are not evidence of model success.

## Finding 15 — stale search results need exact terminal errors

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: Turn 3 returns a full signature for a granted tool; Turn 8 revokes the grant; Turn 12 calls the remembered canonical target; If dispatch trusts transcript knowledge, revoked authority executes; If it rechecks correctly but returns generic not-found, the model searches repeatedly; If it exposes current existence, an ungranted caller gets a capability oracle.
Near-miss scenario:
Scenario: The model calls `mcp__linear__create`; Prefix/fuzzy dispatch selects `mcp__linear__create_issue`; A typo becomes an authority decision.
**Concrete fix**  
Dispatch is exact-match only.
Never auto-run a suggestion.
Define stable outcomes such as:

- `TOOL_ID_UNKNOWN`;
- `TOOL_CATALOG_STALE`;
- `TOOL_NOT_GRANTED`;
- `TOOL_UNAVAILABLE`;
- `TOOL_ARGUMENTS_INVALID`.
Suggestions may be returned only from the caller's current granted projection.
For high-confidentiality connectors, collapse unknown and ungranted into a non-oracular safe error.

## Finding 16 — search results are an unbounded prompt-injection channel

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: An MCP provider supplies a 40 KB description containing hostile instructions; `search_tools` returns the full description and schema; The result enters the model transcript as trusted-looking tool output; The provider text tells the model to call a destructive neighbor tool; The result also consumes the remaining context window; A broad query returns ten such tools; One search creates hundreds of kilobytes of persistent history.
Authorization controls what may execute.
It does not make provider descriptions trustworthy.
**Concrete fix**  
Apply hard limits per description, schema, hit, page, and total result.
Strip or quote provider prose as untrusted data.
Prefer server-authored summaries plus schema fields.
Reject or quarantine oversized/unsupported schemas.
Default to exact/best-one results, not a large page.

## Finding 17 — “token budget” has no defined accountant

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: Catalog construction counts JSON characters divided by four; The provider adapter rewrites schemas into its own wire format; The selected model uses a different tokenizer; Property names and enum-heavy schemas tokenize badly; The real request exceeds the configured budget; The session switches model on a later turn (`createHarness.ts:273-286`); The resident selection remains fixed because tools were captured at session creation; A budget that was valid for model A is invalid for model B.
There is no token-count utility in the current Agent catalog path.
`AgentTool` stores raw JSON Schema only (`shared/tool.ts:10-20`).
**Concrete fix**  
Define the unit explicitly.
Use a deterministic estimate over the exact canonical provider projection, with conservative headroom.
Then enforce the actual selected model's request/context limits at send time.
Record actual input, cache-read, and uncached token usage for calibration.
Do not put tokenizer/model choice into heavyweight runtime binding identity.

## Finding 18 — impossible budgets have no valid implicit behavior

**Severity: SERIOUS**  
**Failing scenario A**
Scenario: Configured total budget is 2,000 tokens; Always-resident core tools require 2,600; The implementation either violates budget,
truncates required schemas, or silently drops core tools.
Scenario: Every option breaks the contract.
**Failing scenario B**
Scenario: Core consumes 1,200 of a 2,000 budget; The next ranked full signature costs 1,100; Only 800 remain; Truncation produces a false schema; Stopping selection can starve later 100-token tools.
**Concrete fix**  
Define separate budgets:

- a non-negotiable core floor;
- an optional full-signature residency budget;
- a hard provider request ceiling.
If core exceeds the supported ceiling, fail configuration/startup with a measured breakdown.
Never truncate a schema.
Skip an oversized optional tool and continue deterministic selection.
Move the entire tool to searchable residency.
Quarantine any single signature that exceeds a separate hard byte/schema limit.

## Finding 19 — small schemas can crowd out valuable tools

**Severity: MINOR**  
**Failing scenario**  
Scenario: Selection greedily packs tools by signature size; Twenty obscure 100-token tools become resident; A frequent 2,000-token tool is always searchable; Most real tasks pay a retrieval round trip; The nominal budget is full but product utility is worse.
The inverse failure occurs if ranking uses global popularity: one connector can monopolize residency and starve every other namespace.
**Concrete fix**  
Define pinned/core policy, measured value/frequency ranking, per-namespace fairness, and deterministic tie-breaks.
Version the ranking policy in the immutable catalog digest.
Do not let per-user dynamic popularity mutate runtime binding identity.

## Finding 20 — provider limits exist beyond token count

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: The selected signatures fit the token budget; The provider has a maximum tool count; One name exceeds provider length or character rules; One schema uses unsupported JSON Schema keywords; The model request is rejected before the turn starts.
A host-side searchable tool may be executable locally even when its native signature cannot be admitted to a provider's tool-definition dialect.
**Concrete fix**  
Run provider/model-specific admission validation on the resident tier.
Validate tool count, name constraints, schema depth, enum size, supported keywords, and request size.
Keep richer host-only schema metadata out of the native provider definition when necessary.
Validate target arguments locally at dispatch against the canonical full schema.

## Finding 21 — per-user catalog identity contradicts the current binding cache

**Severity: FATAL**  
**Failing scenario**  
Scenario: Alice and Bob share one workspace and Agent; Alice has broader grants; Her post-grant catalog digest enters `resolved.identity`; Alice opens the Agent first; `createAgentHost` publishes a canonical current binding; Bob resolves a different semantic identity; The canonical-current key is only `[agentTypeId, workspaceScopeId, physicalBindingIdentity]`; Existing current binding is returned before the new identity is used (`createAgentHost.ts:396-418`); Bob can receive Alice's composition/catalog.
If `physicalBindingIdentity` is varied to avoid reuse, the host creates separate heavyweight bindings per subject/grant set.
That contradicts D29's one canonical current binding per workspace plus Agent (`DECISIONS.md:467-476`).
**Concrete fix**  
The binding digest may contain only actor-neutral installed inventory and implementation/schema revision.
Mutable per-subject authorization must not enter runtime binding identity.
Build a cheap invocation-scoped projection keyed by subject/grant revision/inventory digest.
Dispatch reauthorizes independently against current authoritative state.

## Finding 22 — the alternative is a cache-cardinality explosion

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: There are `T` independently grantable tools; There are theoretically `2^T` grant-set digests; Observed bindings grow with unique subject grant sets and revisions; Example deployment:; 500 workspaces; 40 users per workspace; 4 Agents per workspace; One catalog-specific binding per user and Agent; That is 80,000 compositions before grant revisions; Each composition can own a harness,
session maps, tool adapters, connector clients, and lifecycle state.
Scenario: Every grant edit produces another identity; Pinned sessions keep old identities alive.
This is exactly the cache-cardinality failure the capability analysis warned about.
**Concrete fix**  
Keep one actor-neutral binding per workspace and Agent physical slot.
Cache only small policy projections by:
```text
(workspace, agent, principal, grantRevision, installedInventoryDigest)
```
Make that cache bounded, evictable, and non-authoritative.
Never let it own harness/session/provider-client lifecycle.

## Finding 23 — catalog identity can strand shared sessions

**Severity: FATAL**  
**Failing scenario**  
Scenario: Alice creates a workspace session under catalog identity A; The session persists runtime scope identity A; Bob opens the same session under catalog identity B; `bindingForSession` compares the pin with newly resolved identity; A mismatch throws `AGENT_SESSION_RUNTIME_SCOPE_MISMATCH`
   (`embeddedGateway.ts:569-635`).
Scenario: The shared workspace session is now inaccessible to Bob; Alice's own grant edit can likewise make her old session mismatch.
The design has converted authorization variability into session compatibility identity.
That is the wrong axis.
**Concrete fix**  
Persist only actor-neutral installed inventory/runtime compatibility in session identity.
Store grant revision in per-invocation authorization and approval evidence, not the session pin.
A later user with narrower grants may view the transcript, but current search/dispatch must project and enforce that user's current authority.

## Finding 24 — catalog digests can churn on meaningless changes or miss meaningful ones

**Severity: SERIOUS**  
**Failing scenario A**
Scenario: Digest hashes raw serialized schema and description text; A provider changes object property order; A description fixes punctuation; Runtime identity changes; Bindings and session compatibility churn without executable change.
**Failing scenario B**
Scenario: Digest hashes canonical ids only; The implementation or schema changes under the same id; The binding digest remains stable; Cached validation and approval use stale semantics.
**Concrete fix**  
Define separate identities for:

- executable registration/version;
- canonical sorted validation schema;
- model-facing presentation text;
- installed inventory revision;
- mutable grant revision.
Only actor-neutral execution compatibility belongs in binding identity.
Presentation changes should invalidate presentation caches, not strand sessions.
Grant changes should invalidate authorization projections, not rebuild the harness.

## Finding 25 — the claimed savings survive only under narrow retrieval behavior

**Severity: SERIOUS**  
**Failing scenario and model**  
Use a realistic 20-turn session.
Assume the full installed catalog is 50,000 manifest tokens.
Assume resident core, budgeted signatures, summaries, and the two dispatcher tools total 4,000 tokens.
With no prompt caching:
```text
full catalog: 20 × 50,000 = 1,000,000 tool-context tokens
compressed base: 20 × 4,000 = 80,000 tool-context tokens
```
Now assume eight searches on turns 2, 4, 6, 8, 10, 12, 14, and 16.
If each returns one 1,200-token signature, those blocks persist across 18+16+14+12+10+8+6+4 = 88 later turn contexts.
```text
search history: 88 × 1,200 = 105,600
compressed total: 80,000 + 105,600 = 185,600
saving versus full: about 81%
```
That case works.
Now use a default page of ten hits totaling 8,000 tokens.
```text
search history: 88 × 8,000 = 704,000
compressed total: 80,000 + 704,000 = 784,000
saving versus full: about 22%
```
Now search on fifteen turns with 8,000-token pages.
Those pages persist across 19+18+...+5 = 180 later contexts.
```text
search history: 180 × 8,000 = 1,440,000
compressed total: 80,000 + 1,440,000 = 1,520,000
regression versus full: 52% worse
```
The architecture does not inherently save tokens.
It saves tokens only if retrieval is rare, narrow, and context projection expires old signatures.
**Concrete fix**  
Persist full results for audit if required, but do not replay every full signature forever into model context.
After use, project old results as `{canonicalId, signatureDigest, outcome}`.
Cap search to best-one/exact hits by default.
Benchmark real 20-turn traces before calling the design a saving.

## Finding 26 — prompt caching can erase the billing advantage

**Severity: SERIOUS**  
**Failing scenario**  
Assume cached input tokens cost an illustrative 10% of fresh input.
A stable 50,000-token full catalog over 20 turns costs approximately:
```text
50,000 × (1 + 19 × 0.1) = 145,000 equivalent fresh tokens
```
The 4,000-token resident base costs:
```text
4,000 × (1 + 19 × 0.1) = 11,600 equivalent fresh tokens
```
Eight broad 8,000-token search pages have fresh writes and many cached replays.
Under a plausible eight-first-read plus eighty-cached-repeat model:
```text
8,000 × (8 + 80 × 0.1) = 128,000 equivalent fresh tokens
compressed total = 139,600
```
That is only about 4% below the stable full catalog, before extra output tokens and latency.
The exact price depends on provider caching, but that is the point: raw context occupancy is not billed cost.
**Concrete fix**  
Define the optimization target:

- maximum context occupancy;
- uncached input tokens;
- billed cached input tokens;
- latency;
- task success;
- number of model invocations.
Gate rollout on measured net results for the supported models/providers.
Do not claim savings from a static manifest-size comparison.

## Finding 27 — search adds model round trips the cost model ignores

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: The model cannot call a missing full signature safely; It emits `search_tools`; The host returns signatures; Pi calls the model again to choose and invoke the target; One user turn now contains at least two model invocations; Search on twelve of twenty turns produces roughly 32 model invocations,
not 20.
Scenario: The resident catalog is serialized on those continuation invocations too; Latency increases even when billed tokens fall; The model can search again if the first query misses.
**Concrete fix**  
Include continuation invocations in the cost benchmark.
Measure p50/p95 time to first useful effect, not just tokens.
Consider exact invocation handles in summaries for common tools, or provider-native deferred tool mechanisms if available.
Do not hide the retrieval round trip in “one turn”.

## Finding 28 — current MCP grants are metadata, not enforcement of the composed tools

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: `runtimeCapabilityProjection.resolveBinding` lists and resolves MCP grants; It returns them as `mcpGrants` metadata (`runtimeCapabilityProjection.ts:255-270`); It separately returns `tools: binding.composition.tools` (`:272-276`); The composition's executable array was built elsewhere; An implementation filters the displayed catalog using `mcpGrants`; `call_tool` dispatches from the unfiltered composition array; The displayed authority and executable authority diverge.
Calling this “double enforcement” would be false.
One path is projection metadata.
The other path is executable lookup.
**Concrete fix**  
Create one authoritative resolver that takes verified invocation context and returns an immutable admitted execution plan.
Use that resolver for both search projection and dispatch.
Search may cache its non-authoritative result.
Dispatch must never rely on the cache.
Prove default-deny when grants are absent, malformed, revoked, or unavailable.

## Finding 29 — dispatch can recurse into itself

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: The installed host inventory includes resident `call_tool`; Search returns it accidentally; The model calls `call_tool({name:"call_tool",args:{...}})`; The dispatcher resolves itself; It recurses until stack,
depth, or rate limits fail.
Second scenario:
Scenario: `call_tool` dispatches `search_tools`; Search returns an invocation handle for `call_tool`; A cycle forms across meta-tools.
Third scenario:
Scenario: A host tool delegates back to `call_tool` internally; The cycle is not visible because child calls are swallowed.
**Concrete fix**  
Exclude dispatcher/meta-tools from the dispatchable installed catalog.
Keep a canonical denylist for infrastructure controls.
Add an invocation stack and hard depth/cycle guard.
Test self-call, mutual recursion, and malicious provider aliases.

## Finding 30 — abort and revocation cannot stop a side effect already admitted

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: Approval completes; Admission succeeds; Provider request begins; The user presses Stop; The outer abort signal fires; The provider ignores cancellation or has already committed; UI marks the generic `call_tool` aborted; The inner side effect actually succeeded; A later retry duplicates it.
This is worse when the child operation is invisible.
The current UI can show “aborted” without an inner outcome record.
**Concrete fix**  
Forward abort signals, but model terminal outcomes honestly:

- canceled before dispatch;
- canceled during dispatch;
- completed;
- failed before effect;
- outcome unknown.
Never automatically retry outcome-unknown calls.
Use provider idempotency only where the exact tool supports it.
Persist the child execution receipt independently of the outer UI state.

## Finding 31 — search and dispatch can leak capability existence

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: An ungranted user guesses canonical ids; `call_tool` returns “tool exists but is not granted” for valid ids; It returns “not found” for invalid ids; Repeated guesses enumerate installed private connectors; Search suggestions make enumeration faster.
The existing route code deliberately authorizes before existence checks to avoid an oracle (`runtimeCapabilityProjection.ts:299-307`).
The new tool path must preserve that discipline.
**Concrete fix**  
Authorize the subject and projection before target existence is disclosed.
Return uniform safe errors where connector existence is sensitive.
Generate suggestions only from the current granted projection.
Keep detailed internal diagnostics in value-safe telemetry, not model-visible text.

## Finding 32 — schema validation can become a CPU and memory denial of service

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: A provider installs a deeply recursive or huge schema; Catalog digest canonicalization traverses it repeatedly; Token estimation serializes it repeatedly; Search returns it repeatedly; Dispatch compiles validators on every call; Concurrent users exhaust CPU and heap; A malformed cyclic JavaScript object crashes canonicalization.
**Concrete fix**  
Bound schema bytes, depth, property count, enum count, reference graph, and compilation time at installation.
Require plain acyclic JSON data.
Compile validators once per immutable schema digest.
Cache compiled validators in the actor-neutral installed inventory.
Quarantine invalid tools before they reach summaries or search.

## Finding 33 — catalog construction failure can take out the whole Agent

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: One installed connector returns a malformed signature; Catalog identity construction throws; Binding construction fails; Always-resident core tools become unavailable too; The entire Agent cannot start because one optional provider is bad.
Opposite failure:
Scenario: The implementation silently skips the malformed tool; The digest does not record the quarantine diagnostic; Different replicas build different catalogs; Search and dispatch disagree across requests.
**Concrete fix**  
Define deterministic quarantine behavior.
Optional invalid tools are excluded with stable diagnostics included in catalog identity.
Core-tool invalidity fails startup loudly.
Provider inventory fetch failure uses a declared availability policy: last-known immutable inventory with expiry, or fail-closed searchable provider, never silent broadening.

## Finding 34 — old sessions have no migration semantics

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: A session begins before #1226 with native tool-call events; Deployment enables wrapper dispatch; The same transcript now contains native and outer-wrapper events; Renderer grouping treats them as different tools; Replay cannot correlate wrapper calls with canonical children; A rollback restores native tools; New child-event fields are unknown to the old frontend; Pending approvals created under the wrapper no longer have an executor.
**Concrete fix**  
Version the event/projection contract.
Define additive reader behavior for old and new events.
Do not rewrite historical events.
Drain or terminally stale pending approvals during rollback.
Canary on new sessions first.
Keep dispatch and renderer compatibility until all supported clients understand child identity.
Provide a rollback test using a mixed native/wrapper transcript.

## Finding 35 — the two-tool API is too weak for safe stale-state handling

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: `search_tools({query})` returns only full signatures; `call_tool({name,args})` accepts only a name and arguments; There is no catalog revision in the call; There is no schema digest in the call; There is no canonical id in the call; There is no connector/account selection in the call; Dispatch cannot tell whether the model is using a current result or stale transcript memory; It must either re-resolve a mutable alias or reject too much.
**Concrete fix**  
The API must carry a versioned invocation handle from search to call.
Example:
```ts
search_tools({query}) -> {
  hits: [{
    handle,
    canonicalToolId,
    catalogRevision,
    schemaDigest,
    modelName,
    signature
  }]
}
call_tool({handle, args})
```
The handle is not authority.
Dispatch still reauthorizes.
It is exact target identity plus stale-state detection.
The current `{name,args}` contract should not survive planning.

## Finding 36 — approval UI provenance is unrecoverable from the outer call id

**Severity: SERIOUS**  
**Failing scenario**  
Scenario: A proxied tool asks for human input; Ask User persists the supplied `toolCallId` (`createAskUserTool.ts:85-100`); The only available id is the outer `call_tool` id; The pending record cannot prove which canonical inner operation raised it; Inbox grouping and incident review attribute the question to the dispatcher; A nested approval inside an already approval-gated call becomes ambiguous; The UI cannot distinguish “approve execution” from “tool asks a domain question”.
**Concrete fix**  
Persist child call identity and approval purpose explicitly.
Execution approval and ordinary `ask_user` interaction need distinct typed intents on the same shared approval runtime.
Do not infer purpose from wrapper arguments or display copy.
Reject nested execution approvals unless the protocol defines how they compose.

## Finding 37 — the design has not chosen its source of truth

**Severity: FATAL**  
**Failing scenario**  
Four candidate truths now exist:
Scenario: installed host-side tool array;; grant-filtered catalog snapshot;; model-facing search result retained in transcript;; dispatch-time tool registry.
If the host array wins, revoked tools remain discoverable.
If the catalog snapshot wins, it becomes stale during approval.
If transcript state wins, revocation is impossible.
If dispatch registry wins without matching presentation identity, the UI and approval describe something else.
**Concrete fix**  
Declare the layers explicitly:

- immutable installed inventory is execution metadata, not authority;
- current grant store is authorization truth;
- search projection is a disposable hint;
- invocation handle identifies a versioned target, not permission;
- dispatch admission is the only effect gate;
- approval binds one immutable admitted plan but does not replace reauthorization.
Until this hierarchy is written into the epic, different slices will implement incompatible truths.

## Required acceptance tests before implementation planning

Scenario: Real Pi loop emits a proxied call with canonical inner identity on the live start event; A name-keyed renderer is selected while the call is pending; A renderer receives direct inner arguments, not `{name,args}`; Child progress survives; Child file changes survive; Child cancellation and outcome-unknown states survive; Durable replay reconstructs the same child card; Telemetry records canonical inner identity and outer parent id; Direct and proxied execution use the same approval/admission pipeline; An unapproved protected tool cannot execute through `call_tool`; Approval binds canonical id,
implementation digest, schema digest, grant revision, call id, and canonical argument digest.
Scenario: Revoke while approval waits produces zero provider calls; Regrant under the same alias makes the old approval stale; Two identical concurrent calls require two approvals; Approval replay dispatches at most once; Revocation and admission have a tested linearization rule; A stale search result cannot execute after revocation; A near-match name never executes; Cross-connector same-name tools cannot borrow each other's grant; Duplicate `call_tool` or `search_tools` registration fails startup; Alice's broader catalog cannot become Bob's current binding; Alice and Bob can open the same session without runtime-scope mismatch; Grant edits do not create heavyweight binding generations; Search results come from current grants in pinned sessions; Core-over-budget configuration fails deterministically; Oversized optional signatures move whole to search; they are never truncated; Provider tool-count/name/schema limits are validated before a model call; Oversized or hostile provider descriptions are bounded and treated as untrusted; Self-dispatch and recursive dispatch fail stably; Mixed old/new transcripts replay across rollout and rollback; A 20-turn benchmark reports actual provider input,
cache-read, output, invocation count, latency, and task success.
Scenario: The benchmark includes rare narrow search,
broad frequent search, no-match retries, and model switching.

## Unknowns ledger

### Known-knowns

- Current composition uses a static plain-concatenated tool array.
- Pi resolves the first matching model-facing name.
- `PiChatEvent.tool-call` carries one `toolName` and one `toolCallId`.
- `PiChatEvent.tool-result` carries no tool name.
- Renderer resolution uses `rendererId` and then `toolName`.
- Current `AgentTool` has no approval contract.
- Current grant store has no revision or atomic admission API.
- Current sessions pin runtime scope identity.
- Current canonical current binding is workspace/Agent/physical-slot scoped.

### Known-unknowns

- Exact definition of the residency budget.
- Exact ranking and fairness policy.
- Exact catalog digest fields.
- Exact revocation linearization semantics.
- Exact provider/model tokenizer accounting.
- Exact search ranking,
paging, and result limits.

- Exact rollout compatibility for existing sessions.

### Unknown-knowns surfaced by code

- Renderer identity lives in the event/view model,
not merely the server catalog.

- Tool arrays are captured at Pi session creation.
- Runtime scope identity is a persisted session compatibility boundary.
- Canonical-current reuse occurs before a different semantic identity can win.
- Ask User provenance uses the supplied tool call id.
- File-change extraction depends on the outer result/input shape.

### Unknown-unknowns that now block planning

- Whether a child tool event contract will be added or native dynamic tools will be used.
- Whether approvals operate on typed child invocations or generic outer calls.
- Whether grant storage can support revisioned atomic admission.
- Whether search result bodies can be elided from later model-context projection.
- Whether provider-native tool constraints permit the proposed resident selection.
- Whether the cost saving survives real prompt caching and retrieval frequency.

## Evidence limitations

`gh issue view 1226` and `gh issue view 900` were attempted, but this sandbox could not connect to `api.github.com`.
The review therefore used:

- the supplied #1226 design summary and attack requirements;
- `origin/main` versions of every cited implementation file;
- `origin/main:docs/DECISIONS.md` Decisions 28 and 29;
- the locally available #900 plan commit `b8cfbb736`,
  which states the exact Ask User approval state machine;

- the supplied fact that Pi uses first-match tool lookup.
The named `research/r7-fga.md` and `research/w13-opencode.md` files were not present in the workspace or `origin/main`, so claims attributed only to those missing files were not treated as proof.

## Verdict

#1226 is not ready to plan against.

It needs rework first.
The proposed `call_tool({name,args})` wrapper breaks the central renderer-identity premise, swallows the inner operation, creates a direct approval bypass, and gives no sufficient target/version material for stale-safe dispatch.
“Check grants twice” does not define revocation during approval or effect admission.
Folding per-user authorized catalog identity into the binding digest either leaks the first user's catalog, explodes binding cardinality, or strands shared sessions.
The token-saving claim is conditional and can reverse under broad frequent search.
Do not decompose this epic into implementation tickets.
Rewrite it around a first-class canonical child invocation, one immutable post-validation execution plan, post-approval revisioned admission, actor-neutral installed inventory, invocation-scoped authorization projection, and measured context lifecycle.
Anything less will ship a confused deputy with a generic UI card and fake cost savings.

# opencode V2 as a peer product: ranked harvest

## Verdict

opencode V2 is the closest peer because it makes sessions, agent identity, permissions, plugins, and a server API into one product surface.
Its best ideas are not its tool plumbing.
They are durable prompt admission, explicit replay semantics, staged conversation-plus-files undo, project-scoped remembered approvals, user-authored agent profiles, and a generated server client.
Its worst ideas are equally clear.
The default build agent is allow-most, shell authorization matches raw command text, plugins are arbitrary in-process code, child agents do not inherit a restrictive parent policy, and the V2 beta explicitly disclaims data/API stability.
boring-ui should copy the product affordances, not those trust boundaries.
Source baseline: opencode `dev` branch and live V2 docs fetched 2026-08-11; boring-ui is read only from `origin/main`.

## Ranked harvest

### 1. Durable admission before execution

**Idea**
Accept user intent durably before trying to run the agent.
Return an admission identity that makes an exact retry idempotent.
Keep execution wake-up separate and advisory.

**Mechanism**
`sessions.prompt({ id?, sessionID, prompt, delivery?, resume? })` inserts a durable `session_input` row.
Reusing the same message ID with the same payload returns the same admission receipt.
Reusing it with a different session, prompt, or delivery mode conflicts.
`resume: false` records without waking execution.
Promotion atomically consumes the inbox row and appends the visible user message.
Interrupted runs retain admitted inbox rows for later wake/resume.

Source: `specs/v2/session.md:3-30`, `specs/v2/session.md:32-42`.

**What it gives us**
A refresh, server restart, client retry, or ambiguous network response no longer has to mean “maybe the prompt was lost, maybe it ran twice.”
It gives the UI an honest queued state before a prompt becomes model-visible.
It turns restart recovery into reconciliation from durable facts instead of reconstruction from transient process state.
This is the strongest direct harvest for AgentGateway.
boring-ui already has the right lower-level vocabulary: request keys, payload digests, admission receipts, compare-and-swap state, completed receipts, and `outcome-unknown`.

Source: `origin/main:packages/agent/src/server/agent-host/types.ts:35-56`, `:72-110`, `:118-131`.
The SQLite request ledger is WAL-backed and atomically claims a complete request key with `INSERT OR IGNORE`; transitions compare the expected prior state.

Source: `origin/main:packages/agent/src/server/agent-host/sqliteRequestLedger.ts:38-77`, `:80-131`, `:149-173`.
The missing product move is to expose “admitted but not promoted” as a first-class UI/session state instead of keeping admission mostly inside the gateway effect protocol.

**Cost**
Requires a durable inbox schema, a promotion transaction, idempotency keys from every client, and cleanup/retention policy.
Every mutating endpoint must define exact-retry versus conflicting-reuse semantics.

**What it breaks**
It breaks the convenient fiction that POST success and agent execution are one operation.
Clients must render admitted, promoted, running, settled, rejected, and outcome-unknown separately.
That complexity is real and worth paying.

### 2. Reconnect-safe session event stream as a product contract

**Idea**
Separate an instance-wide live event feed from a session-specific durable replay feed.
Use a durable aggregate sequence as the reconnect cursor.

**Mechanism**
`events.subscribe()` is instance/workspace-wide, live-only SSE.
It includes connection, heartbeat, and disposal events but has no replay guarantee.
`sessions.events({ sessionID, after })` verifies the session, replays committed session events after a sequence, then tails new durable events.
Live text/reasoning/tool-input fragments are deliberately excluded from the durable cursor.
Neither generated client automatically reconnects.
A disconnected live client must refresh authoritative state and resubscribe.
A disconnected durable-session client can retain the last aggregate sequence and reopen with `after`.

Source: `CONTEXT.md:140-156`; `specs/v2/session.md:112-147`.
The finite history endpoint defaults to 50 durable events and accepts at most 100 per page.

Source: `specs/v2/session.md:149-176`.

**What it gives us**
A precise answer to “what happens on reconnect?”
No event cursor pretends to cover ephemeral deltas that cannot actually be replayed.
Multiple clients can independently attach to one session and converge on the same durable history.
Each client may still render low-latency live fragments while connected.
boring-ui’s client is already better automated at the edge: it hydrates `/state`, records the snapshot sequence, attaches `/events?cursor=…`, and on failure rehydrates before reconnecting.

Source: `origin/main:packages/agent/src/front/chat/pi/remotePiSession.ts:307-351`.
Its stream helper uses jittered exponential backoff capped at 30 seconds.

Source: `origin/main:packages/agent/src/front/chat/pi/piChatStream.ts:212-258`.
Do not copy opencode’s “caller must compose reconnect” UX.
Copy the protocol distinction, then retain boring-ui’s automatic recovery loop.

**Cost**
Durable events need ordered sequence allocation and replay retention.
The UI needs a merge rule for durable settlements versus ephemeral fragments.

**What it breaks**
It breaks a single undifferentiated SSE bus.
It also exposes that process activity is not durable: opencode’s active-session registry is cleared by restart.

Source: `CONTEXT.md:162-167`; `specs/v2/session.md:18-29`.

### 3. Conversation-plus-files staged undo

**Idea**
Make “undo the last agent turn” a product operation spanning both chat history and worktree changes.
Stage it visibly before committing it.

**Mechanism**
Before and after clean model steps, opencode attempts filesystem snapshots in a separate internal Git object database.
It records changed paths on the assistant message.
`/undo` stages a boundary at the latest non-empty user message.
Later messages become hidden, the prompt returns to the composer, and affected paths are restored.
Repeated undo widens one staged range.
`/redo` restores the exact pre-undo filesystem state and unhides the messages.
Sending a new prompt commits the staged revert and removes the hidden range from the active projection.

Source: V2 Undo docs `snapshots:44-82`.
The server exposes stage, clear, and commit endpoints rather than forcing this to remain TUI-only internals.

Source: V2 API docs `api:282-295`.

**What it gives us**
A recovery affordance users understand immediately.
It is materially better than asking users to identify tool calls, manually reverse patches, and edit chat context mentally.
It creates a review checkpoint before destructive rollback.
boring-ui has inline edit diffs and collapses long diffs, which is useful but not undo.

Source: `origin/main:packages/agent/src/front/bareToolRenderers/DiffView.tsx:44-79`; tests at `DiffView.test.tsx:5-67`.
The requested-path search found no conversation/worktree undo or redo implementation; “snapshot” hits are transport state snapshots, not filesystem checkpoints.
Search source: `git grep -i -E 'checkpoint|snapshot|undo|redo|revert' origin/main -- packages/agent/src/server/agent-host packages/agent/src/server/harness/pi-coding-agent packages/agent/src/front`.

**Cost**
High.
Requires per-step attribution, a private object store, ignored/untracked-file rules, size limits, staged state, and careful dirty-worktree UX.

**What it breaks**
It can overwrite edits made after staging.
It cannot reverse databases, services, network effects, processes, Git metadata, ignored files, or out-of-scope paths.
Capture is explicitly best effort; interrupted steps can leave changes without an end snapshot.

Source: V2 Undo docs `snapshots:88-98`.
Harvest the staged interaction and narrow path restoration.
Do not market it as a transaction or backup.

### 4. Permission rules users can inspect and remember

**Idea**
Represent permission policy as ordered `(action, resource, effect)` rules and make approval scope explicit.

**Mechanism**
Each rule has `action`, `resource`, and `effect: allow|ask|deny`.
Both action and resource support `*` and `?`; the last matching rule wins.
Global rules are loaded before agent-specific rules.
Multi-resource operations deny if any resource denies, otherwise ask if any asks.

Source: V2 Permissions docs `permissions:43-78`.
Resources are action-specific: relative/canonical paths for read/edit, raw command text for shell, agent ID for subagent, URL for webfetch, query for websearch, and `*` for an MCP tool.

Source: V2 Permissions docs `permissions:79-97`.
An approval response is `once`, `always`, or `reject`.
`always` persists proposed allow patterns for the current project.
Saved approvals cannot override configured deny rules.

Source: V2 Permissions docs `permissions:166-174`.
The API lists pending requests, per-session requests, saved permissions, and supports deleting saved permissions.

Source: V2 API docs `api:98-105`.

**What it gives us**
A coherent UX for “why am I being asked?” and “what will always mean?”
Project-scoped saved grants are a useful middle ground between one call and global machine trust.
It is broader than boring-ui’s current per-agent MCP grants, which are exact connector/tool allowlists.
boring-ui’s MCP model is safer: a missing exact `(workspaceId, agentTypeId, connectorId)` grant yields nothing, wildcard tool names are rejected, and a catalog intersection drops unknown tools.

Source: `origin/main:packages/agent/src/server/agent-host/mcpGrants.ts:3-19`, `:32-47`, `:94-167`.
Those grants persist as durable workspace resources keyed by agent and connector.

Source: `origin/main:packages/agent/src/server/agent-host/mcpGrantStore.ts:19-38`, `:95-133`.
Recommended composition: preserve exact default-deny capability grants as the outer authority boundary, then add opencode-style `ask/once/always` only inside capabilities already granted.

**Cost**
Rule editors, match previews, deletion UI, audit trail, pending-request transport, and stable normalization.

**What it breaks**
opencode’s default build agent allows most actions and asks mainly for `.env` and external-directory access.

Source: V2 Permissions docs `permissions:124-142`.
That is weaker than boring-ui’s per-agent default-deny MCP posture.
Shell resources are raw strings, not parsed argv or a semantic command plan.
External-directory enforcement covers shell working directory, not every path embedded in a command.

Source: V2 Permissions docs `permissions:98-123`.
This is a major security regression if copied directly.
Also worse: a child agent runs with its own configured permissions, not a restricted copy of the parent.

Source: V2 Agents docs `agents:87-90`; Permissions docs `permissions:143-165`.
The public issue tracker documents duplicate equivalent permission prompts from concurrent tools and stale client approvals.

Source: `anomalyco/opencode#36055`.

### 5. User-composable specialised agents

**Idea**
Let users compose a named assistant profile from prompt, model, mode, permissions, step budget, and display metadata.

**Mechanism**
Agents live in `opencode.json(c)` or Markdown files under global/project `.opencode/agents/` directories.
The Markdown filename/path becomes the agent ID; frontmatter is configuration and the body is the system prompt.

Source: V2 Agents docs `agents:91-118`.
Modes are `primary`, `subagent`, or `all`.
Primary agents are session-selectable.
Subagents run in child sessions with fresh context and can be invoked via tool or `@mention`.

Source: V2 Agents docs `agents:76-90`.
Per-agent model references support provider/model and optional variant.
Children use the configured child model or inherit the parent session model.

Source: V2 Agents docs `agents:153-178`.
A non-empty `system` replaces the provider-specific base prompt for that agent while project instructions, skills, and references remain separately composed.

Source: V2 Agents docs `agents:179-183`.
Per-agent ordered permissions control edits, shell patterns, and allowed subagents.
`steps` removes tools on the final step and asks for a text summary.

Source: V2 Agents docs `agents:184-212`.

**What it gives us**
A specialised agent becomes a small inspectable file users can commit and share.
The agent selector is a product primitive rather than app-specific fleet wiring.
boring-ui already supports authored instructions, label/version, plugin config, preferred model, session namespace, tools, and runtime scope.

Source: `origin/main:packages/agent/src/server/agent-host/types.ts:158-177`, `:217-269`.
Agent preferred models are strict, isolated by agent, and overridden by an explicit per-prompt model.

Source: `origin/main:packages/agent/src/server/agent-host/buildAgentComposition.ts:183-210`; `modelPolicy.test.ts:127-174`.
The missing product layer is a user-facing, file-based agent authoring contract with modes and permission previews.

**Cost**
Configuration merge semantics, validation, selector UX, prompt replacement rules, child-session navigation, and safe reload.

**What it breaks**
opencode V2 is internally inconsistent during migration: current docs use plural `agents`, `system`, and ordered `permissions`, while implementation files still bridge V1 `agent`, `prompt`, and `permission` shapes.

Source: V2 migration docs; `packages/opencode/src/agent/agent.ts:257-283`.
Per-agent `request` headers/body are accepted but currently not applied to model calls.

Source: V2 Agents docs `agents:224-238`.
Do not copy accepted-but-inert configuration.

### 6. One generated server contract for every client

**Idea**
Make the HTTP API authoritative and generate browser/Node/Effect clients from it.
Support network and in-process transports without separate domain implementations.

**Mechanism**
The V2 wire protocol is HTTP request/response plus SSE streams.
The client is generated from the same `HttpApi` used by the server.
`@opencode-ai/client` takes a base URL and exposes grouped resources.
Streaming endpoints return async iterables.

Source: V2 Client docs `client:26-74`.
The Node service helper can discover, ensure, version-check, start, authenticate to, and stop a local background server.

Source: V2 Client docs `client:75-104`.
The embedded SDK executes the same assembled router in memory; only the HTTP client transport changes.

Source: `CONTEXT.md:125-150`.
Sessions are addressed by stable `sessionID`; location/workspace is middleware/context rather than a second session identifier.
The API offers create/get/list/export/import/fork/prompt/command/shell/compact/wait/interrupt/model/agent operations.

Source: V2 API docs `api:151-187`, `api:282-308`.

**What it gives us**
TUI, web, desktop, IDE, automation, and plugins can share a typed protocol.
A client can attach to an existing local service rather than spawning a private agent process.
This is the closest opencode analogue to AgentGateway.
boring-ui is stronger on ownership and placement: its request key includes workspace scope, authenticated subject, operation, addressed agent/session target, and request ID.

Source: `origin/main:packages/agent/src/server/agent-host/types.ts:35-57`.
It also has environment leases, runtime binding identities, and revocation fences around provider-backed operations.

Source: `origin/main:packages/agent/src/server/agent-host/environmentLease.ts:55-124`; `workspaceAgentLease.ts:86-147`, `:149-205`.
opencode’s server is a cleaner public product protocol; boring-ui’s gateway is a stronger authority/placement protocol.
Harvest generated clients and local-service discovery without flattening AgentGateway’s scope model.

**Cost**
Schema/codegen discipline, compatibility policy, browser-safe packages, auth, stream cancellation, and version negotiation.

**What it breaks**
V2 API/client/plugin contracts are beta and may change.
The Promise client trusts syntactically valid response shapes instead of runtime-validating them.

Source: `CONTEXT.md:129-144`.
Multiple clients have no exclusive session lease.
They observe the same session and can submit, switch agent/model, interrupt, or answer a permission request if authorized.
The serialized runner prevents simultaneous provider turns, but product-level “who owns this interaction?” is not modeled like boring-ui’s verified actor and lease boundaries.
Source/inference: `specs/v2/session.md:29-42`; API surface above. This concurrency conclusion is an inference from shared endpoints plus serialized runner; no explicit multi-client UX contract was found.

### 7. Plugin lifecycle with structural tools and mutation hooks

**Idea**
Give plugins a typed server-client context, scoped registration, cleanup, transforms, runtime hooks, and structural tool definitions.

**Mechanism**
Plugins are npm packages, explicit local paths, or auto-discovered `.ts/.js` entries under `.opencode/plugins/`.

Source: V2 Plugins docs `plugins:40-73`.
Each default export has a unique `id` and `setup`; setup may return cleanup awaited on disable, reload, or shutdown.
Registrations are scope-owned and released automatically.

Source: V2 Plugins docs `plugins:93-123`.
The context exposes agent/catalog/command/integration/session/skill/tool transforms, AI SDK and request hooks, events, and reload methods.

Source: V2 Plugins docs `plugins:124-154`.
Tools use JSON Schema input/output and an async executor; the execution context includes session, agent, message, call ID, and progress.

Source: V2 Plugins docs `plugins:227-267`.
Config and discovered plugin files in watched directories hot reload by generation.
Package installation uses an isolated cache and disables lifecycle scripts.

Source: V2 Plugins docs `plugins:83-92`.

**What it gives us**
A plugin can extend the whole coding-agent product rather than only UI or only tool lists.
Scoped cleanup and composed transforms are excellent lifecycle mechanics.
boring-ui’s two-tier system is better at naming trust: app/internal plugins can add routes/tools; runtime/generated plugins are route-free and use Pi tools.

Source: `origin/main:packages/workspace/docs/PLUGIN_SYSTEM.md:26-63`.
boring-ui also has better partial-failure behavior for UI hot reload: healthy plugins update and a failed front keeps the previous working UI.

Source: `PLUGIN_SYSTEM.md:82-99`, `:254-267`, `:387-399`.
Recommended harvest: scoped registrations, awaited cleanup, ordered transforms, structural tool schemas, and a plugin-facing generated server client.

**Cost**
Large and unstable API surface.
Hook ordering, slow/failing hooks, schema compatibility, generation replacement, and resource cleanup become core concerns.

**What it breaks**
opencode’s plugin trust model is worse.
Local files are directly imported and package plugins execute in the server process.
Disabling install scripts reduces supply-chain exposure but does not sandbox runtime code.
Plugins can fetch, open background tasks, mutate model context, intercept provider HTTP, add tools, prompt sessions, and connect integrations.

Source: V2 Plugins docs `plugins:83-92`, `:124-226`.
There is no equivalent of boring-ui’s route-free runtime/generated tier.
boring-ui is not fully safe either: plugin tool executors run in the host Node process and bypass the sandbox, and hosted/marketplace trust is unimplemented.

Source: `PLUGIN_SYSTEM.md:58-63`.
Do not collapse our two tiers into opencode’s one in-process tier.

### 8. Fork sessions by cloning a chosen history prefix

**Idea**
Let users branch a conversation at a message without destroying the original.

**Mechanism**
`Session.fork` creates a new root session, derives `(... fork #N)` title, clones metadata, and copies messages/parts before the selected message with new IDs and repaired parent/compaction references.

Source: `packages/opencode/src/session/session.ts:154-162`, `:655-693`.
Parent/child sessions are distinct: subagents use `parentID`; a user fork does not set `parentID` in this implementation.

Source: `session.ts:213-233`, `:247-262`, `:655-665`.

**What it gives us**
Safe exploration of alternatives.
A natural recovery path when a long session takes a bad turn.
A better mental model than “clone all JSON and hope references still line up.”

**Cost**
Potentially expensive history duplication and attachment storage.
Needs explicit semantics around pending work, approvals, file state, and snapshots.

**What it breaks**
The fork copies conversation state, not the worktree state at that historical boundary.
Without a paired workspace checkpoint/worktree branch, the new conversation may believe old files still exist.
This is weaker than a true task branch.

### 9. Cost and token accounting as session metadata

**Idea**
Accumulate cost and token classes on the session and expose them in the UI/API.

**Mechanism**
Session rows include cost plus input, output, reasoning, cache-read, and cache-write token counters.

Source: `packages/opencode/src/session/session.ts:73-112`, `:114-152`.
Cost calculation handles cached tokens, reasoning, provider tiers, and Copilot nano-AIU metadata.

Source: `session.ts:321-385`.

**What it gives us**
Users can judge whether a session, model, agent, or warming policy is worth its spend.
The same counters enable budgets, warnings, and product analytics without scraping transcript prose.
boring-ui’s Pi transcript retains provider usage/cost, but the front deliberately has no `/cost` command and the specified UI paths expose no cost view.

Source: fixture `origin/main:packages/agent/src/server/harness/pi-coding-agent/__tests__/fixtures/pi-events-corpus.jsonl:3-9`; negative assertion `packages/agent/src/front/slashCommands/__tests__/builtins.test.ts:138-139`.

**Cost**
Provider-specific accounting normalization and clear “estimated versus billed” labels.

**What it breaks**
Cost values can be wrong when model pricing metadata is stale or a proxy applies different billing.
Treat them as estimates unless reconciled with provider bills.

### 10. Provider retry status with actionable rate-limit state

**Idea**
Classify transient provider failures, honor retry headers, publish retry timing, and explain account limits in product language.

**Mechanism**
opencode recognizes 429/5xx, overload, network, timeout, and resource-exhausted patterns.
It honors `retry-after-ms`, numeric/date `retry-after`, then uses exponential backoff capped at 30 seconds without headers.

Source: `packages/opencode/src/session/retry.ts:23-68`, `:69-138`.
Retry state carries attempt, message, optional action, and next timestamp.

Source: `retry.ts:161-183`.

**What it gives us**
The UI can say “provider overloaded; retrying at 14:03” rather than showing a spinner or terminal error.
Account-limit errors can point to the relevant settings/billing action.
boring-ui already surfaces Pi auto-retry state and has reconnect backoff, so this is not wholly missing.

Source: `origin/main:packages/agent/src/front/chat/pi/__tests__/piChatReducer.test.ts:2221`; `piChatStream.ts:212-258`.
Harvest the actionable retry timestamp and provider-limit reason into the visible session status.

**Cost**
Provider error taxonomy, idempotent request assumptions, cancellation, and maximum retry policy.

**What it breaks**
Current opencode policy has no maximum attempt count for errors classified retryable.
The schedule continues whenever classification returns retryable.

Source: `retry.ts:161-183`; documented consequence in `anomalyco/opencode#21960`.
That can turn a persistent outage into an indefinitely running session and unbounded request spend.
Copy classification and header handling, not infinite retry.

### 11. Local-model/offline-capable configuration

**Idea**
Treat a local OpenAI-compatible endpoint as a normal provider/model, not a separate product mode.

**Mechanism**
Users define a provider package, loopback `baseURL`, explicit model ID, capabilities, and limits.
No credential is required if the endpoint needs none.

Source: V2 Models docs `models:165-195`; Providers docs `providers:134-172`.

**What it gives us**
Agent execution can work without a cloud model when a local server is available.
The session/server/UI architecture remains the same.

**Cost**
Users must know truthful context/output limits and tool capabilities.
Local inference quality and structured tool-call compatibility vary widely.

**What it breaks**
This is not full offline operation.
Package installation, models.dev catalog refresh, remote plugins/instructions, web tools, integrations, and updates can still require network.
No explicit offline-first cache contract was found in V2 docs or source: **UNVERIFIED beyond local model execution**.

### 12. Session warming is clever but probably not for us

**Idea**
Send transient no-tool model requests to keep provider-side caches warm during pauses.

**Mechanism**
Disabled by default.
Default behavior waits four idle minutes, repeats during a thirty-minute active window, uses current session context, discards the reply, and does not mutate durable history.

Source: V2 Warming docs `warming:40-80`.

**What it gives us**
Potentially lower latency or better prompt-cache reuse after a pause.

**Cost**
Real tokens, cost, rate-limit consumption, privacy exposure, and background provider traffic.

Source: V2 Warming docs `warming:81-85`.

**What it breaks**
It violates a simple expectation that idle means no model calls.
It can consume limited quotas and worsen throttling.
Do not harvest until measured provider-specific cache savings exceed cost and trust damage.

## Session model: exact shape

### Storage and restart survival

Current V2 stores sessions in SQLite via Drizzle.
The default database path is `Global.Path.data/opencode.db` for latest/beta/prod, or a channel-suffixed DB for other installation channels; `OPENCODE_DB` can override it.

Source: `packages/core/src/database/database.ts:36-50`.
On Linux, `Global.Path.data` conventionally resolves under the user data directory; observed/default deployments use `~/.local/share/opencode/opencode.db`.
Source for concrete observed path: opencode issues `#13654`, `#14970`, `#32716`.
Platform-specific `Global.Path.data` resolution was not read in this pass: **UNVERIFIED for non-Linux exact paths**.
SQLite uses WAL, `synchronous=NORMAL`, five-second busy timeout, foreign keys, and a passive checkpoint on open.

Source: `database.ts:20-30`.
The schema separates session metadata, message rows, part rows, durable session-message/event projection, todos, and project-scoped permission rows.

Source: `packages/opencode/src/session/session.sql.ts:1-131` in indexed repository source.
A session survives restart because its metadata, admitted prompts, projected messages, parts, context epoch, and durable events are in SQLite.
The process-local active drain does not survive.
On next resume/wake, stale running tools are durably failed as interrupted instead of blindly replayed.

Source: `specs/v2/session.md:27-42`, `CONTEXT.md:116-121`.

### Durability contract

Internally, V2 intentionally uses the word durable and defines atomic admission/promotion/event transactions.
That is a real semantic contract inside one database generation.
It is stronger than V1’s old loose JSON-file persistence.
Operationally, it is not yet a stable product durability guarantee.
The migration guide says V2 is beta, beta data may be wiped, features may break, and server/plugin APIs may change.

Source: V2 migration docs, “Breaking changes” warning.
The database uses `synchronous=NORMAL`, not SQLite FULL durability.
There is no documented backup, restore, retention, corruption recovery, or cross-device sync contract.
There have also been concrete migration/path failures and NFS corruption reports.

Source: opencode issues `#13654`, `#14970`, `#21790`.
Verdict: semantically durable, operationally best-effort beta persistence.
Do not promise more.

### Resume

Sessions are listed and fetched from SQLite, then execution is resumed by stable session ID.
Prompt admission can wake automatically or remain admit-only with `resume:false`.
Interrupt preserves pending input.

Source: `specs/v2/session.md:3-40`.
The selected agent/model are stored on session metadata and apply to later turns.

Source: `session.ts:73-112`, `:410-425`; `CONTEXT.md:109-121`.

### Branching, children, and forks

Subagents create child sessions with `parentID` and fresh context.
User-visible navigation distinguishes parent and children.

Source: V2 Agents docs `agents:76-90`; `session.ts:213-233`.
Forking clones a prefix into a new root session with remapped IDs.

Source: `session.ts:655-693`.

### Sharing

V2 session sharing is not implemented.
The `/share` command only reports unavailable.
The `share` config is parsed but has no runtime effect and is not a privacy control.
There is no public viewer, share URL, sync, retention, or unshare operation.

Source: V2 Sharing docs `sharing:39-59`.
This is worse than mature V1 marketing and must not be credited to V2.

### Compaction

V2 compaction writes a generated checkpoint containing a structured summary plus a recent serialized tail.
Older durable messages are retained but excluded from active model history.

Source: V2 Compaction docs `compaction:42-53`, `:92-106`.
Automatic trigger estimates the final request and compares it with context limit minus the larger of requested output or buffer.
Provider overflow can trigger one compact-and-retry recovery.

Source: `compaction:47-53`.
Manual compaction is durably admitted, coalesces while pending, and runs at a safe drain boundary.

Source: `compaction:54-71`.
The live page fetched on 2026-08-11 reports `keep.tokens=15000` and `buffer=20000`; a separately indexed recent copy reports `keep.tokens=8000` and a reserved inert `prune` field.
Exact current default is therefore source-drifted: **UNVERIFIED until pinned to a commit/release**.
Do not encode either value into our product contract based only on mutable docs.
No separate compaction model or fallback model exists.
Earlier messages are never reclaimed merely because they left model context.

Source: `compaction:101-107`.

### Titles

New sessions begin with timestamp-derived default titles; child sessions use a distinct prefix.

Source: `session.ts:44-50`, `:475-508`.
A hidden `title` maintenance agent exists with tools denied and a dedicated prompt.

Source: `packages/opencode/src/agent/agent.ts:225-240`.
Manual rename is exposed in the API.

Source: V2 API docs `api:282-285`.
The exact trigger that replaces a default title was not read in a V2 runner source: **UNVERIFIED**.

### History and size limits

Session list defaults to 100 rows in the implementation excerpt.

Source: `session.ts:528-546`.
Message reads are paged internally in chunks of 50 but can walk the complete history when no limit is supplied.

Source: `session.ts:780-802`.
Durable event history pages default to 50 and max at 100.

Source: `specs/v2/session.md:149-176`.
These are page limits, not retention limits.
No automatic session TTL, storage quota, history cap, or vacuum lifecycle was found.
Public reports document unbounded database growth, attachments stored inline, and no automatic cleanup.

Source: opencode issues `#16101`, `#22110`, `#32716`.
This is worse than a mature product should be.

## Permissions: direct comparison

opencode V2 decides permission inside the server/tool execution path.
An ask creates a pending request, publishes it to clients, and suspends execution until a reply.
Any authorized connected client can list/reply through the permission API.

Source: V2 API docs `api:98-105`; Permissions docs `permissions:166-174`.
Granularity is stronger than tool-only booleans: action plus path, raw command, URL, query, agent ID, skill ID, or MCP tool name.
Memory has two forms.
`once` settles only the pending request.
`always` persists an allow rule for the project.
Configured denies remain stronger.
There is no documented “allow for this session” tier in V2.
That missing middle tier matters: project persistence is too broad for exploratory commands, while repeated once prompts are noisy.
boring-ui’s MCP grants are per workspace and per agent, persistent, exact-tool default deny.
opencode’s saved approval is per project, not per session, and agent-specific configured rules participate in evaluation.
The saved approval itself is not described as agent-scoped in the docs.
Treat it as project-shared unless source proves otherwise.
opencode is better at interactive approval UX and generic resource matching.
boring-ui is better at outer capability isolation and exact tool authority.
For #1123 exec grants, the requested `origin/main` paths contain approval render states but no authoritative merged exec-grant store/policy identifiable by the supplied name.
Search source: `git grep -i -E 'exec grant|execution grant|command pattern|shell grant|allow once|allow always|approval' origin/main -- packages/agent packages/workspace`.
Comparison to #1123’s exact final exec-grant mechanism is therefore **UNVERIFIED from the user-authorized source set**.
Do not infer it from branch-only work.

## Plugin comparison

opencode has one powerful runtime plugin tier.
boring-ui has two explicit tiers.
opencode’s context is broader: sessions, integrations, model catalog, commands, agents, skills, references, tools, provider HTTP, AI SDK, and events.
boring-ui’s app/internal tier is comparably powerful at boot and additionally owns React panels/surfaces.
boring-ui’s runtime/generated tier is deliberately route-free and cannot receive backend services or raw paths.

Source: `PLUGIN_SYSTEM.md:39-63`.
opencode plugin tools reach the model by registering structural definitions into the tool transform.
The product-level harvest is lifecycle: generation-scoped registration, awaited cleanup, deterministic ordered transforms, and one plugin-facing client.
The trust conclusion is blunt.
opencode is worse than us because all plugin runtime code is trusted in-process code with a huge mutation surface.
boring-ui is only partially better because app/internal tools also bypass sandbox and hosted untrusted plugins remain unimplemented.
The direction should be three tiers, not one:

1. app/internal trusted boot code;

2. workspace-local developer code with sharply brokered capabilities;

3. hosted/marketplace code isolated from host process and native React tree.

## Server/client and AgentGateway comparison

opencode’s strongest server decision is a public generated contract.
boring-ui’s strongest gateway decision is verified authority and effect ownership.
opencode session identity is simple and portable.
boring-ui session identity is addressed by agent type plus session ID under verified workspace/auth scope.

Source: `origin/main:packages/agent/src/server/agent-host/agentSessionKey.ts`; `types.ts:47-56`.
opencode’s durable event stream is better specified as a reconnect contract.
boring-ui’s front reconnect implementation is more complete out of the box.
opencode has no explicit multi-client write lease.
boring-ui has environment/binding leases and serializes session effects, but a browser tab still does not appear to own an exclusive conversational lease.
The best merged design is:

- AgentGateway authority/placement scopes;

- durable prompt admission and exact retry receipts;

- one durable per-session sequence stream;

- ephemeral fragment channel that never advances durable cursor;

- automatic hydrate/replay/reconnect in official clients;

- optional client presence/editor ownership above, not inside, execution authority;

- generated typed clients from one route contract.

## LSP and code intelligence

opencode V2 does not currently have an LSP runtime.
It accepts/preserves `lsp` configuration but starts or downloads no servers, exposes no LSP tool, and injects no diagnostics into file results.

Source: V2 LSP docs `lsp:41-48`.
Therefore opencode V2 has no lead to harvest here.
The large `packages/opencode/src/lsp/server.ts` found in repository search belongs to the V1 implementation path and must not be credited to V2.
boring-ui also has no LSP/language-server integration in the requested paths.
Search source: `git grep -i -E '\bLSP\b|language server' origin/main -- packages/agent/src/server/agent-host packages/agent/src/server/harness/pi-coding-agent packages/agent/src/front` returned no relevant runtime hit.
Does it matter?
Yes, but below durable sessions, undo, permissions, and gateway replay.
LSP diagnostics after edits can catch type/import/name errors before another expensive model turn.
Definitions and references are faster and more semantically precise than repeated grep for large typed codebases.
Workspace symbols improve navigation when names are overloaded.
The cost is process management, per-language installation, project-root selection, stale diagnostics, and another permission surface.
Recommended first slice: diagnostics-on-edited-files and go-to-definition/reference tools for servers already installed by the workspace.
Do not auto-download arbitrary language servers in the agent process.

## Mature-product gap matrix

| Capability | opencode V2 | boring-ui `origin/main` | Verdict |
| --- | --- | --- | --- |
| Durable session storage | SQLite session/message/part/event/inbox | JSONL transcript plus durable gateway request ledger; optional durable event store | opencode has the cleaner unified domain model |
| Restart-safe admitted prompts | Explicit durable inbox and promotion | Ledger has admission states, but product queue semantics are less visible | Harvest opencode semantics |
| Reconnect replay | Durable session cursor plus live-only bus; client reconnect manual | Hydrate snapshot then cursor stream with automatic backoff | Merge both |
| Fork conversation | Prefix clone with ID repair | No fork found in requested paths | Harvest after undo/checkpoint |
| Sharing | Not implemented | No comparable public session share found | Neither |
| Compaction | Structured checkpoint plus retained tail | Pi-owned behavior; no equivalent product contract found in requested paths | Harvest contract, not mutable defaults |
| Undo/redo files + chat | Staged snapshot-backed revert | No filesystem/conversation undo found | Highest UX gap |
| Inline diff | Present in opencode UI family | Present and tested via `DiffView` | Not a gap |
| File watching | Config files watched; context sampled at safe boundaries | Workspace watcher exists behind lease | Neither has clear agent-facing code-change intelligence lead |
| Cost display | Session cost/token metadata | Transcript contains usage, UI explicitly lacks `/cost` | Harvest |
| Model selection | Per session/agent/command; default fallback to newest available | Per prompt > per-agent preferred > global/Pi fallback; preferred is strict | Similar; ours safer when pinned |
| Runtime provider fallback | No automatic failure failover documented | No automatic failure failover found | Neither; do not silently switch models |
| Rate-limit handling | Rich classifier/backoff/status, but potentially infinite | Pi auto-retry events plus transport reconnect backoff | Harvest status; cap retries |
| Offline model | Local compatible endpoint supported | Custom compatible provider path exists through Pi model registry | Similar |
| Fully offline product | Not contracted | Not contracted | Neither |
| LSP | Config-only, no runtime | None found | Neither |
| Plugin hot reload | Generation replacement and cleanup | Better front partial-failure, two trust tiers | Exchange strengths |
| Session retention | No TTL/quota; DB growth reports | No requested-path lifecycle contract found | Both need policy |

Negative boring-ui rows are deliberately scoped to the requested paths, not the whole company or unreleased branches.
The fork/share searches returned no implementation hit:
`git grep -n -i -E 'fork session|branch session|session fork|forkSession|fork_session|share session|session share|public share|shareSession|share_session' origin/main -- packages/agent/src/server/agent-host packages/agent/src/server/harness/pi-coding-agent packages/agent/src/front`.
The compaction search did find Pi transcript compaction and a guarded `compact` operation, so the table says “no equivalent product contract,” not “no compaction”:
`sessions.load.test.ts:204-268`, `sessions.ts:363-402`, `createHarness.ts:205`.
The fallback search found selection fallback at `createHarness.ts:552-557` and bounded Pi retry state at `piChatReducer.test.ts:2221`, but no provider-failure model failover.
The lifecycle search found manual session deletion at `usePiSessions.ts:502` and request-ledger retention at `agent-host/types.ts:360`, but no session TTL/quota/archive/vacuum policy.
Search commands: `git grep -n -i -E 'model fallback|fallback model|failover|rate.?limit|retry-after' ...` and `git grep -n -i -E 'session ttl|retention|vacuum|archive session|session quota|delete session' ...` over the same requested paths.

## What not to copy

1. Do not copy allow-most defaults.

2. Do not make raw shell text the final security boundary.

3. Do not let child agents escape a restrictive parent authority envelope.

4. Do not call in-process arbitrary npm/local code a plugin trust model.

5. Do not expose a beta API without a version-negotiation and migration story.

6. Do not make reconnect a responsibility every client reimplements.

7. Do not retain session data forever without quota, archive, export, and vacuum controls.

8. Do not retry provider failures forever.

9. Do not accept inert configuration fields that imply nonexistent behavior.

10. Do not advertise V1 LSP or sharing as V2 capability.

## Recommended sequence

### P0: durable input and recovery contract

Project gateway admission into an explicit session inbox state.
Expose admitted/promoted/running/settled states and exact retry receipts.
Specify which events are durable and which are fragments.
Keep official-client hydrate/reconnect automatic.

### P1: staged undo

Add per-step changed-path attribution.
Capture a bounded internal Git snapshot for clean steps.
Stage chat boundary plus path restore before commit.
Show non-reversible side effects explicitly.

### P2: permission product UX

Keep outer per-agent capability grants default-deny.
Add inner ordered action/resource rules.
Offer once, session, and project scopes.
Preview the exact persisted pattern before confirmation.
Parse shell argv where possible; treat raw text matching as advisory, not sufficient authority.

### P3: user-authored agent profiles

Add a project Markdown/JSON agent format for instructions, model preference, mode, step budget, plugins, and permissions.
Compile it into existing `ConfiguredAgentHostAgentSpec` rather than bypassing fleet validation.
Make child authority the intersection of parent envelope and child profile.

### P4: generated client and plugin scope cleanup

Generate official clients from AgentGateway’s public route schema.
Add generation-scoped plugin registrations and awaited cleanup.
Retain the two-tier trust model and move runtime/generated tools toward brokers.

### P5: cost, retention, and code intelligence

Surface estimated per-session cost/token classes.
Add archive/export/delete/TTL/quota/vacuum controls.
Pilot LSP diagnostics only for edited files with workspace-installed servers.

## Source index

opencode repository: `https://github.com/anomalyco/opencode`, branch `dev`.
V2 docs: `https://opencode.ai/v2/docs`.
API docs: `https://opencode.ai/v2/docs/api`.
Build/plugin docs: `https://opencode.ai/v2/docs/build/plugins`.
Primary opencode files read:

- `CONTEXT.md`;

- `specs/v2/session.md`;

- `packages/core/src/database/database.ts`;

- `packages/opencode/src/session/session.ts`;

- `packages/opencode/src/session/session.sql.ts` through indexed repository source;

- `packages/opencode/src/session/retry.ts`;

- `packages/opencode/src/agent/agent.ts`;

- V2 docs for agents, permissions, sharing, undo, compaction, warming, LSP, providers, models, client, plugins, and API.
Primary boring-ui sources read via `git show origin/main:<path>`:

- `packages/agent/src/server/agent-host/types.ts`;

- `packages/agent/src/server/agent-host/embeddedGateway.ts`;

- `packages/agent/src/server/agent-host/createAgentHost.ts`;

- `packages/agent/src/server/agent-host/environmentLease.ts`;

- `packages/agent/src/server/agent-host/workspaceAgentLease.ts`;

- `packages/agent/src/server/agent-host/mcpGrants.ts`;

- `packages/agent/src/server/agent-host/mcpGrantStore.ts`;

- `packages/agent/src/server/agent-host/sqliteRequestLedger.ts`;

- `packages/agent/src/server/agent-host/buildAgentComposition.ts`;

- `packages/agent/src/server/harness/pi-coding-agent/sessions.ts`;

- `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`;

- `packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`;

- `packages/agent/src/front/chat/pi/remotePiSession.ts`;

- `packages/agent/src/front/chat/pi/piChatStream.ts`;

- `packages/agent/src/front/chat/session/usePiSessions.ts`;

- `packages/agent/src/front/bareToolRenderers/DiffView.tsx`;

- `packages/workspace/docs/PLUGIN_SYSTEM.md`.
Issue sources are used only where the implementation/docs do not state operational failure behavior directly.
They are not treated as proof of universal behavior.

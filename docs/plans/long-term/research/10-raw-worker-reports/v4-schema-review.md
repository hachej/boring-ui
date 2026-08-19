# FATAL — the proposed `record` cannot represent Pi's session tree
**Problem**
The proposed record has `session · kind · payload · recorded_at · batch_offset · instance_uid · attempt_id · owner_epoch`. It has no stable entry id, no parent entry id, and no durable current-leaf movement. A flat append order is not enough to determine which earlier entry is the parent of a later entry after a branch. Putting those identities inside an untyped `payload` would make the database unable to enforce referential integrity and would make generic tree queries depend on every payload codec forever. Without explicit tree identity, `getPathToRoot`, branch navigation, branch summaries, fork-at-entry, and compaction reconstruction are not implementable from the canonical store.
**Evidence**
`@earendil-works/pi-agent-core/dist/harness/types.d.ts:230-343` defines every `SessionTreeEntry` with `id`, `parentId`, and `timestamp`. The same declaration requires `SessionStorage.getLeafId`, `setLeafId`, `getEntry`, `getPathToRoot`, and `SessionRepo.fork`. `pi-agent-core/dist/harness/session/memory-storage.js` persists a `type: "leaf"` entry when the active leaf moves. `pi-coding-agent/dist/core/session-manager.js:124-143` reconstructs a path by following `parentId`, not by taking a prefix of file order. `session-manager.js:964-1007` branches by moving the leaf to an earlier entry and optionally appending `branch_summary` from that parent.
**Concrete replacement**
Add explicit nullable tree columns to canonical records:
```sql
pi_entry_id          text,
pi_parent_entry_id   text,
pi_entry_type        text,
pi_target_entry_id   text,
pi_schema_version    integer
```
Require all five semantics through checks and composite foreign keys shown in the corrected schema. Store Pi `leaf`, `compaction`, `branch_summary`, `label`, `session_info`, model/tool-setting changes, custom entries, and messages as first-class `pi_entry_type` values. Do not linearize a Pi tree unless the product explicitly removes branching and fork from its supported contract.
# SERIOUS — the tree/log mismatch is a mapping, but only with durable leaf records
**Problem**
An append-only log and a tree are not inherently incompatible. The proposal treats their compatibility as implicit, however, and therefore omits the operation that changes the active branch without deleting history. If the implementation merely treats the last ordinary record as the leaf, reopening a session after `moveTo` selects the wrong branch.
**Evidence**
Pi core models leaf movement as an append-only `LeafEntry { type: "leaf", targetId }`. `leafIdAfterEntry()` returns `entry.targetId` for a leaf entry and `entry.id` for ordinary entries. This proves the correct mapping: append-only physical order plus parent edges plus explicit leaf-move records reconstructs the logical tree.
**Concrete replacement**
Canonicalize each Pi storage mutation as one `pi_entry` record. For ordinary entries, set `pi_entry_id`, `pi_parent_entry_id`, and `pi_entry_type`. For a leaf move, set `pi_entry_type = 'leaf'`; `pi_target_entry_id` is the selected leaf or NULL for Pi's reset-to-root operation. Rebuild `getLeafId()` by replaying `(batch_no, record_index)` and applying `leafIdAfterEntry`. Any cached current leaf must carry `through_batch_no` and `stream_incarnation`.
# SERIOUS — compaction is not merely a generic record kind
**Problem**
The proposal names no fields for Pi's compaction boundary. A JSON payload that loses `firstKeptEntryId` or attaches it to the wrong branch produces plausible-looking but incorrect model context. Compaction also cannot be reconstructed by taking records after the compaction's physical offset because the kept entries may precede it physically on the selected tree path.
**Evidence**
Pi's `CompactionEntry` requires `summary`, `firstKeptEntryId`, and `tokensBefore`. `pi-coding-agent/dist/core/session-manager.js:190-225` finds the compaction on the active parent path, then retains earlier path entries starting at `firstKeptEntryId` plus later entries. The Flue streaming protocol similarly treats compaction as a structural boundary and emits a conversation reset rather than pretending it is an ordinary delta.
**Concrete replacement**
For `pi_entry_type = 'compaction'`, require payload schema version 1 with:
```json
{
  "summary": "string",
  "firstKeptEntryId": "string",
  "tokensBefore": 123,
  "details": null,
  "fromHook": false
}
```
Copy `firstKeptEntryId` into `pi_target_entry_id` so a composite foreign key can verify it belongs to the same scoped session. Emit a projection reset chunk at the containing batch boundary.
# FATAL — `batch_offset` on each record does not define an atomic batch
**Problem**
Repeating a `batch_offset` value on several rows does not say who owns the batch, how record order inside the batch is defined, whether the batch is complete, or whether a partial batch can become visible. The proposal has no primary key for `record` and no intra-batch position. Two records with the same session, kind, timestamp, and offset are indistinguishable. An implementation that autoincrements per record contradicts the stated per-batch cursor contract.
**Evidence**
Flue's `ConversationStreamStore.append` accepts `records: readonly ConversationRecord[]` and returns one offset. Its 2.0.3 SQL implementation stores one row in `flue_conversation_stream_batches` with primary key `(path, seq)` and serializes the entire record array as one value. The store contract says every record in the batch persists all-or-nothing and partial writes corrupt the conversation graph.
**Concrete replacement**
Create a batch table and a record table:
```sql
stream_batches(stream_id, batch_no, ...,
  primary key (stream_id, batch_no));
stream_records(stream_id, batch_no, record_index, record_id, ...,
  primary key (stream_id, batch_no, record_index),
  unique (stream_id, record_id),
  foreign key (stream_id, batch_no)
    references stream_batches(stream_id, batch_no));
```
Insert the batch row and every record row in one transaction. Increment the stream head only in that same transaction.
# SERIOUS — a client cannot and must not resume mid-batch
**Problem**
The prompt asks how a client resumes mid-batch. Under a batch-offset contract it cannot resume mid-batch, and inventing such a cursor would weaken the atomicity guarantee. The proposal does not state whether read limits count records or batches, so a page boundary could accidentally split a batch.
**Evidence**
Flue reads batches strictly after the supplied offset. Its SDK advances the resumable stream offset only after every event projected from a delivered batch has been yielded. Wire chunks may have a `(batch, index)` position for deduplication, but the resumable durable offset remains the batch offset.
**Concrete replacement**
Count read limits in batches. Return all record rows for every selected batch. Expose `position = { batchOffset, recordIndex }` for deduplication only. Advance `nextOffset` after the consumer has processed the complete last batch. After a disconnect during batch projection, redeliver the entire batch and let the consumer deduplicate positions. Reject an offset greater than the stream head; do not silently clamp it as the old store does.
# FATAL — no primary key or retry identity exists for canonical writes
**Problem**
`record` has neither `record_id` nor producer sequence. A crashed writer cannot distinguish an exact retry from a second logical append. `attempt_id · owner_epoch` is insufficient because one attempt writes many batches.
**Evidence**
Flue fences with stream incarnation, producer id, producer epoch, and producer sequence. Its batch table has `UNIQUE(path, producer_id, producer_epoch, producer_sequence)`. An exact retry returns the original offset; a retry under that identity with different content is a conflict. The existing Boring store has `appendEventOnce(path, idempotency_key, event)` but only at per-event granularity.
**Concrete replacement**
Add to `stream_batches`:
```sql
producer_id        text not null,
producer_epoch     bigint not null,
producer_sequence  bigint not null,
content_digest     text not null,
unique (stream_id, producer_id, producer_epoch, producer_sequence)
```
Require `producer_sequence = streams.next_producer_sequence` for a new append. On an existing producer-sequence tuple, compare `content_digest`, submission id, and attempt id; return the old offset only on an exact match.
# FATAL — the pause record cannot enforce stale-answer safety
**Problem**
`request_id · session · kind · action + canonical_args · state · answered_at · answer` is not enough to prove that an answer is fresh, authorized, one-shot, or attached to the still-pending tool call. It lacks a capability/nonce, expiry, responder identity, allowed responder policy, submission/attempt identity, tool-call identity, canonical-argument digest, and consumption state. It also fails to distinguish “answer stored” from “answer consumed to authorize the effect.”
**Evidence**
Eve keys structured input responses by `requestId`; stale approval responses become ordinary user messages and never authorize the old call. Eve approval context includes `session`, `toolName`, `toolInput`, approved tools, and `callId`. Boring's existing ask-user plugin already stores `questionId`, `sessionId`, `ownerPrincipalId`, `answerToken`, status, timestamps, schema, and structured answer values. `plugins/ask-user/src/shared/types.ts` also defines timeout cancellation and distinct `answered`, `cancelled`, and `abandoned` outcomes.
**Concrete replacement**
Use the `pauses` table in the corrected schema with:
```text
pause_id, tenant_id, workspace_id, session_id,
submission_id, attempt_id, tool_call_id, continuation_key,
kind, action_name, canonical_args, args_digest,
request_schema, challenge, answer_policy,
capability_digest, state, created_at, expires_at,
response_id, response_payload, responded_by_principal_id,
responded_via, responded_at, consumed_at, terminal_reason
```
Accept a response only with one compare-and-set from `pending` to `responded`, matching scope, capability digest, and unexpired deadline. Authorize execution only with a second compare-and-set from `responded` to `consumed`, matching submission, current attempt or durable continuation key, tool call, action name, and argument digest.
# SERIOUS — approval, question, and OAuth waits are not one payload shape
**Problem**
Approval is a one-shot capability over a specific effect. A question is validated structured user data. OAuth is an external authorization challenge whose credentials must never be stored in the conversation payload. The proposed `action + canonical_args` shape fits only approval.
**Evidence**
Eve's `authorization.required` can carry URL, user code, expiry, instructions, and display name, then completes as authorized, declined, failed, or timed out. Its OAuth tokens are stored outside history while the durable wait survives a crash. The ask-user plugin has a versioned form schema and validates submitted values against it.
**Concrete replacement**
Keep one lifecycle table but use typed nullable columns plus checks:
- `approval`: requires `action_name`, `canonical_args`, `args_digest`, and `tool_call_id`.
- `question`: requires `request_schema`; answer is validated before the state transition.
- `authorization`: requires `challenge` and `authorization_ref`; the ref points to a secret broker record, never token bytes.
Add a check that rejects incompatible field combinations. Store only caller-safe challenge metadata in `challenge`.
# SERIOUS — pause ordering relative to the submission queue is undefined
**Problem**
The proposal does not say whether an answer is a new submission, an out-of-band continuation, or steering text. That ambiguity changes queue ordering and whether unrelated messages can overtake a paused tool call. It also creates a deadlock risk if a pause response is queued behind the very submission waiting for it.
**Evidence**
Eve holds unrelated text while approval is pending and replays it after approval. Flue keeps one runnable queue head per session and joins only under explicit turn-boundary transitions. The current Boring Pi service has a distinct follow-up queue and `followup-consumed` events, so ordinary delivery is already not equivalent to resolving input.
**Concrete replacement**
Treat a matching pause response as an out-of-band response to `pause_id`, not a queued submission. It may wake only the owning submission/continuation. Treat unmatched or stale text as a normal newly admitted submission with its own `queue_seq`. Add `blocked_by_pause_id` to the owning submission as a projection or derive it from pending pauses. Do not run later queue entries while the head submission owns a pending pause unless the product explicitly selects concurrent turns.
# SERIOUS — responder authorization is absent
**Problem**
Knowing a request id is not authorization to approve a destructive action. Putting tenant/workspace only on the submission does not let an answer endpoint authorize the pause without an unsafe indirect lookup. Channel answers add another principal-binding problem: provider identity must map to an allowed workspace principal.
**Evidence**
The existing ask-user bridge scopes browser operations by a verified session and uses an answer token. Its stored question includes `ownerPrincipalId`. The Eve analysis explicitly warns that approval is a gate, not resource authorization; executors still enforce tenant/resource permissions.
**Concrete replacement**
Persist `answer_policy` as a versioned object such as:
```json
{
  "v": 1,
  "mode": "owner_or_role",
  "ownerPrincipalId": "p_123",
  "roles": ["workspace_admin"],
  "allowedChannels": ["web", "slack"]
}
```
Persist `responded_by_principal_id` and `responded_via`. Require current tenant/workspace membership and the policy at response time; do not rely solely on the bearer capability. Recheck resource authorization immediately before the effect executes because membership/grants may have changed after approval.
# FATAL — `queued | running | settled` plus `outcome` does not enforce settlement
**Problem**
The enum admits invalid combinations such as `queued + completed`, `running + failed`, and `settled + NULL outcome` unless explicit checks exist. More importantly, it cannot bridge the crash window between appending the canonical `submission_settled` record and updating the submission row. Two attempts can race to append different outcomes if the store trusts fields rather than a reservation protocol.
**Evidence**
Flue uses `queued`, `running`, `terminalizing`, and `settled` plus `joining/joined` for its optional live-join semantics. It first reserves an exact settlement record, then appends it canonically, then finalizes the row. Its settlement update is gated by submission id, current attempt id, status, and settlement record id. First terminal state wins; stale attempts return false.
**Concrete replacement**
Add `terminalizing` and these columns:
```text
current_attempt_id, settlement_record_id, settlement_outcome,
settlement_payload_digest, terminalizing_at, settled_at
```
Enforce checks tying fields to status. Reserve with a compare-and-set from `running` to `terminalizing` only for `current_attempt_id`. An exact retry of the same settlement identity succeeds; conflicting identity or payload fails. Finalize only after the canonical record is visible.
# FATAL — `attempt_id · owner_epoch` on records does not define attempt ownership
**Problem**
The proposal places attempt fields on records but defines no attempt row, claim transition, lease, retry budget, or current-attempt pointer. A stale worker can therefore keep writing after recovery assigns a new attempt. There is no way to distinguish a crashed attempt from a slow one.
**Evidence**
Flue claims queued work atomically, stores `attempt_id`, owner, lease expiry, attempt count, max attempts, and a wall-clock timeout. Recovery replaces an attempt and fences the previous owner. The canonical stream separately fences producers by epoch and incarnation.
**Concrete replacement**
Create `submission_attempts` with one row per attempt and retain history. Point `submissions.current_attempt_id` to it. Gate all submission-owned appends on both:
```text
submissions.status in ('running','terminalizing')
submissions.current_attempt_id = batch.attempt_id
attempts.state = 'running'
attempts.owner_id = producer_id
attempts.owner_epoch = producer_epoch
attempts.lease_expires_at > now
```
Never overwrite an old attempt row during recovery.
# SERIOUS — queue order has no durable column
**Problem**
`admitted_at` is not a total order. Two submissions can share a timestamp, clocks can move, and multiple database writers can observe different wall-clock order. Without a scoped sequence, “oldest unsettled submission of a session” is not deterministic.
**Evidence**
Flue persists an autoincrement `sequence` and queries runnable work by earlier unsettled sequence in the same session. The plan promises an accepted-work ledger but provides no equivalent queue key.
**Concrete replacement**
Add `queue_seq bigint not null` and `unique(session_id, queue_seq)`. Allocate it under the session row lock or from a per-session sequence allocator in the admission transaction. Use `(session_id, queue_seq)` for queue order; keep `admitted_at` only as time metadata. If live joining/steering is supported, add explicit `joining`, `joined`, and `joined_into_submission_id` transitions; otherwise forbid them rather than inferring them from timing.
# SERIOUS — abort intent is missing and stop cannot survive a crash
**Problem**
An in-memory abort signal is not durable. The proposed status/outcome cannot represent “abort requested but not yet settled,” especially when the worker owning the attempt has died.
**Evidence**
Flue stores `abort_requested_at` without immediately changing status and lets normal attempt settlement produce `aborted`. The current Pi service exposes interrupt/stop separately from stream terminal events.
**Concrete replacement**
Add `abort_requested_at`, `abort_requested_by_principal_id`, and `abort_reason` to submissions. First request wins through `COALESCE(abort_requested_at, now())`. Recovery checks the intent before any retry and settles `aborted` through the fenced settlement protocol. Do not write outcome directly from the abort endpoint.
# FATAL — tenancy on submission alone is not an isolation boundary
**Problem**
Records without tenant/workspace columns can be fetched by stream/session id alone. Pauses without scope can be answered by request id alone. Sessions may have records not owned by a submission at all: compaction, labels, leaf moves, metadata, child-session activity, and imported history. Therefore “resolve through submission” is both incomplete and vulnerable to accidental unscoped queries.
**Evidence**
The plan itself says one authoritative stream per agent instance, not one stream per submission. Pi writes many session entry types outside a one-to-one submission relation. The current `PiSessionStore` puts `boringSessionCtx` in the session header and checks it during file resolution. `PiSessionIdentityService` compares workspace and storage scope before access.
**Concrete replacement**
Put `tenant_id` and `workspace_id` on sessions, streams, batches, records, submissions, attempts, pauses, attachments, and usage rows. Use composite foreign keys back to the scoped parent so duplicated scope cannot disagree. Make every repository method require a scope object. For PostgreSQL, enable row-level security using request-local tenant/workspace settings as defense in depth. Never expose a repository method shaped as `getRecord(recordId)` without scope.
# SERIOUS — `instance_uid` is undefined and conflates three identities
**Problem**
The proposed record's `instance_uid` could mean product session, process lifetime, or stream incarnation. Those identities have different lifecycles. Using one value for all three makes recreation, import, and fork ambiguous.
**Evidence**
Flue distinguishes agent instance identity, stream incarnation, producer identity, and producer epoch. Pi distinguishes session metadata id, optional parent session, entry ids, and the active leaf.
**Concrete replacement**
Use separate columns:
- `sessions.session_id`: durable product/Pi session identity.
- `sessions.instance_uid`: immutable incarnation of that product session if recreate-in-place is supported.
- `streams.incarnation_uid`: reset/import fence for the physical canonical stream.
- `streams.producer_id` and `producer_epoch`: current writer claim.
- `attempts.attempt_id`: one execution attempt.
Document whether deleting/recreating the same public session id is allowed; default to never reusing it.
# FATAL — existing event-stream rows cannot be promoted to canonical records losslessly
**Problem**
`boring_event_stream_entries` stores `AgentEvent { v, eventIndex, timestamp, sessionId, chunk: PiChatEvent }`. Those chunks are a UI/runtime event projection, not a complete accepted-work ledger or Pi session tree. They do not reliably contain submission ids, admitted payloads, parent entry ids, current leaf moves, attempt ownership, pause state, settlement reservations, or durable tool recovery evidence. Calling a mechanical table copy a canonical migration would invent guarantees the old data never had.
**Evidence**
`origin/main:packages/agent/src/server/events/eventStreamStore.ts` assigns one sequence per appended event and stores JSON text under `(path, seq)`. `PiChatEvent` includes live deltas, queue snapshots, UI commands, usage, retries, and errors. The current service appends those events individually with the event's `seq` as an idempotency key. Pi JSONL separately contains the parent-linked transcript and compaction entries.
**Concrete replacement**
Import old event rows only as `kind = 'legacy_pi_chat_event'` in singleton batches, preserving their JSON byte-for-byte and recording `migration_source` plus old path/seq. Mark them non-canonical for execution recovery. Use Pi JSONL, not the event stream, as the source for imported `pi_entry` records. Do not synthesize historical submissions or claim that legacy turns have exactly-once settlement.
# SERIOUS — Pi JSONL migration is expressible but requires two-source reconciliation
**Problem**
Current Boring wrapper files may link to native Pi files, and the event stream may contain newer UI events than the last complete Pi entry. Importing only one source loses either tree semantics or display/audit material. Importing both naively duplicates messages.
**Evidence**
`PiSessionStore.resolveSessionTranscript` prefers linked native Pi entries and exposes persisted message entries for cold history. `createHarness.ts` opens the saved Pi file or creates a new native session file. Pi entry ids are already copied to `BoringChatMessage.piEntryId` where available, providing a deduplication key for some projections.
**Concrete replacement**
Implement an offline importer with a per-session migration barrier:
1. Stop new admission for the session.
2. Wait for or explicitly fail any active legacy run.
3. Resolve the wrapper and linked native Pi transcript exactly as current code does.
4. Import the Pi header and every Pi entry in file order as canonical `pi_entry` records.
5. Verify every parent and compaction target exists in the same session.
6. Import old `PiChatEvent` envelopes into the legacy projection lane, deduplicating only where `piEntryId` proves identity.
7. Append a `migration_cutover` record with source digests and source maxima.
8. Set session mode from `legacy_read_only` to `active` only after verification.
# SERIOUS — old cursors have no compatibility story
**Problem**
The old cursor is one offset per event. The new cursor is one offset per atomic batch. Changing the encoding while clients reconnect can skip or duplicate events unless a cutover contract exists.
**Evidence**
The old store formats `seq` as a padded offset and resumes with `seq > parsedOffset`. The proposed protocol says clients resume strictly after a returned opaque offset.
**Concrete replacement**
Version cursor envelopes, for example `v2:<stream-incarnation>:<opaque-batch>`. At cutover either:
- preserve a read-only v1 endpoint until all issued v1 cursors expire; or
- create `legacy_cursor_alias(stream_id, old_seq, new_batch_no)` for every imported singleton batch.
Reject a cursor whose stream incarnation does not match; return a typed `CURSOR_RESET_REQUIRED` with a fresh snapshot path. Never parse a v1 cursor as a v2 batch number by accident.
# SERIOUS — attachments need an immutable byte store, not URLs in payloads
**Problem**
Current chat attachments may be data URLs, remote URLs, or workspace paths. None is a durable, integrity-checked canonical attachment identity. Remote URLs can expire or change, data URLs bloat records, and paths cross workspace authority boundaries.
**Evidence**
Flue separates immutable attachment bytes from canonical records and stores id, MIME type, size, digest, and optional filename. The current `BoringChatPart` file shape permits `url`, `path`, and `filesystem`.
**Concrete replacement**
Add `attachments` and `record_attachments` tables from the corrected schema. Verify SHA-256 and byte size on put and read. Scope lookups to tenant/workspace/session. Treat filename as presentation metadata, not identity. Project a signed/download URL at read time; never persist it as canonical identity.
# SERIOUS — usage/metering cannot be recovered from a generic record alone
**Problem**
Billing requires a stable idempotency identity and attribution to attempt, submission, model, and provider response. The proposed schema has no such fields. If usage exists only in an untyped record payload, a replay or retry can double-charge or under-charge.
**Evidence**
The current `pi-chat/metering.ts` derives stable `usageId` values, records each assistant usage, and serializes usage writes before settlement/release. Pi assistant messages include detailed token and cost usage.
**Concrete replacement**
Add an append-only `usage_ledger` with unique `(tenant_id, usage_id)` and fields for session, submission, attempt, message/entry id, provider, model, token categories, provider cost, billed micros, currency, and recorded time. Reference the canonical usage record id when one exists. Meter every provider attempt independently; deduplicate only by stable usage id, never by equal numeric usage values. Keep the billing ledger immutable and outside transcript compaction.
# SERIOUS — child sessions and forked sessions are absent
**Problem**
One `session` scalar on each record cannot express why a child exists, which parent tool call created it, or from which entry a fork was made. Recovery cannot reattach an unresolved delegated task without this relation.
**Evidence**
Pi `SessionRepo.fork` creates a new session from a source entry. Pi JSONL metadata supports `parentSessionPath`. Flue delegated tasks use child sessions with their own durable streams and retain child conversation identity in interrupted markers. Eve stream events likewise expose `childSessionId` for subagent calls.
**Concrete replacement**
Add to `sessions`:
```text
parent_session_id, forked_from_entry_id,
created_by_submission_id, created_by_tool_call_id,
session_kind ('root','fork','subagent')
```
Give every child its own stream and tree. The parent canonical record references the child session id and tool call id. Do not cascade-delete child history merely because a parent record is compacted.
# SERIOUS — payloads and record kinds have no schema version
**Problem**
`kind · payload` without a version is an irreversible compatibility trap. Readers cannot distinguish old payload semantics from new ones after deployment. Malformed payloads can enter the only authoritative history.
**Evidence**
Current Pi session headers carry a version and migrate v1 to v2 to v3. Current Boring `AgentEvent` and `PiChatSnapshot` also carry wire versions. Flue stamps its persisted format and its reduced-state checkpoint format separately.
**Concrete replacement**
Add `record_schema_version integer not null` to every record. Maintain a closed registry of `(kind, version) -> validator/reducer`. Validate before append and reject unknown versions. Add a store-level `schema_meta` row for physical schema version; do not confuse it with per-record semantic version.
# SERIOUS — fold checkpoints/snapshots need incarnation and offset guards
**Problem**
Full replay grows without bound. Adding an unguarded snapshot later risks treating stale or torn cache state as authoritative.
**Evidence**
Flue optionally stores fold checkpoints carrying head offset, stream incarnation, and format version. It discards mismatched checkpoints and rebuilds from the log. The current Pi snapshot is a UI projection and cannot be silently promoted to canonical truth.
**Concrete replacement**
Add optional `stream_checkpoints(stream_id, through_batch_no, incarnation_uid, format_version, digest, data)`. Write each checkpoint atomically. On load, verify incarnation, supported format, digest, and `through_batch_no <= head_batch_no`. If validation fails, ignore it and replay from batch zero.
# MINOR — timestamps need distinct meanings and database defaults
**Problem**
One `recorded_at` cannot distinguish source capture time, database commit time, admission time, attempt start, response time, and settlement time. Application clocks may skew across producers.
**Evidence**
Pi entries carry source timestamps. Flue distinguishes accepted, started, input-applied, abort-requested, settled, and lease-expiry times.
**Concrete replacement**
Use `source_at` for preserved Pi/provider time and `committed_at default current_timestamp` for database order metadata. Keep lifecycle timestamps on the lifecycle rows. Never use timestamps as queue or stream order.
# SERIOUS — no retention, deletion, or legal-hold semantics exist
**Problem**
The proposed canonical store contains prompts, tool arguments, answers, OAuth challenge metadata, attachments, and possibly secrets accidentally returned by tools. “Append-only” does not answer tenant deletion, user erasure, retention, or legal hold. Composite child and attachment references make later deletion policy expensive to retrofit.
**Evidence**
The current session API supports deletion. Flue's submission contract has no per-session deletion, which is a deliberate contract rather than an accidental omission.
**Concrete replacement**
Add session lifecycle fields `deleted_at`, `retention_until`, and `legal_hold` only after the product chooses semantics. Default repository reads to exclude tombstoned sessions. Use tenant-scoped encryption keys if cryptographic erasure is required. Do not add cascading physical deletes until attachment sharing and child-session retention are decided.
# SERIOUS — “physical topology is a deployment choice” conflicts with cross-table atomicity
**Problem**
The proposal simultaneously requires exact settlement, atomic batches, and an unspecified one-or-many-database topology. Foreign keys and one-transaction admission/canonicalization work only inside one transactional store. Separate stores require an explicit obligation/outbox protocol.
**Evidence**
Flue's `terminalizing` settlement obligation exists specifically to bridge canonical-record append and submission finalization safely. Its adapter contract defines behavior rather than assuming SQL co-location.
**Concrete replacement**
Define one logical `DurableAgentStore` contract with conformance tests. For a single SQL database, perform admission input materialization and settlement transitions transactionally where possible. For split stores, require durable obligations with exact record ids/digests and idempotent reconciliation. Do not call topology a free deployment choice until both implementations pass the same concurrency/crash contract suite.
# SERIOUS — no contract tests define observable storage behavior
**Problem**
Columns alone do not prove atomicity, fencing, first-terminal-wins, exact retries, or tenant isolation. Most failures here appear only under concurrency and crash injection.
**Evidence**
Flue ships separate contract suites for submission, conversation stream, and attachment stores. The existing Boring event store has targeted busy-retry and idempotency tests, but not the proposed cross-domain contract.
**Concrete replacement**
Require adapter contract tests for:
- racing admission with equal and conflicting payloads;
- two concurrent claims of one queue head;
- stale attempt and stale producer writes;
- exact and conflicting batch retry;
- torn/partial batch invisibility;
- two different settlement attempts;
- crash after settlement reservation, append, and finalize;
- pause response races, expiry, stale capability, and revoked membership;
- cross-tenant ids deliberately chosen to collide;
- fork/branch/leaf/compaction round trips;
- legacy migration restart at every checkpoint;
- attachment byte/digest conflicts;
- cursor incarnation reset.
# Corrected schema to implement
The following is PostgreSQL-shaped SQL. SQLite adapters can lower enums to checked text and JSONB to text, but must preserve the observable constraints.
```sql
create type agent_session_kind as enum ('root', 'fork', 'subagent');
create type agent_session_mode as enum ('legacy_read_only', 'active', 'tombstoned');
create type submission_status as enum (
  'queued', 'running', 'terminalizing', 'settled'
);
create type submission_outcome as enum ('completed', 'failed', 'aborted');
create type attempt_state as enum ('running', 'replaced', 'finished');
create type pause_kind as enum ('approval', 'question', 'authorization');
create type pause_state as enum (
  'pending', 'responded', 'consumed', 'denied', 'cancelled', 'expired', 'failed'
);
create table agent_store_meta (
  key text primary key,
  value text not null
);
insert into agent_store_meta(key, value)
values ('physical_schema_version', '1');
create table agent_sessions (
  tenant_id text not null,   workspace_id text not null,
  session_id text not null,   instance_uid uuid not null,
  agent_type text not null,   session_kind agent_session_kind not null default 'root',
  mode agent_session_mode not null default 'active',   parent_session_id text,
  forked_from_entry_id text,   created_by_submission_id text,
  created_by_tool_call_id text,   created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,   deleted_at timestamptz,
  retention_until timestamptz,   legal_hold boolean not null default false,
  primary key (tenant_id, workspace_id, session_id),
  unique (tenant_id, workspace_id, instance_uid),
  foreign key (tenant_id, workspace_id, parent_session_id)
    references agent_sessions(tenant_id, workspace_id, session_id),
  check ((session_kind = 'root') = (parent_session_id is null)),
  check ((session_kind <> 'fork') or forked_from_entry_id is not null),
  check ((mode = 'tombstoned') = (deleted_at is not null))
);
create table conversation_streams (
  tenant_id text not null,   workspace_id text not null,
  stream_id uuid not null,   session_id text not null,
  incarnation_uid uuid not null,   head_batch_no bigint not null default -1,
  producer_id text,   producer_epoch bigint not null default 0,
  next_producer_sequence bigint not null default 0,   created_at timestamptz not null default current_timestamp,
  primary key (tenant_id, workspace_id, stream_id),
  unique (tenant_id, workspace_id, session_id),
  unique (tenant_id, workspace_id, stream_id, incarnation_uid),
  foreign key (tenant_id, workspace_id, session_id)
    references agent_sessions(tenant_id, workspace_id, session_id),
  check (head_batch_no >= -1),
  check (producer_epoch >= 0),
  check (next_producer_sequence >= 0)
);
create table submissions (
  tenant_id text not null,   workspace_id text not null,
  submission_id uuid not null,   session_id text not null,
  queue_seq bigint not null,   agent_type text not null,
  payload_version integer not null,   payload jsonb not null,
  payload_digest text not null,   idempotency_key text,
  submitter_principal_id text,   origin text not null,
  trace_context jsonb,   admitted_at timestamptz not null default current_timestamp,
  canonical_input_record_id uuid,   canonical_ready_at timestamptz,
  status submission_status not null default 'queued',   current_attempt_id uuid,
  attempt_count integer not null default 0,   max_attempts integer not null default 10,
  timeout_at timestamptz,   abort_requested_at timestamptz,
  abort_requested_by_principal_id text,   abort_reason text,
  blocked_by_pause_id uuid,   settlement_record_id uuid,
  settlement_outcome submission_outcome,   settlement_payload_digest text,
  terminalizing_at timestamptz,   settled_at timestamptz,
  error jsonb,
  primary key (tenant_id, workspace_id, submission_id),
  unique (tenant_id, workspace_id, session_id, queue_seq),
  foreign key (tenant_id, workspace_id, session_id)
    references agent_sessions(tenant_id, workspace_id, session_id),
  check (queue_seq >= 0),
  check (payload_version > 0),
  check (attempt_count >= 0 and max_attempts > 0),
  check (
    (status = 'queued'
      and current_attempt_id is null
      and settlement_record_id is null
      and settlement_outcome is null
      and settled_at is null)
    or
    (status = 'running'
      and current_attempt_id is not null
      and settlement_record_id is null
      and settlement_outcome is null
      and settled_at is null)
    or
    (status = 'terminalizing'
      and current_attempt_id is not null
      and settlement_record_id is not null
      and settlement_outcome is not null
      and settlement_payload_digest is not null
      and terminalizing_at is not null
      and settled_at is null)
    or
    (status = 'settled'
      and settlement_record_id is not null
      and settlement_outcome is not null
      and settlement_payload_digest is not null
      and settled_at is not null)
  )
);
create unique index submissions_idempotency_present_idx
  on submissions(tenant_id, workspace_id, session_id, idempotency_key)
  where idempotency_key is not null;
create index submissions_runnable_idx
  on submissions(tenant_id, workspace_id, session_id, status, queue_seq);
create table submission_attempts (
  tenant_id text not null,   workspace_id text not null,
  attempt_id uuid not null,   submission_id uuid not null,
  attempt_no integer not null,   state attempt_state not null default 'running',
  owner_id text not null,   owner_epoch bigint not null,
  lease_expires_at timestamptz not null,   started_at timestamptz not null default current_timestamp,
  input_applied_at timestamptz,   finished_at timestamptz,
  replaced_by_attempt_id uuid,
  primary key (tenant_id, workspace_id, attempt_id),
  unique (tenant_id, workspace_id, submission_id, attempt_no),
  unique (tenant_id, workspace_id, submission_id, attempt_id),
  foreign key (tenant_id, workspace_id, submission_id)
    references submissions(tenant_id, workspace_id, submission_id),
  foreign key (tenant_id, workspace_id, replaced_by_attempt_id)
    references submission_attempts(tenant_id, workspace_id, attempt_id)
    deferrable initially deferred,
  check (attempt_no > 0),
  check (owner_epoch >= 0),
  check ((state = 'running') = (finished_at is null)),
  check ((state = 'replaced') = (replaced_by_attempt_id is not null))
);
alter table submissions
  add constraint submissions_current_attempt_fk
  foreign key (tenant_id, workspace_id, submission_id, current_attempt_id)
  references submission_attempts(
    tenant_id, workspace_id, submission_id, attempt_id
  )
  deferrable initially deferred;
alter table agent_sessions
  add constraint sessions_creator_submission_fk
  foreign key (tenant_id, workspace_id, created_by_submission_id)
  references submissions(tenant_id, workspace_id, submission_id)
  deferrable initially deferred;
create table stream_batches (
  tenant_id text not null,   workspace_id text not null,
  stream_id uuid not null,   incarnation_uid uuid not null,
  batch_no bigint not null,   producer_id text not null,
  producer_epoch bigint not null,   producer_sequence bigint not null,
  submission_id uuid,   attempt_id uuid,
  record_count integer not null,   content_digest text not null,
  committed_at timestamptz not null default current_timestamp,
  primary key (tenant_id, workspace_id, stream_id, batch_no),
  unique (
    tenant_id, workspace_id, stream_id,
    producer_id, producer_epoch, producer_sequence
  ),
  foreign key (tenant_id, workspace_id, stream_id, incarnation_uid)
    references conversation_streams(
      tenant_id, workspace_id, stream_id, incarnation_uid
    ),
  foreign key (tenant_id, workspace_id, submission_id, attempt_id)
    references submission_attempts(
      tenant_id, workspace_id, submission_id, attempt_id
    ),
  check (batch_no >= 0),
  check (producer_epoch >= 0),
  check (producer_sequence >= 0),
  check (record_count > 0),
  check ((submission_id is null) = (attempt_id is null))
);
create table stream_records (
  tenant_id text not null,   workspace_id text not null,
  stream_id uuid not null,   session_id text not null,
  batch_no bigint not null,   record_index integer not null,
  record_id uuid not null,   kind text not null,
  record_schema_version integer not null,   payload jsonb not null,
  source_at timestamptz,   committed_at timestamptz not null default current_timestamp,
  submission_id uuid,   attempt_id uuid,
  pi_entry_id text,   pi_parent_entry_id text,
  pi_entry_type text,   pi_target_entry_id text,
  pi_schema_version integer,   migration_source jsonb,
  primary key (
    tenant_id, workspace_id, stream_id, batch_no, record_index
  ),
  unique (tenant_id, workspace_id, stream_id, record_id),
  unique (tenant_id, workspace_id, session_id, record_id),
  unique (tenant_id, workspace_id, session_id, pi_entry_id),
  foreign key (tenant_id, workspace_id, stream_id, batch_no)
    references stream_batches(tenant_id, workspace_id, stream_id, batch_no),
  foreign key (tenant_id, workspace_id, session_id)
    references agent_sessions(tenant_id, workspace_id, session_id),
  foreign key (tenant_id, workspace_id, submission_id, attempt_id)
    references submission_attempts(
      tenant_id, workspace_id, submission_id, attempt_id
    ),
  foreign key (tenant_id, workspace_id, session_id, pi_parent_entry_id)
    references stream_records(tenant_id, workspace_id, session_id, pi_entry_id)
    deferrable initially deferred,
  foreign key (tenant_id, workspace_id, session_id, pi_target_entry_id)
    references stream_records(tenant_id, workspace_id, session_id, pi_entry_id)
    deferrable initially deferred,
  check (record_index >= 0),
  check (record_schema_version > 0),
  check ((submission_id is null) = (attempt_id is null)),
  check (
    (kind = 'pi_entry'
      and pi_entry_id is not null
      and pi_entry_type is not null
      and pi_schema_version is not null)
    or
    (kind <> 'pi_entry'
      and pi_entry_id is null
      and pi_parent_entry_id is null
      and pi_entry_type is null
      and pi_target_entry_id is null
      and pi_schema_version is null)
  ),
  check (
    (pi_entry_type = 'compaction' and pi_target_entry_id is not null)
    or pi_entry_type is distinct from 'compaction'
  )
);
alter table submissions
  add constraint submissions_canonical_input_record_fk
  foreign key (
    tenant_id, workspace_id, session_id, canonical_input_record_id
  ) references stream_records(
    tenant_id, workspace_id, session_id, record_id
  ) deferrable initially deferred;
alter table submissions
  add constraint submissions_settlement_record_fk
  foreign key (
    tenant_id, workspace_id, session_id, settlement_record_id
  ) references stream_records(
    tenant_id, workspace_id, session_id, record_id
  ) deferrable initially deferred;
alter table agent_sessions
  add constraint sessions_fork_entry_fk foreign key (
    tenant_id, workspace_id, parent_session_id, forked_from_entry_id
  ) references stream_records(
    tenant_id, workspace_id, session_id, pi_entry_id
  ) deferrable initially deferred;
create table pauses (
  tenant_id text not null,   workspace_id text not null,
  pause_id uuid not null,   session_id text not null,
  submission_id uuid not null,   attempt_id uuid,
  tool_call_id text,   continuation_key text not null,
  kind pause_kind not null,   action_name text,
  canonical_args jsonb,   args_digest text,
  request_schema jsonb,   challenge jsonb,
  authorization_ref text,   answer_policy jsonb not null,
  capability_digest text not null,   state pause_state not null default 'pending',
  created_at timestamptz not null default current_timestamp,   expires_at timestamptz,
  response_id text,   response_payload jsonb,
  responded_by_principal_id text,   responded_via text,
  responded_at timestamptz,   consumed_at timestamptz,
  terminal_reason text,
  primary key (tenant_id, workspace_id, pause_id),
  unique (tenant_id, workspace_id, session_id, response_id),
  unique (tenant_id, workspace_id, submission_id, continuation_key),
  foreign key (tenant_id, workspace_id, session_id)
    references agent_sessions(tenant_id, workspace_id, session_id),
  foreign key (tenant_id, workspace_id, submission_id)
    references submissions(tenant_id, workspace_id, submission_id),
  foreign key (tenant_id, workspace_id, submission_id, attempt_id)
    references submission_attempts(
      tenant_id, workspace_id, submission_id, attempt_id
    ),
  check (expires_at is null or expires_at > created_at),
  check (
    (kind = 'approval'
      and tool_call_id is not null
      and action_name is not null
      and canonical_args is not null
      and args_digest is not null)
    or kind <> 'approval'
  ),
  check ((kind = 'question' and request_schema is not null) or kind <> 'question'),
  check (
    (kind = 'authorization'
      and challenge is not null
      and authorization_ref is not null)
    or kind <> 'authorization'
  ),
  check (
    (state = 'pending'
      and response_payload is null
      and responded_at is null
      and consumed_at is null)
    or
    (state = 'responded'
      and response_payload is not null
      and responded_at is not null
      and consumed_at is null)
    or
    (state = 'consumed'
      and response_payload is not null
      and responded_at is not null
      and consumed_at is not null)
    or state in ('denied', 'cancelled', 'expired', 'failed')
  )
);
alter table submissions
  add constraint submissions_blocked_pause_fk
  foreign key (tenant_id, workspace_id, blocked_by_pause_id)
  references pauses(tenant_id, workspace_id, pause_id)
  deferrable initially deferred;
create table attachments (
  tenant_id text not null,   workspace_id text not null,
  session_id text not null,   attachment_id uuid not null,
  mime_type text not null,   byte_size bigint not null,
  sha256_digest text not null,   filename text,
  storage_key text not null,   created_at timestamptz not null default current_timestamp,
  primary key (tenant_id, workspace_id, session_id, attachment_id),
  unique (tenant_id, workspace_id, session_id, sha256_digest, byte_size),
  foreign key (tenant_id, workspace_id, session_id)
    references agent_sessions(tenant_id, workspace_id, session_id),
  check (byte_size >= 0)
);
create table record_attachments (
  tenant_id text not null,   workspace_id text not null,
  stream_id uuid not null,   record_id uuid not null,
  session_id text not null,   attachment_id uuid not null,
  ordinal integer not null,
  primary key (tenant_id, workspace_id, stream_id, record_id, ordinal),
  foreign key (tenant_id, workspace_id, stream_id, record_id)
    references stream_records(tenant_id, workspace_id, stream_id, record_id),
  foreign key (tenant_id, workspace_id, session_id, record_id)
    references stream_records(tenant_id, workspace_id, session_id, record_id),
  foreign key (tenant_id, workspace_id, session_id, attachment_id)
    references attachments(tenant_id, workspace_id, session_id, attachment_id),
  check (ordinal >= 0)
);
create table usage_ledger (
  tenant_id text not null,   workspace_id text not null,
  usage_id text not null,   session_id text not null,
  submission_id uuid,   attempt_id uuid,
  pi_entry_id text,   provider_response_id text,
  provider text not null,   model text not null,
  input_tokens bigint not null default 0,   output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,   cache_write_tokens bigint not null default 0,
  provider_cost_micros bigint,   billed_micros bigint,
  currency text not null default 'USD',   canonical_record_id uuid,
  recorded_at timestamptz not null default current_timestamp,
  primary key (tenant_id, usage_id),
  foreign key (tenant_id, workspace_id, session_id)
    references agent_sessions(tenant_id, workspace_id, session_id),
  foreign key (tenant_id, workspace_id, submission_id)
    references submissions(tenant_id, workspace_id, submission_id),
  foreign key (tenant_id, workspace_id, submission_id, attempt_id)
    references submission_attempts(
      tenant_id, workspace_id, submission_id, attempt_id
    ),
  foreign key (tenant_id, workspace_id, session_id, canonical_record_id)
    references stream_records(tenant_id, workspace_id, session_id, record_id),
  check (
    input_tokens >= 0 and output_tokens >= 0
    and cache_read_tokens >= 0 and cache_write_tokens >= 0
  ),
  check ((submission_id is null) = (attempt_id is null))
);
create table stream_checkpoints (
  tenant_id text not null,   workspace_id text not null,
  stream_id uuid not null,   through_batch_no bigint not null,
  incarnation_uid uuid not null,   format_version integer not null,
  data_digest text not null,   data bytea not null,
  written_at timestamptz not null default current_timestamp,
  primary key (tenant_id, workspace_id, stream_id),
  foreign key (tenant_id, workspace_id, stream_id, incarnation_uid)
    references conversation_streams(
      tenant_id, workspace_id, stream_id, incarnation_uid
    ),
  check (through_batch_no >= -1),
  check (format_version > 0)
);
create table legacy_cursor_alias (
  tenant_id text not null,   workspace_id text not null,
  stream_id uuid not null,   old_path text not null,
  old_seq bigint not null,   new_batch_no bigint not null,
  primary key (tenant_id, workspace_id, old_path, old_seq),
  foreign key (tenant_id, workspace_id, stream_id, new_batch_no)
    references stream_batches(tenant_id, workspace_id, stream_id, batch_no)
);
```
# Required transactional operations
## Admit
1. Lock the scoped session row.
2. Resolve an existing non-null idempotency key.
3. Return an exact replay only when payload version and digest match.
4. Reject conflicting reuse.
5. Allocate `queue_seq = prior + 1` under the same lock.
6. Insert `status = 'queued'` before any model/provider/tool work.
## Claim
1. Select the smallest unsettled `queue_seq` for the session.
2. Require it to be queued and canonically ready.
3. Insert a new attempt row.
4. Compare-and-set submission to `running` and the new current attempt.
5. Increment `attempt_count` and anchor `timeout_at` only once.
6. Commit before executing Pi.
## Acquire producer
1. Lock the stream row.
2. Set producer id, increment producer epoch, reset producer sequence.
3. Return the stream incarnation, epoch, sequence zero, and current batch offset.
4. Every prior claim becomes stale immediately.
## Append batch
1. Lock the stream row.
2. Verify incarnation, producer id, epoch, and expected producer sequence.
3. If submission-owned, verify current attempt and unexpired ownership.
4. Check exact retry identity before allocating a batch number.
5. Insert the batch plus all records in one transaction.
6. Verify `record_count` equals the inserted record count.
7. Advance stream head and producer sequence in the same transaction.
## Respond to pause
1. Authenticate and resolve current tenant/workspace membership.
2. Hash the presented capability and compare in constant time.
3. Lock the scoped pause row.
4. Require `state = 'pending'` and `now < expires_at` when expiry exists.
5. Enforce `answer_policy` and validate response schema.
6. Set response identity, responder, channel, payload, time, and `responded` atomically.
7. Exact replay of the same `response_id` and payload returns the prior result.
8. Conflicting replay fails.
## Consume approval
1. Lock the pause and submission rows.
2. Require pause `responded` and submission still owns the continuation.
3. Match tool call, action name, canonical argument digest, and scope.
4. Recheck current resource authorization.
5. Transition pause to `consumed` before releasing the one-shot continuation.
6. A stale/expired/replaced pause can never authorize execution.
## Settle
1. Build the exact immutable settlement record and digest.
2. Compare-and-set `running -> terminalizing` for the current attempt.
3. Exact retries of the same record identity/digest return the reservation.
4. Conflicting retries and stale attempts fail.
5. Append the reserved record through the fenced stream writer.
6. Verify the canonical record exists.
7. Compare-and-set `terminalizing -> settled` for that record and attempt.
8. Recovery scans and completes any stranded terminalizing obligation.
# Decisions only the author can make
1. Is Pi branching/fork a supported product capability, or is the product intentionally linearizing sessions and removing those APIs?
2. Is one transactional database the required first implementation, or must split submission/stream stores work on day one?
3. Are later submissions blocked behind a pending pause, or may sessions process concurrent turns?
4. Are live turn-boundary joins/steering required; if yes, which explicit `joining/joined` state machine is accepted?
5. Who may answer each approval class: submitter, session owner, workspace role, named principal, channel identity, or a combination?
6. Where do OAuth credentials live, and what durable non-secret reference does a pause store?
7. Are child/subagent sessions externally listable, independently retainable, and independently deletable?
8. Must old v1 cursors continue working after cutover, and for how long?
9. Is historical UI event fidelity required, or is verified Pi transcript/tree fidelity sufficient for legacy sessions?
10. What happens to an active legacy turn at the migration barrier: drain, abort, or mark failed with unknown tool outcomes?
11. What are tenant deletion, user erasure, legal-hold, attachment retention, and child-session retention semantics?
12. Is active-active ownership of one session a requirement, or is affinity plus replacement ownership sufficient?

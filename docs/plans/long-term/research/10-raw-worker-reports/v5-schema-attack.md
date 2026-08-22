# FATAL — V4 is not executable PostgreSQL DDL
**Failing scenario**
`agent_sessions.created_by_submission_id` is declared `text`. `submissions.submission_id` is declared `uuid`. V4 later creates a composite foreign key from the former to the latter. PostgreSQL rejects that foreign key because corresponding columns have incompatible types. The migration stops while creating the schema, before any operation can run. This is deterministic, not a concurrency edge case.
**Exact fix**
```sql
alter table agent_sessions
  alter column created_by_submission_id type uuid
  using created_by_submission_id::uuid;
```
For a fresh install, declare the column as `uuid` in `create table agent_sessions`.
# A1 — Admit
## SERIOUS — admission is atomic only inside the new store, not with the existing request ledger
**Failing interleaving**
P1 commits `agent_request_ledger.state = 'pending-admission'` in the existing SQLite ledger. P1 commits the new V4 `submissions` row. P1 dies before `acceptAdmission` advances the existing ledger. P2 retries the same request. The old ledger says the admission is pending. The new store says the submission already exists. No V4 operation reconciles those states. Reverse the commit order and the failure is worse. The old ledger can return an accepted receipt for a submission that never committed. The V4 idempotency index cannot make two databases atomic. Within V4 alone, locking the session and using `submissions_idempotency_present_idx` serializes same-session admissions.
Digest equality remains transition logic; the unique index cannot distinguish exact replay from conflict. SQLite cannot implement `SELECT ... FOR UPDATE` and must use `BEGIN IMMEDIATE`.
**Exact fix**
Put the full gateway request identity and submission admission in the same database transaction. The identity must include workspace scope, auth subject, operation, target, and request id. If the ledger must remain separate, add a transactional admission outbox in the V4 database:
```sql
create table admission_outbox (
  tenant_id text not null,
  workspace_id text not null,
  request_key_digest text not null,
  submission_id uuid not null,
  payload_digest text not null,
  state text not null check (state in ('committed','projected')),
  created_at timestamptz not null default current_timestamp,
  primary key (tenant_id, workspace_id, request_key_digest),
  foreign key (tenant_id, workspace_id, submission_id)
    references submissions(tenant_id, workspace_id, submission_id)
);
```
Insert `submissions` and `admission_outbox` together. Project the old ledger asynchronously and derive acceptance only from the committed outbox row.
## MINOR — queue allocation has no durable counter
**Failing interleaving**
P1 and P2 both compute `max(queue_seq) + 1` without actually taking the documented session lock. Both attempt the same sequence. The unique key rejects one, so safety survives but availability depends on retry code. The DDL does not express the allocation transition.
**Exact fix**
Either keep the mandatory scoped session lock and check every insert result, or add `next_queue_seq bigint not null default 0` to `agent_sessions` and allocate with:
```sql
update agent_sessions
set next_queue_seq = next_queue_seq + 1,
    updated_at = current_timestamp
where tenant_id = $1 and workspace_id = $2 and session_id = $3
returning next_queue_seq - 1;
```
# A1 — Claim
## SERIOUS — two claimers can leave two live attempt rows
**Failing interleaving**
P1 selects queued head Q. P2 selects the same Q. P1 inserts attempt A with `state = 'running'`. P2 inserts attempt B with `state = 'running'`. P1 wins the submission compare-and-set to current attempt A. P2's compare-and-set updates zero rows. If P2 fails to check row count or commits instead of rolling back, B remains a live orphan. V4 permits arbitrarily many `running` attempts for one submission. Correctness relies on transaction discipline, not a constraint.
**Exact fix**
```sql
create unique index submission_attempts_one_running_idx
  on submission_attempts(tenant_id, workspace_id, submission_id)
  where state = 'running';
```
The attempt insert and submission CAS must be one transaction. The transaction must abort unless the CAS returns exactly one row.
## FATAL — a dead running owner blocks the session forever
**Failing scenario**
P1 claims queue head Q and commits `status = 'running'`. P1 dies before settling. The attempt lease expires. Claim only accepts `queued` submissions. The next claim selects the smallest unsettled queue item, which is Q. Q is not queued, so no claim succeeds. Every later submission in that session remains blocked forever. V4 has no replace-attempt or reclaim operation. It also never enforces `attempt_count < max_attempts` or `timeout_at`.
**Exact fix**
Add a Reclaim transaction:
1. Lock the submission and current attempt.
2. Require `status = 'running'`, current attempt equality, and expired lease.
3. Mark the old attempt `replaced` with `finished_at` and `replaced_by_attempt_id`.
4. Insert the new attempt.
5. Advance `current_attempt_id` and `attempt_count` atomically.
6. If retry budget or wall timeout is exhausted, reserve a failed or aborted settlement instead.
```sql
create index submission_attempts_expired_idx
  on submission_attempts(tenant_id, workspace_id, lease_expires_at)
  where state = 'running';
alter table submissions add constraint submissions_attempt_budget_check
  check (attempt_count <= max_attempts);
```
# A1 — Acquire producer
## FATAL — any caller can steal the producer fence
**Failing interleaving**
Current attempt A acquires producer P at epoch 7. Replaced or unauthorized process S calls Acquire Producer. V4 locks only the stream row. It does not require S to own a current, running, unexpired attempt. S overwrites the producer id and advances the epoch to 8. A is fenced even though its submission lease is still valid. S now holds a schema-valid producer claim. The required transition confuses mutual exclusion with authorization.
**Exact fix**
```sql
alter table conversation_streams
  add column producer_submission_id uuid,
  add column producer_attempt_id uuid,
  add constraint conversation_streams_producer_pair_check
    check ((producer_submission_id is null) = (producer_attempt_id is null)),
  add constraint conversation_streams_producer_attempt_fk
    foreign key (
      tenant_id, workspace_id, producer_submission_id, producer_attempt_id
    ) references submission_attempts(
      tenant_id, workspace_id, submission_id, attempt_id
    );
```
Acquire must lock stream, submission, and attempt in a single documented order. Its conditional update must require current attempt, running state, owner identity, and live lease. Define a separate privileged path for system-owned tree or migration writes. Revoke direct table DML from worker roles and expose acquisition through a database procedure.
# A1 and A2 — Append batch and fencing
## FATAL — the exact-retry algorithm rejects every successful retry
**Failing interleaving**
P1 appends producer sequence 0. The transaction advances `next_producer_sequence` to 1. The response is lost. P1 retries epoch E, sequence 0, and the same digest. V4 step 2 checks the expected producer sequence before step 4 checks retry identity. Sequence 0 is no longer expected, so the exact retry is rejected. The unique key contains the information needed to return the old offset, but the stated transition consults it too late.
**Exact transition fix**
After locking the stream, first run:
```sql
select batch_no, incarnation_uid, submission_id, attempt_id,
       record_count, content_digest
from stream_batches
where tenant_id = $1
  and workspace_id = $2
  and stream_id = $3
  and producer_id = $4
  and producer_epoch = $5
  and producer_sequence = $6;
```
If found, compare every immutable input and return the original batch only on exact equality. Only when absent may the code require `$6 = next_producer_sequence` and allocate a new batch.
## FATAL — a replaced attempt can append after replacement commits
**Failing interleaving**
P1 locks the stream row and reads attempt A as current and unexpired. P1 does not lock the submission or attempt row. P2 replaces A with attempt B and commits. P1 inserts a batch referring to historical attempt A and advances the head. The batch foreign key proves only that A once existed. It does not prove A is current, running, owned by this producer, or unexpired. The stale producer has written after its logical fence.
**Exact transition fix**
Use one lock order everywhere: stream, submission, attempt. Under those locks, require:
```sql
submissions.status in ('running','terminalizing')
and submissions.current_attempt_id = $attempt_id
and submission_attempts.state = 'running'
and submission_attempts.owner_id = $producer_id
and submission_attempts.owner_epoch = $producer_epoch
and submission_attempts.lease_expires_at > clock_timestamp()
```
The guarded append and head update must be one transaction. Every conditional statement must check `RETURNING` or affected-row count. This invariant cannot be expressed by the existing foreign keys. It requires a procedure/trigger boundary or exclusive disciplined DML privileges.
## SERIOUS — `record_count` does not enforce batch atomic shape
**Failing scenario**
The batch says `record_count = 2`. The transaction inserts one child record. A buggy adapter skips V4 step 6 and commits. Every declared constraint passes. A later delete can also reduce the child count because immutability is not declared.
**Exact fix**
Use a deferred constraint trigger that counts children at commit, or store the complete serialized batch in one immutable row. Revoke `UPDATE` and `DELETE` on stream batches and records from application roles.
# A1 — Respond to pause
## SERIOUS — winner serialization works, but exact response retry is also ordered incorrectly
**Failing interleaving**
P1 responds to pending pause X and commits `responded`. Its response is lost. P1 retries the same response id and payload. V4 step 4 requires `state = 'pending'` before step 7 handles exact replay. The retry fails because X is already responded. Two different concurrent responses do serialize correctly on the pause row lock. The first wins and the second must fail.
**Exact transition fix**
Under the row lock, first compare an existing response identity and payload. Return an exact match. Reject a conflict. Only if no response exists may the code require pending state and an unexpired deadline.
## SERIOUS — the state check permits an unidentifiable response
**Failing scenario**
An update writes `state='responded'`, a JSON payload, and `responded_at`. It leaves `response_id`, responder principal, and channel NULL. V4's check accepts the row. No exact retry or authorization audit can identify that response. Terminal pause states accept arbitrary response and consumption fields because the last check arm is unconstrained.
**Exact fix**
Require `response_id`, `responded_by_principal_id`, and `responded_via` for `responded` and `consumed`. Define an explicit field shape for each terminal state. Use a response digest if payload equality must be stable across adapters.
# A1 and A4 — Consume approval
## FATAL — the pause is one-shot, but the external effect is neither durable nor exactly once
**Failing interleaving**
P1 changes the pause from `responded` to `consumed` and commits. P1 dies before dispatching the tool effect. Recovery cannot consume again because the pause is no longer responded. The approved effect occurs zero times. If recovery instead replays consumed pauses, P1 can die after the effect but before recording it. The same effect then occurs twice. `consumed_at` is not an effect ledger. For non-idempotent external systems, no schema can promise exactly once across that crash window.
**Exact fix**
Atomically consume the pause and insert a durable continuation dispatch:
```sql
create table continuation_dispatches (
  tenant_id text not null,
  workspace_id text not null,
  pause_id uuid not null,
  effect_id uuid not null,
  action_name text not null,
  args_digest text not null,
  state text not null check (state in
    ('queued','running','succeeded','failed','outcome_unknown')),
  owner_id text,
  lease_expires_at timestamptz,
  settled_at timestamptz,
  primary key (tenant_id, workspace_id, pause_id),
  unique (tenant_id, workspace_id, effect_id),
  foreign key (tenant_id, workspace_id, pause_id)
    references pauses(tenant_id, workspace_id, pause_id)
);
```
Workers claim and reclaim this dispatch by lease. The executor receives `effect_id` as its idempotency key. The executor loads the immutable action and digest from storage, never from new caller arguments. Record `outcome_unknown` when an external effect cannot be reconciled.
## SERIOUS — two pause rows can authorize the same tool call
**Failing interleaving**
P1 inserts approval X for tool call T and continuation key C1. P2 inserts approval Y for the same submission and tool call T but key C2. Both rows satisfy V4's only continuation uniqueness rule. Both receive responses. Both are consumed. The same logical effect is authorized twice.
**Exact fix**
```sql
create unique index pauses_one_approval_per_tool_call_idx
  on pauses(tenant_id, workspace_id, submission_id, tool_call_id)
  where kind = 'approval';
```
A genuinely later invocation must have a new tool-call id. Consume with one conditional update matching state, tool call, action, and argument digest.
## SERIOUS — `blocked_by_pause_id` can point at another submission's pause
**Failing scenario**
Submission S1 is in the same workspace as S2. Set S1's `blocked_by_pause_id` to a pause owned by S2. The current foreign key passes because it contains no submission or session identity. Queue scheduling and continuation ownership are now corrupted.
**Exact fix**
```sql
alter table pauses add constraint pauses_submission_pause_uq
  unique (tenant_id, workspace_id, submission_id, pause_id);
alter table submissions drop constraint submissions_blocked_pause_fk;
alter table submissions add constraint submissions_blocked_pause_fk
  foreign key (tenant_id, workspace_id, submission_id, blocked_by_pause_id)
  references pauses(tenant_id, workspace_id, submission_id, pause_id)
  deferrable initially deferred;
```
# A1 and A3 — Settle
## FATAL — the advertised settlement reservation cannot commit
**Failing scenario**
Settle step 2 commits `running -> terminalizing` with a reserved record id. The terminalizing check requires `settlement_record_id` to be non-null. The deferred foreign key requires that record to exist by transaction commit. Settle step 5 appends the record only after reservation. Foreign-key deferral does not cross transactions. The reservation transaction therefore fails every time. The claimed stranded-terminalizing recovery state cannot be created as specified.
**Exact fix**
Separate reservation identity from canonical visibility:
```sql
alter table submissions
  add column reserved_settlement_record_id uuid;
```
Terminalizing must require the reserved id, outcome, digest, and timestamp, while requiring final `settlement_record_id is null`. Settled must require both ids and equality between them. Only the final id receives the foreign key to `stream_records`. The alternative is reserve, append, and finalize in one database transaction, but then V4 must delete its claimed cross-transaction recovery protocol.
## FATAL — a submission can produce two canonical terminal records
**Failing interleaving**
A buggy or stale producer appends `submission_settled(completed)` record R1. The submission row has not reserved R1. The legitimate settle path later appends `submission_settled(failed)` record R2. The submission row records only R2 and first-row CAS still appears correct. The canonical stream contains two terminal outcomes for the same submission. `kind` is unconstrained text and no unique key prevents this. The settlement foreign key checks only record id within the session. It does not check record kind, submission, attempt, outcome, or digest.
**Exact fix**
```sql
create unique index stream_records_one_settlement_idx
  on stream_records(tenant_id, workspace_id, submission_id)
  where kind = 'submission_settled';
```
Add a constraint trigger verifying that the referenced record's submission, attempt, kind, payload outcome, and digest equal the reservation. Do not allow generic append authority to write settlement records.
## FATAL — a submission can reach zero terminal outcomes
**Failing scenario**
Owner death while running is never reclaimed. Owner death after reservation is not recoverable because that reservation cannot commit. A producer reacquisition after reservation can also fence the owner before append. Recovery cannot replace a terminalizing current attempt under the stated operations. The submission stays unsettled forever.
**Exact fix**
Add expired-running recovery and reserved-terminalizing recovery as first-class operations. Add indexes for both scans:
```sql
create index submissions_terminalizing_recovery_idx
  on submissions(tenant_id, workspace_id, terminalizing_at)
  where status = 'terminalizing';
create index submission_attempts_expired_idx
  on submission_attempts(tenant_id, workspace_id, lease_expires_at)
  where state = 'running';
```
Reservation CAS must require current attempt, running attempt state, owner, epoch, and live lease. Two simultaneous Settle calls are otherwise safe only if the losing CAS checks zero rows and aborts.
# A5 — Tree fidelity
## FATAL — deferred parent foreign keys admit cycles
**Failing transaction**
```sql
begin;
-- abbreviated common scope and batch columns
insert into stream_records
  (..., pi_entry_id, pi_parent_entry_id, pi_entry_type, pi_schema_version)
values
  (..., 'A', 'B', 'message', 1),
  (..., 'B', 'A', 'message', 1);
commit;
```
Both rows exist by deferred-FK checking time. Every V4 constraint passes. Pi's `getPathToRoot('A')` follows A to B to A forever. A recursive CTE with `UNION ALL` also loops until the recursion/resource limit.
**Exact fix**
For online appends, make the parent foreign key immediate and make tree identity immutable. Parents already exist before children in Pi's storage contract. If bulk import needs forward references, use a deferred cycle-detecting constraint trigger. Never keep the deferred FK without a cycle check.
```sql
create function forbid_pi_tree_rewrite() returns trigger language plpgsql as $$
begin
  if (new.tenant_id,new.workspace_id,new.session_id,
      new.pi_entry_id,new.pi_parent_entry_id)
     is distinct from
     (old.tenant_id,old.workspace_id,old.session_id,
      old.pi_entry_id,old.pi_parent_entry_id)
  then
    raise exception 'Pi tree identity and parent are immutable';
  end if;
  return new;
end $$;
create trigger stream_records_pi_tree_immutable
before update on stream_records
for each row execute function forbid_pi_tree_rewrite();
```
## FATAL — a compaction target need not be on the compacted branch
**Failing scenario**
Create root A with sibling children B and C. Append compaction D with parent C and target B. The target FK passes because B is in the same session. Pi searches `firstKeptEntryId` only on D's selected ancestor path. B is not on A/C/D. Pi silently omits all intended pre-compaction context.
**Exact fix**
Add a deferred constraint trigger that recursively proves `pi_target_entry_id` is an ancestor of `pi_parent_entry_id` for compactions. Reject the insert when no such ancestor exists.
## SERIOUS — generic target columns admit invalid Pi entry shapes
**Failing scenario**
V4 accepts a label with no target. It accepts a message with an arbitrary target. It accepts a leaf whose JSON target differs from `pi_target_entry_id`. Readers trusting JSON and readers trusting normalized columns reconstruct different trees.
**Exact fix**
```sql
alter table stream_records add constraint stream_records_pi_target_shape check (
  kind <> 'pi_entry' or case pi_entry_type
    when 'compaction' then pi_target_entry_id is not null
    when 'label' then pi_target_entry_id is not null
    when 'leaf' then true
    else pi_target_entry_id is null
  end
);
```
Add a trigger or generated projection verifying payload/column equality. For leaf, JSON null and SQL NULL both mean reset to root. For compaction, payload `firstKeptEntryId` must equal the normalized target.
## SERIOUS — V4 can represent a fork but does not define how to create one
**Failing scenario**
Implementation inserts a fork session row with `parent_session_id` and `forked_from_entry_id`. It creates an empty child stream. Pi's actual fork copies the selected path entries into new storage. Opening the V4 child returns an empty `getEntries()` and `getPathToRoot()`. Provenance metadata is not the fork contents.
**Exact transition fix**
Add a Fork transaction that:
1. Locks the parent session/stream at a selected source offset.
2. Resolves Pi's `before` versus `at` fork semantics.
3. Creates the child session and stream.
4. Copies the selected root-to-target path in order.
5. Preserves Pi entry ids, parents, payloads, and timestamps in child scope.
6. Clears source submission/attempt ownership on copied history.
7. Commits child metadata and complete copied path atomically.
## Branch reconstruction query
```sql
with recursive
latest as (
  select pi_entry_id, pi_entry_type, pi_target_entry_id
  from stream_records
  where tenant_id = $1
    and workspace_id = $2
    and session_id = $3
    and kind = 'pi_entry'
  order by batch_no desc, record_index desc
  limit 1
),
leaf as (
  select case
    when pi_entry_type = 'leaf' then pi_target_entry_id
    else pi_entry_id
  end as id
  from latest
),
recursive_path as (
  select r.*, 0 as depth
  from stream_records r
  join leaf l on r.pi_entry_id = l.id
  where r.tenant_id = $1
    and r.workspace_id = $2
    and r.session_id = $3
  union all
  select p.*, c.depth + 1
  from recursive_path c
  join stream_records p
    on p.tenant_id = c.tenant_id
   and p.workspace_id = c.workspace_id
   and p.session_id = c.session_id
   and p.pi_entry_id = c.pi_parent_entry_id
)
select * from recursive_path order by depth desc;
```
The parent walk is indexed by V4's unique scoped `pi_entry_id` key. Its cost is O(h log N) plus O(h) output for branch height h. Finding the latest leaf is not indexed and scans/sorts session records. Add:
```sql
create index stream_records_latest_pi_entry_idx
  on stream_records(
    tenant_id, workspace_id, session_id,
    batch_no desc, record_index desc
  ) include (pi_entry_id, pi_entry_type, pi_target_entry_id)
  where kind = 'pi_entry';
```
# A6 — Tenancy and association integrity
## FATAL — tenant columns do not isolate reads
**Cross-tenant read**
```sql
select payload from stream_records where record_id = $1;
```
The query forgot tenant and workspace predicates. V4 returns matching rows from every tenant. `record_id` is not globally unique, so `.first()` can leak nondeterministically. The same failure applies to:
```sql
select * from pauses where pause_id = $1 for update;
select storage_key from attachments where attachment_id = $1;
select * from agent_sessions where session_id = $1;
select * from usage_ledger where usage_id = $1;
```
Composite keys constrain writes; they do nothing to a SELECT that omits scope. V4 recommends RLS in prose but creates no RLS policy.
**Exact PostgreSQL fix**
For every scoped table:
```sql
alter table stream_records enable row level security;
alter table stream_records force row level security;
create policy tenant_workspace_isolation on stream_records
using (
  tenant_id = current_setting('app.tenant_id', true)
  and workspace_id = current_setting('app.workspace_id', true)
)
with check (
  tenant_id = current_setting('app.tenant_id', true)
  and workspace_id = current_setting('app.workspace_id', true)
);
```
Repeat for sessions, streams, submissions, attempts, batches, pauses, attachments, joins, usage, checkpoints, aliases, outbox, and dispatches. Use an application role that is NOSUPERUSER and NOBYPASSRLS. Use `FORCE ROW LEVEL SECURITY` to close the table-owner bypass. At transaction start set both values transaction-locally:
```sql
select set_config('app.tenant_id', $1, true);
select set_config('app.workspace_id', $2, true);
```
SQLite has no equivalent structural read isolation. Its adapter remains application-enforced and needs adversarial scope contract tests.
## FATAL — a record's stream and session can disagree
**Failing scenario**
Create stream SA owned by session A. Insert a batch for SA. Insert its record with `session_id = 'B'`. The batch FK resolves through SA. The independent session FK resolves through B. Both pass. Stream replay of A now emits a tree entry whose tree constraints are scoped to B.
**Exact fix**
```sql
alter table conversation_streams add constraint conversation_streams_stream_session_uq
  unique (tenant_id, workspace_id, stream_id, session_id);
alter table stream_records add constraint stream_records_stream_session_fk
  foreign key (tenant_id, workspace_id, stream_id, session_id)
  references conversation_streams(tenant_id, workspace_id, stream_id, session_id);
```
The stronger repair adds `session_id` to `stream_batches` and carries it through every batch and record foreign key.
## SERIOUS — independent foreign keys permit same-workspace ownership laundering
**Failing cases**
A pause may name session B while referencing a submission from session A. A stream-A batch may reference an attempt belonging to session B. A stream-A record may reference a session-B attempt. Two records can deliberately reuse record UUID R in different stream/session pairs. `record_attachments` can resolve its stream FK to one record and session FK to the other. The attachment then joins bytes and metadata from different resources.
**Exact fix**
Carry `session_id` through `submission_attempts` and `stream_batches`. Use composite foreign keys shaped as:
```sql
(tenant_id, workspace_id, session_id, submission_id, attempt_id)
```
Add one full record identity:
```sql
alter table stream_records add constraint stream_records_full_identity_uq
  unique (tenant_id, workspace_id, stream_id, session_id, record_id);
```
Make `record_attachments` reference that one identity instead of two independent records. Make pauses reference `(scope, session, submission)` as one key.
# A7 — Migration
## FATAL — the promised SQLite lowering cannot execute V4's cyclic ALTER statements
**Failing case**
The source event store and request ledger are SQLite. V4 says SQLite may lower enums and JSONB, then creates cyclic relationships with PostgreSQL `alter table ... add constraint`. SQLite rejects that syntax; lowering column types does not repair it. The migration fails while adding `submissions_current_attempt_fk`, before data import.
**Exact fix**
Ship a separate SQLite DDL in which all foreign keys are present in `CREATE TABLE`, including references to tables created later, or rebuild affected tables through create/copy/rename migrations. Do not describe enum/JSON lowering as a complete SQLite adapter plan.
## SERIOUS — malformed or duplicate-id Pi JSONL has no import policy
**Failing case**
A legacy file contains valid entry A, malformed/truncated entry B with id `b`, and valid entry C whose parent is `b`. Existing Boring parsing can skip B and retain C; V4 either inserts C and fails its parent FK or drops C and loses displayed history. Pi JSONL also accepts duplicate ids into an in-memory last-write-wins map, while V4's scoped Pi id key rejects them.
**Exact fix**
Add a durable import-anomaly/quarantine journal, preserve source bytes and digest, and keep the affected session `legacy_read_only`. Activation must require explicit repair or a documented lossy policy; silent skipping is not migration.
## FATAL — there is no idempotent migration identity for legacy rows
**Failing scenario**
Migrator imports old path P, sequence 17 into new batch 42. It inserts records and crashes before inserting `legacy_cursor_alias`. On restart it cannot prove batch 42 came from P/17. `stream_records.migration_source` is untyped JSON with no unique constraint. The migrator inserts P/17 again as batch 43. The canonical stream now contains a duplicated event. Reverse the write order and `legacy_cursor_alias` cannot be inserted first because it has an immediate foreign key to the not-yet-created batch.
**Exact fix**
Put source identity on the batch and constrain it:
```sql
alter table stream_batches
  add column migration_source_kind text,
  add column migration_source_key text;
create unique index stream_batches_migration_source_idx
  on stream_batches(
    tenant_id, workspace_id, migration_source_kind, migration_source_key
  )
  where migration_source_key is not null;
```
For old events use a canonical key such as `old_path || '#' || old_seq`. Insert batch, records, and alias in one transaction. On retry, compare the imported digest before returning the existing mapping.
## FATAL — old event stream paths do not supply V4 tenancy
**Failing case**
The old store keys rows only by opaque `path`. Historical paths include `sessions/${sessionKey}`. Current `sessionKey` serializes session id plus workspace/user context, while older callers can use only the raw session id. Neither form provides a guaranteed V4 `tenant_id`. Alice and Bob may each own legacy session id `s1` in the same workspace because user is part of the old storage scope; V4 omits user from the session key, so the second session insert collides. The same public session can also have two non-identical old event paths, but V4 permits only one conversation stream. No deterministic SQL migration can invent ownership or choose which history wins. Guessing a default tenant, merging streams, or dropping a path silently reassigns or loses data.
**Exact fix**
Require an explicit migration scope map:
```sql
create table legacy_scope_map (
  old_path text primary key,
  tenant_id text not null,
  workspace_id text not null,
  session_id text not null,
  resolution text not null check (resolution in ('mapped','quarantined'))
);
```
Quarantine every path without one unambiguous mapping. Do not cut over while unresolved rows exist.
## SERIOUS — closed legacy streams lose their terminal read state
**Failing case**
`boring_event_streams.closed = 1` for path P. V4's `conversation_streams` has no closed state. After migration, a subscriber that previously observed `closed: true` observes an apparently open stream and waits forever.
**Exact fix**
If historical UI cursor fidelity is required, add:
```sql
alter table conversation_streams
  add column closed_at timestamptz;
```
Map old `closed=1` to a non-null close marker. If canonical streams intentionally never close, explicitly retire the old API and do not claim transparent cursor migration.
## FATAL — Pi JSONL fork provenance is not reliably reconstructible
**Failing case**
A child JSONL header stores `parentSession` as a file path. The parent file was deleted, moved, or belongs to a scope not mounted during migration. V4 requires `parent_session_id` to reference an existing session. The child cannot be inserted as `fork` or `subagent` without violating the FK/check. Even when the file exists, the header does not store V4's exact `forked_from_entry_id`. A full-session fork copies all entries, including branch/leaf markers, so inference from the child's last physical entry can name a leaf marker rather than source leaf.
**Exact fix**
Add import states that preserve unresolved provenance without falsifying it:
```sql
alter table agent_sessions
  add column legacy_parent_ref text,
  add column migration_state text not null default 'native'
    check (migration_state in ('native','resolved','quarantined'));
```
Permit quarantined imported sessions to be read-only with unresolved parent provenance, or require a preflight that rejects the entire cutover until all parents resolve. Never synthesize `forked_from_entry_id` without verifying copied path equality.
## FATAL — V4 does not reconcile the existing request ledger state machine
**Failing case**
The existing ledger contains `in-flight` request R when the migration barrier occurs. The old process may already have executed a tool effect. V4 has no submission/attempt row for R and no `outcome-unknown` outcome. Replaying R may duplicate the effect. Dropping R may lose accepted work. Marking it failed asserts an outcome that is not known.
**Exact fix**
Drain active old work before migration, or add `outcome_unknown` to the imported settlement model and preserve the full request key/digest. The migration must specify one barrier policy: drain, abort, or quarantine unknown outcomes. Without that policy, migration is not executable.
## SERIOUS — stream incarnation cannot be rotated with historical batches present
**Failing scenario**
The migration or reset logic updates `conversation_streams.incarnation_uid`. Historical batches reference the old `(stream_id, incarnation_uid)` tuple. The update is rejected by their foreign keys. Using cascade would rewrite historical batches to lie about their incarnation. The schema promises incarnation reset behavior but models only one mutable incarnation row.
**Exact fix**
Create an immutable incarnation table:
```sql
create table stream_incarnations (
  tenant_id text not null,
  workspace_id text not null,
  stream_id uuid not null,
  incarnation_uid uuid not null,
  created_at timestamptz not null default current_timestamp,
  retired_at timestamptz,
  primary key (tenant_id, workspace_id, stream_id, incarnation_uid)
);
```
Let batches reference this table. Let the stream row point to `current_incarnation_uid`. Never update an incarnation identity in place.
# A8 — Performance
## SERIOUS — pending pause discovery table-scans
**Table-scanning query**
```sql
select * from pauses
where tenant_id = $1
  and workspace_id = $2
  and state = 'pending'
  and (expires_at is null or expires_at > current_timestamp)
order by created_at;
```
The primary key ends in `pause_id`; no index begins with state/time discovery keys.
**Exact fix**
```sql
create index pauses_pending_idx
  on pauses(tenant_id, workspace_id, created_at)
  include (session_id, submission_id, expires_at)
  where state = 'pending';
```
Add a separate expiry index if the sweeper orders by `expires_at`.
## SERIOUS — runnable-head lookup is not covered in queue order
**Slow query**
```sql
select * from submissions s
where s.tenant_id = $1
  and s.workspace_id = $2
  and s.session_id = $3
  and s.status <> 'settled'
order by s.queue_seq
limit 1;
```
V4 indexes `(scope, session, status, queue_seq)`. Because status precedes queue sequence, multiple unsettled statuses require merge/sort.
**Exact fix**
```sql
create index submissions_unsettled_head_idx
  on submissions(tenant_id, workspace_id, session_id, queue_seq)
  where status <> 'settled';
```
## SERIOUS — list sessions per tenant/workspace sorts the whole scope
**Slow query**
```sql
select * from agent_sessions
where tenant_id = $1 and workspace_id = $2 and mode <> 'tombstoned'
order by updated_at desc, session_id
limit $3;
```
The primary key is ordered by session id, not recency.
**Exact fix**
```sql
create index agent_sessions_list_idx
  on agent_sessions(
    tenant_id, workspace_id, mode, updated_at desc, session_id
  );
```
If listing crosses workspaces, add a tenant-only recency index separately.
## SERIOUS — latest Pi leaf lookup scans and sorts
The exact query and partial covering index are given in A5. Without that index, every reopen pays O(N log N) or a full scan for latest physical Pi entry.
## SERIOUS — recovery scans have no usable indexes
Expired attempts need a partial index by lease expiry. Terminalizing submissions need a partial index by terminalizing time. Both exact indexes are given in A3. Without them, every recovery tick scans durable history.
## MINOR — child-session listing has no parent index
**Slow query**
```sql
select * from agent_sessions
where tenant_id=$1 and workspace_id=$2 and parent_session_id=$3
order by created_at;
```
**Exact fix**
```sql
create index agent_sessions_parent_idx
  on agent_sessions(
    tenant_id, workspace_id, parent_session_id, created_at
  ) where parent_session_id is not null;
```
## SERIOUS — usage deduplication is not enforced
**Failing scenario**
The provider retry returns the same `provider_response_id` twice. Two workers choose different `usage_id` values. Both rows commit and billing doubles. No V4 key covers provider response identity or canonical record identity.
**Exact fix**
```sql
create unique index usage_ledger_provider_response_idx
  on usage_ledger(tenant_id, workspace_id, provider, provider_response_id)
  where provider_response_id is not null;
create unique index usage_ledger_canonical_record_idx
  on usage_ledger(tenant_id, workspace_id, session_id, canonical_record_id)
  where canonical_record_id is not null;
```
# A9 — Over-engineering and dead weight
## MINOR — `agent_store_meta` is generic machinery for one invariant
The table permits arbitrary keys but only physical schema version is defined. That flexibility carries no current integrity rule. Use a one-row schema metadata table with a checked singleton id, or keep it only if multiple independently versioned projections are already committed scope.
## MINOR — `trace_context` is not canonical state
It does not participate in admission, ownership, ordering, recovery, or settlement. Keep it only if a concrete observability consumer exists. Otherwise remove it from the first durable schema and emit tracing metadata externally.
## SERIOUS — `stream_checkpoints` are premature and incorrectly constrained
Flue defines checkpoints as optional caches. V4 adds them to the mandatory schema before the canonical path is correct. `through_batch_no` can point beyond the stream head or to no batch. The one-row primary key also destroys previous checkpoints without an explicit atomic replacement protocol. Cut the table from the first implementation. Add it only after replay performance is measured and contract tests exist.
## SERIOUS — `legacy_cursor_alias` is insufficient as a migration journal
It maps old cursor to new batch but stores no source digest, migration version, or completion state. It cannot independently prevent duplicate imported batches. Replace it with the constrained batch source identity plus alias written in the same transaction. If old cursors are not a compatibility requirement, cut the table entirely.
## MINOR — `incarnation_uid` uniqueness on the stream row is redundant
`unique(scope, stream_id, incarnation_uid)` adds incarnation to an already unique scoped stream id. Its only purpose is to be a foreign-key target. That purpose prevents rotation and should move to immutable `stream_incarnations`. Do not keep both forms.
## MINOR — attachment dedupe policy is embedded without a stated requirement
`unique(scope, session, sha256_digest, byte_size)` forces one metadata row per identical bytes. Two uploads with different filenames collapse to one attachment identity even though filename is presentation metadata. Either document content-addressed attachment identity and exclude filename intentionally, or remove this unique key and enforce idempotency by attachment id plus byte/digest equality.
# Minimal DDL diff against V4
The following is the minimum structural delta before implementation work starts. It does not replace the required corrected transactions, triggers, RLS role setup, or migration barrier.
```sql
-- 1. Make the base DDL executable.
alter table agent_sessions
  alter column created_by_submission_id type uuid
  using created_by_submission_id::uuid;
-- 2. Prevent multiple live attempts and cover recovery.
create unique index submission_attempts_one_running_idx
  on submission_attempts(tenant_id, workspace_id, submission_id)
  where state = 'running';
create index submission_attempts_expired_idx
  on submission_attempts(tenant_id, workspace_id, lease_expires_at)
  where state = 'running';
alter table submissions add constraint submissions_attempt_budget_check
  check (attempt_count <= max_attempts);
-- 3. Separate settlement reservation from canonical visibility.
alter table submissions
  add column reserved_settlement_record_id uuid;
create index submissions_terminalizing_recovery_idx
  on submissions(tenant_id, workspace_id, terminalizing_at)
  where status = 'terminalizing';
create unique index stream_records_one_settlement_idx
  on stream_records(tenant_id, workspace_id, submission_id)
  where kind = 'submission_settled';
-- Replace V4's submission status CHECK so terminalizing requires
-- reserved_settlement_record_id and settlement_record_id IS NULL,
-- while settled requires settlement_record_id = reserved_settlement_record_id.
-- 4. Bind producer acquisition to an attempt.
alter table conversation_streams
  add column producer_submission_id uuid,
  add column producer_attempt_id uuid,
  add constraint conversation_streams_producer_pair_check
    check ((producer_submission_id is null) = (producer_attempt_id is null)),
  add constraint conversation_streams_producer_attempt_fk
    foreign key (
      tenant_id, workspace_id, producer_submission_id, producer_attempt_id
    ) references submission_attempts(
      tenant_id, workspace_id, submission_id, attempt_id
    );
-- 5. Bind streams and records to the same session.
alter table conversation_streams add constraint conversation_streams_stream_session_uq
  unique (tenant_id, workspace_id, stream_id, session_id);
alter table stream_records add constraint stream_records_stream_session_fk
  foreign key (tenant_id, workspace_id, stream_id, session_id)
  references conversation_streams(tenant_id, workspace_id, stream_id, session_id);
alter table stream_records add constraint stream_records_full_identity_uq
  unique (tenant_id, workspace_id, stream_id, session_id, record_id);
-- 6. Enforce pause ownership and one approval per tool call.
create unique index pauses_one_approval_per_tool_call_idx
  on pauses(tenant_id, workspace_id, submission_id, tool_call_id)
  where kind = 'approval';
alter table pauses add constraint pauses_submission_pause_uq
  unique (tenant_id, workspace_id, submission_id, pause_id);
alter table submissions drop constraint submissions_blocked_pause_fk;
alter table submissions add constraint submissions_blocked_pause_fk
  foreign key (tenant_id, workspace_id, submission_id, blocked_by_pause_id)
  references pauses(tenant_id, workspace_id, submission_id, pause_id)
  deferrable initially deferred;
create table continuation_dispatches (
  tenant_id text not null,
  workspace_id text not null,
  pause_id uuid not null,
  effect_id uuid not null,
  action_name text not null,
  args_digest text not null,
  state text not null check (state in
    ('queued','running','succeeded','failed','outcome_unknown')),
  owner_id text,
  lease_expires_at timestamptz,
  settled_at timestamptz,
  primary key (tenant_id, workspace_id, pause_id),
  unique (tenant_id, workspace_id, effect_id),
  foreign key (tenant_id, workspace_id, pause_id)
    references pauses(tenant_id, workspace_id, pause_id)
);
-- Replace V4's pause state CHECK to require response identity,
-- responder, channel, payload, and timestamp for responded/consumed.
-- 7. Enforce Pi target shapes and cover latest-leaf lookup.
alter table stream_records add constraint stream_records_pi_target_shape check (
  kind <> 'pi_entry' or case pi_entry_type
    when 'compaction' then pi_target_entry_id is not null
    when 'label' then pi_target_entry_id is not null
    when 'leaf' then true
    else pi_target_entry_id is null
  end
);
create index stream_records_latest_pi_entry_idx
  on stream_records(
    tenant_id, workspace_id, session_id,
    batch_no desc, record_index desc
  ) include (pi_entry_id, pi_entry_type, pi_target_entry_id)
  where kind = 'pi_entry';
-- Replace the deferred parent FK with an immediate FK for online writes.
-- Add immutability and compaction-ancestor triggers described in A5.
-- 8. Cover queue, session, pause, and child hot paths.
create index submissions_unsettled_head_idx
  on submissions(tenant_id, workspace_id, session_id, queue_seq)
  where status <> 'settled';
create index agent_sessions_list_idx
  on agent_sessions(
    tenant_id, workspace_id, mode, updated_at desc, session_id
  );
create index agent_sessions_parent_idx
  on agent_sessions(
    tenant_id, workspace_id, parent_session_id, created_at
  ) where parent_session_id is not null;
create index pauses_pending_idx
  on pauses(tenant_id, workspace_id, created_at)
  include (session_id, submission_id, expires_at)
  where state = 'pending';
-- 9. Make migration restartable.
alter table stream_batches
  add column migration_source_kind text,
  add column migration_source_key text;
create unique index stream_batches_migration_source_idx
  on stream_batches(
    tenant_id, workspace_id, migration_source_kind, migration_source_key
  ) where migration_source_key is not null;
create table legacy_scope_map (
  old_path text primary key,
  tenant_id text not null,
  workspace_id text not null,
  session_id text not null,
  resolution text not null check (resolution in ('mapped','quarantined'))
);
-- 10. Prevent usage double counting.
create unique index usage_ledger_provider_response_idx
  on usage_ledger(tenant_id, workspace_id, provider, provider_response_id)
  where provider_response_id is not null;
create unique index usage_ledger_canonical_record_idx
  on usage_ledger(tenant_id, workspace_id, session_id, canonical_record_id)
  where canonical_record_id is not null;
-- 11. Enable and FORCE tenant/workspace RLS on every scoped table.
-- Create USING and WITH CHECK policies from transaction-local app settings.
-- Run workers as NOSUPERUSER NOBYPASSRLS and revoke direct public DML.
```
# Required transition diff against V4
1. Admit must share a transaction with the authoritative request identity,
or write an outbox that is the sole source of admission truth.
2. Claim must check CAS row count, roll back the losing attempt insert,
and enforce the retry budget.
3. Add Reclaim for expired running attempts and exhausted retry budgets.
4. Acquire Producer must be authorized by the current leased attempt,
with a separate explicit system-producer path.
5. Append must check exact retry identity before expected sequence.
6. Append must lock stream, submission, and attempt and revalidate the fence under those locks.
7. Respond to Pause must check exact replay before requiring pending state.
8. Consume Approval must atomically enqueue a durable idempotent continuation dispatch.
9. Settle must reserve an unconstrained record identity,
append it, then bind the final foreign key and finalize.
10. Recovery must handle both expired-running and reserved-terminalizing work.
11. Fork must copy the selected Pi path into the child stream atomically.
12. Migration must pre-resolve scope, write source identity/batch/records/alias atomically,
and quarantine ambiguous or outcome-unknown legacy work.
# Verdict
The V4 schema is still not implementable as-is. It does not merely need hardening. Its PostgreSQL DDL fails to create, its exact-retry transitions reject valid retries, its settlement reservation cannot commit, its lease model cannot reclaim a dead queue head, its producer and attempt fences can be bypassed by legal rows, its approval consumption loses or duplicates effects across crashes, its tree admits cycles and invalid compactions, and its tenant columns provide no read isolation. Implementing it “as written” would produce a store that is both unavailable under ordinary crashes and unsafe under ordinary multi-process races.
Do not begin adapter implementation until the structural diff, transition diff, migration barrier, RLS policy, and recovery operations are incorporated and exercised by concurrency contract tests.

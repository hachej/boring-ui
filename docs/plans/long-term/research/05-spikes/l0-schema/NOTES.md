# Durable-record store spike notes

## Result

The four scoped operations pass 17 contract tests on Node 22 `node:sqlite` with WAL enabled. The public store is bound to one `(tenant_id, workspace_id)` scope and does not expose its `DatabaseSync` handle or any raw query method.

## Changes from the published schema

- Lowered UUIDs and enums to `TEXT`, enums to `CHECK` constraints, JSONB to `TEXT CHECK(json_valid(...))`, booleans to checked integers, and timestamps to integer epoch milliseconds.
- Kept only the tables needed for admit, claim/reclaim, appendBatch, settle, and their stream/session relationships. Pauses, attachments, usage, checkpoints, aliases, Pi tree fields, fork/migration, and approval dispatch are deliberately out of scope.
- Added `agent_sessions.next_queue_seq`; admit allocates with `UPDATE ... RETURNING` under `BEGIN IMMEDIATE`, rather than `max(queue_seq)+1`.
- Added `admission_outbox` in the same transaction as admission. Every gateway request identity gets an outbox row, including a new request that resolves to an existing idempotent submission.
- Added session identity to attempts and batches, full composite foreign keys, `submission_attempts_one_running_idx`, the expired-attempt index, and `attempt_count <= max_attempts`.
- Bound a stream producer to both submission and attempt. Claim atomically acquires this producer fence; reclaim replaces an expired attempt and moves the fence. At retry exhaustion, timeout, or abort after owner death, claim atomically creates a deterministic recovery settlement instead of exceeding the budget or blocking the queue.
- Append checks an existing `(producer_id, producer_epoch, producer_sequence)` before expected sequence. Exact retry compares all stored immutable batch and record inputs. A new append revalidates current submission, running attempt, owner, epoch, lease, and stream producer within one `BEGIN IMMEDIATE` transaction.
- Added a two-phase-in-one-transaction batch representation: insert `complete=0`, insert all children, then set `complete=1`. A trigger checks child count at completion; completed batches and records are immutable; records cannot be added to a completed batch. Readers return only completed batches.
- Added `reserved_settlement_record_id`, but chose V5's allowed single-transaction settlement alternative: reserve, append, validate, bind, and finalize atomically. No committed `terminalizing` recovery state exists.
- Added one-settlement-per-submission uniqueness plus triggers requiring a terminal record to match the active reservation and requiring the final submission binding to match record submission, attempt, outcome, and digest. Generic `appendBatch` cannot write terminal records.
- Abort intent has precedence over a later worker-supplied success outcome.
- All adapter lookups carry the bound tenant/workspace predicates. Duplicate record IDs across tenants are supported and return only the bound tenant's row.

## Structural versus transition enforcement

Structural: foreign keys, checked states, durable queue uniqueness, one running attempt, one terminal record, attempt budget, full stream/session association, batch child-count validation, completed-batch/record immutability, and settlement reservation/final-binding validation.

Transition-enforced: admission allocation, claim CAS/reclaim, lease and current-owner checks, producer fencing, append sequencing, and atomic settlement. SQLite cannot express cross-row current-time lease predicates as ordinary constraints, so these live behind `BEGIN IMMEDIATE` operations in the only public adapter.

## Properties upheld only by convention

- SQLite has no RLS or database roles. Read isolation is enforced by the scope-bound adapter and private database handle. A separate process that opens the SQLite file directly can bypass it; callers must use the adapter. The tests prove the raw-SQL escape hatch is absent from the adapter API and adversarial duplicate IDs remain isolated through it.
- The admission outbox is the authoritative admission record, but projection into the pre-existing request ledger is outside this spike. No atomicity is claimed across two database files.
- Lease/current-attempt authorization depends on exclusive use of the adapter for DML. SQLite cannot revoke table DML from an application role as PostgreSQL can.

## Still out of scope / still broken

The other three operations and their tables were not implemented: pause/approval consumption, Pi tree/fork fidelity, and migration. External tool effects remain at-least-once and are not made exactly-once by this store. PostgreSQL RLS, procedures, and real multi-process contention tests remain follow-up work; these tests intentionally use deterministic logical interleavings as requested.

## Verification

`npm test`: 5 files passed, 17 tests passed.

# S1 TDD report

## Verdict

Sound for the four scoped operations through the scope-bound SQLite adapter: admission is durable/idempotent and ordered; claim has one live owner and recovers expired owners including exhausted/aborted/timed-out heads; append batches are atomic, retry-safe, and fenced; settle exposes exactly one terminal outcome with abort precedence. SQLite tenant read isolation remains adapter-enforced, not database RLS.

## Tests: 17 passed, 0 failed

- `V5 A1 Admit > SERIOUS admission and authoritative request identity commit atomically`
- `V5 A1 Admit > SERIOUS exact admission retry returns the durable original and conflicting retry is rejected`
- `V5 A1 Admit > MINOR durable counter assigns strict queue order across logical producers`
- `V5 A1 Claim > SERIOUS two claimers cannot leave two live attempts`
- `V5 A1 Claim > FATAL an expired owner is replaced and no longer blocks the queue head`
- `V5 A1 Claim > FATAL an expired owner at its retry limit is terminally recovered instead of blocking the queue`
- `V5 A1/A2 Append batch and fencing > FATAL exact retry is checked before the advanced producer sequence`
- `V5 A1/A2 Append batch and fencing > FATAL retry identity includes every immutable batch input`
- `V5 A1/A2 Append batch and fencing > FATAL a replaced attempt cannot append after replacement commits`
- `V5 A1/A2 Append batch and fencing > SERIOUS all records commit atomically at one shared batch offset`
- `V5 A1/A3 Settle > FATAL reservation, terminal record, and final binding commit as one transaction`
- `V5 A1/A3 Settle > FATAL concurrent logical settles produce exactly one canonical terminal outcome`
- `V5 A1/A3 Settle > FATAL the schema rejects an unreserved generic terminal record`
- `V5 A1/A3 Settle > abort intent wins over a later successful worker result`
- `V5 A1/A3 Settle > FATAL an expired owner can be reclaimed and then reach one terminal outcome`
- `V5 A6 Tenancy > FATAL a forgotten tenant predicate cannot return another tenant row through the adapter`
- `V5 A6 Tenancy > SQLite raw-SQL escape hatch is absent from the public adapter API`

## Deviations from the published schema

- SQLite lowering: UUID/enums are checked `TEXT`, JSONB is JSON-valid `TEXT`, timestamps are epoch-millisecond `INTEGER`; WAL and foreign keys are enabled.
- Scoped subset only: sessions, streams, submissions, admission outbox, attempts, batches, and records.
- Added durable session queue counter and transactional admission outbox; every request identity is recorded even when idempotency resolves to an existing submission.
- Added full session-bearing composite keys/FKs, one-running-attempt partial uniqueness, expired recovery index, and attempt-budget check.
- Claim also acquires the attempt-bound producer fence. Expired work is replaced, or terminally recovered on abort/timeout/budget exhaustion.
- Append checks exact retry before expected sequence and compares every immutable stored record input. It revalidates the attempt/owner/lease fence under `BEGIN IMMEDIATE`.
- Added batch `complete` protocol and triggers for exact child count and immutability; reads exclude incomplete batches.
- Used `reserved_settlement_record_id` but selected atomic reserve+append+finalize, eliminating committed terminalizing state. Added reservation and final-binding triggers plus one terminal-record uniqueness.
- Added full stream/session association and scope predicates on every adapter read.

## Convention-only properties

- SQLite has no RLS/roles: tenancy and DML authorization require exclusive use of the private, scope-bound adapter. Direct file access can bypass this boundary.
- Cross-row lease/current-owner/current-attempt predicates are transaction checks, not declarative SQLite constraints.
- The outbox is authoritative inside this database; projection/reconciliation with the legacy ledger is not implemented or claimed atomic.

## Actual `npm test` output

```text
> test
> vitest run --reporter=basic

 RUN  v3.2.7 /home/ubuntu/projects/spike-l0-schema

 ✓ test/v5-tenancy.test.ts (2 tests) 25ms
 ✓ test/v5-admit.test.ts (3 tests) 45ms
 ✓ test/v5-claim.test.ts (3 tests) 49ms
 ✓ test/v5-append-batch.test.ts (4 tests) 51ms
 ✓ test/v5-settle.test.ts (5 tests) 65ms

 Test Files  5 passed (5)
      Tests  17 passed (17)
   Start at  09:47:29
   Duration  896ms (transform 335ms, setup 0ms, collect 835ms, tests 235ms, environment 2ms, prepare 838ms)
```

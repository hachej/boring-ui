| invariant | enforced by | raw-SQL test that proves it | what Postgres would add |
|---|---|---|---|
| At most one running attempt per submission | CONSTRAINT — partial unique index `submission_attempts_one_running_idx` | `test/raw-schema-invariants.test.ts` — `rejects two running attempts for one submission` | The same partial unique index; no stronger Postgres-only primitive is required. |
| At most one settlement record per submission | CONSTRAINT — partial unique index `stream_records_one_settlement_idx` | `test/raw-schema-invariants.test.ts` — `rejects two settlement records for one submission` | The same partial unique index, plus a deferrable composite FK/constraint trigger for the final submission-to-record binding. |
| No record can be appended to a complete batch | TRIGGER — `stream_records_no_insert_into_completed_batch` | `test/raw-schema-invariants.test.ts` — `rejects a record appended into an already-complete batch` | A trigger with row locking on the parent batch; a deferrable constraint trigger can validate at commit. |
| A complete batch has exactly its declared child-record count | TRIGGER — `stream_batches_must_start_incomplete` and `stream_batches_validate_completion` | `test/raw-schema-invariants.test.ts` — `rejects every route to a complete batch whose child count does not match` | A deferrable constraint trigger, evaluated at transaction commit, is the natural Postgres implementation. |
| A fenced, expired, or superseded producer cannot append a batch | TRIGGER — `stream_batches_validate_producer_fence` (the adapter also rejects it) | `test/raw-schema-invariants.test.ts` — `rejects a fenced producer appending a legally-shaped row` | A trigger that locks the stream/submission/attempt fence rows (`SELECT … FOR UPDATE`); RLS would additionally protect tenant scope. |
| A submission cannot reach a second terminal outcome | TRIGGER — `submissions_validate_status_transition`, backed by settlement reservation/binding triggers and the one-settlement index | `test/raw-schema-invariants.test.ts` — `rejects a submission reaching a second terminal outcome` | A transition trigger plus a deferrable composite FK/constraint trigger binding the submission to its terminal record. |
| A stream record cannot carry an inconsistent tenant/workspace/session/stream identity | CONSTRAINT — composite foreign keys on `stream_records` | `test/raw-schema-invariants.test.ts` — `rejects a stream record with an inconsistent session/stream/tenant triple` | The same composite foreign keys; RLS would be defense in depth for tenant isolation. |

## Final `npm test` output

```text
> test
> vitest run --reporter=basic


 RUN  v3.2.7 /home/ubuntu/projects/spike-l0-schema

 DEPRECATED  'basic' reporter is deprecated and will be removed in Vitest v3.
Remove 'basic' from 'reporters' option. To match 'basic' reporter 100%, use configuration:
{
  "test": {
    "reporters": [
      [
        "default",
        {
          "summary": false
        }
      ]
    ]
  }
}
 ✓ test/v5-tenancy.test.ts (2 tests) 33ms
 ✓ test/v5-append-batch.test.ts (4 tests) 47ms
 ✓ test/v5-admit.test.ts (3 tests) 48ms
 ✓ test/v5-claim.test.ts (3 tests) 56ms
 ✓ test/v5-settle.test.ts (5 tests) 75ms
 ✓ test/raw-schema-invariants.test.ts (7 tests) 93ms


 Test Files  6 passed (6)
      Tests  24 passed (24)
   Start at  09:57:22
   Duration  947ms (transform 405ms, setup 0ms, collect 925ms, tests 351ms, environment 2ms, prepare 1.00s)
```

## Mutation-check output

```text
> mutate
> node scripts/mutate.mjs


=== MUTATION: drop submission_attempts_one_running_idx ===
=== RESULT: KILLED (npm test exit 1) ===

=== MUTATION: drop stream_records_one_settlement_idx ===
=== RESULT: KILLED (npm test exit 1) ===

=== MUTATION: disable adapter producer fence ===
=== RESULT: KILLED (npm test exit 1) ===

Mutation summary: 3/3 killed; 0 survived.
```

## Corrected verdict

The original evidence was insufficient and the deployment conclusion was wrong: two schema indexes were decoration as far as the test suite could prove, and producer fencing was demonstrated only through the adapter. After this pass, the seven invariants above are structurally enforced in SQLite and independently falsified through raw `DatabaseSync` writes. The suite now fails if either unique index is removed, and it separately fails if the adapter fence is disabled. This establishes those specific invariants; it is not a blanket proof that the entire persistence design is production-ready. A Postgres deployment still needs concurrency-aware trigger locking, deferrable settlement/count validation, and tenant RLS.

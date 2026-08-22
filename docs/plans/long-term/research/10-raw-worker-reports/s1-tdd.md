You are implementing and PROVING a durable-record store, TDD, iterating until the tests pass.
This is a real spike: write code, run it, fix it, repeat. Do not stop at a design.

WORKSPACE: /home/ubuntu/projects/spike-l0-schema (already scaffolded: package.json with vitest, npm install done, Node 22 with node:sqlite).
Put DDL + adapter in src/, tests in test/. Run with `npm test`.

THE SPEC: /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/../l0-schema.md  (the schema) — but it is KNOWN BROKEN.
THE DEFECT LIST: /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/v5-schema-attack.md — 17 FATAL / 20 SERIOUS findings with failing interleavings
and a DDL diff. This is your worklist. Read it first.
Background if needed: /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/v4-schema-review.md (where the schema came from).

TARGET RUNTIME: `node:sqlite` (DatabaseSync), because that is what the real codebase uses
(see git show origin/main:packages/agent/src/server/events/sqlStorage.ts in
/home/ubuntu/projects/boring-ui-v2). Lower enums to text+CHECK and jsonb to TEXT, but PRESERVE the
observable constraints. Use WAL. Keep the adapter behind a narrow interface so Postgres can follow.

SCOPE — do NOT attempt all seven operations. Get these FOUR genuinely correct and proven:
  1. admit          (durable admission before any work; idempotency; queue order)
  2. claim          (lease acquisition; exactly one owner; reclaim after a dead owner)
  3. appendBatch    (atomic batch with one offset shared by N records; fencing against a stale producer)
  4. settle         (exactly one terminal outcome; concurrent settle attempts; abort intent)
Plus the tenancy read-isolation fix (V5: composite keys do NOT isolate lookups).

METHOD — strict TDD, and the tests are the point:
  a. For each of V5's failing interleavings in scope, write a test that FAILS against a naive
     implementation. Simulate concurrency deterministically: interleave two logical actors by
     sequencing their statements inside/around transactions. Do not use sleeps or real threads.
  b. Then write the DDL + adapter so the test passes for the RIGHT reason (a constraint or a
     transition, not application discipline). If a property can only be upheld by convention, say so
     explicitly in a comment and in your report — that is a finding, not a pass.
  c. Run `npm test` after every change. Iterate until green or genuinely blocked.
  d. Include a test that a forgotten tenant predicate CANNOT return another tenant's row. If node:sqlite
     has no RLS, implement the enforced-predicate layer in the adapter and prove the raw-SQL escape
     hatch is not reachable through the adapter's public API.

DELIVERABLES in the workspace:
  src/schema.sql          the DDL that actually executes
  src/store.ts (or .mjs)  the adapter with the four operations
  test/*.test.ts          the contract tests, named after the V5 findings they encode
  NOTES.md                what passed, what you could NOT make structural, what is still broken,
                          and the exact DDL/transition changes you made vs the published schema

FINAL REPORT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/s1-tdd-report.md — terse: test results (pass/fail counts, and the actual test
names), every deviation from the published schema and why, every property you could only uphold by
convention, and a blunt verdict on whether these four operations are now sound.
Do not claim success you did not observe: paste real `npm test` output.
No preamble.

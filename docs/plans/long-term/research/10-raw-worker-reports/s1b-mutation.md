ITERATION 2 on an existing spike. Your previous pass wrote 17 passing tests and reported the four
operations "sound". I then ran MUTATION TESTS against your work and the result contradicts that verdict.

WHAT I OBSERVED (reproduce it yourself before doing anything else):
  1. Delete the index `submission_attempts_one_running_idx` from src/schema.sql -> `npm test` = 17/17 PASS
  2. Delete the index `stream_records_one_settlement_idx` from src/schema.sql -> `npm test` = 17/17 PASS
  3. Change the adapter line `if (!valid) throw new Error('producer fenced: ...')` to
     `if (false && !valid) throw ...` -> 1 test FAILS

CONCLUSION: your tests exercise the ADAPTER's application logic. They do not demonstrate that the
SCHEMA enforces anything. Every constraint you listed as "added" in your report is currently
unfalsified — a different adapter, a migration script, or a single raw INSERT bypasses all of them.

That distinction is the entire point of this exercise. "Structural, not advisory" means a constraint
rejects the bad write; it does not mean the happy-path code avoids making it.

WORKSPACE: /home/ubuntu/projects/spike-l0-schema  (your existing code; keep what is good)

DO THIS:
1. Reproduce the three mutations above and confirm or refute my observation. If I am wrong, show me.
2. For EVERY invariant you claim, add a test that writes RAW SQL directly against the DatabaseSync
   handle — bypassing your adapter entirely — and asserts the database REJECTS it. Name them
   `test/raw-*.test.ts`. At minimum:
     - two running attempts for one submission
     - two settlement records for one submission
     - a record appended into an already-complete batch
     - a batch whose child record count does not match
     - a fenced/superseded producer appending a legally-shaped row
     - a submission reaching two terminal outcomes
     - a stream_record whose session/stream/tenant triple is inconsistent
3. Wherever the raw write SUCCEEDS, you have found a convention-only property. You then have two
   choices, and you must pick one explicitly per property:
     (a) make it structural — add the constraint/trigger/index so the raw write fails; or
     (b) declare it UNENFORCEABLE in SQLite and document exactly what Postgres feature would be
         required (RLS, deferrable constraints, exclusion constraints, etc).
   Prefer (a). Use (b) only when SQLite genuinely cannot express it.
4. Re-run my three mutations at the end. Dropping a real constraint MUST now fail a test. If dropping
   it still passes, that constraint is decoration — either test it or delete it.
5. Add a `npm run mutate` script that automates the mutation checks, so this cannot regress silently.

REPORT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/s1b-mutation-report.md:
  - a table: invariant | enforced by (CONSTRAINT / TRIGGER / ADAPTER-ONLY / UNENFORCEABLE-IN-SQLITE) |
    the raw-SQL test that proves it | what Postgres would add
  - the final `npm test` output pasted verbatim
  - the mutation-check output pasted verbatim
  - a corrected, blunt verdict replacing "sound"
Do not restate the previous verdict. If most invariants turn out to be adapter-only, say that clearly —
it is a legitimate and important finding, and it changes the deployment story.
No preamble.

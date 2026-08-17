# R-33-05 — Canonical record schema (L0)

**Status:** proposed · **Confidence:** reported · **Subsystem:** durability · **Filed:** —

## Claim
One schema owning submissions, records and pauses, with tenancy in every key, batch offsets as first-class
rows, and settlement enforced by constraints.

## Why
Everything else waits on it: R-33-01 needs a writer, R-33-02 needs a pause table, R-33-04 needs a target.

## Evidence
| source | what it establishes |
|---|---|
| `research/convergent-durability.md` | three frameworks agree on the primitives |
| `spike/RESULT.md` | 24 tests, seven raw-SQL invariant tests that **bypass the adapter**, `npm run mutate` kills on constraint removal |

## What it costs
Unknown until the outstanding defects are closed.

## What it breaks
Replaces `eventStreamStore`. Requires the migration in R-33-04.

## Refutation
**Already partially refuted, twice.** The first sketch had 8 fatal flaws; the corrected schema still has
17 fatal / 20 serious — its PostgreSQL DDL does not execute as written, and composite keys do not isolate
*lookups* (only joins), so tenancy needs RLS or an enforced-predicate layer. **Not implementable as
written.** The shape survives; the details do not. Next step is contract tests, not another review.

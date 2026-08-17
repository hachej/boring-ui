# R-33-04 — Migrate by importing pi JSONL; abandon event-store rows

**Status:** proven · **Confidence:** executed · **Subsystem:** durability · **Filed:** —

## Claim
Import pi's native transcripts into the canonical store under an explicit tenant scope. Do **not** promote
`boring_event_stream_*` rows: they are a UI projection and their keys carry no tenancy.

## Why
Breaking the wire is free; losing customers' transcripts is not. With protocol compatibility out of
scope, existing session data is the only remaining migration question.

## Evidence
| source | what it establishes |
|---|---|
| `research/event-store-path-keys.md` | old rows are keyed by opaque `path` with no `tenant_id`; promotion fails closed rather than guessing a tenant |
| `spike/RESULT.md` | a real 4,229-line transcript round-tripped byte-exact (11 compaction entries, a branch parent with two children, leaf, path-to-root, order); a real 822-line session imported and **continued under Gemini**, original bytes unchanged |

## What it costs
One importer. Lost: token deltas, progress events, transient errors — event-only transport detail absent
from the native transcript.

## What it breaks
Open sessions reconnect on the new protocol; an in-flight partial turn may disappear and should be
reported. Known defect: the importer is **not idempotent** — re-running fails `SQLITE_CONSTRAINT 2067`.

## Refutation
If a real transcript could not be imported losslessly, or pi could not continue from imported state. Both
were tested against your own historical sessions.

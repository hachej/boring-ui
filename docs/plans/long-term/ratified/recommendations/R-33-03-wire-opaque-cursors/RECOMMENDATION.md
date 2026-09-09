# R-33-03 — Opaque cursors, implicit sessions, authoritative `final`

**Status:** proven · **Confidence:** executed · **Subsystem:** wire · **Filed:** partially #979

## Claim
Clients should receive resume tokens they pass back verbatim, sessions should be created by first send,
and `message-end.final` should be authoritative so a dropped delta heals without a rehydrate.

## Why
The client derives and compares numeric `seq`, which is why replay-gap and cursor-ahead recovery exist.
Session creation is explicit, so a fresh panel sits with a disabled composer until someone clicks.

## Evidence
| source | what it establishes |
|---|---|
| `research/opencode-offsets.md` | offsets are opaque and assigned per atomic append batch; clients never derive them |
| `spike/RESULT.md` | first pass: **all three break** the real ChatPanel. Second pass with patches: **all three work**, verified in a browser |

## What it costs
**12 files, +77 / −106 — a net reduction of 29 lines.** Afterwards the production search returns no
matches for numeric `seq`/`cursor`/`lastSeq` declarations or `needsResync`/`expectedSeq` in front/shared.

## What it breaks
The wire. Acceptable — breaking changes were ratified 2026-08-11. No dual-protocol support needed.

## Refutation
If the panel could not be made to work without numeric ordering. It could, and the diff is in the spike.

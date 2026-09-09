# R-33-02 — Make human input a durable journaled pause

**Status:** proven · **Confidence:** executed · **Subsystem:** plugins/durability · **Filed:** —

## Claim
A question or approval must be a journaled record resumable from the store alone — not a promise held in
a process-local map.

## Why
`plugins/ask-user/src/server/askUserRuntime.ts:38-60` — the durable object is only the question row; the
blocked tool call waits in `InProcessAskUserCoordinator.waiters`. On restart the row survives, the
waiter does not, startup marks it `abandoned`, and answering returns *"question waiter is no longer
available."* Durable-looking UI metadata over a non-durable continuation.

## Evidence
| source | what it establishes |
|---|---|
| `research/eve-human-input.md` | policy runs after schema validation, before executor auth; `input.requested` → `session.waiting`; stale answers demoted; "no in-memory process must remain alive" |
| `spike/RESULT.md` | real SIGKILL, resumed in a different PID, original `tool_call_id` consumed; 5/5 invariants constraint-enforced under targeted mutation |

## What it costs
A pause table and a re-entrant continuation. **Requires a minimal transactional writer (L1a)** — a pause
without one recreates the split authority this fixes.

## What it breaks
Nothing ratified. Supersedes the "L0 + L3, stop there" sequencing, which was disproven.

## Refutation
If the original tool call could not be completed by a process that never held the promise. It was.

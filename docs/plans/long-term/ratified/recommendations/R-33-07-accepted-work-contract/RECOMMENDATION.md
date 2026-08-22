# R-33-07 — Adopt the accepted-work contract as #1009's specification

**Status:** proposed · **Confidence:** reported · **Subsystem:** durability · **Filed:** —

## Claim
Replace "durable replay across restarts" with a contract: admit durably before model work; exactly one
terminal outcome per submission; at-least-once execution over exactly-once recording; unresolved
*ordinary* tool calls settle as explicit unknown outcomes; converge-then-classify recovery.

## Why
A property is not a specification. #1009 currently states one.

## Evidence
| source | what it establishes |
|---|---|
| `research/convergent-durability.md` | Flue, eve and Managed Agents converge on the same primitives independently — a settled design with three reference implementations |

## What it costs
A text change to an issue, then implementation under R-33-05.

## What it breaks
Nothing. Note the qualification: durable tools and delegated tasks **do** replay; only ordinary calls
settle as unknown. No external effect is exactly-once merely because the record is.

## Refutation
If the three implementations disagreed on the primitives. They do not.

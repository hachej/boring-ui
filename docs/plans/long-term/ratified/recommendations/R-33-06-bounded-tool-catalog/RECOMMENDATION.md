# R-33-06 — Bounded tool catalog: grant-scoped residency + lexical search

**Status:** refuted in part · **Confidence:** executed · **Subsystem:** tools · **Filed:** #1226

## Claim
Separate authorization (grants) from residency (a token budget). Three tiers: always-resident core,
budgeted signatures, summary + searchable. Grant broadly, stay cheap.

## Why
Grants currently do two jobs — they decide reach *and*, because every granted tool materialises into the
tool list, they decide context cost. So customers are told to enable fewer connectors than they want.

## Evidence
| source | what it establishes |
|---|---|
| `research/opencode-catalog.md` | ~2,000-token signature budget, per-namespace summaries always resident, ~64-line lexical search, host-resident object-tree dispatch |
| `research/token-baseline.md` | pi's 7 core tools ≈ 811 description-tokens; ~116/tool → 8 connectors ≈ 18,600 before schemas |
| `spike/RESULT.md` | **`call_tool` does NOT preserve tool identity**: called directly pi emits `toolName:"beta_add"`; through a dispatcher it emits only `toolName:"call_tool"` |

## What it costs
Unknown — the dispatch mechanism must be redesigned first.

## What it breaks
Renderers, metering and per-call approval all key off tool identity. #900's requirement that one approval
binds to the real call's canonical arguments is broken by a dispatcher.

## Refutation
Refuted as designed. A rewrite needs **first-class child events** carrying `parentToolCallId`, plus an
immutable post-validation execution plan. The residency model survives; the dispatch does not.

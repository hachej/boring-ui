# R-33-08 — Correct the security claims in DECISIONS.md

**Status:** proposed · **Confidence:** verified · **Subsystem:** auth · **Filed:** —
**Priority: highest. Documentation only, no code.**

## Claim
DECISIONS.md describes guarantees the code does not provide. Correct the documents before building the
enforcement, so nobody else reasons from them — as this session did, repeatedly.

## Why
Verified at call sites:
- D29's `unique symbol` brand is `declare const` — **no runtime value** (`shared/gateway/types.ts:38-48`)
- "re-checked on every use" holds for top-level calls; streamed events reuse a captured claim (`embeddedGateway.ts:155`)
- D27's `ModelCapabilityIssuer` **does not exist**; the model path reads process env (`models/modelConfig.ts:92-98`)
- MCP grants reach reporting only; execution uses a static template allowlist
- #1123 is ratified design with zero implementation

## Evidence
| source | what it establishes |
|---|---|
| `research/governance-audit.md` | 23 convention-only · 15 enforced-by-code · 2 structural |
| `research/credentials-audit.md` | D27's production credential architecture is not implemented |
| `research/call-site-traces.md` | the orchestrator's own traces for each claim above |

## What it costs
A docs PR. The enforcement work is separate and larger.

## What it breaks
The claim that governance is a shipped differentiator. It is a designed one.

## Refutation
If any of the five traces above were wrong. Each is reproducible with a single `git grep`.

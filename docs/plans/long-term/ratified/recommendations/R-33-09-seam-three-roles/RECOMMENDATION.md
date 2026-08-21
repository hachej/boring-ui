# R-33-09 — A capability seam ships all three roles or it does not ship

Status: proposed · Source: DeepSeek Harness `docs/capability-seams.md`, `AGENTS.md`
Kind: process + code · Cost: low · Priority: high

## Claim

Adopt DeepSeek's rule verbatim: a capability seam consists of **Owner**
(interface), **Implementation**, and **Consumer**, and the three land in the same
change. A seam with no consumer is not a seam — it is dead weight that reads as a
shipped guarantee.

## Why

This is the single systemic defect this whole research cycle found, and DeepSeek
has a review rule that would have blocked every instance of it. Our recurring
pattern is *mechanism built · decision ratified · never wired*:

| Mechanism | Owner | Impl | Consumer |
| --- | --- | --- | --- |
| Tool collision policy | ✅ `mergeTools.ts:37` | ✅ `:63` | ❌ only tests set `collisionPolicy` |
| Credential vault | ✅ `server/credentials/**` | ✅ | ❌ exported from index, zero callers |
| ~~MCP connector grants~~ | ✅ | ✅ | ✅ **corrected 2026-08-14 — wired via `runtimeCapabilityProjection`** |
| D27 BYOK issuer | ✅ decision | ❌ | ❌ `git grep ModelCapabilityIssuer` → 0 hits |
| #1123 exec grants / mount sets | ✅ | partial | ❌ |

Census on 2026-08-14 (`R-33-14/research/seam-census.md`) confirmed two of these
as genuinely dead (collision policy, credential vault) and cleared MCP grants.
The two dead ones were reviewed and merged green and are unreachable in production. The cost is
not the dead code — it is that `DECISIONS.md` and the type names describe a
system that does not run, and we then reason from that description.

## Evidence

- `packages/agent/src/server/catalog/mergeTools.ts:37,63` vs `__tests__/mergeTools.test.ts:81,100` — verified on `main` 2026-08-14, `collisionPolicy` appears in the implementation and in tests, nowhere else.
- `packages/agent/src/server/models/modelConfig.ts:92-98,112` — `apiKeyEnv` string passthrough; no issuer.
- DeepSeek: *"Capability seams as complete units — each capability comprises Service Definition, Provider and Consumer roles together; they split only when roles evolve independently."*

## What it costs

A review checklist line and one CI check: for each exported service interface,
assert at least one non-test importer. ~1 day.

## What it breaks

Five existing seams fail the check on day one. That is the point — each becomes
either wired or deleted, and the ratified decision it claims to implement gets
re-opened or corrected (see R-33-08).

## Refutation

Show a seam we deliberately ship ahead of its consumer for a named, dated,
in-flight consumer. If more than one or two exist and each has a real landing
date, the rule is too strict and should become "consumer or a linked issue".
Current evidence: none of the five has a landing date.

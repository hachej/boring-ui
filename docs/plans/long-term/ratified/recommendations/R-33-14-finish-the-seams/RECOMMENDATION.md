# R-33-14 — Finish the seams: composition-time provider selection

Status: proposed · Source: DeepSeek Harness composition model + own seam census
Kind: code + invariant · Cost: medium · Priority: high
Evidence: [`research/seam-census.md`](research/seam-census.md)

## Claim

We are not missing seams. We have six and **none is selectable at composition
time** — each is pinned by a hard-coded switch, an env boolean, or nothing at all.
Add the selection layer over the seams that already exist, rather than adding
seams.

## Why

"Everything is a plugin" reads as a large architectural gap. The census says
otherwise:

| seam | owner | impl | consumer | composition choice |
| --- | --- | --- | --- | --- |
| Sandbox provider | ✅ `SandboxProviderV1` | ✅ **×7** | ✅ | ❌ switch at `host/sandbox.ts:104-125` |
| Session persistence | ✅ `EventStreamStore:31` | ✅ | ✅ `createAgent({eventStore})` | ❌ `BORING_CHAT_DURABLE_STREAM` |
| MCP grants | ✅ | ✅ | ✅ | ❌ |
| AuthorizedAgentScope | ✅ | ✅ | ✅ ×19 files | n/a |
| Tool collision policy | ✅ | ✅ | ❌ **dead** | n/a |
| Credential vault | ✅ | ✅ ×3 backends | ❌ **dead** | ❌ |

Seven sandbox providers behind a real registry (`SandboxProviderId`,
`providerMatrix.ts`, `resolveStaticSandboxProviderV1`) and the host still calls
`createDirectSandboxProvider()` / `createBwrapSandboxProvider()` / … from a
switch. The registry is built and then bypassed. Same story for
`EventStreamStore`: a clean interface, an injectable consumer, and the choice
made by an env flag instead of a composition.

DeepSeek's profiles/bundles/patch layers are exactly this missing layer, which is
why they can claim "everything is a plugin" with a comparable number of seams.
The difference is selection, not architecture.

## Scope

1. **Sandbox** — replace the `host/sandbox.ts` switch with profile-driven
   resolution through the registry that already exists. Highest value: 7
   implementations become reachable, and it is the prerequisite for SBX1.
2. **Session persistence** — `BORING_CHAT_DURABLE_STREAM` becomes a composition
   choice (`jsonl` | `sqlite`), matching DeepSeek's `ctx.sessionPersistence`.
3. **The R-33-09 CI check** — fail any exported service interface with no
   non-test, non-doc importer. On today's tree it fires twice: tool collision
   policy and the credential vault. Each then gets wired or deleted, and the
   decision it claims to implement gets corrected (R-33-08).

## What it costs

Medium, and lower than R-33-12 was priced. No new interfaces — (1) and (2) are
rewiring call sites against types that already exist; (3) is a lint rule.

## What it breaks

`BORING_CHAT_DURABLE_STREAM` stops being honoured — needs a deprecation shim or a
release note. The sandbox switch is internal, so no external contract moves. The
CI check fails the tree on day one **by design**.

## Refutation

If the seven sandbox providers are not in fact independently selectable — if
several are variants of one deployment target rather than alternatives — then the
registry is over-general and a switch is the honest encoding. Test: name a
deployment context for each of the seven. If fewer than three survive, drop (1)
and keep only (2) and (3).

Equally, if `BORING_CHAT_DURABLE_STREAM` is a temporary migration flag with a
deletion date rather than a permanent choice, (2) is churn — the flag should just
be removed once SQLite is default, and no composition choice is needed.

## Corrections carried

This recommendation corrects two claims made earlier in the cycle:
- "sandbox has no registry" — **false**, `SandboxProviderV1` + `providerMatrix.ts` + `resolveStaticSandboxProviderV1` exist.
- "MCP grants are unwired" — **false**, consumed by `runtimeCapabilityProjection`, reached from `createAgentHost.ts:870`.

Both were used as evidence for R-33-09 and R-33-12; those files are amended.

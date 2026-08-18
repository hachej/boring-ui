# Seam census — `main`, 2026-08-14

Method: `git grep` over `packages`, excluding `__tests__`. Docs and archived plans
excluded from consumer counts. Question per seam: does a **non-test, non-doc
consumer** exist, and is the alternative selectable at composition time?

## 1. Tool collision policy — DEAD

```
mergeTools.ts:37   collisionPolicy?: ToolCollisionPolicy
mergeTools.ts:63   if (options.collisionPolicy === 'error') assertNoToolCollisions(options)
```

Those are the **only two** non-test occurrences in the repo. `mergeTools` itself
has non-test callers (`scripts/smoke-capability-readiness*.mts`), but none passes
`collisionPolicy`, so the guarded branch is unreachable in every live path.
Every remaining mention is documentation: `agent/docs/PLUGINS.md`, two archived
plans, `core/docs/CHAT_FIRST_WORKSPACE_BOOT.md`, `workspace/docs/plans/archive/PLUGIN_MODEL.md`.

Verdict: **owner + impl, zero consumers.** Five documents describe a guarantee
that never runs. First-wins collision remains the actual behaviour
(`buildAgentComposition.ts:181` spreads `extraTools` after `standardTools`).

## 2. Credential vault — DEAD

`server/credentials/` = `hostResolver.ts` (16 KB), `withResolvedCredential.ts`,
`vault/` (`envelopeCrypto`, `kmsBackend`, `vaultStoreBackend`, `persistence`,
`inMemoryPersistence`), `index.ts`.

Every import of the module is **internal to the folder** or a re-export:
```
server/index.ts:298   withResolvedCredential,
server/index.ts:299 } from './credentials'
shared/index.ts:246   export * from './credentials'
```
Filtering out `src/server/credentials/**` and `src/shared/credentials/**` leaves
exactly one line — the barrel re-export. No route, service, or provider calls it.

Verdict: **owner + impl + KMS and Vault backends, zero consumers.** This is the
largest dead seam by code volume.

## 3. MCP connector grants — WIRED (correct my earlier claim)

`ResolvedMcpConnectorGrant` is consumed:
```
runtimeCapabilityProjection.ts:80,255   mcpGrants?: readonly ResolvedMcpConnectorGrant[]
createAgentHost.ts:765,870              runtimeCapabilities: runtimeCapabilityProjection(projectionOptions)
httpProjection.ts:22                    imports from runtimeCapabilityProjection
```
The projection is live inside `createAgentHost`. Earlier note in this cycle
("only in `mcpGrants.ts` and `runtimeCapabilityProjection.ts`") was read as
*unwired*; the second file is a genuine consumer reached from the host.

Verdict: **wired.** The open question is narrower and unresolved: boring-mcp still
enforces via `getMcpProviderTemplate(provider).allowedTools`, so there may be two
enforcement paths rather than none. Needs a separate trace before any claim.

## 4. AuthorizedAgentScope — WIRED, BUT UNEVENLY MINTED

19 non-test files, ~70 references, spanning agent / cli / core / workspace.
Widely load-bearing as a type. Four non-test construction sites:

| site | how the scope is built | assessment |
| --- | --- | --- |
| `core/.../createCoreWorkspaceAgentServer.ts:349` | `Object.freeze({ ...verifiedClaim }) as AuthorizedAgentScope` | derived from a verified claim — correct shape |
| `workspace/.../createWorkspaceAgentServer.ts:365` | `Object.freeze({ ...claim }) as AuthorizedAgentScope` | derived from a claim — correct shape |
| `agent/src/server/createStandaloneAgentHostApp.ts:101` | `({ ... }) as AuthorizedAgentScope` | object literal cast; **no verifier in the expression** |
| `cli/src/server/modeApps.ts:55` | `({ ... }) as AuthorizedAgentScope` | object literal cast; **no verifier in the expression** |

`AgentScopeVerifier` appears in only 4 non-test places, all of them type
declarations (`shared/gateway/types.ts:50`, `shared/index.ts:200`,
`agent-host/types.ts:5,349`) — no implementation is named in the census.

Verdict: the brand is decorative (see R-33-11) and **two of four minting sites do
not visibly consult a verifier**. Both are plausibly dev/standalone entry points
rather than deployed multi-tenant paths — that must be confirmed before either is
called a vulnerability. It is the single highest-value follow-up in this census.

## Summary

| seam | owner | impl | consumer | composition-time choice |
| --- | --- | --- | --- | --- |
| Tool collision policy | ✅ | ✅ | ❌ | n/a |
| Credential vault | ✅ | ✅ ×3 backends | ❌ | ❌ |
| MCP grants | ✅ | ✅ | ✅ | ❌ |
| AuthorizedAgentScope | ✅ | ✅ | ✅ ×19 files | n/a |
| Sandbox provider | ✅ `SandboxProviderV1` | ✅ ×7 | ✅ | ❌ hard-coded switch, `host/sandbox.ts:104-125` |
| Session persistence | ✅ `EventStreamStore:31` | ✅ `SqliteEventStreamStore:94` | ✅ `createAgent({eventStore})` | ❌ env boolean `BORING_CHAT_DURABLE_STREAM` |

**Two dead seams, four live ones — and not one of the six is selectable at
composition time.** The shortfall is narrower than "we lack seams" and different
in kind: we build the seam, then hard-wire past it.

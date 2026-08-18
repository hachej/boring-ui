# Scout report — DeepSeek Harness v0.1 vs boring

Scouted 2026-08-14 · all boring claims verified against `main` by `git grep` on that date
Source notes: [`harvest-deepseek.md`](harvest-deepseek.md) · Census: [`../../recommendations/R-33-14-finish-the-seams/research/seam-census.md`](../../recommendations/R-33-14-finish-the-seams/research/seam-census.md)

---

## 0. What was scouted

**DeepSeek Harness v0.1 (`dsh`)** — released 2026-08-13, MIT, developer preview,
`npx @deepseek-ai/dsh web`. Built on vendored **Cordis**: *"plugins contribute
services, typed events, and reversible effects to a shared context."* Model
adapter, tool registry, session log and the agent loop are all plugins. Python
and native SDKs for out-of-process plugins.

**Why it matters more than Flue or eve:** those compete with pi, our harness.
`dsh` competes with `packages/workspace` plugins + `agent-host` composition —
our layer. First direct competitor at this altitude.

---

## 1. The gaps — what they have, what we have, what to do

Each row: their mechanism (quoted from their docs), our state (file:line on
`main`), and the recommendation.

### G1 — Seam completeness

| | |
| --- | --- |
| **Them** | *"Capability seams as complete units — each capability comprises Service Definition, Provider and Consumer roles together; they split only when roles evolve independently."* Three service classes: **seam** (`ctx.llm`, `ctx.shell`, `ctx.sandbox` — swappable), **core** (`ctx.sessions`, `ctx.tools` — singular), **bundle** (`ctx.agentLoop` — composes). |
| **Us** | Two seams ship an interface and an implementation with **zero non-test consumers**: tool collision policy (`mergeTools.ts:37,63` — the only two occurrences in the repo) and the credential vault (`server/credentials/`, 3 backends, only importer is the barrel re-export `server/index.ts:298`). Five documents describe the collision guarantee; first-wins is the real behaviour (`buildAgentComposition.ts:181`). |
| **Reco** | **R-33-09** — a seam ships Owner + Impl + Consumer or it does not ship. CI check: every exported service interface needs a non-test, non-doc importer. Fires twice today. |

### G2 — Durability invariant

| | |
| --- | --- |
| **Them** | *"Model-visible means logged. Anything reaching a model request must be reconstructible from the session log, ensuring durability, replay capability, and UI fidelity across fork/resume."* Backed by a generated ~60-event catalog, verified in CI, with a **surface / log-only** split — `user/message` derives an LLM message, `hook/invoked` and `fs/observed` are durable but non-deriving. |
| **Us** | `harnessPiChatService.readStateBeforeDispose` reconciles across three-to-four owners with `seq: Math.max(persisted.seq, liveSeq)`. That expression exists only because model-visible state is allowed to originate outside the log. |
| **Reco** | **R-33-10** — adopt the invariant verbatim in `coding-invariants.md`; generate the event catalog from source. Independent corroboration: Flue reached the same rule (durable input record is the precondition for invoking pi). Three harnesses, separately, same conclusion. |

### G3 — Enforcement style

| | |
| --- | --- |
| **Them** | *"Runtime invariants over static checks: validate authoritative event streams or mutable data rather than relying on service presence or metadata inspection."* |
| **Us** | `AuthorizedAgentScope`'s brand is `declare const … unique symbol` (`shared/gateway/types.ts:38-48`) — **no runtime emission**. Any object with the two public fields passes. Its own doc comment says it "must be checked by issuer identity and current membership on every use"; the type system cannot do that. `embeddedGateway.ts:155` verifies once and captures the claim in a closure — revocation never reaches an open subscription. Census: 4 non-test minting sites; core and workspace derive from a verified claim, **`createStandaloneAgentHostApp.ts:101` and `cli/modeApps.ts:55` cast an object literal with no verifier in the expression** (both plausibly dev-only — unconfirmed). |
| **Reco** | **R-33-11** — retire the phantom brand, verify at use not at boundary, add a membership epoch. First: confirm whether those two minting sites are reachable in a deployed multi-tenant path. |

### G4 — Composition / customization

| | |
| --- | --- |
| **Them** | *"Profiles (named compositions stored locally) and bundles (distribution formats for configuration and code); layers apply to an empty entry list in [order]: bundles from the profile, then patches at multiple levels, allowing flexible customization without modifying core code."* Plugin discovery = a GitHub topic (`dsh-plugin`), zero registry infrastructure. |
| **Us** | Six seams exist. **None is selectable at composition time.** Sandbox: 7 providers behind a real registry (`SandboxProviderV1`, `providerMatrix.ts`, `resolveStaticSandboxProviderV1`) — bypassed by a hard-coded switch at `host/sandbox.ts:104-125`. Session persistence: clean `EventStreamStore:31` interface, injectable via `createAgent({eventStore})` — chosen by the env boolean `BORING_CHAT_DURABLE_STREAM`. |
| **Reco** | **R-33-14** (near-term, medium) — profile-driven selection over the registries we already have. **R-33-12** (the senecaapp.ai epic) — profiles/bundles/patch layers so defaults and customization are the same mechanism at different layers. |

### G5 — Sandbox trust boundary

| | |
| --- | --- |
| **Them** | Mandated: *"Spawned commands get a scrubbed env (drop `*KEY*`/`*SECRET*`/`*TOKEN*`/`*PASSWORD*`)."* Plus 0700 temp dirs with `'wx'`/0600 opens; never `rmSync` without an `lstatSync().isSymbolicLink()` check. |
| **Us** | The reverse. `createDirectSandbox.ts:100` → `workspacePythonEnv.ts:30` → `runtimeSupport.ts:12` = `{ ...process.env }`. `opts?.env` is optional, so the **default** path hands the child the entire host environment; `preserveHostHome: true` also keeps `HOME`. `git grep 'SECRET|scrubEnv|redactEnv'` over `boring-sandbox/src` finds no scrubbing implementation — only a `dockerRunner` test assertion and remote-worker error codes. |
| **Reco** | **R-33-13** — allowlist (not their denylist; theirs misses `VAULT_ADDR`, `AWS_*`, `GH_*`), with an off-by-default `BORING_SANDBOX_INHERIT_ENV` escape hatch that logs when used. |

---

## 2. Where we are ahead

| Capability | dsh | boring |
| --- | --- | --- |
| Tenancy / authorization subject / per-workspace scope | ❌ absent | ✅ the differentiator |
| Plugin trust levels | not documented | ✅ `trust: "local-trusted-native"` |
| Hot load / unload with revisions | not documented | ✅ `boring.plugin.load/unload`, `revision` |
| Product surface breadth | panels, tools, skills | ✅ + `registerSurfaceResolver`, `registerCatalog`, `registerToolRenderer`, `registerWorkspaceSource`, `registerBinding`, `registerAppLeftAction`, `registerPanelCommand` |

Flue, eve and now dsh all lack tenancy. Three independent OSS harnesses, same
hole. The paid tiers of Mastra and LangGraph charge for it. This keeps holding.

## 3. Where we deliberately diverge

`ctx.agentLoop` as a swappable plugin is the "second behaviour composer" that
**D25 / D26 / D28 / D29 rejected four times**, and that Flue was assessed and
declined on. `dsh` has no tenancy story partly *because* a swappable loop makes
central authorization unguaranteeable. Not a lag — a decision.

## 4. Corrections issued this session

Two earlier claims in this research cycle were wrong and are amended in place:

| claim | reality |
| --- | --- |
| "sandbox has no registry" | **False.** `SandboxProviderV1` (`shared/providerV1.ts:97`), `SandboxProviderId`, `providerMatrix.ts`, `createStaticSandboxProvidersV1` / `resolveStaticSandboxProviderV1`, 7 providers. |
| "MCP grants are unwired" | **False.** Consumed by `runtimeCapabilityProjection.ts:80,255`, reached from `createAgentHost.ts:870`. |

Consequence: R-33-12 repriced high → **medium**, and R-33-14 carved out as the
independently shippable half. The honest shortfall is *"we build the seam then
hard-wire past it"*, not *"we lack seams"*.

---

## 5. Recommendations, ordered

| # | id | recommendation | kind | cost | why this rank |
| 1 | **R-33-13** | Scrub the env handed to spawned commands | bug (sec) | low | Live credential exposure; one afternoon; obvious escape hatch |
| 2 | **R-33-09** | Seam ships Owner + Impl + Consumer | process | low | One CI rule; stops the bleeding on both dead seams at once |
| 3 | **R-33-14** | Composition-time provider selection | code | med | 7 sandbox providers become reachable; prerequisite for SBX1 |
| 4 | **R-33-11** | Runtime invariants over the phantom brand | bug | med | Gated on confirming the two unverified minting sites |
| 5 | **R-33-10** | "Model-visible means logged" | invariant | low/med | Cheap to state; needs the generated catalog to be checkable |
| 6 | **R-33-12** | Profiles · bundles · patch layers | design | med | The senecaapp.ai epic; **blocked** — see below |

**R-33-12 remains blocked.** `runtimeBackendRegistry.ts:228,241,243` filters
`source.kind === "external"` and calls `importServerModule(serverPath, true)`,
then runs `runtimePlugin.routes(router)` — external plugin code imported into the
unsandboxed host, contradicting `PLUGIN_SYSTEM.md`'s route-free rule. Shipping
user-authored plugins on top of that is RCE as a feature. Tracked privately.

## 6. Open / unverified

- Are `createStandaloneAgentHostApp.ts:101` and `cli/modeApps.ts:55` reachable in a deployed multi-tenant configuration? Decides whether G3 is P1 or P3.
- Is `createDirectSandbox` reachable outside single-tenant local dev? Same question for G5.
- Does boring-mcp enforce via grants **and** `getMcpProviderTemplate().allowedTools` — two paths rather than none? Needs its own trace.
- No implementation of `AgentScopeVerifier` appeared in the census — only four type declarations. Where is it implemented?

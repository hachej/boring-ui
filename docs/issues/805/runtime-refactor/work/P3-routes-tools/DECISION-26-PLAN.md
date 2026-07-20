---
github: https://github.com/hachej/boring-ui/issues/805
issue: 805
state: ready-for-human
updated: 2026-07-18
track: owner
flag: not-needed
---

# P3 — boring-bash extraction remaining work (Decision 26)

## Authority and dispatch status

> **NON-DISPATCHABLE (2026-07-20) pending a post-#846 recut.** PR #846 changes
> Core/Workspace/Agent ownership, removes the authored `toolCatalog` direction,
> inserts actor-neutral binding/session and shared resource-generation work
> before typed multi-agent activation, and keeps custom sandbox tools in Step 3.
> Therefore every gate/slice below—including P3.0 test freeze and the former v1
> mechanical tier—is historical input only. Create no P3 Bead/PR until this file
> is rewritten from current `main`, its tool-catalog/custom-tool taxonomy is
> removed, and #805/#391 alignment explicitly restores dispatch.

This was the canonical Decision 26 plan for the remaining **P3 boring-bash
extraction slice only**. It supersedes this directory's older `PLAN.md`,
`TODO.md`, and `HANDOFF.md` for dispatch. Those files remain historical research;
their plugin-bundle, pure-mode, deployment, publication, and controller-era
claims have no authority.

The governing sources are:

- [Decision 26](../../../../../DECISIONS.md), including its small-step and
  evidence-before-extraction rules;
- [the active #391 roadmap](../../../../391/plan.md) and
  [roadmap alignment](../../../../391/ROADMAP-ALIGNMENT.md);
- [agent consumption modes](../../../../391/AGENT-CONSUMPTION-MODES.md);
- [agent-cloud vision](../../../../391/AGENT-CLOUD-VISION.md), used as a
  non-binding control-plane/data-plane constraint; and
- [coding invariants](../../../../../kanzen/procedures/coding-invariants.md),
  especially invariant 5 (Workspace + Sandbox are one runtime-mode pair) and
  invariant 9 (Pi file/shell tools execute through factories plus Operations
  adapters).

**Re-scope (owner directive 2026-07-19).** P3 splits into two tiers with
different dispatch gates:

- **v1 — mechanical extraction + sandbox wiring.** Copying the existing
  bash/routes-tools implementation out of `packages/agent` into
  `packages/boring-bash` byte-for-byte, verifying it, and swapping consumers
  onto it is low-risk mechanical work; it does not need a named second
  consumer to justify it. v1 also includes wiring boring-bash tool execution
  across `SandboxProviderV1` (the contract landing from #808's provider
  extraction, see [Scope boundary with #808](#scope-boundary-with-808)) with
  trust-routed dispatch — see
  [Remote tool execution and the tool trust boundary](#remote-tool-execution-and-the-tool-trust-boundary-owner-directive-2026-07-19).
  v1's only gate is **#808's provider-extraction Phase 3 swap landing on
  main** (see below); it is not gated by Decision 26 Step 2 or a named
  consumer.
- **v2 — multi-agent-facing composition.** Consumer migration onto a
  redesigned composition seam, contraction of the old Agent origins, and any
  work that depends on proving real package-boundary pressure remain gated by
  Decision 26 Step 2 plus an owner-accepted named second consumer, as before.

Prerequisite Step 2 is the sandbox-provider extraction owned by
[issue #808](https://github.com/hachej/boring-ui/issues/808). This local
extraction ordering does not renumber the Decision 26 product roadmap: deferred
package extraction remains evidence-gated Step 3 there for v2 purposes. P3's
mechanical v1 tier does not wait for Step 2/named-consumer evidence; it only
waits for #808's own Phase 3 swap (provider implementations moved off Agent,
`SandboxProviderV1` stable) to land, for two reasons: (a) v1's copy phase must
not open a second concurrent copy-and-freeze window on `packages/agent` while
#808 is mid-swap on the same files — that is a divergence risk, not a
process preference; and (b) the sandbox wiring in v1 consumes the
`SandboxProviderV1` contract #808 produces, so it cannot be built before that
contract exists. See [Trigger conditions](#trigger-conditions) for the exact
gate. P3.0's test-only behavior freeze may still be prepared before either
gate, and it must avoid files being changed by the active A1 stack.

## Problem

Today the Agent package both runs the agent loop and owns the bash/filesystem
tool and HTTP-route implementations. This blurs the package boundary Decision 26
wants to earn after a second consumer exists. A move performed before #808 would
also freeze P3 against the wrong runtime type: concrete provider selection and
the paired Workspace + Sandbox lifecycle still live in Agent today.

The remaining work is therefore a deliberately sequenced extraction:

```text
#808 extracts providers without splitting the paired-runtime invariant
                         |
                         v
the existing runtime owner selects one Workspace + Sandbox pair
                         |
                         v
Agent invokes app-supplied boring-bash contributions with that same pair
```

The extraction must preserve observable behavior, avoid a second runtime or tool
registry, and keep all executable effects on the data plane through the selected
Sandbox/Workspace Operations boundary.

## Today / Delta baseline

This plan was recut against `origin/main` at
`556aed587d2272ee1f6e41153dc3517818067712` on 2026-07-18. P3.1 must record a
new baseline after its prerequisites land; this SHA is evidence for the plan,
not permission to implement against stale code.

| Area | Today on main | Remaining P3 delta |
| --- | --- | --- |
| A1 authoring | PR #813 materializes authored sources and PR #815 adds `agent validate`. PRs #814, #816, #817, and #821 are an active stacked implementation of trusted tool catalogs, the dev app/CLI, and conformance. | Do not implement or redesign A1. After that stack lands, consume its final composition seam without editing authored-definition or validation behavior. |
| Authoring safety | Definitions are data-only and authored directories are not executable module roots. The landed materializer accepts the future `toolCatalog` input but currently rejects non-empty `toolRefs`; open PR #814 implements trusted catalog resolution. | Consume the final A1 contract after it lands. P3 moves trusted platform bash/file handlers only; it does not add tenant custom-tool execution. |
| Tool composition | `registerAgentRoutes` uses `mergeTools()` for standard → extra → plugin composition, while `createAgentApp` still concatenates its catalog directly. The A1 stack is actively changing collision/composition behavior. | Rebaseline after A1, then converge both paths on one policy-preserving merge authority as part of the P3 composition cut. Do not add a third composer or catalog. |
| Runtime pair | `RuntimeModeAdapter.create()` returns a `RuntimeBundle` containing Workspace, Sandbox, FileSearch, and binding strategies. Disposal belongs to the adapter/binding lifecycle, not the bundle. Tests assert one runtime working directory. | Consume the post-#808 pair and its existing lifecycle owner. P3 must not select providers, independently construct/swap either half, or take disposal ownership. |
| Sandbox package | `@hachej/boring-sandbox` contains shared capabilities/provider matrix and runsc evidence, while direct/bwrap/Vercel/remote-worker implementations and mode resolution still live in Agent. | None in P3. #808 owns moving provider implementations and provider-side lifecycle while preserving paired host/runtime composition. |
| boring-bash | `@hachej/boring-bash` exports `.`, `/shared`, and `/server`; `/agent` and `/plugin` are stubs. Its server code owns readonly/management projections and runtime binding, not the general agent tools/routes. | Add the narrow `/agent` tool builders and extend `/server` with the route registrar only after #808 stabilizes the input contract. Do not turn `/plugin` into runtime authority. |
| Tools | Agent owns `tools/harness`, `tools/filesystem`, `tools/upload`, and the bound/remote Workspace/Sandbox Operations adapters. Pi bash/file effects mostly use those adapters. Upload has a host `readFile(storageRoot)` fallback, and harness cleanup directly unlinks a host path; only `registerAgentRoutes` includes `upload_file`. | Move the boring-bash-owned implementations and tests without changing observable names, schemas, readiness, readonly, spoof, routing, or error behavior. P3.2 replaces both raw-host effects with bound Workspace/Sandbox Operations while preserving external contracts; it must not add upload to `createAgentApp`. |
| Routes | Agent owns file, file-record helper, tree, search, fs-events, and git routes. The git URL helper currently shells out through host `node:child_process`. `sessionChangesRoutes` is separately session-owned. | Move the filesystem route closure to boring-bash. P3.3 binds git inspection through the selected pair/Operations without changing the route contract. Keep session changes in Agent. |
| App composition | `createAgentApp`, `registerAgentRoutes`, and `AgentRouteBindingProfile.filesystem` hardwire the current tools/routes. Workspace/Core/CLI and internal dev/E2E consumers enter through those seams in different ways. | Introduce one static app-shell contribution seam, migrate every named consumer, then remove the Agent origins and obsolete exports. |
| Package edges | Agent is guarded against boring-bash/boring-sandbox value imports. The tools/routes to move currently import Agent runtime, provisioning, middleware, ignore-policy, and error helper values by relative path. | Preserve the Decision 19 edge in both directions: boring-bash may use Agent types but no Agent values; Agent imports no boring-bash values. P3.1 classifies the full tool/route value closure. P3.2/P3.3 move route/tool-local primitives or inject narrow structural callbacks; they neither copy generic Agent helpers nor create a reverse value edge. |
| Workspace plugins | The workspace plugin server API accepts already-realized `agentTools` during boot; it does not own the selected request/runtime pair. | Do not stretch this plugin API into a runtime registry. App shells provide a static boring-bash contribution; Agent binds it to its existing selected pair. |
| Tool trust | Trusted-only `toolCatalog` composition exists via the A1 authoring contract; every catalog entry is a first-party, host-constructed handler that may run in-process. There is no trust field on a tool and no remote-exec path. | Add a host-declared `trusted \| untrusted` trust level to the catalog construction seam and the remote-exec bridge described below. Untrusted tools stay off the P3 in-process invoke path entirely. |
| P3 dispatch tiering | This plan previously gated all of P3.1+ behind Decision 26 Step 2 plus a named second consumer. | Split into a v1 tier (P3.0–P3.3S: mechanical copy-verify-swap extraction plus trust-taxonomy/remote-exec sandbox wiring), gated only by #808's Phase 3 provider-extraction swap, and a v2 tier (P3.4–P3.7: the multi-consumer contribution seam and consumer migration), which keeps the original Step 2/named-consumer gate. |

### Current ownership evidence

- Agent hardwires tools in `packages/agent/src/server/createAgentApp.ts` and
  `packages/agent/src/server/registerAgentRoutes.ts`.
- Agent hardwires the filesystem route family in those files and in
  `packages/agent/src/server/agentRouteBindingProfile.ts`.
- The implementations and behavior tests live under
  `packages/agent/src/server/{tools,http/routes}`.
- `packages/boring-bash/src/agent/index.ts` is a stub and the package manifest
  has no `./agent` export today.
- Current direct consumers include Workspace, Core, CLI mode apps, full-app and
  playground/dev/E2E/smoke paths. P3.1 must regenerate this list after A1/#808.

## Scope boundary with #808

#808 Step 2 owns the sandbox-provider contract, provider implementations, and
provider-side lifecycle. It must preserve the existing rule that host/runtime
composition produces one coherent Workspace + Sandbox pair. P3 consumes that
post-#808 pair through the existing runtime owner; it does not relocate provider
selection or invent pair lifecycle. P3 must not change:

- direct, bwrap, Vercel, remote-worker, or future provider implementations;
- mode detection, provider choice, fallback, provisioning, health, caching, or
  lifecycle rules;
- Workspace-provider or Sandbox-provider factories;
- the sandbox capability matrix, isolation evidence, image/network policy, or
  runsc behavior; or
- X1 mounts, S3/FUSE support, attachment semantics, or mount credentials.

If post-#808 runtime composition requires separate Workspace and Sandbox
selection or disposal, P3 stops. That would violate invariant 5 and requires
#808/runtime-composition correction or a new owner decision; P3 must not paper
over the split with an adapter of its own.

## Trigger conditions

### Safe before any gate: P3.0 only

P3.0 may start after this plan is approved. It may add or strengthen tests and a
generated consumer inventory around behavior that exists on main. It may not
move code, add package exports, change composition signatures, or edit active A1
implementation files. If an intended test file overlaps an open A1 PR, use a
new dedicated contract-test file or wait.

### v1 gate — mechanical copy-verify-swap + sandbox wiring: P3.1 onward, up to and including the mechanical swap

P3's v1 tier (Phase 1 COPY, Phase 2 VERIFY, Phase 3 SWAP; trust taxonomy;
remote-exec bridge) may start only when all of these are true:

1. A1 PRs #814, #816, #817, and #821 have merged or been explicitly superseded,
   so P3 does not plan through their stacked files.
2. #808's provider-extraction **Phase 3 swap** has landed on main:
   `packages/agent` no longer owns concrete provider implementations, the
   resulting runtime composition exposes one stable Workspace + Sandbox pair
   and one disposal contract, `SandboxProviderV1` is the recorded stable
   contract, and its merge SHA is recorded in P3.1.
3. P3.0 is green on the resulting main.

No elapsed date, desire to unblock #805, or package-boundary preference
satisfies this trigger, but — unlike v2 below — **v1 does not require Decision
26 Step 2 completion or a named second consumer.** It is mechanical,
behavior-preserving code motion plus sandbox wiring, not a new abstraction
earned by consumer pressure. P3.1 re-reads code and updates the inventory
against the post-#808 main; later v1 beads use that post-merge evidence.

### v2 gate — multi-agent-facing composition and consumer migration: Step 2 required

The consumer-migration and contraction beads that follow the v1 swap (the
former "P3.4 onward" work: the redesigned static app-shell contribution seam
that multiple named consumers share, primary/auxiliary consumer migration, and
removal of the old Agent origins) may start only when, in addition to the v1
gate above:

1. #808 has a Decision 26 recut whose scope explicitly owns provider extraction
   and the paired-runtime acceptance gate, and that recut records satisfaction
   of its own Decision 26 product Step 2/named-consumer activation trigger.
2. Decision 26 product Step 2 is complete, and an owner-accepted named second
   consumer plus concrete duplicated route/tool composition pressure are linked
   from the bead that starts this tier. #808's package number or the existence
   of wrappers around the same Agent implementation is not consumer evidence.

No elapsed date, desire to unblock #805, partial #808 PR, or package-boundary
preference satisfies this trigger. The Decision 26 Step 2/named-consumer gate
authorizes planning and rebaseline first; the v2 tier must still prove that the
extraction is earned before its product code starts.

## Solution

### Ownership after extraction

The existing post-#808 runtime owner selects one runtime pair. App shells supply
a static boring-bash contribution to Agent; Agent invokes its callbacks with the
same pair used by the agent loop:

```ts
// Interface sketch only; P3.1 names the actual post-#808 types.
type PairedBashRuntime = Readonly<{
  workspace: Workspace
  sandbox: Sandbox
  fileSearch: FileSearch
}>

type BashRuntimeContribution = Readonly<{
  buildTools(input: { runtime: PairedBashRuntime }): readonly AgentTool[]
  registerRoutes(app: FastifyInstance, input: {
    getRuntime(request: FastifyRequest): Promise<PairedBashRuntime>
  }): Promise<void>
}>
```

The names and exact grouping are intentionally unfrozen until #808/A1 land.
P3.1 must inventory and thread the current policy/lifecycle inputs explicitly:
`disableDefaultFileTools`, dynamic filesystem bindings, provisioning/readiness,
fs-events lease deferral, the git Workspace facade, and upload's entrypoint
asymmetry. The contribution must not recover any of them from process-global
state. Its semantics are fixed:

- Workspace and Sandbox come from the same selected pair;
- route authorization happens before the pair is exposed to handlers;
- routes/tools receive Workspace, Sandbox, or bound Operations—not arbitrary
  host roots;
- the static contribution cannot select or cache a second provider/pair;
- each effect uses the selected pair for that request/session; and
- the owner that creates the pair disposes it exactly once.

`@hachej/boring-bash/agent` owns trusted platform tool builders and their
Operations bindings. `@hachej/boring-bash/server` owns the filesystem HTTP route
registrar and transitive helpers. `@hachej/boring-agent/server` owns the agent
loop, sessions, the one `mergeTools()` call, and a narrow static contribution
input used by app shells.

### Control-plane / data-plane rule

| Concern | Plane and authority |
| --- | --- |
| A1 definition, prompt text, tool declarations/refs | Data validated on the control plane; P3 does not change it. |
| Trusted host allowlist / `toolCatalog` | Control-plane composition data; P3 does not discover handlers from authored directories. |
| Bash/file/upload handler execution | Data plane only, through the selected Sandbox/Workspace and Pi/Operations adapters. |
| Future tenant custom handler | Not P3. It must be a sandbox entrypoint; never an in-process import on the control plane. |
| Sessions/transcripts | Control-plane durable host data; not moved into boring-bash or the sandbox workspace. |

Moving a handler to the boring-bash package does not authorize it to execute in
the host process. Existing trusted `AgentTool` wrappers may validate calls and
shape results server-side, but every filesystem, shell, repo, or upload effect
must cross the bound Workspace/Sandbox Operations seam.

### One composition seam

P3 adds a narrow, static app-shell contribution input to the existing Agent
composition. App shells import the boring-bash implementation; Agent remains
free of a boring-bash value import and supplies the selected runtime to its
callbacks. The exact post-#808 type is selected in P3.1, but it must meet these
constraints:

- runtime tools enter `mergeTools()` as standard tools;
- A1 materialized tools remain `extraTools` (or the final equivalent landed by
  the A1 stack);
- plugin tools retain their existing position;
- collisions are handled by the one A1-updated policy; and
- no process-global mutation, late registration, runtime mutable registry,
  plugin snapshot, or second merge pass is introduced.

The current workspace plugin pipeline is not the carrier for the runtime-bound
contribution: it realizes tools before the selected pair is available. P3 uses
explicit app-shell composition and does not widen the plugin contract.

### Route move boundary

Move the complete dependency closure for the existing file/file-record,
tree, search, fs-events, and git routes, including the route-specific helpers,
tests, and stable wire error codes they require. P3.1 inventories every current
Agent value import. P3.3 moves route-local primitives or uses a structural/
injected boundary; it must not import Agent middleware values. Duplicating a
small stable lowercase wire-code literal in the new package is preferable to a
reverse package edge or a new generic contracts package. Keep the public HTTP
paths, authentication ordering, `(filesystem, path)` addressing, readonly
rejection, path-spoof protection, and response schemas unchanged.

Do not move `sessionChangesRoutes`, `sessionChangesTracker`, `deepLinkRoutes`,
chat/session routes, catalog/model routes, or general Agent middleware. The
deep-link route is the AR1-owned share-entry boundary even though it consumes a
Workspace. When a helper is genuinely generic, leave it with its current owner
and depend on a public narrow contract; do not copy it into both packages.

## Remote tool execution and the tool trust boundary (owner directive 2026-07-19)

This feature is part of P3's **v1** tier (see
[Authority and dispatch status](#authority-and-dispatch-status)): it is
mechanical sandbox wiring plus a host-declared trust field, not a
multi-agent-facing composition change, so it is gated only by #808's Phase 3
swap, not by Decision 26 Step 2 or a named consumer.

### Trust taxonomy

Every tool in a catalog carries a host-assigned trust level:

- `trusted`: first-party tools owned/shipped by the platform or app — the
  existing `toolCatalog` path under the A1 authoring contract. MAY execute
  in-process on the host.
- `untrusted`: tools loaded by a user/tenant (custom agent-bundle tools).
  Handler code is presumed unsafe and MUST execute inside the sandbox only.

Authority rule: trust is declared where the host **constructs** the catalog
(framework code), never self-declared by the tool or its bundle — the same
host-declared authority shape already used for workspace types. The A1
compiler/materializer already rejects tenant definitions that point at
in-process modules (see `AGENT-CLOUD-VISION.md`'s custom-tools section); this
feature is the execution-side enforcement of that same rule, not a new policy.

### Remote tool exec feature

boring-bash's tool dispatcher routes by trust level:

- `trusted` → in-process invoke, unchanged from the existing in-process tool
  path carried over by the v1 copy-verify-swap.
- `untrusted` → remote-exec bridge across the `SandboxProviderV1` seam
  produced by #808's provider extraction (`P2-sandbox-providers`, see
  `../../../808/runtime-refactor/work/P2-sandbox-providers/PLAN.md`): the
  handler entrypoint is spawned inside the sandbox, JSON args go in on stdin,
  JSON result comes out on stdout — the MCP-stdio pattern, no new wire
  protocol. Per-invocation env/secret injection (never baked into images or
  bundles), timeouts, and stable error codes distinguishing handler failure,
  transport failure, and policy denial are all part of this bridge's
  contract.

### Alignment notes

Consistent with `../../../391/AGENT-CLOUD-VISION.md`'s custom-tools section
(declaration is data on the control plane, handler is code in the sandbox),
invariant 9 (Pi factories plus Operations adapters), and invariant 5
(Workspace + Sandbox are one runtime-mode pair). Dependency: the remote-exec
bridge consumes the `SandboxProviderV1` contract extracted by the #808 lane —
this is the same v1 sequencing gate stated above (#808 Phase 3 swap merged),
not a separate or additional gate, and it is explicitly **not** gated by
Decision 26 Step 2/named-consumer evidence; the remote-exec beads below must
not start before the #808 Phase 3 swap is satisfied.

## Decisions

1. **Behavior freeze first.** Contract tests land before package moves.
2. **#808 owns providers, not pair selection.** Existing runtime composition
   keeps Workspace + Sandbox paired; P3 consumes that pair and lifecycle without
   recreating either.
3. **Explicit app-shell composition.** Runtime-bound bash contributions do not
   flow through the current workspace plugin registry.
4. **One tool merge after convergence.** Boring-bash tools are a standard-tool
   contribution. P3 preserves each entrypoint's frozen catalog semantics while
   converging the post-A1 direct-concatenation/`mergeTools()` paths; A1 remains
   an executing dependency.
5. **Operations carry effects.** Package ownership changes; the control/data
   execution boundary does not.
6. **Expand → migrate → contract.** Add the destination APIs, migrate named
   consumers in bounded batches, then remove Agent origins and old exports.
7. **No compatibility re-export.** Once all in-repo consumers move, Agent no
   longer value-exports boring-bash routes/tools under old paths.
8. **Sessions stay in Agent.** P3 is not a session-storage or transcript move.
9. **Decision 19 edges stay acyclic.** Boring-bash may import Agent types but no
   Agent values; Agent may not import boring-bash or boring-sandbox values. App
   shells supply the static value contribution.

## Test seams

- **Highest public seam:** app creation/route registration with an injected
  paired runtime, proving the final tool catalog, HTTP behavior, and one-pair
  lifecycle.
- **Package seams:** `@hachej/boring-bash/agent` tool builders and
  `@hachej/boring-bash/server` route registrar with fake bound Operations.
- **Existing prior art:** Agent filesystem/harness/upload tests, route tests,
  `createAgentApp` tests, `registerAgentRoutes` lifecycle tests, boring-bash
  readonly/no-leak conformance, and post-#808 paired-runtime tests.
- **Avoid testing:** private file locations, provider internals owned by #808,
  duplicated Pi behavior, or a temporary old/new implementation in the same
  test. Test observable contracts and ownership/import invariants.

The behavior freeze records at least:

- exact standard tool names, JSON schemas, readiness requirements, collision
  behavior, and per-entrypoint catalog differences (notably upload exists in
  `registerAgentRoutes` but not `createAgentApp`);
- direct and sandbox-backed cwd/path routing from the same runtime pair;
- upload/read/write/edit/find/grep/ls/bash/isolated-code success and stable
  failures, as applicable to provider capabilities;
- route paths, auth-before-effects, readonly rejection, spoof protection, and
  file/tree/search/fs-event/git response/error shapes; and
- create/dispose counts proving no mixed or double-disposed pair.

### Named gate artifacts

P3.0 creates two test-only artifacts reused by every later bead:

- `packages/agent/src/server/__tests__/boringBashExtraction.contract.test.ts`
  freezes per-entrypoint behavior and paired-runtime identity; and
- `scripts/check-p3-bash-extraction.mts` keeps a committed origin/consumer
  allowlist and exits non-zero on unknown consumers, forbidden ownership edges,
  forbidden production-file changes in preparation mode, missing transition
  markers, or stale origins for the requested phase.

The checker supports the exact phases used below: `current`, `post-p2`,
`tools-expanded`, `routes-expanded`, `agent-seam`, `primary-migrated`, and
`contracted`. Its allowlist is evidence, not a mechanism for ignoring a new
consumer: every addition requires classification in the plan/PR.

## Proposed Bead chain (proposal only)

No P3 boring-bash Beads exist as of this plan. **Do not edit `.beads` while
planning.** After owner approval, create the following serial chain. Logical IDs
are stable plan references; `br create` assigns repository IDs.

```text
P3.0
  └─> P3.1 (v1; blocked by the completed A1 stack and #808 Phase 3 swap —
            NOT by Decision 26 Step 2 / named consumer)
        └─> P3.2 ─> P3.3 ─┬─> P3.3T (trust taxonomy contract)
                           └─> P3.3R (remote-exec bridge, depends on P3.3T)
                                 └─> P3.3V (Phase 2 VERIFY: dual-target parity)
                                       └─> P3.3S (Phase 3 SWAP: mechanical swap PR)
                                             │
                                             │  ── v1 ends here; v1 is shippable ──
                                             ▼
                                            P3.4 (v2; also blocked by Decision 26
                                            product Step 2 + named consumer and
                                            #808 extraction Step 2)
                                              └─> P3.5 ─> P3.6 ─> P3.7
```

P3.0–P3.3S are the **v1** tier: mechanical copy-verify-swap extraction plus
sandbox wiring, gated only by the #808 Phase 3 swap (see
[Trigger conditions](#trigger-conditions)). P3.4–P3.7 are the **v2** tier:
the redesigned multi-consumer contribution seam, consumer migration, and
contraction, gated by Decision 26 Step 2 plus a named second consumer as
before. v1 is independently shippable: it can merge and run in production
with `packages/agent`'s two existing composers pointed at the boring-bash
copy, before any v2 work starts.

Each tier's chain is serial because destination APIs, Agent composition, and
consumer migration overlap within that tier. Parallelizing those edits would
increase merge risk without creating an independently shippable outcome.

### P3.0 — Freeze current boring-bash route/tool behavior (pre-gate)

**Today:** behavior tests exist next to Agent implementations, but there is no
single extraction contract covering tool identity, route behavior, and paired
lifecycle across both server entry points.

**Delta:** add dedicated contract tests/fixtures and a reproducible consumer
inventory only. Do not move code or change runtime/package APIs.

**Depends on:** plan approval only. This is the sole pre-#808 bead.

**Machine gate:** both commands pass; the second command also proves the diff
from `origin/main` contains only tests, fixtures, the checker, and docs.

```bash
pnpm --filter @hachej/boring-agent exec vitest run src/server/__tests__/boringBashExtraction.contract.test.ts
pnpm exec tsx scripts/check-p3-bash-extraction.mts --phase=current --check-prep-diff=origin/main
```

### P3.1 — Rebaseline and freeze the post-#808 contribution contract (v1, Phase 1 prep)

**Today:** this plan's interface is only a sketch because Agent owns provider
selection and the current A1 stack is open.

**Delta:** record A1/#808 merge SHAs; regenerate the origin/consumer and
complete transitive tool/route dependency inventories, including every Agent
value import and its move, inject, or leave-at-origin disposition; no
disposition may leave a boring-bash → Agent value import. Name the exact
paired-runtime input (`SandboxProviderV1`-backed), inventory every
policy/lifecycle input named above, and update the green Agent contract test
to the post-#808 origins. Make no provider implementation or destination
move.

**Depends on:** P3.0; merged/superseded A1 PRs #814/#816/#817/#821; #808's
provider-extraction **Phase 3 swap** merged to main, satisfying invariant 5.
**Does not** depend on Decision 26 product Step 2 or a named second
consumer — that gate applies only to the v2 tier starting at P3.4.

**Machine gate:** both commands pass against the existing post-#808 Agent
origins. The contract proves the same Workspace/Sandbox identity and runtime cwd
reach the currently hardwired route/tool paths; the checker verifies trigger
evidence, the complete input/consumer inventory, and no P3 provider change. If
the pair cannot be represented without separate selection, stop.

```bash
pnpm --filter @hachej/boring-agent exec vitest run src/server/__tests__/boringBashExtraction.contract.test.ts
pnpm exec tsx scripts/check-p3-bash-extraction.mts --phase=post-p2
```

### P3.2 — Add boring-bash agent tools behind the paired contract (v1, Phase 1 COPY)

**Today:** `/agent` is a stub and Agent owns harness/filesystem/upload builders
and Operations bindings.

**Delta:** add the real `@hachej/boring-bash/agent` export; move/copy-first the
scoped tool implementation and tests; use Pi factories plus bound
Workspace/Sandbox Operations; replace upload's raw-host fallback and harness's
direct host cleanup without changing their external contracts or adding upload
to `createAgentApp`; and resolve every inventoried Agent value dependency by
moving a tool-local primitive or injecting a narrow structural callback. Extend
the boring-bash invariant to allow Agent type-only imports and reject Agent
values. Do not copy generic Agent helpers. Preserve names/schemas/readiness/
errors. Mark each temporary Agent origin with `TODO(remove:P3.6)`.

**Depends on:** P3.1.

**Machine gate:** all commands pass; the destination contract covers direct and
the post-#808 sandbox test pair, and the checker/invariant reject authored-module
imports, every boring-bash → Agent value import, copied generic helpers, raw host
filesystem/shell effects in the moved tools, missing transition markers, and
accidental upload parity drift.

```bash
pnpm --filter @hachej/boring-bash typecheck
pnpm --filter @hachej/boring-bash exec vitest run src/agent/__tests__/agentTools.contract.test.ts
pnpm --filter @hachej/boring-bash check:invariants
pnpm exec tsx scripts/check-p3-bash-extraction.mts --phase=tools-expanded
```

### P3.3 — Add the boring-bash route registrar (v1, Phase 1 COPY)

**Today:** Agent owns and registers the file/file-record, tree, search,
fs-events, and git route closure.

**Delta:** add the route registrar and its transitive helpers/tests to
`@hachej/boring-bash/server`, fed by an authorized accessor for the same runtime
pair. Replace the git helper's host `child_process` execution with the bound
Workspace/Sandbox Operations path while preserving its response/error contract.
Keep temporary Agent origins marked for P3.6. Do not move session changes.

**Depends on:** P3.2.

**Machine gate:** all commands pass. The route test covers every existing wire
path plus auth-before-effects, readonly, spoof, response/error, lease, git-facade,
and pair identity. The checker rejects raw host shell/filesystem effects in the
moved route closure and every boring-bash → Agent value import, proves session
changes and deep-link stay in Agent, and requires every temporary origin to be
marked.

```bash
pnpm --filter @hachej/boring-bash exec vitest run src/server/__tests__/routes.contract.test.ts
pnpm --filter @hachej/boring-bash typecheck
pnpm --filter @hachej/boring-bash check:invariants
pnpm exec tsx scripts/check-p3-bash-extraction.mts --phase=routes-expanded
```

### P3.3T — Trust taxonomy contract (v1)

**Today:** every catalog entry composed through the A1 `toolCatalog` path is
implicitly trusted; there is no trust field and no enforcement point.

**Delta:** add the host-declared `trusted | untrusted` field to the catalog
construction seam (declared where the host constructs the catalog, never
tool/bundle self-declared), and add the dispatcher branch point that will
route `untrusted` handlers away from in-process invocation. This bead adds the
taxonomy and the branch point only; it does not yet implement the sandbox
transport (P3.3R) or change any existing trusted tool's behavior.

**Depends on:** P3.3.

**Machine gate:**

```bash
pnpm --filter @hachej/boring-bash typecheck
pnpm --filter @hachej/boring-bash exec vitest run src/agent/__tests__/toolTrust.contract.test.ts
pnpm --filter @hachej/boring-bash check:invariants
```

### P3.3R — Remote-exec bridge across SandboxProviderV1 (v1)

**Today:** no tool handler executes remotely; every catalog entry runs
in-process.

**Delta:** implement the `untrusted` dispatch branch as a remote-exec bridge
across `SandboxProviderV1`: spawn the handler entrypoint inside the sandbox,
write JSON args to stdin, read a JSON result from stdout (MCP-stdio pattern,
no new protocol), inject per-invocation env/secrets (never baked into images
or bundles), enforce a timeout, and return stable, distinguishable error codes
for handler failure, transport failure, and policy denial.

**Depends on:** P3.3T; #808's `SandboxProviderV1` contract merged (already
required by the v1 gate).

**Machine gate:**

```bash
pnpm --filter @hachej/boring-bash typecheck
pnpm --filter @hachej/boring-bash exec vitest run src/agent/__tests__/remoteExecBridge.contract.test.ts
pnpm --filter @hachej/boring-bash check:invariants
```

### P3.3V — Phase 2 VERIFY: dual-target parity suite (v1)

**Today:** the copied boring-bash tools/routes (P3.2, P3.3) and the new trust
taxonomy/remote-exec bridge (P3.3T, P3.3R) exist alongside the still-live
Agent-owned originals; nothing proves they are behaviorally identical.

**Delta:** add a dual-target parity suite that runs the same fixture inputs
against both the Agent-owned implementation and the boring-bash copy and
asserts identical tool names/schemas/readiness/order, route
paths/auth/readonly/spoof/response/error shapes, and — for the new trust
taxonomy — identical trusted-tool behavior plus a passing untrusted-tool
remote-exec round trip. This is a standalone verification bead: it adds tests
only, it does not touch `packages/agent`.

**Depends on:** P3.3R.

**Machine gate:**

```bash
pnpm --filter @hachej/boring-bash exec vitest run src/__tests__/dualTargetParity.contract.test.ts
pnpm exec tsx scripts/check-p3-bash-extraction.mts --phase=tools-expanded
pnpm exec tsx scripts/check-p3-bash-extraction.mts --phase=routes-expanded
```

### P3.3S — Phase 3 SWAP: mechanical swap PR (v1)

**Today:** `createAgentApp` and `registerAgentRoutes` construct tools/routes
from the Agent-owned implementation directly.

**Delta:** mechanically repoint those two existing composers at the
boring-bash copy and delete the now-duplicate Agent-owned implementation.
This is a direct swap of the two entrypoints that exist today; it is **not**
the generalized multi-consumer contribution seam (that is P3.4, v2). No
consumer-facing signature changes, no new abstraction — same tool
names/schemas/routes, now served from `@hachej/boring-bash`.

**Depends on:** P3.3V green.

**Machine gate:** all commands pass; this bead's diff audit proves it changes
only the two composer call sites plus deletion of the superseded Agent
implementation — no new public API surface.

```bash
pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-bash build
pnpm exec tsx scripts/check-p3-bash-extraction.mts --phase=tools-expanded
pnpm exec tsx scripts/check-p3-bash-extraction.mts --phase=routes-expanded
```

**v1 is complete and shippable after P3.3S.** P3.4 onward is the v2 tier.

### P3.4 — Add one static Agent contribution seam (v2)

**Today (post-v1):** both Agent server assembly paths call the boring-bash
copy directly (via the P3.3S mechanical swap) but each still hardwires that
call itself; `AgentRouteBindingProfile.filesystem` encodes the hardwired route
family. There is still no shared contribution seam multiple named consumers
can compose through.

**Delta:** add one explicit contribution accepted by both assembly paths. App
shells provide the static boring-bash implementation; Agent invokes it with its
already-selected pair. Route registration uses its authorized runtime accessor;
runtime tools enter the existing standard-tool list before the one
`mergeTools()` call. Retain legacy hardwiring temporarily for unmigrated named
consumers only.

**Depends on:** P3.3S (v1 complete); completed Decision 26 product Step 2 plus
accepted named consumer/duplication evidence; merged #808 Decision 26 recut
and extraction Step 2 satisfying invariant 5 (see the
[v2 gate](#v2-gate--multi-agent-facing-composition-and-consumer-migration-step-2-required)).

**Machine gate:** all commands pass. The contribution contract proves parity to
each entrypoint's own frozen catalog/order (not equality between entrypoints),
A1 extra-tool collision behavior, route responses, explicit policy inputs, and
exactly-once pair disposal. The checker finds one post-convergence merge
authority and no process-global or mutable registry.

```bash
pnpm --filter @hachej/boring-agent exec vitest run src/server/__tests__/boringBashContribution.contract.test.ts
pnpm --filter @hachej/boring-agent typecheck
pnpm exec tsx scripts/check-p3-bash-extraction.mts --phase=agent-seam
```

### P3.5 — Migrate primary application consumers (v2)

**Today:** Workspace, Core, CLI modes, full-app, and the A1 dev path reach Agent
composition through different wrappers.

**Delta:** migrate the named production app shells to pass the static
boring-bash contribution through the P3.4 seam. Their current post-#808 runtime
owner continues to select and dispose the pair. Use the final A1 dev-app/CLI
shape as a consumer; do not edit A1 authoring, validation, catalog, or CLI
semantics.

**Depends on:** P3.4.

**Machine gate:** all commands pass. Existing package integrations prove each
mode's one pair feeds Agent and boring-bash; the checker reports no unclassified
primary consumer and no A1 definition/materializer product-code change.

```bash
pnpm --filter @hachej/boring-workspace typecheck && pnpm --filter @hachej/boring-workspace test
pnpm --filter @hachej/boring-core typecheck && pnpm --filter @hachej/boring-core test
pnpm --filter @hachej/boring-ui-cli typecheck && pnpm --filter @hachej/boring-ui-cli test
pnpm --filter full-app typecheck && pnpm --filter full-app test
pnpm exec tsx scripts/check-p3-bash-extraction.mts --phase=primary-migrated
```

### P3.6 — Migrate auxiliary consumers and contract Agent ownership (v2)

**Today:** playground, dev/E2E, eval, smoke, examples, remote-worker checks, and
front renderer tests may import Agent-owned tool/runtime internals directly.

**Delta:** migrate every remaining classified consumer; re-home Agent-internal
dev/E2E helpers only where required by the new public owner; delete the old
Agent implementations/exports and obsolete filesystem route profile; remove all
`TODO(remove:P3.6)` markers. Do not leave compatibility re-exports.

**Depends on:** P3.5.

**Machine gate:** all commands pass. The checker reports zero old-origin
imports/registrations, all transition markers are gone, builds resolve the new
exports, import/publish audits reject old Agent value exports, and affected
auxiliary tests are green.

```bash
pnpm exec tsx scripts/check-p3-bash-extraction.mts --phase=contracted
! rg -n "TODO\\(remove:P3\\.6\\)" packages apps plugins
pnpm --filter @hachej/boring-bash build
pnpm audit:imports
pnpm audit:publish-manifests
pnpm test:changed
```

### P3.7 — Close cross-package conformance and proof (v2)

**Today:** package-local tests do not prove the completed ownership boundary or
all application modes as one cohort.

**Delta:** add final conformance/import tests, run the full affected-package and
golden-path proof, update package docs/ownership maps, and obtain the required
fresh-eyes plus structural review. No new behavior or abstraction enters this
bead.

**Depends on:** P3.6.

**Machine gate:** all commands in [Proof](#proof) pass from a clean checkout;
the diff audit proves both Decision 19 directions (no Agent → runtime-package
value import and no boring-bash → Agent value import), no provider implementation
change, no A1 behavior change, and no retired dependency; the review ladder
returns clean after dispositions.

## Acceptance

P3 is complete only when:

1. The #808 merge SHA and post-#808 paired-runtime contract are recorded.
2. `@hachej/boring-bash/agent` owns the scoped trusted tool builders and
   `@hachej/boring-bash/server` owns the scoped route closure.
3. All shell/file/repo/upload effects execute through the same selected
   Workspace + Sandbox pair and Operations adapters.
4. Agent owns the loop, sessions, and one tool merge, but no longer owns or
   value-exports the moved implementations.
5. Every inventoried application, dev, test, eval, smoke, and example consumer
   is migrated or explicitly proven out of scope.
6. Existing tool names/schemas/readiness/order, route paths/auth/error behavior,
   readonly/spoof rules, and runtime cwd semantics remain unchanged.
7. A1 definitions remain data-only, A1 tools compose through its landed
   catalog/input, and no A1 source is duplicated or redesigned.
8. No provider selection/lifecycle or X1 mount work lands in P3.
9. No compatibility re-export, runtime mutable registry, or second tool composer
   remains.
10. Package invariants prove boring-bash imports Agent types only and Agent has
    no boring-bash/boring-sandbox value import.

## Proof

Run from a clean checkout after P3.7. Exact targeted test paths may be updated by
P3.1 to match the post-#808 tree, but the package and invariant gates are fixed.

```bash
pnpm --filter @hachej/boring-bash typecheck
pnpm --filter @hachej/boring-bash test
pnpm --filter @hachej/boring-bash check:invariants
pnpm --filter @hachej/boring-bash build
pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-agent build
pnpm --filter @hachej/boring-workspace typecheck
pnpm --filter @hachej/boring-workspace test
pnpm --filter @hachej/boring-core typecheck
pnpm --filter @hachej/boring-core test
pnpm --filter @hachej/boring-ui-cli typecheck
pnpm --filter @hachej/boring-ui-cli test
pnpm --filter full-app typecheck
pnpm --filter full-app test
pnpm lint:invariants
pnpm audit:imports
pnpm audit:publish-manifests
pnpm check:golden-path
```

Additionally attach:

- the P3.0 and P3.1 consumer inventories;
- targeted contract-test output for both Agent assembly paths and at least the
  direct plus post-#808 sandbox pair;
- a name-only diff classifying every package changed as destination, composer,
  consumer, contract cleanup, test, or docs; and
- the review dispositions required by the Model Card.

No visual proof is required: this is a behavior-preserving server/package move.
If a current workspace file-tree/editor E2E exists after #808, run it as an
additional regression gate rather than inventing a new visual workflow.

## Rollout and rollback

Use one coherent expand → migrate → contract stack:

1. expand destination APIs and contract tests;
2. migrate primary then auxiliary consumers without changing wire behavior;
3. contract Agent ownership only when inventory reaches zero.

The stack must merge as a coherent cohort. Before P3.6, rollback is reverting
the newest migration bead while temporary origins still exist. After P3.6,
rollback is reverting the P3.2–P3.6 cohort to the pre-extraction commit; do not
restore ad-hoc old-path re-exports. There is no runtime flag: a flag would create
two composition authorities for a package-only behavior freeze.

## Explicit non-goals

- Any A1 authoring, materialization, tool-catalog, validate, dev app/CLI, or
  conformance implementation.
- Tenant custom tools, sandbox entrypoint protocol, secret injection, timeouts,
  or network-egress policy.
- #808 provider contracts/implementations or X1 S3/FUSE/mount work.
- P4 file UI ownership, P5 provisioning/secrets, P6 plugin child apps, P7
  multi-agent inspection, P8 programme verification, E1 attachments, or P1
  headless-core work.
- Pure mode, workspace-less mode, route removal, UI capability gating, renderer
  extraction, model-policy changes, or new wire behavior.
- AgentHost, a controller/reconciler, content-addressed rollout/CAS, publication
  journals, `AgentDeployment`/`definitionRef`, deployment registries, or any
  runtime mutable registry. None is a dependency or permitted implementation
  mechanism.
- `createBashAgentFeature`, a generic `AgentFeature`, plugin activation
  snapshots, scoped-route plugin machinery, or a second tool catalog/composer.
- Moving session changes, transcripts, or durable host session data into the
  Workspace/Sandbox pair.

## Stop conditions and open question

Stop and return to planning if:

- post-#808 runtime composition does not preserve one coherent pair with one
  lifecycle owner;
- the A1 stack changes the standard/extra/plugin composition order or replaces
  `mergeTools()` rather than extending it;
- a named consumer requires provider selection inside boring-bash;
- the post-#808 pair cannot replace the scoped upload, harness-cleanup, or git
  host effects through existing Operations without provider-contract changes;
- behavior parity requires a wire-path, auth, readonly, spoof, schema, or error
  change; or
- a proposed move would execute an authored/tenant handler in the control-plane
  process.

The only intentionally deferred technical question is the exact name/shape of
the post-#808 paired-runtime input. P3.1 resolves it from landed code; all of its
semantic constraints and the stop condition are specified above.

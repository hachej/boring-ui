---
github: https://github.com/hachej/boring-ui/issues/808
issue: 808
state: ready-for-human
updated: 2026-07-19
flag: not-needed
track: owner
---

# gh-808 Extract the existing sandbox providers behind one paired contract

## Authority

This is the canonical plan for the remaining P2.0 `boring-sandbox` extraction
work owned by issue #808 under [Decision 26](../../DECISIONS.md). It recuts the
useful research in
[`runtime-refactor/work/P2-sandbox-providers`](runtime-refactor/work/P2-sandbox-providers)
against current `origin/main`; those older lane files are evidence, not dispatch
authority. The X1 documents remain later research only.

The Today inventory was reverified after rebasing onto `origin/main` at
`556aed587` on 2026-07-18. The intervening changes restored the current
agent-cloud vision and planning Bead but did not change provider/runtime
product code. This baseline includes the current CLI
`provisionCliWorkspaceRuntime()` fallback to `agent.resolveMode()`, so CLI is an
explicit P2.5 importer rather than an assumed historical consumer. Re-run the
inventory at dispatch and again immediately before the coordinated cutover.

The planning Bead is `wt-391-forward-6au`: **P2.0: recut boring-sandbox
extraction plan per Decision 26 + agent-cloud vision**. It is plan-only and is
complete when this reviewed plan merges. The execution chain proposed below is
not created by this PR.

[`../391/AGENT-CLOUD-VISION.md`](../391/AGENT-CLOUD-VISION.md) is a current
north-star note, explicitly non-binding on Beads. This plan follows its
control-plane/data-plane split and the rule that executable tenant work runs
only in the sandbox. Its long-term product ideas create no dependency and do
not override Decision 26 sequencing or the canonical #391 plan.

Shared sequencing remains controlled by:

- [`../391/plan.md`](../391/plan.md): provider extraction is Step 3 after the
  Step 2 trigger.
- [`../391/ROADMAP-ALIGNMENT.md`](../391/ROADMAP-ALIGNMENT.md): P2 needs a
  demonstrated consumer and X1 remains later.
- [`../391/AGENT-CONSUMPTION-MODES.md`](../391/AGENT-CONSUMPTION-MODES.md):
  every execution stays workspace-backed and Workspace + Sandbox swap together.
- [`../805/runtime-refactor/work/A1-agent-authoring/PLAN.md`](../805/runtime-refactor/work/A1-agent-authoring/PLAN.md):
  authored definitions are data-only and do not carry runtime handles or
  executable module paths.

## Problem

The package boundary is only half present. `@hachej/boring-sandbox` is already
published, versioned, included in release tooling, and owns shared capability
facts plus the structural runsc preflight. The providers used by the product,
however, still live inside `@hachej/boring-agent`, so the intended swappable
data-plane boundary is not a package contract today.

Earlier P2 branches moved more than this work package now needs. They mixed in
remote-worker relocation, runsc production qualification, broad runtime-mode
ownership, environment attachments, and future mounts. Some extracted files
were later reintroduced into Agent during the retired deployment work. Blindly
replaying those commits would restore stale authority and miss current code.

The remaining problem is narrower:

```text
static host runtime choice
-> one versioned SandboxProviderV1 contract
-> one ready Workspace + Sandbox pair
-> existing Agent tool/session/model composition
```

The extraction must preserve behavior. It does not add a provider, a feature,
or a new runtime owner.

## Today / Delta inventory

| Area | Today on `origin/main` | Remaining delta |
| --- | --- | --- |
| Package | `packages/boring-sandbox` exists at `0.1.89` and exports `.`, `./shared`, `./providers`, and `./providers/runsc`; its provider folder currently contains the runsc scaffold, not the direct/bwrap/Vercel implementations. | Extend the existing package; do not scaffold or create a second package. |
| Release | Sandbox is already in version, staging, CI, and publish lists. | Qualify the changed artifact; do not redo publish-pipeline parity. |
| Shared facts | `PROVIDER_CONTRACT_VERSION = "boring-sandbox.provider.v1"`, `PROVIDER_CAPABILITIES`, and mode-to-provider facts already exist. | Reuse the one existing version constant on the executable provider interface; do not create a second version authority or rewrite capability facts. |
| Direct | `createDirectSandbox` and tests live under `packages/agent/src/server/sandbox/direct`. | Move the current implementation and its behavior/conformance tests behind the V1 provider interface. |
| bwrap | `buildBwrapArgs`, `createBwrapSandbox`, and tests live under `packages/agent/src/server/sandbox/bwrap`; `local` mode pairs them with a Node workspace. | Move the current implementation and provider-owned helpers without changing bwrap policy, arguments, or fallback behavior. |
| Vercel | Vercel exec, remote workspace, handle persistence, snapshots, auth, template, readiness, provisioning adapter, and tests live across Agent sandbox/workspace/runtime-mode paths. Runtime creation returns a pair, but provisioning can lazily resolve the same durable handle through a separate helper path. | Move the current provider-owned code behind the same V1 pair contract while retaining current auth, persistence, setup, health, and cleanup behavior. Every runtime or provisioning operation must first acquire one scoped pair lease; no workspace-only or sandbox-only acquisition path remains. |
| Runtime pair | Agent's `RuntimeModeAdapter.create()` already returns one `RuntimeBundle` containing a Workspace and Sandbox. Resolve-mode tests assert matching runtime roots. | Make provider creation return the pair atomically; the existing higher Agent composition consumes it and remains the sole tool/session/model loop. |
| Mode selection | `direct`, `local`, and `vercel-sandbox` are selected statically by `resolveMode`; production safety already rejects unsafe full-app modes. | Preserve these exact mode IDs and selection rules. Move only the value-bearing provider composition needed to keep Agent free of sandbox runtime values; add no mutable registry. |
| Consumers | Full-app uses Vercel in production and direct/local in approved development; Workspace and CLI also call the existing mode seam. | Migrate these named current consumers in the contract step and prove their existing journeys from exact package artifacts. |
| A1 | `MaterializedAgentSourceV1` is frozen, excludes runtime/catalog handles, and currently rejects unresolved `toolRefs`; the A1 plan keeps definitions data-only. | Do not put definitions, tool declarations, catalog functions, or handlers in the sandbox provider interface. Preserve the seam for Pi/toolCatalog tools to execute effects through Operations adapters against the acquired pair. |
| runsc | `./providers/runsc` is a structural, `productionReady: false` preflight surface. | Leave it unchanged. Production qualification/attestation is owned elsewhere and does not block this extraction. |
| X1 | Only stale S3/FUSE planning exists; no product mount implementation is present. | No mount code, export, capability expansion, credentials, or benchmark work. Leave room by keeping the provider contract additive/versioned, not by adding mount methods now. |

## Trigger and dispatch gates

This plan being merged does not authorize implementation. Proposed execution
Beads remain deferred until all of the following are true:

1. Decision 26 Step 2 has completed its accepted proof. The exact trigger is a
   merged canonical Step 2 plan/implementation proving multiple agents share
   one Workspace + Sandbox lifecycle without a second runtime owner.
2. The owner accepts this recut and creates/updates the proposed Beads from this
   plan. A stale P2 Bead or lane checklist is never enough.
3. The named current consumers still exist at dispatch: full-app Vercel
   production, full-app or CLI direct/local development, and Workspace server
   composition. If their seams have changed, refresh the Today/Delta inventory
   before assigning P2.1.
4. The first execution PR records the exact current package version and a
   zero-behavior-change baseline for the three modes.

A second paying tenant is **not** required to extract the three providers that
already have named consumers. A second tenant, a self-operated Seneca data
plane, or measured Vercel limitations may trigger planning for another provider
or new provider features; that trigger requires a separate issue/plan and does
not widen this one.

X1 remains deferred until a named native-mount consumer supplies access,
lifecycle, credential, isolation, and proof requirements. Attestation remains
deferred to its own Bead. Neither is a dependency of this chain.

## Solution

### One interface, three static implementations

Add one front-safe, versioned provider interface under
`@hachej/boring-sandbox/shared`. The exact TypeScript spelling is finalized in
P2.1, but its semantics are fixed:

```ts
type ExtractedSandboxProviderIdV1 =
  | "direct"
  | "bwrap"
  | "vercel-sandbox"

type WorkspaceSandboxPairV1 = Readonly<{
  workspace: Workspace
  sandbox: Sandbox
  provisioning?: SandboxProvisioningOperationsV1
  checkHealth?(): Promise<SandboxPairHealthV1>
  dispose(): Promise<void>
}>

interface SandboxProviderV1 {
  readonly contractVersion: typeof PROVIDER_CONTRACT_VERSION
  readonly providerId: ExtractedSandboxProviderIdV1
  readonly capabilities: ProviderCapabilities
  resolveRuntimeRoot(context: SandboxProviderCreateContextV1): string
  create(context: SandboxProviderCreateContextV1): Promise<WorkspaceSandboxPairV1>
  invalidate?(context: SandboxProviderInvalidateContextV1): Promise<void> | void
  close?(): Promise<void>
}
```

The existing Agent `Workspace`, `Sandbox`, and runtime-context contracts are
referenced type-only until their published ownership is separately changed;
`boring-sandbox` gains no Agent runtime value import. P2.1 must prove the
emitted declaration graph remains consumable without a runtime cycle. This
provider interface is the only executable provider contract. The pair's
health/provisioning members are supporting result types under that same V1
contract, not independently acquired providers. Provider-specific factory
options do not form a second selection, acquisition, or lifecycle interface.

`create()` is the sole provider-owned acquisition path. A runtime binding holds
one returned pair lease for its lifetime. A provisioning-only request acquires
one pair lease, derives the higher provisioning adapter from
`pair.provisioning` plus the pair's Workspace/Sandbox, runs the request, and
disposes that lease. If provisioning runs for an already-acquired binding, it
reuses that binding's pair. It must never call a Vercel-only helper that
constructs a second Workspace/Sandbox wrapper behind the contract.

`resolveRuntimeRoot`, `checkHealth`, `invalidate`, and `close` cover only the
existing runtime-layout, cached-binding health, cache-eviction, and
provider-wide shutdown seams needed by today's consumers. P2.1 may simplify
their exact spelling after the consumer audit, but it may not export
provider-specific lifecycle side doors. The interface gains no mount,
attestation, deployment, publication, or live-selection method.

Provider-specific credentials, SDK clients, handle stores, and test hooks stay
in server-only factory options. They are not added to the common create
context. The shared context contains only the existing runtime identity and
setup inputs needed by all three modes (workspace root/id, session id,
template/request metadata, and the existing telemetry seam). It contains no
principal authorization, `AgentDefinition`, `MaterializedAgentSourceV1`, tool
catalog, handler, session store, deployment reference, digest, or publication
state.

The interface reuses `PROVIDER_CONTRACT_VERSION`; there is no parallel version
constant. Implementations are constructed statically and passed by value. No
lookup table is mutable at runtime, and no install/update endpoint exists.

### Pairing and lifecycle

Provider creation succeeds with one ready pair or fails with neither half
published. The pair must satisfy:

- `workspace.runtimeContext.runtimeCwd === sandbox.runtimeContext.runtimeCwd`;
- provider-specific root aliases preserve today's visible paths;
- `dispose()` is idempotent and releases provider-owned local watchers,
  wrappers, and lease resources exactly once;
- partial creation failure releases transient lease resources while preserving
  or destroying a durable provider resource exactly as today's provider does;
- cache eviction and provider-wide shutdown still run through the existing
  runtime lifecycle;
- a workspace pair is never swapped or disposed independently by a logical
  agent.

For Vercel specifically, the persisted remote handle is durable state, not the
local pair lease. Pair disposal must not newly stop, delete, or force-snapshot
that handle. `invalidate()` clears only the current in-process cached handle so
the next atomic acquisition follows today's persisted-handle
reuse/recreation policy; provider `close()` retains today's scheduler shutdown
semantics. Direct/bwrap disposal closes their current local watcher/process
resources without changing command behavior.

Agent's higher `RuntimeBundle` may continue to add file search, bash/filesystem
Operations strategies, readiness, and provisioning. Those are composition over
the pair, not a second provider contract.

Today, `RuntimeBundle` has no disposer and binding retirement calls
`binding.retire()`, then `binding.agent.dispose()`, then cache eviction. The
delta therefore includes an explicit pair-disposal hook on the composed runtime
binding:

```text
stop admission and abort/drain provisioning
-> dispose the Agent model/session runtime
-> dispose WorkspaceSandboxPairV1 exactly once
-> evict the cached provider handle
-> close provider-wide resources when the app/mode closes
```

`createAgentApp()` uses the same ordering before `modeAdapter.dispose()`. If
construction fails after a pair is acquired, the construction catch path
disposes the pair. Retirement continues attempting pair disposal and cache
eviction after an earlier cleanup error, preserving the first actionable error
and logging later failures. P2.4 owns this wiring; provider-level conformance
alone cannot close the lifecycle gate.

### Control plane / data plane

| Plane | Owns | Must not own |
| --- | --- | --- |
| Host/control plane | Static mode choice; auth and membership; persisted workspace/session records; A1 data-only definitions and tool references; construction of trusted tool catalogs; provider credentials/handle-store adapters. | Tenant handler execution, arbitrary shell/file effects, or a mutable provider registry. |
| Sandbox/data plane | The selected provider's workspace filesystem and process execution; current direct, bwrap, or Vercel implementation; provider lifecycle and cleanup. | Workspace membership, agent/product selection, definitions, billing, sessions/transcripts, or control-plane mutation. |
| Agent behavior layer | One existing model/session loop; Pi tool factories; Operations adapters bound to the authorized pair; prompt/tool/readiness composition. | Provider selection authority, provider credentials, or a second Workspace/Sandbox lifecycle. |

Direct remains an explicitly trusted local data-plane adapter, bwrap remains the
local isolated adapter, and Vercel remains the current remote data plane. The
terms describe where effects execute; they do not grant authorization.

### A1 and tool execution boundary

This extraction does not implement custom tenant tools. It preserves these
rules for current and future tools:

1. A1 definitions and `toolRefs` remain data-only. They never select a provider
   or carry a function/module path into the provider interface.
2. A trusted server-only `toolCatalog` may resolve a declaration only after the
   host has selected and authorized the workspace pair.
3. File and shell effects continue through Pi factories plus Operations
   adapters bound to `Workspace`/`Sandbox`; a future tenant handler may execute
   only as a sandbox entrypoint through that boundary.
4. This plan adds no in-process tenant `import()`, custom-tool subprocess
   protocol, or handler loader. Those require their own consumer-backed plan.

## Decisions

1. **Reuse the published package and version constant.** Today the scaffold,
   capability matrix, invariant script, and release lists exist. Delta is the
   executable V1 interface and implementations only.
2. **Return a pair, not a bare exec client.** Today the application already
   relies on matching Workspace and Sandbox roots. Returning both atomically is
   the smallest way to preserve invariant 5 across local and remote providers.
3. **Keep mode choice static.** Today mode resolution is startup/config driven.
   Delta may relocate value-bearing composition so package layering holds, but
   it does not create a registry, controller, watcher, or live mutation path.
4. **Move behavior, do not redesign it.** Today each provider has working tests
   and production/development consumers. Delta preserves exported behavior,
   stable errors, auth, paths, timeouts, streaming, readiness, persistence,
   provisioning, cleanup, and production safety.
5. **One behavior loop above the pair.** Today Agent owns tools, sessions, and
   the model loop. Delta does not duplicate those in `boring-sandbox`.
6. **Use copy -> verify -> swap** (expand -> migrate -> contract, sequenced per
   owner directive 2026-07-19). Temporary duplicate files are allowed only
   between the Phase-1 copy Beads and the Phase-3 swap, must remain
   behavior-locked by the same conformance tests run against both copies, and
   have P2.5 as their explicit deletion owner. `packages/agent` sandbox code is
   frozen for the whole window (see the freeze rule under Execution phasing);
   divergence between the copies is the named failure mode. No compatibility
   re-export survives P2.5.
7. **Preserve published APIs deliberately.** P2.1 records the public export
   audit. If removing Agent provider/mode exports is breaking for a confirmed
   consumer, stop and choose an explicit release transition; do not hide the
   break with a permanent shim.

## Test seams

- Highest public seam: create each provider through `SandboxProviderV1`, obtain
  one pair, run workspace and exec operations, then dispose the pair.
- Existing behavior seams:
  `packages/agent/src/__tests__/conformance/sandbox.ts`, direct/bwrap provider
  tests, Vercel workspace/exec/handle/mode tests, and
  `packages/agent/src/server/runtime/__tests__/resolveMode.test.ts`.
- Composition seams: Workspace server, Core workspace-agent server, CLI mode
  provisioning, full-app production safety, and Vercel smoke scripts.
- Artifact seam: packed `@hachej/boring-sandbox` plus the exact affected
  package cohort installed without workspace links.
- Avoid testing private helpers when the provider/pair seam proves the same
  behavior. Mechanical moves retain focused helper tests where they catch
  platform/path/SDK edge cases.

## Execution phasing — copy, verify, swap

Sequencing per owner directive 2026-07-19: copy-verify-swap. The slices below
are unchanged in content but are grouped into three strictly ordered phases;
each phase's exit gate must pass before the next phase starts.

**Phase 1 — COPY (P2.1, P2.2, P2.3).** The direct, bwrap, and vercel-sandbox
implementations are *copied* from `packages/agent` into
`packages/boring-sandbox` behind `SandboxProviderV1`. `packages/agent`'s live
provider code and every production importer remain completely untouched; the
Agent originals stay in place as the running product path. "Move"/"relocate"
in the slice text below therefore means copy-with-deferred-deletion: the old
copy is deleted only in Phase 3.

**Phase 2 — STANDALONE VERIFY (P2.4 plus the parity suite).** `boring-sandbox`
is proven standalone before any consumer is rewired. The shared
conformance/parity suite must be runnable against BOTH the old in-agent
provider path and the new package, and must pass identically against both —
this dual-target parity run is the phase gate. The static composer (P2.4) is
built and tested in this phase without changing any production importer.

**Phase 3 — SWAP (P2.5, then P2.6).** A separate, near-mechanical PR rewires
`packages/agent` (and the other named importers) to consume `boring-sandbox`:
imports flipped, zero behavior delta, old Agent copies deleted. P2.6's
exact-artifact proof follows the swap.

**Freeze rule (explicit constraint).** From the moment Phase-1 copying starts
until the Phase-3 swap PR lands, no changes may be made to `packages/agent`'s
sandbox code. Divergence between the two copies is the named failure mode of
this extraction: any urgent fix that cannot wait must be applied to both
copies in the same PR with the parity suite passing on both, and is otherwise
a stop condition (see below).

## Remaining slices

All line counts are review guidance, not permission to omit behavior. A move
may exceed a normal net-line budget when `git diff --find-renames` proves it is
mechanical; semantic edits remain small and separately visible.

### P2.1 — Freeze the single V1 pair contract and baseline (Phase 1)

**Today:** shared capability/version facts and Agent-owned Workspace/Sandbox
types exist; no executable provider interface exists in `boring-sandbox`.

**Delta:** add `SandboxProviderV1`, its create/invalidate/close contexts, paired
lifecycle and existing operational result, exact three-provider ID type,
stable error codes where the existing registries lack them, and reusable
provider/pair conformance. Record the public export and consumer audit. Do not
move providers yet. The audit must trace runtime creation, standalone and
dynamic disposal, runtime-root lookup, readiness/health, provisioning-only
requests, cache eviction, and provider shutdown so none escapes through a
provider-specific side interface.

**Blocked by:** all dispatch gates above.

**Machine gate:** sandbox build/typecheck/test/invariants pass; a fixture
provider passes pair conformance; type tests reject a mismatched contract
version and a result that exposes only Workspace or only Sandbox; a
provisioning fixture cannot run before acquiring a pair; no provider-specific
acquisition/lifecycle export is present; shared code contains no `node:*`
import or `Buffer`; the export audit is attached to the PR.

**Rollback:** additive contract can be reverted before consumers migrate.

### P2.2 — Copy direct and bwrap behind V1 (Phase 1)

**Today:** both implementations, Node workspace helper dependencies, and tests
live in Agent; `direct` and `local` mode tests already prove paired roots.

**Delta:** relocate the current direct/bwrap provider-owned code and tests to
`boring-sandbox/providers`; implement V1 factories using the existing version
and capability facts. Preserve direct's trusted-host behavior and bwrap's
current arguments, Linux check, network/resource behavior, streaming, abort,
timeout, truncation, and path semantics. Keep temporary Agent origins only
until P2.5, named with P2.5 as deletion owner.

The pair implementation also moves the provider-bound Node workspace factory,
host-root WeakMap, path containment, ignore rules, watcher, and their tests.
Concretely, start from today's `createNodeWorkspace.ts`, `paths.ts`,
`ignore.ts`, and `nodeWatcher.ts`. Replace the watcher's Agent value imports
for env/logging with server-only provider factory inputs or a package-local
adapter; never import Agent values from sandbox. `copyTemplate`,
`createServerFileSearch`, tool Operations strategies, and provisioning remain
in the higher static composer because they decorate an acquired pair. Any
remaining Agent-only need for a Node workspace must use the acquired pair or an
explicit host-injected workspace factory at P2.5, not import the sandbox value.

**Blocked by:** P2.1.

**Machine gate:** both implementations pass the shared pair/sandbox/workspace
conformance; existing direct/bwrap focused tests pass from the new package;
`local` still maps to provider `bwrap`; direct and bwrap runtime-root equality
tests pass; a planted sandbox -> Agent value import and sandbox -> boring-bash
import fail the invariant scan.

**Rollback:** runtime consumers still point at their Today origins until P2.5.

### P2.3 — Copy Vercel behind the same V1 interface (Phase 1)

**Today:** Vercel code spans Agent sandbox, workspace, and mode folders and
uses `@vercel/sandbox`, `@vercel/blob`, persisted handle storage, snapshot and
readiness helpers.

**Delta:** relocate that current code and its tests to the sandbox package,
move only the dependencies exclusively owned by it, and expose a V1 factory.
Keep credentials/client/store/clock/logger/test hooks in server-only factory
options. Fold today's separate `ensureVercelProvisioningParts()` acquisition
path into V1 pair acquisition: provisioning primitives are derived from the
acquired pair, and provisioning-only calls use a scoped pair lease. Preserve
current workspace path aliases, auth precedence, template seeding, handle
reuse/recreation, cache eviction, setup telemetry, health, snapshot behavior,
provisioning adapter behavior, and cleanup. Pair disposal releases only local
lease resources; it does not newly stop/delete/snapshot the durable Vercel
handle.

**Blocked by:** P2.1. It may be prepared in parallel with P2.2 only in an
isolated worktree; package barrels/manifests have one writer and P2.4 waits for
both.

**Machine gate:** Vercel pair and workspace conformance, all moved mock-backed
Vercel tests, package build/typecheck/invariants, and setup-failure cleanup
tests pass without live credentials; runtime-bound provisioning reuses the
existing pair; provisioning-only acquires and disposes exactly one pair; pair
dispose leaves the persisted handle reusable; invalidate forces the existing
recreation path without deleting durable state; `git diff --find-renames=90%`
plus a semantic-diff note proves changes beyond import paths are intentional.

**Rollback:** runtime consumers still point at their Today origins until P2.5.

### P2.4 — Compose the three providers statically above V1 (Phase 2)

**Today:** Agent's `resolveMode` constructs value-bearing adapters directly and
its `RuntimeBundle` adds file search, Operations strategies, readiness, and
provisioning.

**Delta:** place the value-bearing static composer in the existing host/runtime
layer that may import sandbox values (prefer `@hachej/boring-bash/server` after
the P2.1 export audit). It maps only `direct`, `local`, and `vercel-sandbox` to
the three V1 provider values and adapts the acquired pair and its declared
operations into the existing RuntimeBundle/readiness/provisioning seams. It
does not import a provider-specific acquisition, health, provisioning,
eviction, or shutdown helper. Agent retains only types/behavior composition and
accepts the adapter by injection. Preserve `BORING_AGENT_MODE`, auto-detection,
custom injected adapters, production safety, readiness, and provisioning
behavior.

Wire the pair disposer into both lifecycle shapes in the same slice: dynamic
binding retirement adds a post-Agent `disposeRuntime` step before cache
eviction, while standalone `createAgentApp()` disposes Agent -> pair -> mode.
The construction-failure path disposes any acquired pair. Tests inject failures
at Agent disposal, pair disposal, and cache eviction and prove later cleanup
still runs, the first error wins, and repeated close/retire calls invoke pair
disposal once.

**Blocked by:** P2.2 and P2.3.

**Machine gate:** the existing resolve-mode table passes at the new public
composition seam; a pair is created/disposed once per runtime binding,
standalone app shutdown, and provisioning-only lease; provisioning for an
existing binding reuses its pair; partial construction and three-point
cleanup-failure tests pass; custom adapter injection still works; invalid mode
and missing Vercel auth errors are unchanged; no static import loads the Vercel
SDK when a direct/bwrap subpath is used if the export audit identifies that as
a current property. **Phase-2 exit gate:** the shared conformance/parity suite
runs against BOTH the old in-agent provider path and the new
`boring-sandbox` package and passes identically on both targets; the dual-run
evidence is attached to the PR. Phase 3 may not start without it.

**Rollback:** no production importer changes until P2.5.

### P2.5 — Swap: migrate consumers and contract the old Agent ownership (Phase 3)

**Today:** Agent exports concrete provider/mode values and Core, Workspace, CLI,
full-app, dev/smoke code, and tests consume those paths.

**Delta:** migrate every current importer to the V1/static-composer seam in one
coordinated PR; delete the old provider-owned Agent files/exports and temporary
duplicates; move provider-only package dependencies; strengthen import/export
invariants. Agent may retain type-only references but has zero runtime value
imports from boring-sandbox/boring-bash. No old-path value re-export or runtime
shim remains.

The importer inventory explicitly includes the current CLI
`provisionCliWorkspaceRuntime()` fallback to `agent.resolveMode()`, Workspace
server composition, Core's injected handle store, full-app/dev/smoke entry
points, and Agent's own standalone/test harnesses. Agent-internal generic
workspace uses consume the acquired runtime pair or a host-injected workspace
factory; they do not retain a second Node workspace implementation as a hidden
provider.

**Blocked by:** P2.4 and an accepted P2.1 public-API disposition.

**Machine gate:** repository grep finds no deleted provider origins or
forbidden old imports; `pnpm audit:imports`, `pnpm lint:invariants`, affected
package builds/typechecks/tests, current resolve-mode tests, Core/Workspace/CLI
tests, full-app production-safety tests, and Agent isolation checks pass. A
planted Agent -> sandbox/bash value import fails. `git diff --check` passes.

**Rollback:** revert the coordinated importer/deletion PR and the preceding
additive provider PRs before release; no data migration is involved.

### P2.6 — Prove exact artifacts and release handoff (Phase 3)

**Today:** the sandbox package already participates in the release cohort, and
current full-app/CLI/Workspace behavior is proven through workspace links in
normal repository tests.

**Delta:** pack the exact affected package cohort, install it without workspace
links in clean consumer fixtures/checkouts, and prove direct, bwrap, and
Vercel composition through their named current consumers. Run the normal
release workflow only with owner approval; record exact versions/integrities
and the prior compatible cohort.

**Blocked by:** P2.5, clean independent review, and release-owner approval.

**Machine gate:** tarball export/dependency audit; clean-install typecheck/build
and direct/local smoke for CLI or full-app development; full-app Vercel mock
integration plus the existing credentialed smoke when credentials are
available; affected package cohort tests; no workspace link in the consumer
lockfile; exact artifact versions/integrities recorded. A credentialed smoke
waiver must name the residual risk and cannot claim live Vercel proof.

**Rollback:** restore the prior exact compatible cohort. Published artifacts
are never rewritten; corrections use new versions.

## Dependency graph

```text
Decision 26 Step 2 + owner activation
-> Phase 1 COPY   (P2.1 -> P2.2 + P2.3; packages/agent untouched, freeze starts)
-> Phase 2 VERIFY (P2.4 + dual-target parity suite = phase gate)
-> Phase 3 SWAP   (P2.5 near-mechanical importer swap PR -> P2.6 artifact proof)

P2.6 does not unblock X1 or attestation automatically.
Each requires its own trigger and recut.
```

## Proposed Bead chain (plan only)

Sequencing per owner directive 2026-07-19: copy-verify-swap — one bead per
phase, simple and robust. These are proposed IDs/aliases for tracker creation;
if `br` allocates a different concrete prefix, preserve the titles and
dependency edges exactly. Do not edit `.beads` in this planning PR.

| Proposed ID | Title | Covers | Depends on | Initial status |
| --- | --- | --- | --- | --- |
| `wt-808-phase-1-copy` | `Phase 1: copy direct/bwrap/vercel providers into boring-sandbox behind V1 (agent untouched, freeze starts)` | P2.1, P2.2, P2.3 | Decision 26 Step 2 proof; owner activation | deferred |
| `wt-808-phase-2-verify` | `Phase 2: standalone verify — static composer + dual-target parity suite (old in-agent path vs new package)` | P2.4 + parity gate | `wt-808-phase-1-copy` | deferred |
| `wt-808-phase-3-swap` | `Phase 3: swap — near-mechanical importer rewire, delete old Agent copies, exact-artifact proof` | P2.5, P2.6 | `wt-808-phase-2-verify` | deferred |

Before creating them, copy the constituent slices' Today, Delta, exclusions,
machine gates, and rollback into each phase Bead so execution does not depend
on rereading this plan, and record the freeze rule on all three. Then run
`br dep cycles` and `bv --robot-insights`; never run bare `bv`.

## Acceptance

The P2 extraction is complete only when all of these Today/Delta claims are
machine-proven:

1. Today's package/release scaffold is reused, not rebuilt.
2. One `SandboxProviderV1` contract, stamped only by the existing
   `PROVIDER_CONTRACT_VERSION`, is the executable interface for direct, bwrap,
   and Vercel.
3. Each provider returns and disposes one matching Workspace + Sandbox pair;
   provisioning cannot acquire either half separately; current visible roots,
   durable-handle persistence, and lifecycle behavior remain compatible.
4. Direct, bwrap, and Vercel current features and tests survive the move; no
   provider capability or selection fallback is added.
5. Mode selection remains static and current mode IDs/configuration remain
   compatible; no mutable registry or second runtime owner exists.
6. Agent's model/session/tool composition consumes the authorized pair and has
   no runtime value dependency on provider packages.
7. A1 definitions remain data-only; tool effects use the existing
   toolCatalog/Pi/Operations boundary and no tenant handler is imported into the
   control plane.
8. Current Core, Workspace, CLI, full-app, direct/local development, and Vercel
   consumer paths pass from exact package artifacts.
9. Old Agent provider implementations/exports and all temporary duplicates are
   gone; no compatibility shim or retired authority remains.
10. X1 mounts, attestation, runsc qualification, remote-worker relocation, and
    every new provider feature remain outside the implementation diff.

## Proof

Each implementation PR runs its focused gate. P2.5/P2.6 run, at minimum:

```bash
pnpm --filter @hachej/boring-sandbox run build
pnpm --filter @hachej/boring-sandbox run typecheck
pnpm --filter @hachej/boring-sandbox run test
pnpm --filter @hachej/boring-sandbox run check:invariants
pnpm --filter @hachej/boring-bash run build
pnpm --filter @hachej/boring-bash run typecheck
pnpm --filter @hachej/boring-bash run test
pnpm --filter @hachej/boring-bash run check:invariants
pnpm --filter @hachej/boring-agent run build
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run test
pnpm --filter @hachej/boring-agent run check:isolation
pnpm audit:imports
pnpm lint:invariants
pnpm typecheck
pnpm test:changed
```

P2.6 adds clean artifact/consumer commands recorded in that PR. Live Vercel
claims require the existing credentialed smoke or an explicit waiver. bwrap
claims require a Linux+bwrap runner; platform skips prove only portability of
the test suite, not bwrap execution.

For this plan-only PR, proof is:

```bash
git diff --check origin/main...
git diff --name-only origin/main...
git grep -nE 'AgentHost|definitionRef|AgentDeployment|publication journal|content-addressed rollout|runtime mutable registry' -- docs/issues/808/plan.md
```

The grep is reviewed to confirm every occurrence is an explicit rejection or
non-goal, never a dependency.

## Rollout / rollback

1. Land the additive contract and provider implementations only after the
   dispatch trigger.
2. Keep current consumers on Today paths until all three V1 implementations
   pass conformance.
3. Land the static composer, then perform one coordinated importer/deletion
   cutover.
4. Prove exact packed artifacts before publishing.
5. Publish through the existing cohort workflow only with release-owner
   approval.
6. Roll back code by restoring the prior compatible cohort; there is no schema
   or user-data migration.

## Explicit non-goals

- S3, FUSE, mount lifecycle, mount capabilities, credentials, or benchmarks
  (X1).
- Attestation, EU runsc qualification, new isolation claims, or production
  readiness for the existing runsc preflight.
- A new provider, remote-worker relocation/handshake, self-operated fleet, or
  new Vercel/direct/bwrap feature.
- AgentHost or any renamed equivalent; controller/reconciler loops; rollout
  CAS; publication/apply journals; deployment records or definition references;
  mutable runtime registries; install/update APIs.
- Runtime upload, compiled-bundle resolution, digest/pointer selection, or
  dynamic provider selection.
- Domain/workspace-type routing, Step 2 multi-agent UI/delegation, MCP/A2A,
  contracted execution, billing, marketplace, or control-plane UI.
- A second model/session/tool loop, per-agent sandbox inside one workspace, or
  a second Workspace/Sandbox lifecycle owner.
- Custom tenant-tool execution, in-process tenant imports, or a new tool wire
  protocol. The interface only preserves the future sandbox-exec seam.
- New Vercel handle stop/delete/snapshot-on-dispose semantics or a second
  provider-specific provisioning acquisition path.
- Removing or redesigning unrelated published compiler, runsc, capability, or
  filesystem-binding APIs.

## Stop conditions

Stop and amend the plan rather than improvise if:

1. Step 2 is not complete when an execution Bead is proposed for dispatch.
2. current consumers no longer exercise all three target providers;
3. one interface cannot represent Vercel and local pairs without exposing
   provider credentials, behavior/catalog functions, or control-plane state;
4. Workspace and Sandbox roots/lifecycles would be selected or disposed
   independently;
5. preserving a confirmed published consumer requires a breaking transition
   not covered by the P2.1 export audit;
6. the move changes provider behavior or requires a new capability/fallback;
7. Agent would retain a runtime value import from boring-sandbox/boring-bash
   after P2.5;
8. implementation begins adding mounts, attestation, remote-worker/runsc
   readiness, custom tools, or another provider;
9. any retired deployment/control-plane concept becomes necessary to finish
   the extraction;
10. `packages/agent` sandbox code needs a change during the Phase-1-to-Phase-3
    freeze window that cannot be applied to both copies in one PR with the
    parity suite passing on both — divergence between the copies is the named
    failure mode and must be resolved by plan amendment, not improvisation.

## Review record

- `tier-1 fresh-eyes` — **revise**. Fixed three material findings: rebased and
  reverified the changed CLI consumer against current main; wired pair disposal
  explicitly into dynamic and standalone lifecycle/error paths; assigned the
  direct/bwrap Node workspace/path/watcher helpers and remaining injection
  seam. Clean on scope, Decision 26 exclusions, triggers, and Bead shape.
- `tier-2 architecture` — **revise**. Closed the remaining pair-boundary risk:
  today's Vercel provisioning helper can reacquire provider parts separately,
  and the durable handle has a different lifetime from the local pair lease.
  The recut now makes V1 creation the sole acquisition path, requires
  provisioning to reuse or scope one pair lease, and preserves persistent
  handle/cache/scheduler semantics with machine gates.
- `tier-1 convergence` — **revise, then clean after rebase**. The lifecycle
  revision was clean, but `origin/main` advanced during review. Rebased to
  `556aed587`, reread the restored agent-cloud vision and current
  `wt-391-forward-6au`, and verified the intervening diff changed only planning
  authority (`.beads` and the vision document), not provider/runtime consumers.

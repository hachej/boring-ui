> **Work-package status:** retained research and non-dispatchable until this
> child issue’s canonical plan and Bead graph are recut under Decision 26.
> Stale readiness, Decision 25 P0→N1, and AgentHost/D1 passages have no authority.

# P2-sandbox-providers — Plan

> **Binding priority-4 supersession (2026-07-11).** P2 provider extraction and
> EU conformance merge only after the priority-3 T1/T2 proof. The isolated Sol
> recut may prepare against current main, but it cannot merge, change D1 APIs,
> or claim a D1 prerequisite before that gate. D1 uses the existing approved
> workspace/runtime composition and explicit trust profile. When P2 opens, it
> extracts providers and validates isolation/EU facts without changing the
> already-proven D1 behavior. #628 remains structural `productionReady:false`
> evidence. Every runsc-before-D1 statement below is historical and
> non-dispatchable where it conflicts with [`INDEX.md`](../../../../391/runtime-refactor/INDEX.md).

> **Historical reduced-v1 proposal (2026-07-10; non-dispatchable).** P2 was an isolated runsc/provider track for
> the D1 dedicated workspace path, not a prerequisite for a public pure mode or
> a full provider-taxonomy rewrite. #557 is merged evidence that sandbox publish
> parity has landed. Continue only the smallest provider boundary and runsc
> behavior D1 consumes; keep speculative relocation and generic provider APIs
> post-v1.

> Phase: binding narrow P2 runsc/provider slice · Work order: [TODO.md](TODO.md) · Handoff: [HANDOFF.md](HANDOFF.md)
> Ordering authority: [INDEX.md](../../../../391/runtime-refactor/INDEX.md) · Vision: [VISION.md](../../../../391/runtime-refactor/VISION.md)

## Current-main evidence for the later priority-4 recut

`@hachej/boring-sandbox` exists and #557 publish-pipeline parity is merged. Do
not scaffold or republish it. #628 adds a structural runsc config/preflight
surface and deliberately reports `productionReady: false`. It proves neither
provider parity nor lifecycle/security readiness. Priority-4 work starts from
that narrow boundary after priorities 1-3; D1 does not consume or wait for this
recut.

## Historical runsc-first deliverables — non-dispatchable

- one injected workspace runtime path to a real preconfigured EU runsc worker;
- honest authenticated runsc, network, resource-limit, image, persistence, and
  cleanup facts, with missing/unknown facts failing closed;
- no production fallback to direct, bwrap, Vercel, fake, or unverified workers;
- A1 local development stays on the existing workspace host, preferring bwrap
  and allowing direct only through explicit trusted-local policy;
- only imports changed by this narrow runsc slice migrate;
- #416 contracts and package import invariants remain unchanged.

Before D1 planning locks, run a time-boxed validation spike on the intended EU
host. Record systrap/provider availability, namespace/network enforcement,
resource limits, digest-pinned image handling, cleanup after normal/error/abort,
and authenticated capability facts. Any unproved fact remains `unknown` and
fails closed; the spike may reject the proposed provider instead of forcing a
false parity claim.

The full direct/bwrap/Vercel/remote-worker relocation, capability matrix,
`resolveMode` cutover, pure-only binary, and all-mode composer rewrite are
post-v1. A real D1 target, not mocks alone, closes this slice.

## Historical full provider/mode plan — non-dispatchable for v1

Everything below records the superseded pre-#557 provider/package migration.
Do not dispatch it or treat its preflight/current-reality statements as current.

## Historical governing architecture
- [00-global-isa.md](../../../../391/runtime-refactor/architecture/00-global-isa.md) — the zero agent→bash/sandbox value-import invariant; open decision 3 (RESOLVED → boring-sandbox); provisioning-ownership rule.
- [02-boring-bash-environment.md](../../../../391/runtime-refactor/architecture/02-boring-bash-environment.md) — package layers, provider capability matrix, mode↔provider mapping, remote-worker split rules.
- [08-pluggable-agent-surfaces.md](../../../../391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md) — decision 11: the three-package `boring-agent` ← `boring-bash` ← `boring-sandbox` stack and its acyclic import edges.

## Design context
Phase 2 stands up the three-package stack. Concrete providers do **not** land in `boring-bash/providers`; they move to a new dedicated `@hachej/boring-sandbox` package (`packages/boring-sandbox/src/providers`) that imports agent **types only**. `@hachej/boring-bash` (THE RUNTIME — the CHOICE of sandbox) owns runtime-mode resolution (`resolveMode`/`autoDetectMode`/`hasBwrap`), importing boring-sandbox **values** + agent **types**. The acyclic edges are: `sandbox → agent(types)`; `bash → sandbox(values) + agent(types)`; agent imports neither. This is also the first composition cutover (runtime-mode) — every in-repo composer that resolved a mode is migrated in-PR to inject the resolved adapter or import `@hachej/boring-bash/modes`; no old-path re-exports, no host shims. Providers do not move until Phase 1 injection is complete.

**Amendment (2026-07-08):** P2's provider matrix is an input to environment
resolution, not a behavior switch surface. Provider facts (`reported|unknown`
filesystem/exec/image/mount/network facts) are consumed by hosts and
boring-bash to prepare host-owned attachment lifetimes. Internal prepared
handles remain behind `withAuthorizedView`; the host consumes auth-gated
contributions for tools, prompt, readiness, and input assets and
passes only methodless `ResolvedEnvironment[]` projections. Surfaces and later
packs consume the resolved facts; they do not infer authority from
mode/provider labels.

## Verified current repo reality (pre-P2)
- `packages/boring-sandbox/` does not exist yet. `pnpm-workspace.yaml` already includes `packages/*`, so BBP2-000 verifies coverage rather than adding a duplicate workspace pattern unless that file changes.
- `@hachej/boring-bash@0.1.61` currently exports only `.`, `./shared`, and `./server`; `./modes` is added in BBP2-005. `packages/boring-bash/scripts/check-invariants.mjs` currently requires those three exports and scans `packages/agent/src` for `@hachej/boring-bash` value imports.
- `packages/agent/src/server/index.ts` currently re-exports provider and mode values (`createDirectSandbox`, `createBwrapSandbox`, remote-worker client/protocol/workspace, `createVercelSandboxWorkspace`, `autoDetectMode`/`hasBwrap`/`resolveMode`). BBP2-007 deletes those exports with no compatibility re-export.
- The mode adapters in `packages/agent/src/server/runtime/modes/*` depend on helper code that is not a provider file by name: `createNodeWorkspace`/`getNodeWorkspaceHostRoot`/path helpers, `createServerFileSearch`, `copyTemplate`, and provisioning artifact helpers. P2 moves or injects those helpers explicitly so `@hachej/boring-bash/modes` has no value import from `@hachej/boring-agent`.
- `apps/full-app/src/server/worker/*` currently imports remote-worker protocol/provider symbols through `@hachej/boring-agent/server`; BBP2-006 repoints the worker server to `@hachej/boring-sandbox/shared`/`providers` and keeps the worker server app-owned. The current `/internal/health` response is `{ ok: true }`; P2 does not add a capability handshake.

## Deliverables
- package skeleton and exports **[landed via #416: skeleton, shared filesystem-binding contracts, readonly/management company-context operations, fixture provider, leakage/conformance tests]**;
- **scaffold the new `@hachej/boring-sandbox` package** (sandbox management: providers, FUSE-S3 mounts, lifecycle — imports agent **types only**);
- provider capability model + fixed/reported capability facts in `boring-sandbox/shared` only; mode/provider mapping docs; provider facts feed environment resolution and never become user-facing capability truth by themselves;
- move concrete provider implementations (direct, bwrap, vercel-sandbox, remote-worker client) to **`packages/boring-sandbox/src/providers`** (00 open decision 3, RESOLVED; 08 decision 11) — **not** `boring-bash/providers`; this includes provider-bound workspace helpers (`createNodeWorkspace`, `getNodeWorkspaceHostRoot`, remote/vercel workspace factories, path-containment helpers) required by those providers;
- **runtime-mode resolution (`resolveMode`/`autoDetectMode`/`hasBwrap`) lands in `@hachej/boring-bash`** (THE RUNTIME: the CHOICE of sandbox), resolving a mode id to a `@hachej/boring-sandbox` provider value;
- mode-private helpers (`createServerFileSearch`, template copy, provider-adapter artifact helpers) move with `boring-bash/modes` or are injected; no moved mode file may value-import `@hachej/boring-agent`;
- provisioning transition: P2 may leave the pre-existing central engine in
  agent temporarily only because P5 BBP5-002 owns its atomic move. P2 adds no
  new agent provisioning contract/export/dependency. The v1 target is boring-
  bash/server owning engine/runners/fingerprints, host owning orchestration, and
  boring-sandbox owning provider adapters/facts;
- remote-worker split docs: protocol/shared types → `boring-sandbox/shared`, client/provider adapter → `boring-sandbox/providers`, optional server package path;
- provider selection safety: deployed/core/tenant composers fail closed when no
  approved provider is available; `direct` is an explicit trusted-local policy
  choice, never an automatic isolation downgrade;
- remote-worker relocation is reviewed separately from mode/composer cutover;
- one v1 production provider: gVisor `runsc --platform=systrap` on a
  preconfigured worker, with digest-pinned OCI bundle input, per-workspace
  netns/nftables, cgroup/pid/CPU/memory limits, and no broker-secret injection;
  D1/P8 prove it on a real EU target;
- invariant/import boundary: **acyclic** `boring-sandbox → agent(types)`; `boring-bash → boring-sandbox(values) + agent(types)`; agent imports neither;
- migration strategy (v2, strict): **migrate every importer in the same PR** — no type-only old-path exports, no re-export stubs, no host shims that outlive the phase. Intra-phase transitional code carries `// TODO(remove:<bead-id>)` + a deletion bead.
- **Amendment (2026-07-06):** publish-pipeline parity for `@hachej/boring-sandbox` (BBP2-009, before BBP2-005): before `@hachej/boring-bash` gains a value dependency on `@hachej/boring-sandbox`, add sandbox to all five publish lists (`scripts/audit-publish-manifests.mjs`, version bump, CI versioning, CI publish, release workflow), ordered before `packages/boring-bash`, and bring it onto the current version cohort (it sits at `0.1.61` vs the `0.1.64` cohort). Until then, the published boring-bash must not depend on sandbox.
- Do not move providers until Phase 1 injection is complete.

## Exit criteria
- package builds; no import cycle; current apps still compile after same-PR importer migration (no old-path re-export, no host shim); landed #416 contracts unchanged (governance consumers #476–#501 keep working).
- hardened runsc provider passes lifecycle/preflight/policy conformance and one
  preconfigured real EU worker proves systrap, netns/nftables, resource limits,
  digest-pinned image, and secret absence; mocks alone do not close P2 v1.

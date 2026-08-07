---
github: https://github.com/hachej/boring-ui/issues/1123
issue: 1123
state: needs-owner-approval
updated: 2026-08-07
flag: flag:BORING_ENV_MOUNTS (server-side; exec grants default-deny regardless)
track: owner
---

# gh-1123 — executable environments: per-agent fs + exec grants

## Problem

Agents get exactly one executable root. The Workspace+Sandbox pairing
invariant realizes the primary `user` filesystem in Bash; every other
filesystem binding is deliberately file-tools-only
(`docs/PROJECT_ENVIRONMENT_MODEL.md`, "Environment Mount: separate execution
realization"). The owner-ratified direction (2026-08-07, #970 review): an
agent should have access to **various filesystems AND execution, configurable
per agent** — e.g. a client agent with its own readonly `knowledge/` fs plus a
scratch exec workspace, grants-configured per client.

Today the single-root assumption is hard-coded end to end:

- `SandboxProviderCreateContextV1` takes one `workspaceRoot`; no mount list
  (`packages/boring-sandbox/src/shared/providerV1.ts`).
- `buildBwrapArgs` emits exactly one `--bind <root> /workspace --chdir
  /workspace` (duplicated byte-identical in `packages/boring-sandbox/src/
  providers/bwrap/` and `packages/boring-bash/src/agent/runtime/`).
- Every `RuntimeBashStrategy` spawn hook takes one root; `buildBwrapArgs`
  always emits `--chdir /workspace` (the `local-sandbox` strategy's
  `sandboxRoot` option feeds only `bwrapSpawnHook`'s env).
- `RuntimeFilesystemBinding` (`packages/agent/src/server/runtime/mode.ts`)
  has no `mountable`/materialization field and no `sourceRoot` — bindings are
  pure logical file-ops, and #970's multi-root readonly projection engine is
  a *virtual* union with no single real directory to bind.
- No grants vocabulary exists in code: zero hits for
  `environment.bash.execute` anywhere. The per-agent enforcement seam exists
  (`createAgentHostRuntimeCapabilityProjection.resolveBinding`, fed by the
  #1114 fleet/policy config on main), but nothing rides it yet.

## Solution

### The Environment abstraction

An **Environment** is the leased execution realization an agent binding runs
in. It already half-exists: `EnvironmentLease` (`packages/agent/src/server/
agent-host/environmentLease.ts`) refcounts one provider-created
`WorkspaceSandboxPairV1` per resolved scope. This epic widens what a lease
realizes, without breaking the pairing invariant:

```text
Environment = primary workspace root            (unchanged, pairing invariant)
            + mount set: N extra roots          (each an authorized binding:
              at logical paths, ro/rw            direct real dir OR live view)
            + exec capability                    (explicit per-agent grant)
            + lease lifecycle                    (refcounted lease, keyed by
                                                 mount set; #1083 attaches later)
```

**Lease keying (the load-bearing decision).** `EnvironmentLeaseManager`
keys records by `[workspaceScopeId, placementIdentity]` and shares one
sandbox across agent bindings. If mounts stayed per-agent inputs to a
shared sandbox, an ungranted agent leasing after a granted one would see
its mounts — a grant bypass. Therefore: the **resolved mount set is part of
the lease identity** (folded into `placementIdentity`). Agents whose
grants resolve to different mount sets get different environments; sharing
happens only on identical mount sets. Grant enforcement is structural, not
advisory.

**Reclamation.** Today `EnvironmentLeaseManager.release()` only decrements
`references`; on the common path a zero-reference record is never disposed
(disposal happens only via `retire()`/`close()`). Acceptable with one
record per workspace scope; unacceptable once mount sets fork records —
every distinct grant-set would strand a live sandbox until host shutdown,
and grant edits would strand the old record forever. This epic adds
disposal-at-zero (or idle-timeout eviction with an explicit bound) for
mount-forked records. Owner decision 5 (fork-over-fail) is ratifiable only
together with this reclamation story.

**Fingerprint reconciliation.** `createEnvironmentProvisioningFingerprint`
documents that contribution grants are deliberately excluded so grant-only
changes share the lease (`runtimeScopeIdentity.ts:61-65`). The mount set is
not a grant: it is Environment-mutating identity derived *from* grants.
It enters `placementIdentity` (the lease key), and therefore flows into the
fingerprint too, which already digests `placementIdentity` — key and
fingerprint stay consistent by construction. The invariant's wording is
amended, not violated: grant changes that leave the resolved mount set
unchanged still share the lease. `AGENT_SHARED_ENVIRONMENT_UNAVAILABLE`
keeps its current meaning (same-key fingerprint mismatch); differing mount
sets never reach it because their keys already differ.

Rules (amending `PROJECT_ENVIRONMENT_MODEL.md`, not repealing it):

1. `mount requires authorization` stays the only valid direction. A mount is
   derived from an existing filesystem binding the agent already holds; the
   mount adds physical visibility, never new logical access.
2. Two mount kinds (owner direction 2026-08-07): `mountKind: 'direct'`
   binds a static real directory (`materialization.sourceRoot` — knowledge/,
   fixtures; zero-cost path); `mountKind: 'view'` mounts a **live
   Operations→FUSE bridge** over a virtual/computed binding. No copy/sync
   engine is ever built — a view mount routes every read through the
   adapter at access time.
3. Exec is an explicit per-agent grant (`environment.bash.execute`), never
   inferred from read/write access. Default deny.
4. Readonly bindings mount `ro`; a binding never mounts wider than its
   file-ops access. View mounts are readonly in v1 (EROFS on write).
5. Actor-varying resources never enter a **shared** execution namespace —
   unchanged. They may now mount because environments fork per
   agent/grant-set (lease keying below): each environment's view mount
   evaluates as exactly its agent's identity, never a blended one.

### View mounts: the Operations→FUSE bridge

A small FUSE filesystem whose `read`/`readdir`/`getattr` callbacks invoke
the `RuntimeFilesystemBinding` operations vtable live, mounted on the host
and bind-mounted into the bwrap sandbox at `/mnt/<fsid>`. Properties:

1. **Adapter stays the policy enforcement point.** Every bash read routes
   through the same operations the file tools use — the "mount requires
   authorization" invariant is preserved mechanically; no policy is baked
   into copies and nothing goes stale.
2. **Actor identity.** The FUSE mount is per-environment, and environments
   already fork per agent/grant-set via the lease key — each mount is
   constructed with its agent's binding context and evaluates as that
   agent.
3. **Readonly in v1.** Write/`mknod`/`setattr` callbacks return `EROFS`.
4. **Lifecycle.** Mounted at lease create; unmounted at the
   disposal-at-zero/reclamation point (the r2 lease work) — reclamation is
   now also resource cleanup, not just record hygiene.
5. **Failure honesty.** Adapter error → `EIO`; adapter latency is now
   filesystem latency. SharePoint-class adapters will be slow — accepted
   and visible, not hidden behind caches in v1.
6. **Dependency ground-truth** (checked 2026-08-07): upstream `fuse-native`
   is dormant (2.2.6, last published 2022-05); `@cocalc/fuse-native` is an
   actively maintained fork (2.4.3, 2025-07) — viable, but a
   single-maintainer N-API binding. Owner-visible risk: if it fails us
   (Node ABI churn, prebuild rot), the fallback is a userspace NFS-lite/9p
   server mounted on the host, or a small Go/Rust FUSE sidecar speaking the
   operations vtable over a local socket.
7. **Host requirements.** `fuse3` + `fusermount3`, `/dev/fuse` available in
   the deployment container (device passthrough for containerized hosts),
   and verified interaction with bwrap user namespaces (bind-mounting a
   host FUSE mount into the sandbox; same-uid access, `allow_other` not
   expected but verified in the spike).

### Grants model (healio vocabulary, subset built here)

Per-agent trusted policy (rides the #1114 fleet/policy config; shares the
#1087 per-agent policy seam) gains:

- `environment.bash.execute` — scoped per filesystem id: the agent may run
  commands with that filesystem's mount visible/selected. Grant on the
  primary `user` fs reproduces today's behavior.
- `environment.mount.manage` — reserved name only in this epic (see
  Non-goals).

Enforcement points (two, both structural):

1. **Mount computation** — environment scope resolution: the agent's grants
   resolve to a mount set *before* the lease is acquired; the set enters the
   lease key and the provider create context. An ungranted agent's
   environment simply never contains the mount.
2. **Tool assembly** — `buildAgentComposition` (which unconditionally
   includes bash via `buildHarnessAgentTools` today) gates bash-tool
   presence on the exec grant. `resolveBinding` only returns the
   already-built composition, so the gate lives in composition, not there.

v1 gates **the bash tool only**. Other exec-shaped surfaces
(`SandboxProvisioningOperationsV1.exec`, provisioning hooks,
`runtimeScope.extraTools`, pi extensions) are not gated by this grant;
they are host-configured, not agent-requested, and mounts are already
absent from ungranted agents' environments via point 1. This scoping is
stated, not hidden. `filesystem.read/write`, `git.*`, `network.egress`,
`secret.use` from the grants design are out of scope here (bindings + #971
already govern fs access).

### Composition with existing seams

- **Binding contract**: `RuntimeFilesystemBinding` gains an optional
  `materialization?: { sourceRoot: string }` (server-private, never wired to
  the browser catalog) and the shared `FilesystemCatalogEntry.capabilities`
  vocabulary gains `'execute'` so the UI can show which fs an agent can exec
  in. Bindings declare `mountKind`: `'direct'` requires
  `materialization.sourceRoot`; `'view'` requires only the operations
  vtable. This dissolves r2's "zero mountable bindings until #1107":
  governance `company_context` (a per-operation `mkdtemp` projection,
  actor-varying — never direct-mountable) is **demo-viable as a live view
  mount today**, since the per-environment bridge calls its adapter with
  the agent's own identity. #1107 `knowledge/` folders remain the first
  direct-mount candidates.
- **Provider seam**: `SandboxProviderCreateContextV1` gains optional
  `mounts?: readonly { sourceRoot; logicalPath; access: 'ro'|'rw' }[]` and
  `ProviderCapabilities` gains `mounts: boolean`. Providers that don't
  declare it (direct, vercel-sandbox, remote-worker) reject a non-empty
  mount list at create time with a stable error code (fail closed). bwrap
  implements it; the two byte-identical `buildBwrapArgs` copies are
  deduplicated first. Mount hygiene (defined by this epic — there is no
  existing discipline to reuse; the nearest prior art, governance
  `assertInsideRoot`, is check-then-use-original, exactly the TOCTOU shape
  to avoid):
  - every `sourceRoot` is realpath-resolved and containment-checked **once
    at lease create**, and the **resolved** paths are what every subsequent
    exec binds — bwrap re-spawns per command, so per-exec re-resolution
    would reopen the race. Residual risk stated: `--bind` itself follows
    symlinks at mount time; the resolved-path rule bounds it to
    lease-create time.
  - `logicalPath` lives in a dedicated namespace **outside `/workspace`**
    (default `/mnt/<fsid>`); mounts under the primary rw root are
    forbidden, avoiding bind shadowing and ro-under-`HOME` breakage
    (`--setenv HOME /workspace` stays).
  - the existing out-of-workspace `dirname(workspaceRoot)/.boring-agent`
    bind is brought under the same resolved-once rule.
  - view mounts reuse the same provider contract unchanged: the bridge
    exposes a host FUSE mountpoint directory, which enters `mounts[]`
    exactly like a direct `sourceRoot` (providers never learn about FUSE).
- **Pairing invariant**: untouched. The pair is still created atomically by
  `SandboxProviderV1.create`; mounts are inputs to that one create, not a
  second realization path. `providerAdapter.ts` keeps owning bundle assembly.
- **Shell routing (#971 base)**: bash tool gains cwd selection across the
  primary root + mounted logical paths, and cross-root path qualification so
  readonly-mount writes fail with the same stable-code errors #971 uses.
- **SBX1/gVisor**: runsc is qualification-only today; remote-worker executes.
  The mount list rides the same provider contract, so SBX1 inherits it when
  its provider lands (`docs/issues/808/sbx1-own-cloud-provider-plan.md`);
  no gVisor work in this epic.
- **#1083 (pane-owned process lease)**: adjacent, not included. This epic
  widens the lease key by mount set but keeps the lease lifecycle contract;
  #1083 later attaches pane-owned processes to the same lease vocabulary.

## Today / Delta

| Piece | Today | Delta |
|---|---|---|
| Virtual/computed bindings | file-tools-only by design | live-mountable via Operations→FUSE bridge (`mountKind: 'view'`, ro) |
| Mounts in sandbox | one `--bind` of primary root (bwrap); one `workspaceRoot` in provider ctx | `mounts[]` in create context; `ProviderCapabilities.mounts`; bwrap N binds |
| Binding materialization | implicit (governance projection dir happens to be real) | explicit `materialization.sourceRoot`; virtual stays file-ops-only |
| Exec policy | bash offered whenever runtime has it; no per-agent gate | `environment.bash.execute` per fs in agent policy; default deny for non-primary |
| Shell cwd | hardcoded `/workspace` single root | cwd selection across primary + mounts; cross-root qualification |
| Grants vocabulary | none in code | `environment.bash.execute` (built), `environment.mount.manage` (reserved) |
| bwrap args builder | duplicated in 2 packages | single shared implementation |

## Decisions

- **Environment = lease + mount set + exec grants**, realized inside the
  existing single `SandboxProviderV1.create` call. No second realization
  path, no new top-level runtime object.
- **Mountability is a declared capability of a binding**
  (`materialization.sourceRoot` present), never inferred from probing.
- **Default deny**: no exec grant → no change from today except the primary
  fs, which is implicitly granted for compat (recorded, not silently
  special-cased: fleet policy compiler materializes the implicit grant).
- **Mount set is lease identity**: grants → mount set → lease key. Two
  agents share an environment only when their resolved mount sets match;
  otherwise the lease manager forks environments (no
  `AGENT_SHARED_ENVIRONMENT_UNAVAILABLE` hard-fail for mount-set
  differences — see owner decision 5).
- **bwrap-first**: v1 providers = bwrap (full support); direct/host,
  vercel-sandbox, and remote-worker reject mounts (capability
  `mounts: false`). Pure/readonly modes have no exec at all — unchanged.
- **Mount namespace**: `/mnt/<fsid>`, never under `/workspace` (see owner
  decision 3 for confirmation — it is agent-visible surface).
- **ro-only named mounts in v1**: `access: 'rw'` is contract-supported but
  only the primary root uses rw. rw views are out of scope entirely
  (owner-ratified); rw direct mounts are a follow-up issue, not a v1 gate.
- **Two mount kinds, one provider contract**: `mountKind: 'direct' |
  'view'`; the view bridge lives above the provider seam and hands it an
  ordinary host directory.
- **FUSE dependency**: `@cocalc/fuse-native` (maintained fork) with the
  sidecar/9p fallback recorded as owner-visible risk (view-bridge section,
  property 6).
- Sequencing blockers: **all slices start after #971 (or its slim rebuild,
  branch `review/942-readonly-slim`, currently being rebuilt) merges** —
  #971 touches every file the early slices touch, so nothing lands before
  it. #1107 approval gates only the real knowledge direct mounts; slice 6's
  fixture + live `company_context` view keep the epic independent of #1107
  delivery.

## Flag / Abstraction

- Needed?: yes — mount plumbing crosses provider + bash + policy.
- Path: `BORING_ENV_MOUNTS=1` gates mount realization; exec grants are
  policy-data (default deny) so they need no flag of their own.
- Rollback: unset flag → mount resolution yields the empty set for every
  agent (empty set encodes as *absence* in `placementIdentity`, so lease
  keys are byte-identical to pre-epic keys — tested) **and** the exec-grant
  gate is ignored (bash offered exactly as today) — flag off is
  byte-for-byte today's behavior, no granted-but-unmounted half state and
  no lease-bucket split. Binding `materialization` is inert metadata.

## Staged slices

1. **Contract + provider substrate** — `materialization` on
   `RuntimeFilesystemBinding` (reconciling the duplicate shape in
   `packages/boring-bash/src/agent/runtime/types.ts`), `'execute'` catalog
   capability, `mounts` on provider context + capabilities (all optional),
   amend `PROJECT_ENVIRONMENT_MODEL.md`; dedupe `buildBwrapArgs`; implement
   N-mount bwrap with the resolve-once hygiene rules above and the
   `/mnt/<fsid>` namespace rule; fail-closed rejection in
   direct/vercel-sandbox/remote-worker; conformance + bwrap-args snapshot
   tests (incl. symlinked-sourceRoot resolution). Behind flag. Also
   reconcile the latent `sandboxRoot` option (it lives on the
   `local-sandbox` strategy and feeds `bwrapSpawnHook`'s env, not
   `buildBwrapArgs`, which always `--chdir /workspace`): honor or delete.
2. **Environment scope + lease plumbing** — carry the resolved mount set
   through `AgentHostEnvironmentScope`/`ResolvedEnvironmentScope` →
   `EnvironmentLeaseManager` (mount set folded into `placementIdentity`) →
   `ModeContext`/`RuntimeModeAdapter.create` → provider context; add
   disposal-at-zero / idle eviction for mount-forked records. Encoding
   rule: an empty mount set contributes **nothing** to `placementIdentity`
   (no `[]` suffix), so flag-off and pre-epic keys are byte-identical —
   with a test, else flag-off splits every lease bucket. Tests: different
   mount sets ⇒ distinct leases; identical sets share; zero-ref forked
   records reclaimed.
3. **Exec grants** — `environment.bash.execute` in fleet/agent policy
   schema; bash-tool gating in `buildAgentComposition`; mount-set
   derivation from grants; implicit primary-fs grant materialized; tests
   for default-deny and grant-scoped tool assembly.
4. **Operations→FUSE view bridge** — spike first (host-requirements +
   bwrap-bind verification, `@cocalc/fuse-native` viability; fallback
   decision point if rotten), then the bridge: readdir/getattr/read →
   vtable, EROFS writes, EIO on adapter error, mount at lease create /
   unmount at reclamation. Tests: bridge unit tests against a fake vtable;
   sandboxed `cat` through a live adapter.
5. **Shell routing** (deferrable) — multi-root cwd selection + cross-root
   qualification in boring-bash on the #971 substrate; readonly mounts
   produce #971's stable denial codes. Deferrable because the demo works
   from `/workspace` via `ls /mnt/<fsid>` without cwd selection.
6. **Demo/e2e** — agent with the primary scratch workspace, a direct-mount
   fixture, and **one live view mount** (governance `company_context`
   through its adapter); e2e proves: shell reads the view at
   `/mnt/company_context` with agent-scoped content, write returns EROFS,
   ungranted sibling agent gets neither mount nor bash for that fs, view
   unmounts at lease reclamation. Swaps in #1107 `knowledge/` direct
   mounts when available.

## Non-goals

- Runtime mount management (`environment.mount.manage` stays reserved): no
  API/UI to add/remove mounts mid-lease; mount set is fixed at lease create.
- gVisor/runsc execution provider, SBX1 fleet work, vercel-sandbox mounts.
- `network.egress` / `secret.use` / `git.*` grants.
- Per-actor mounts into shared namespaces (still forbidden).
- #1083 pane-owned process lifecycle (adjacent epic).
- Any copy/sync engine for virtual filesystems — explicitly rejected
  (owner): copies fork state, bake in policy, and go stale. Views mount
  live or not at all.
- rw view mounts; caching layers inside the view bridge.

## Test Seams

- Highest public seam: provider conformance suite
  (`packages/boring-sandbox/src/providers/__tests__/conformance/`) +
  `dualTargetParity` contracts for mount behavior; capability-projection
  tests for grants; boring-bash tool tests for cwd/qualification.
- Existing prior art: governance `filesystemBindings` projection tests;
  `environmentLease.test.ts` (extended for forking + reclamation). No
  reusable mount-validation prior art exists — slice 1 defines it.
- Avoid testing: bwrap binary internals; re-testing #971 authorization paths
  beyond the new cross-root cases.

## Acceptance

- A fleet-configured agent with an exec grant on a mounted ro fs (direct or
  view) can `ls`/`cat` it under `/mnt/<fsid>` inside bwrap and cannot write
  it (view writes → EROFS); an agent without the grant has identical
  file-tool access and no exec visibility of that fs.
- A live view mount serves agent-scoped adapter content with no copies;
  adapter failure surfaces as EIO, and the mount disappears at lease
  reclamation.
- Providers without `mounts` capability reject non-empty mount lists with a
  stable error code.
- Flag off ⇒ byte-identical bwrap args to today (snapshot test).

## Proof

- Exact commands: `pnpm -C packages/boring-sandbox test` (conformance +
  bwrap args snapshot), `pnpm -C packages/boring-bash test`,
  `pnpm typecheck:changed`, slice-5 e2e run in workspace-playground.
- Screenshot/demo: playground session showing the agent shell reading a
  live `company_context` view at `/mnt/company_context` + EROFS on write +
  denied ro-mount write; catalog UI showing `execute` capability badge.

## Owner decisions required

Resolved by owner direction (2026-08-07, r3): view mounts in scope, no
copy/sync engine, rw views out. Previously review-endorsed and now treated
as decided: ro-only named mounts in v1; fail-closed host/direct mode; exec
grant per fs with one shared shell image per environment. Remaining open:

1. **Mount namespace**: `/mnt/<fsid>`, mounts under `/workspace` forbidden
   (avoids bind shadowing and ro-under-HOME breakage). Agent-visible
   surface — confirm the path convention.
2. **Environment forking UX** (ratifiable only with the reclamation story
   above): agents with different mount sets fork into separate
   environments — separate sandboxes/cost — instead of hard-failing with
   `AGENT_SHARED_ENVIRONMENT_UNAVAILABLE`. Confirm fork-over-fail.
3. **FUSE dependency risk**: accept `@cocalc/fuse-native` (maintained
   single-maintainer fork) as the v1 bridge, with the Go/Rust sidecar or
   userspace 9p/NFS-lite server as the fallback if the Node binding proves
   unmaintainable? Slice 4's spike is the checkpoint.
4. **Remote-worker parity timing**: v1 rejects mounts on remote-worker. Is
   bwrap-only acceptable for the killer demo, or does the productionized
   agency track need remote-worker mounts in this epic (adds protocol work
   to `remoteWorkerProtocolV1`)?

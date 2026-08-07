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
- Every `RuntimeBashStrategy` spawn hook takes one root; bwrap hardcodes
  inner cwd `/workspace` (`packages/boring-bash/src/agent/tools/harness/
  bashToolOptions.ts`).
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
            + mount set: N extra roots          (each an authorized, MATERIALIZED
              at logical paths, ro/rw            filesystem binding)
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

Rules (amending `PROJECT_ENVIRONMENT_MODEL.md`, not repealing it):

1. `mount requires authorization` stays the only valid direction. A mount is
   derived from an existing filesystem binding the agent already holds; the
   mount adds physical visibility, never new logical access.
2. Only **materialized** bindings (backed by one real directory) are
   mountable. Virtual/projected unions (#970's multi-root projection) remain
   file-tools-only. This is an explicit capability on the binding, not an
   inference.
3. Exec is an explicit per-agent grant (`environment.bash.execute`), never
   inferred from read/write access. Default deny.
4. Readonly bindings mount `ro`; a binding never mounts wider than its
   file-ops access.
5. Actor-varying resources (per-user `company_context`) never enter a shared
   execution namespace — unchanged.

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
  in. The governance `company_context` projection dir is the one existing
  materialized binding; #1107's `knowledge/` folders are the next.
- **Provider seam**: `SandboxProviderCreateContextV1` gains optional
  `mounts?: readonly { sourceRoot; logicalPath; access: 'ro'|'rw' }[]` and
  `ProviderCapabilities` gains `mounts: boolean`. Providers that don't
  declare it (direct, vercel-sandbox, remote-worker) reject a non-empty
  mount list at create time with a stable error code (fail closed). bwrap
  implements it; the two byte-identical `buildBwrapArgs` copies are
  deduplicated first. Mount hygiene: every `sourceRoot` is host-side
  realpath-resolved and containment-checked before emitting bind args
  (symlinked sourceRoots must not bind through), and `logicalPath` lives in
  a dedicated namespace **outside `/workspace`** (default `/mnt/<fsid>`) —
  mounts under the primary rw root are forbidden, avoiding bind shadowing
  and ro-under-`HOME` breakage (`--setenv HOME /workspace` stays).
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
  only the primary root uses rw until an owner decision (below) opens it.
- Sequencing blockers per issue: #971 merged to main, #1107 approved (it
  defines the knowledge/package filesystems this epic mounts). Slices 1–3
  can land before those; slices 4–6 rebase on them (slice 6 has a fixture
  fallback if #1107 slips).

## Flag / Abstraction

- Needed?: yes — mount plumbing crosses provider + bash + policy.
- Path: `BORING_ENV_MOUNTS=1` gates mount realization; exec grants are
  policy-data (default deny) so they need no flag of their own.
- Rollback: unset flag → mount resolution yields the empty set for every
  agent (so lease keys re-converge and providers receive no mounts) **and**
  the exec-grant gate is ignored (bash offered exactly as today) — flag off
  is byte-for-byte today's behavior, no granted-but-unmounted half state.
  Binding `materialization` is inert metadata.

## Staged slices

1. **Contract + docs** — `materialization` on `RuntimeFilesystemBinding`
   (reconciling the duplicate shape in
   `packages/boring-bash/src/agent/runtime/types.ts`), `'execute'` catalog
   capability, `mounts` on provider context + capabilities (all optional),
   amend `PROJECT_ENVIRONMENT_MODEL.md`. No behavior change; typecheck +
   existing conformance stays green.
2. **Provider substrate** — dedupe `buildBwrapArgs` (and resolve its latent
   `sandboxRoot` parameter: honor it or delete it), implement N-mount bwrap
   with realpath + containment + overlap validation (reusing #970's
   `assertMounts` discipline) and the `/mnt/<fsid>` namespace rule,
   fail-closed rejection in direct/vercel-sandbox/remote-worker, conformance
   + bwrap-args snapshot tests (incl. symlinked-sourceRoot rejection).
   Behind flag.
3. **Environment scope + lease plumbing** — carry the resolved mount set
   through `AgentHostEnvironmentScope`/`ResolvedEnvironmentScope` →
   `EnvironmentLeaseManager` (mount set folded into the lease key) →
   `ModeContext`/`RuntimeModeAdapter.create` → provider context. Tests:
   different mount sets ⇒ distinct leases; identical sets share.
4. **Exec grants** — `environment.bash.execute` in fleet/agent policy
   schema; bash-tool gating in `buildAgentComposition`; mount-set
   derivation from grants; implicit primary-fs grant materialized; tests
   for default-deny and grant-scoped tool assembly.
5. **Shell routing** — multi-root cwd selection + cross-root qualification in
   boring-bash on the #971 substrate; readonly mounts produce #971's stable
   denial codes.
6. **Demo/e2e** — agent with a ro-mounted knowledge fs + primary scratch
   workspace, grants-configured in fleet policy; e2e proves: file tools see
   both, shell sees both at declared paths, write into ro mount denied,
   ungranted sibling agent gets no mount and no bash for that fs. Uses a
   plain server-configured materialized binding as fixture so acceptance
   does not hard-depend on #1107 delivery; swaps to #1107 `knowledge/`
   when available.

## Non-goals

- Runtime mount management (`environment.mount.manage` stays reserved): no
  API/UI to add/remove mounts mid-lease; mount set is fixed at lease create.
- gVisor/runsc execution provider, SBX1 fleet work, vercel-sandbox mounts.
- `network.egress` / `secret.use` / `git.*` grants.
- Per-actor mounts into shared namespaces (still forbidden).
- #1083 pane-owned process lifecycle (adjacent epic).
- Mounting virtual/projected filesystems by materializing copies — explicitly
  rejected; copies would fork state and break the authorization derivation.

## Test Seams

- Highest public seam: provider conformance suite
  (`packages/boring-sandbox/src/providers/__tests__/conformance/`) +
  `dualTargetParity` contracts for mount behavior; capability-projection
  tests for grants; boring-bash tool tests for cwd/qualification.
- Existing prior art: #970 `assertMounts`/containment tests; governance
  `filesystemBindings` projection tests; `environmentLease.test.ts`.
- Avoid testing: bwrap binary internals; re-testing #971 authorization paths
  beyond the new cross-root cases.

## Acceptance

- A fleet-configured agent with an exec grant on a mounted ro knowledge fs
  can `ls`/`cat` it under its logical path inside bwrap and cannot write it;
  an agent without the grant has identical file-tool access and no exec
  visibility of that fs.
- Providers without `mounts` capability reject non-empty mount lists with a
  stable error code.
- Flag off ⇒ byte-identical bwrap args to today (snapshot test).

## Proof

- Exact commands: `pnpm -C packages/boring-sandbox test` (conformance +
  bwrap args snapshot), `pnpm -C packages/boring-bash test`,
  `pnpm typecheck:changed`, slice-5 e2e run in workspace-playground.
- Screenshot/demo: playground session showing dual-fs agent shell listing
  both roots + denied write; catalog UI showing `execute` capability badge.

## Owner decisions required

1. **rw named mounts in v1?** Contract supports `rw`; plan ships ro-only for
   named filesystems. Open rw now (scratch/exec workspaces beyond primary)
   or defer to a follow-up issue?
2. **Host/direct mode**: plan fail-closes mounts+exec-grants outside bwrap.
   Acceptable that host-mode (dev laptops, `{kind:'host'}`) gets no
   multi-fs exec in v1, or must host mode approximate mounts (no
   confinement) for local DX?
3. **Mount namespace**: plan mounts named filesystems at `/mnt/<fsid>` and
   forbids mounts under `/workspace` (avoids bind shadowing and
   ro-under-HOME breakage). This is agent-visible surface — confirm the
   path convention.
4. **Grant granularity confirmation**: issue says exec "per fs". Plan scopes
   `environment.bash.execute` per filesystem id (mount visibility + cwd
   eligibility) with one shared shell process image per environment — i.e.
   a granted shell can *see* every granted mount simultaneously. Confirm
   that's the intent vs. isolated per-fs shells.
5. **Environment forking UX**: agents with different mount sets fork into
   separate environments (separate sandboxes, separate resource cost)
   instead of hard-failing with `AGENT_SHARED_ENVIRONMENT_UNAVAILABLE`.
   Confirm fork-over-fail as the product behavior.
6. **Remote-worker parity timing**: v1 rejects mounts on remote-worker.
   Is bwrap-only acceptable for the killer demo, or does the productionized
   agency track need remote-worker mounts in this epic (adds protocol work
   to `remoteWorkerProtocolV1`)?

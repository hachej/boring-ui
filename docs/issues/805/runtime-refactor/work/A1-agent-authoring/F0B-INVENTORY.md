# F0b — current-main consumer, provider, publication, and migration inventory

Date: 2026-08-22 · Repo: boring-ui-v2 @ main `31361f157` · Bead: `wt-391-forward-step1a-current-xn9.6`

Method: every claim below was checked against a **clean git worktree**
(`.worktrees/weekend-f0b-inventory`, branch `weekend/f0b-inventory`, HEAD =
`31361f157`), not the primary checkout — the primary checkout at
`~/projects/boring-ui-v2` currently carries **untracked files from an
in-flight #1123 slice** (`packages/boring-sandbox/src/providers/bwrap/resolveEnvironmentMounts.ts`,
`packages/boring-sandbox/src/shared/mounts.ts`, `packages/boring-sandbox/src/shared/capability.ts`,
`packages/boring-bash/src/server/routes/filesystems.ts`, etc. — none tracked
at HEAD; `git cat-file -e HEAD:<path>` fails for all of them). A first grep
pass against the primary checkout produced false positives for the
environment-mount contract before this was caught. **Any future refresh of
this inventory must run from a clean worktree, not the primary checkout.**

This inventory is the F0b deliverable per the bead: it reconciles the F0a
replacement graph (`F0A-PLAN-PROOF.md`) against what main actually contains
today, folding in three parallel realities the graph (cut 2026-07-21) never
saw. It supersedes no ratified decision; it is evidence only.

---

## 1. Consumers of agent-host / fleet APIs

| Consumer | File | Calls | Notes |
| --- | --- | --- | --- |
| Workspace app-server composition root | `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`, `packages/workspace/src/app/server/index.ts` | `resolveDefaultAgentFleet`, `loadConfiguredAgentFleet` (transitively) | Primary in-process fleet composition; wires embedded gateway + leases. |
| Core (web) | `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` | `resolveDefaultAgentFleet` | Independent Workspace consumer per Decision-28 invariant 3; does not route through CLI. |
| CLI hub | `packages/cli/src/server/modeApps.ts` | `resolveDefaultAgentFleet` | Independent consumer; same fleet loader as Workspace/Core. |
| workspace-playground (dev/demo app) | `apps/workspace-playground/src/server/factoryAgents.ts`, `apps/workspace-playground/src/server/dev.ts`, `apps/workspace-playground/src/eval/run.ts` | `loadConfiguredAgentFleet` directly | Used for local fleet dev/eval; gated by `BORING_AGENT_FLEET`. |
| Agent package itself | `packages/agent/src/server/index.ts`, `packages/agent/src/server/agentDefinition/resolveDefaultAgentFleet.ts`, `packages/agent/src/server/agentDefinition/loadConfiguredAgentFleet.ts` | defines both | Loader reads `.agents/factory/fleet.yaml` + `policy.yaml`. |

No other package (plugins, boring-bash, boring-sandbox) calls the fleet
loader directly — plugins consume the agent-host through the Workspace
composition root's tool/gateway registries
(`packages/workspace/src/shared/plugins/uiBridgeRegistry.ts`,
`packages/workspace/src/server/ui-control/tools/uiTools.ts`), not the fleet
API.

### Fleet loader internals (F3a substance)

- `loadConfiguredAgentFleet()` reads `.agents/factory/fleet.yaml` (roster,
  skill-digest pins) + `.agents/factory/policy.yaml` (model tier policy),
  fail-closed per seat.
- Stable error codes confirmed in `packages/agent/src/shared/error-codes.ts`:
  `AGENT_FLEET_SEAT_PERSONA_INVALID`, `DEFAULT_AGENT_TYPE_UNKNOWN_SEAT`,
  `WORKSPACE_TYPE_IMMUTABLE`.
- Roster: three seats (`.agents/factory/orchestrator`, `.agents/factory/triage`,
  `.agents/factory/worker` exist as persona package directories on disk;
  `fleet.yaml` names them owner-ratified 2026-08-10, gh-1187 S0). Deferred
  seats (`concierge`, `reviewer`, `auditor`, `beadle`) are test fixtures only,
  not live packages.
- **Owner**: F3a (`.12`).

---

## 2. Sandbox / Environment providers

| Piece | File(s) | State |
| --- | --- | --- |
| Provider substrate (v1 contract) | `packages/boring-sandbox/src/shared/providerV1.ts`, `providerMatrix.ts`, `runtimeIsolation.ts`, `capability.ts` | All present at HEAD and exported from `packages/boring-sandbox/src/shared/index.ts`. `capability.ts` here is a pre-existing `ProviderCapabilities` descriptor (fs/exec/watch/search/hardening/sourceOfTruth flags, `SANDBOX_PROVIDER_UNSUPPORTED_REQUIREMENT` et al.) — unrelated to the #1123 grants vocabulary (`filesystem.read/write`, `environment.bash.execute`, …), which does not exist on main. No `mounts.ts` at HEAD. |
| Providers implemented | `packages/boring-sandbox/src/providers/{direct,bwrap,runsc,node-workspace,vercel-sandbox,blaxel,remote-worker}` | All present; `blaxel` (EU-sovereign bridge, #1236, merged 2026-08-12) is the newest. |
| Legacy Agent-owned boundary | `packages/agent/src/server/runtime/modes/providerAdapter.ts` uses `WorkspaceSandboxPairV1` | **Still live** — confirms F2a's "neutralize Agent-owned Sandbox contract" is not started; this is exactly the coupling F2b-ii exists to remove. |
| boring-bash server surface | `packages/boring-bash/src/server/{readonlyProjectionOperations,managementProjectionOperations,agentResourceOperations,runtimeBindingManager}.ts` | Old Decision-26-era path (projection/binding operations), **not** an `EnvironmentService`. No `routes/filesystems.ts` at HEAD (that file is an untracked #1123 artifact in the primary checkout, absent here). |
| Logical binding vocabulary | `packages/boring-bash/src/shared` — `FilesystemId`, `FilesystemAccess` (readonly/readwrite), `FilesystemProjection`, `FilesystemBindingResolver`, `RuntimeBindingManager` | Precursor only; no frozen transport-neutral op set (read/write/edit/list/stat/mkdir/delete/move/find/grep/watch/exec), no `CanonicalFilesystemResolver` (zero hits repo-wide at HEAD). |
| Lease/admission machinery | `packages/agent/src/server/agent-host/environmentLease.ts`, `workspaceAgentLease.ts` (`guardMethods` disposed-binding proxy) | Present; zero hits for `ExecutionGrantBroker` or `ModelCapabilityIssuer` anywhere in the tree. |
| Environment-mount contract (F1a/F1b/F2b-i territory) | — | **Not on main.** `EnvironmentService`, `CanonicalFilesystemResolver`, `ExecutionGrantBroker`, `SANDBOX_PROVIDER_MOUNTS_UNSUPPORTED`, `BORING_ENV_MOUNTS` all return zero hits at HEAD `31361f157`. This is the live code of open PR #1166 (`#1123 feat(env): slice 1 — environment mount contract + provider substrate`, state OPEN, `mergedAt: null`, no merge commit) plus follow-on commits (`4fbcf9d8`, `b052142a8`, `c04869c8b`, `c2ed0d723`) sitting on unmerged branches — confirmed by `git merge-base --is-ancestor <sha> main` returning false for each. |
| **Owner** | F1a/.7, F1b/.8, F2a/.9, F2b-i/.10, F2b-ii/.11 | See CONFLICTS §5. |

---

## 3. Published package entrypoints

Verified from each `package.json` `exports` map at HEAD (not `dist/`
contents, which are gitignored build output):

| Package | Exports at HEAD |
| --- | --- |
| `@hachej/boring-agent` (`packages/agent`) | `.`, `./shared`, `./core`, `./server`, `./server/pi-session-readability`, `./server/agent-host/testing/gatewayConformance`, `./server/agent-host/testing/compositionRouteProof`, `./server/worker`, `./front`, `./front/styles.css`, `./front/artifacts`, `./eval`. **No `./application` entrypoint.** No `AgentApplication.invoke` API (F3a acceptance item). |
| `@hachej/boring-workspace` (`packages/workspace`) | `.`, `./testing`, `./testing/e2e`, `./charts`, `./shared`, `./bridge-client`, `./app/front`, `./app/server`, `./server`, `./runtime-server`, `./events`, `./plugin`, `./globals.css` |
| `@hachej/boring-core` (`packages/core`) | `./server`, `./server/db`, `./app/server`, `./app/front`, `./app/front/styles.css`, `./app/vite`, `./front`, `./front/top-bar-slot`, `./shared`, `./theme.css` (no root `.` export) |
| `@hachej/boring-bash` (`packages/boring-bash`) | `.`, `./shared`, `./server`, `./agent` |
| `@hachej/boring-sandbox` (`packages/boring-sandbox`) | `.`, `./shared`, `./providers`, `./providers/{direct,bwrap,node-workspace,blaxel,vercel-sandbox,runsc,remote-worker}` |

**Missing entrypoint confirmed**: `packages/agent` has no `./application`
export and no grep hit for `AgentApplication` as a public type/class in
`packages/agent/src`. This is an F3a acceptance gap, not yet closed by
#1114/#1202.

---

## 4. DB migrations (packages/core/drizzle)

Full list at HEAD ends at `0024`; the two most recent, both load-bearing for
this epic:

| Migration | Content | Merged via |
| --- | --- | --- |
| `0023_workspace_type_id.sql` | `ALTER TABLE workspaces ADD COLUMN workspace_type_id text DEFAULT 'default' NOT NULL` + regex check constraint | pre-dates this inventory's window; server-controlled, `WORKSPACE_TYPE_IMMUTABLE` error enforces write immutability (`packages/core/src/server/workspaceType.ts`) — observed always `'default'` on main (fixtures/routes). |
| `0024_workspace_default_agent_type_id.sql` | `ALTER TABLE workspaces ADD COLUMN default_agent_type_id text` (nullable, **no NOT NULL**) + regex check constraint | PR #1156, merged 2026-08-10, titled "…(D28 requirement)". |

Confirmed: `0024` is exactly as the audit described — nullable, no forced
default, no data backfill statement in the file. No `F4A-MIGRATION-PROOF.md`
exists anywhere in the repo (checked `find . -iname "F4A-MIGRATION-PROOF.md"`
returns nothing) — the forward/rollback/writer-activation matrix the bead
requires is unrecorded.

**Owner**: F4a (`.13`). Live continuation: open PR #1311
(`[wt-391-forward-xp3s.9] Reconcile persisted default Agents safely`).

---

## 5. CONFLICTS — requires an owner ruling (not resolved here)

Per AGENTS.md hard rule 11 (reconcile architecture proposals with the
ratified plan; never silently supersede a frozen ruling), the following is
reported, not adjudicated:

**F1a (`.7`) / F1b (`.8`) / F2b-i (`.10`) territory collides with the
gh-1123 "executable environments" epic**, which is independently in flight
against the *same* files and problem space:

- gh-1123 issue: "per-agent fs + exec grants (configurable multi-root
  execution)" — state OPEN, sequenced after #970/#971 (binding substrate +
  shell qualification, both on main) and #1107 (agent knowledge/package
  roots, landed).
- Slice 1 = PR #1166, `#1123 feat(env): slice 1 — environment mount contract
  + provider substrate`, OPEN, unmerged. Introduces `resolveEnvironmentMounts`,
  `mounts.ts`, `capability.ts` grant vocabulary
  (`filesystem.read/write`, `environment.bash.execute`,
  `environment.mount.manage`, `git.read/write`, `network.egress`,
  `secret.use`), and the fail-closed `SANDBOX_PROVIDER_MOUNTS_UNSUPPORTED`
  pattern, gated by flag.
- Follow-on unmerged commits on the same line (`b052142a8` "delete
  duplicated buildBwrapArgs, use canonical sandbox implementation extracted
  from #1166", `4fbcf9d8`, `c04869c8b`, `c2ed0d723`) show active rebasing
  against main, i.e. this is a live, moving target, not a stalled branch.
- The F1a/F1b/F2b-i bead bodies (frozen 2026-07-21) describe a
  transport-neutral frozen op contract + `CanonicalFilesystemResolver` +
  `ExecutionGrantBroker` to be built from scratch under this epic's
  ownership. gh-1123's grants model (`environment.bash.execute` per
  filesystem, `mountable` capability flag on `RuntimeFilesystemBinding`) is
  a *different, already-designed* shape for materially the same problem,
  already partially coded and under active review/rebase.
- **Decision needed**: (a) amend F1a/F1b/F2b-i bead bodies to point at
  gh-1123's slices as the authoritative implementation vehicle and re-scope
  the F-series beads to review/acceptance gates only, or (b) keep the
  F-series as the primary spec and require gh-1123 to conform to it before
  merge, or (c) something else the owner rules on. This inventory does not
  choose.

**F5a (`.17`) issuer territory overlaps gh-1082 (BYOK/credentials epic)**:

- gh-1082 issue: "Epic: BYOK tenant keys — salvage 16f.2 vault storage (KMS
  backend)", OPEN.
- `#1137` (BYOK plan r3 + key-scope decision memo, owner-gated) — **merged**
  2026-08-07.
- `#1145` ("[gh-1082 S1] durable credential persistence + externally-anchored
  rollback protection") — **state OPEN, `mergedAt: null`**. (Correction to
  the source audit, which listed this as merged — verified directly via
  `gh pr view 1145`; it is not.)
- `#1164` ("[1082 slice B] pi-derived startup credential registry + vault
  resolver composition") — OPEN.
- None of these implement `ModelCapabilityIssuer` (zero grep hits at HEAD)
  or the Decision-27 hosted-key matrix F5a specifies, but they occupy
  adjacent credential-issuance territory that F5a's acceptance criteria will
  eventually need to compose with or supersede. Flagging for the same
  owner-ruling treatment as F1a/F1b/F2b-i, lower urgency since neither line
  has landed runtime code yet.

---

## 6. Corrections to the source audit found during verification

The audit at
`/tmp/claude-1000/.../scratchpad/recon/X-xn9-audit.md` was the primary input
and is largely accurate; two things changed under direct verification:

1. **PR #1145 is not merged.** The audit's F5a row (line 72) parenthetical
   "#1145 merged" is wrong — `gh pr view 1145` shows `state: OPEN`,
   `mergedAt: null`. Corrected in §5 above.
2. **Grep hygiene**: the audit's claims about the environment-mount
   contract being absent from main are correct, but a first-pass grep
   against the primary checkout (`~/projects/boring-ui-v2`, not this
   worktree) produced false positives for `resolveEnvironmentMounts.ts`,
   `mounts.ts`, and `capability.ts` because that checkout currently holds
   **untracked** files from an unrelated in-flight #1123 branch. All facts
   in this document are re-verified against a clean worktree at HEAD
   `31361f157` (`git cat-file -e HEAD:<path>` and `git merge-base
   --is-ancestor` used to confirm ancestry, not just file presence).

All other spot-checked claims (fleet loader consumers, package exports,
0023/0024 migration content, `WorkspaceSandboxPairV1` still live,
`ModelCapabilityIssuer`/`EnvironmentService`/`CanonicalFilesystemResolver`/
`ExecutionGrantBroker` all absent, PR states for #1114/#1156/#1202/#1236/
#1350/#1310/#1311/#845/#1166) matched the audit exactly.

---

## 7. Bead-owner summary (unowned-path check)

Every code area inventoried above maps to exactly one F-series bead:

| Area | Owner bead |
| --- | --- |
| Fleet loader, seat roster, `./application` entrypoint gap | F3a `.12` |
| Persisted default (`0024`), read-path preference, `workspaceTypeId` inertness | F4a `.13` |
| Session namespacing, registry lock (unbuilt) | F4b `.14` |
| Environment-mount contract, grants, `EnvironmentService` (contested with gh-1123) | F1a `.7` / F1b `.8` / F2b-i `.10` |
| `WorkspaceSandboxPairV1` removal, neutral provider handle | F2a `.9` |
| Consumer migration off old Environment paths | F2b-ii `.11` |
| Workspace single-Agent orchestrator | F3b-i `.15` |
| Two-Agent lifecycle/seam | F3b-ii `.16` |
| Signup intent, hosted issuer (contested with gh-1082) | F5a `.17` |
| Auth hardening / #845 recreation | F5b `.18` |
| CLI independent consumer | F6 `.19` |
| Canonical-fs cross-surface proof | F7 `.20` |

No inventoried path is left without an owner bead. F0a (`.5`) itself remains
bookkeeping-only: PR #889 already satisfies it (merged 2026-07-22); this
document does not re-litigate that finding, only cites it for continuity.

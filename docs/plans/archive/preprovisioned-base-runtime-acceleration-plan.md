# Preprovisioned Base Runtime Acceleration Plan

## Summary

Goal: **workspace boots as fast as possible without compromising correctness**.

Boring should not add a second provisioning system. The existing provider-neutral provisioning flow remains the source of truth:

```text
provisionWorkspaceRuntime() = correctness
```

Preprovisioned base runtimes are only acceleration:


| Start state                 | Startup action                                   | Result          |
| --------------------------- | ------------------------------------------------ | --------------- |
| Plain runtime               | bootstrap + `provisionWorkspaceRuntime()`        | Correct         |
| Preprovisioned base runtime | verify bootstrap + `provisionWorkspaceRuntime()` | Correct, faster |


For Vercel this acceleration is a sandbox snapshot. For local/bwrap it may later be a prepared managed runtime directory. For direct mode it is usually just existing workspace state. Future Docker/Kubernetes providers may use images.

Non-goal for the first implementation: building a full registry, automatic promotion pipeline, or new provider abstraction. Start with Vercel snapshot acceleration plus mandatory fallback.

### Ship Phase 1 first, as its own milestone

The bootstrap commands are currently **broken** on Vercel Node runtimes (bare `pip` with no `python3-pip`, no `--user`, no `sudo` on `dnf`). Fixing that (Phase 1) plus letting the existing provisioning fingerprints skip unchanged reinstalls likely delivers most of the "boot fast, boot correct" win **without any snapshot machinery**.

Therefore: **Phase 1 is a standalone, shippable milestone.** Ship it, measure boot time, and only then decide whether the snapshot acceleration in Phases 2–5 is worth its added complexity. Do not treat Phases 1–5 as a single all-or-nothing arc.

### Key architectural decision: reuse the serve-time runtime path, do not build a parallel one

Base preparation **is not a new code path**. It creates a seed runtime through the *same* `RuntimeModeAdapter` used at serve time, runs the *same* `provisionWorkspaceRuntime()` with the *same* provisioning adapter, then snapshots. This is the single most important design constraint in this plan — it is what guarantees a base can never drift from the real workspace contract, because the base is literally built by the serve path.

Verified wiring this reuses:

- `registerAgentRoutes.ts:382-389` already calls `provisionRuntime({ provisioningAdapter: modeAdapter.createProvisioningAdapter?.(runtimeLayout, modeCtx) })` at serve time.
- `modes/vercel-sandbox.ts:503` already implements `createProvisioningAdapter()`.
- `modes/vercel-sandbox.ts:144-148` already supports creating a runtime **from** a snapshot via `source: { type: 'snapshot', snapshotId }`.

So both directions already exist in code.

### What actually gets written (keep the scope honest)

The "Layer A/B/C" and "two hashes" framing below is *explanation*, not a module count. Do not build three layers and a hash subsystem. The entire net-new surface is:

1. **Fix two shell call sites** (`UV_SETUP_COMMANDS`, `makeInstallCommand`) so Node-runtime bootstrap works. — Phase 1, ships alone.
2. **A few idempotent bootstrap shell lines** run in the seed/workspace (no marker file, no version system — see Layer A).
3. **One env var read inside the vercel mode** (`BORING_AGENT_BASE_RUNTIME`), parsed into a small pointer and turned into a snapshot `source`.
4. **One fallback wrapper at the runtime-binding call site** ("try base source, else plain").
5. **One CI script** that drives the existing create→provision→snapshot sequence and writes the pointer.

Layer B (provisioning) already exists and is reused unchanged. That's the whole change.

## Core invariant

There is one provider-neutral list of runtime contributions. It is consumed by `provisionWorkspaceRuntime()` across every provider, via the `plugins` field of `ProvisionWorkspaceRuntimeOptions` (`provisioning/types.ts:90-91`).

Provider-specific code may bootstrap OS/runtime primitives, but must not invent a separate app materialization path for skills, CLIs, SDKs, or templates.

The preprovisioned base should include app SDKs/CLIs/templates/skills by default, because the goal is fast workspace boot. Workspace startup still runs `provisionWorkspaceRuntime()` so stale or missing app materialization is repaired.

```text
Provider bootstrap
  -> makes provider capable of running provisioning
  -> e.g. node/npm/pnpm/python3/pip3/uv

Provider-neutral provisioning contributions
  -> skills, template dirs, Python SDKs, Node packages, CLIs
  -> declared once by plugins/app config (ProvisionWorkspaceRuntimeOptions.plugins)
  -> consumed by provisionWorkspaceRuntime()

Provider base artifact
  -> snapshot/cache/image containing bootstrap + provisioned contributions
  -> optimization only
```

## Why this is needed

`boring-macro` needs both Node tooling and Python SDK/CLI tooling.

Vercel runtimes are split:

- `node22` / `node24` / `node26`: Node, npm, pnpm, and Amazon Linux `python3`, but no `pip` or Astral `uv`.
- `python3.13`: Python, pip, uv, but no Node/npm/pnpm.

Live checks showed the correct Vercel Node-runtime bootstrap is:

```bash
sudo dnf install -y python3-pip
python3 -m pip install --user --upgrade uv
/home/vercel-sandbox/.local/bin/uv --version
```

`sudo dnf install -y uv` does not work; Amazon Linux provides `libuv`, not Astral `uv`.

This contradicts the current code in two concrete places that Phase 1 must fix:

- `snapshots/deploymentSnapshot.ts:1-4` — `UV_SETUP_COMMANDS` runs bare `python3 -m pip install --upgrade uv` (no `python3-pip` first, no `--user`, no explicit bin path). On a Node runtime there is no `pip`, so this fails.
- `vercel-sandbox/bake.ts:107-113` — `makeInstallCommand('dnf', …)` emits `dnf install -y …` with **no `sudo`**. On the `vercel-sandbox` user this requires `sudo`.

## Existing pieces to reuse

- `RuntimeModeAdapter` (`runtime/mode.ts:13`): creates live runtimes for `direct`, `local`, `vercel-sandbox`; exposes `create(ctx)` and `createProvisioningAdapter(runtimeLayout, ctx)`.
- `ModeContext` / `RuntimeBundle` (`runtime/mode.ts:26,35`).
- `WorkspaceProvisioningAdapter` (`provisioning/types.ts:53`): provider-specific `exec`, `workspaceFs`, install source resolution, cache roots. **Already implemented for vercel-sandbox** (`modes/vercel-sandbox.ts:503-...`).
- `provisionWorkspaceRuntime()` (`provisioning/provisionWorkspaceRuntime.ts`): correctness path for skills/templates/Python/Node/fingerprints/repair.
- Contribution types (`provisioning/types.ts`):
  - `RuntimeProvisioningContribution` (L35)
  - `RuntimeTemplateContribution` (L10)
  - `RuntimePythonSpec` (L16)
  - `RuntimeNodePackageSpec` (L27)
  - `ProvisionWorkspaceRuntimeOptions['plugins']` (L90-91)
- Provisioning fingerprint logic (`provisioning/fingerprint.ts`): `createNodeRuntimeFingerprint()`, `createPythonRuntimeFingerprint()`, `readFingerprint()`, `writeFingerprint()`, `shouldInstallRuntime()`.
- Vercel snapshot helpers:
  - `DeploymentSnapshotRecipe`, `DeploymentSnapshotProvider`, `buildDeploymentSnapshotRecipe()` (`snapshots/deploymentSnapshot.ts`)
  - `prepareVercelDeploymentSnapshot()`, `createVercelDeploymentSnapshotProvider()` (`vercel-sandbox/deploymentSnapshot.ts`)
  - `bakeSnapshotIfNeeded()`, `buildSnapshotRecipeHash()` (`vercel-sandbox/bake.ts`)
- Runtime layout / env: `BORING_AGENT_RUNTIME_DIR_NAMES` and `getBoringAgentRuntimeEnv()` (`workspace/runtimeLayout.ts`).

## Layer ownership

Three roles (this is *explanation*, not three modules to build — see the inventory above):

- **Layer A — provider bootstrap** (Vercel-specific, ~12 shell lines): install/verify only the low-level primitives provisioning needs — `node`, `npm`, `pnpm`, `python3`, `pip3`, `/home/vercel-sandbox/.local/bin/uv`. Must **not** install app skills/SDKs/templates/CLIs, and must not write into provisioning-owned managed paths (runtime layout dirs come from `BORING_AGENT_RUNTIME_DIR_NAMES`).
- **Layer B — provider-neutral provisioning** (already exists, reused unchanged): base-prep and normal startup both call `provisionWorkspaceRuntime()` with the same `plugins` list through the same `createProvisioningAdapter()`. No Vercel-only list of skills/templates/SDKs/CLIs.
- **Layer C — provider base artifact** (a snapshot id for Vercel; prepared dir / image for future providers): carries the result of A+B but is never trusted blindly — startup still verifies/repairs through `provisionWorkspaceRuntime()`.

Two callouts on Layer A:

- **No bootstrap marker / version file.** An earlier draft proposed a `.boring-agent-bootstrap/version` marker. Drop it — it's a second fingerprint system that does nothing: the bootstrap is already idempotent via its own guards (`command -v pip3`, `[ -x "$UV_BIN" ]`), and a version string would *not* drive upgrades (the `[ -x "$UV_BIN" ]` guard short-circuits that). Re-run the script unconditionally; the base hash (via `setupCommands`) handles invalidation. If version-driven re-provisioning is ever needed, reuse `fingerprint.ts`.
- `**pnpm` precondition:** assumed pre-baked in the base Node image. The script *verifies* pnpm but does not install it; under `set -euo pipefail` a missing `pnpm` fails loudly. If a future runtime lacks it, add an explicit install step.

## Hashing: one base runtime hash (subsumes the existing recipe hash)

**Decision: subsume, do not layer.** Today `bake.ts` has `buildSnapshotRecipeHash()` which hashes `{runtime, pythonPackages, systemPackages, setupCommands}` and keys the local snapshot cache. We extend that single function (or replace it) to become *the* base runtime hash and retire the recipe-only hash. There are exactly two hashes total, and they answer different questions; we do not add a third.

### 1. Provisioning fingerprint (already exists — reuse `fingerprint.ts`)

Scope: provider-neutral app/runtime contributions.

Question:

```text
Are the skills/templates/Python SDKs/Node packages/CLIs in this workspace current?
```

Used by `provisionWorkspaceRuntime()` to skip reinstalls (`shouldInstallRuntime()`).

Inputs:

- normalized plugin contribution metadata
- skill files
- template directory contents
- Python project/spec/source files declared by the contribution
- Node package specs and relevant lock/package metadata
- boring-agent provisioning schema/version as needed

Must not hash:

- whole app repo
- user workspace files
- logs/cache/temp files
- unrelated client/server files unless declared as provisioning inputs

Do not invent a parallel contribution hash; extend the existing `fingerprint.ts` logic.

### 2. Base runtime hash (the extended `buildSnapshotRecipeHash`)

Scope: whole reusable base artifact identity. This **is** the one identity hash for snapshots — it replaces the current recipe-only hash so there is a single source of truth and no drift.

Question:

```text
Is this snapshot/cache/image the right reusable starting point for this
provider/runtime/bootstrap/app contribution set?
```

Inputs (extend the current `{runtime, pythonPackages, systemPackages, setupCommands}` with):

- provider, e.g. `vercel-sandbox`
- runtime profile, e.g. `node24-python-tools`
- boring-agent version
- **provisioning fingerprint from §1**
- lockfile/package manager metadata needed by provisioning

Note there is **no separate "bootstrap version" string** — the bootstrap commands already live in `setupCommands`, which is hashed. Editing the bootstrap script (or `UV_BIN`) changes `setupCommands`, which changes the base hash automatically. This is exactly why the marker/version file in Layer A is unnecessary: the hash, not a hand-maintained version constant, is what invalidates a stale base.

Why provider/bootstrap identity is included: the same app contributions may be valid on multiple providers, but a Vercel `node24` snapshot with `/home/vercel-sandbox/.local/bin/uv` is not interchangeable with a local bwrap cache or a future Docker image. Changing bootstrap commands or `UV_BIN` must invalidate the base even if app SDKs did not change. Folding the provisioning fingerprint in means an SDK/skill change invalidates the base too.

## Minimal type additions

Keep this small. Do not add a large `CanonicalRuntimeArtifactProvider` abstraction yet.

**One type that mirrors the env JSON 1:1.** The discipline that matters is *behavioral* — `create()` branches only on `provider`/`kind`/`ref` and never recomputes or gates on `hash` — not "carve fields off the type". Parsing the pointer JSON (which carries `hash`/`runtimeProfile`) into a shape that omits them would just force a cast or a silent field-drop. So use a single pointer type matching the wire format:

```ts
interface BaseRuntimePointer {
  provider: string          // 'vercel-sandbox' (reject pointers for other providers)
  kind: string              // 'snapshot' for v1
  ref: string               // snapshot id
  runtimeProfile?: string   // label for telemetry/debugging; nothing branches on it in v1
  hash?: string             // base runtime hash; carried for telemetry, NOT gated on at serve time
}
```

What consumes what:

- `create()` (serve path): reads `provider`/`kind` to reject foreign pointers, maps `ref` to a snapshot `source`. **Nothing else.** No hash recompute, no `runtimeProfile` dispatch (provisioning repairs regardless — see Deployment pointer).
- Telemetry/logging: may read `hash`/`runtimeProfile` straight off the parsed pointer. No separate threading, no second type.

No generic `data` bag and no prepared-dir/image variants until a second provider actually exists — do not add speculative fields now.

**Do not touch the shared `ModeContext`.** An earlier draft added `baseRuntimeArtifact?` to `ModeContext` (`runtime/mode.ts:26`). Don't — that type is cross-provider (`direct`/`local`/`vercel-sandbox` all consume it), and the base pointer is a Vercel-only, deploy-*wide* constant that never varies per workspace creation. Threading it per-create through a shared type is a boundary leak.

Instead, **read it where every other Vercel config value is already read**: `createVercelSandboxModeAdapter` already resolves runtime, timeout, team, project, and auth from env via `getEnvVar` (`vercel-sandbox.ts:372-376`). Parse `BORING_AGENT_BASE_RUNTIME` there, once, at construction. `ModeContext`, `direct`, and `local` stay untouched; the Vercel concept stays inside the Vercel module.

The vercel client `create()` already branches on `params.source.type === 'snapshot'` (`vercel-sandbox.ts:144-148`), so the mode just maps a resolved `{ provider: 'vercel-sandbox', kind: 'snapshot', ref }` to:

```ts
source: { type: 'snapshot', snapshotId: artifact.ref }
```

If the pointer is absent or for another provider, build a plain runtime. The "snapshot failed → retry plain" *fallback* is not inside `create()` — see below.

## Deployment pointer (replaces the old snapshotId config and local cache)

**Decision: replace fully.** The local snapshot cache (`~/.config/boring-agent/vercel-snapshot-cache.json`) and the `snapshotId`/`BORING_AGENT_VERCEL_SNAPSHOT_ID` "snapshot-id-configured" skip path (`bake.ts:240-247`) are removed. The deployment env pointer is the only mechanism the serve path consults. This is a deliberate, harder cutover that buys a single unambiguous source of truth.

Use one deployment env var as the current base pointer:

```bash
BORING_AGENT_BASE_RUNTIME='{"provider":"vercel-sandbox","kind":"snapshot","ref":"snap_...","hash":"a1b2c3d4...","runtimeProfile":"node24-python-tools"}'
```

CI prepares and smoke-tests the base, then deploys the app with this pointer.

Runtime reads this pointer, checks `provider`/`kind`, attempts to start from it, and falls back to plain runtime + full provisioning if it is missing or invalid.

**Do not recompute the base hash on the serve hot path.** Recomputing it would mean hashing the fingerprint inputs (skill files, template dirs, lockfiles) during the very workspace-creation we are trying to make fast — self-defeating, and redundant because `provisionWorkspaceRuntime()` always re-runs and repairs regardless. The base hash is a CI-side concern (cache reuse + producing the pointer), not a runtime gate.

If you want a runtime sanity check, do the cheap version only: compare `pointer.hash` against an **app-embedded expected-hash constant** baked at build time (a string compare, no recomputation). On mismatch, log/telemetry `base_hash_mismatch`, skip the base, and use fallback provisioning — never fail the user request. If even that is more than v1 needs, skip the check entirely and rely on provisioning to repair.

### Cutover steps for the replacement

> ⚠️ **This is the riskiest line item in the plan** — a sharp simplicity-over-compatibility trade, not a free cleanup. Before removing the cache, audit who depends on it: **local dev loops and the test suite** may rely on `snapshotId`/`vercel-snapshot-cache.json` to avoid re-baking. If anything does, keep a thin compat shim for one release (read the old path, warn, then drop it) rather than a hard cutover. Grep for `snapshotId`, `vercel-snapshot-cache`, and `BORING_AGENT_VERCEL_SNAPSHOT_ID` across the repo and tests first.

1. Remove the `snapshotId` short-circuit and the local cache read/write from `bake.ts`. Base identity now lives only in the deployment pointer.
2. CI is the only producer of snapshots (see Phase 4); there is no longer an on-host bake cache to consult at serve time.
3. Delete `BORING_AGENT_VERCEL_SNAPSHOT_ID` references; if any remain temporarily, treat them as no-ops, not as an alternate pointer.

Full registry/history can come later in object storage or DB if the deployment env pointer is not enough.

## Vercel bootstrap contract

For Vercel Node runtimes, bootstrap is idempotent and provider-specific. It is safe to run unconditionally on every base-prep and every workspace start — the per-primitive guards make it a near-noop when everything is already present, so no marker/version file is needed:

```bash
set -euo pipefail

UV_BIN="/home/vercel-sandbox/.local/bin/uv"
export PATH="/home/vercel-sandbox/.local/bin:$PATH"

# Each step is its own idempotency check — install only what's missing.
if ! command -v pip3 >/dev/null 2>&1; then
  sudo dnf install -y python3-pip
fi

if [ ! -x "$UV_BIN" ]; then
  python3 -m pip install --user --upgrade uv
fi

# Verify the full primitive set (fails loudly if the base image lacks node/npm/pnpm).
node --version
npm --version
pnpm --version
python3 --version
pip3 --version
"$UV_BIN" --version
```

Important:

- `/home/vercel-sandbox/.local/bin/uv` is the authoritative `uv` path for internal provisioning.
- Provisioning correctness must not depend on PATH propagation. The provisioning adapter must pass `UV_BIN` explicitly (do not call bare `uv`).
- Still prepend `/home/vercel-sandbox/.local/bin` to PATH for user/model convenience so `uv --version` works interactively.
- `sudo` is required for `dnf` on the `vercel-sandbox` user; `bake.ts:makeInstallCommand` must emit `sudo dnf` (or the seed must run privileged).

## App-specific materialization

Preprovisioned bases should include app-owned runtime contributions by default, not just base tools. This is the main latency win: most workspace starts should hit provisioning fingerprints and avoid reinstalling SDKs/CLIs.

However, those contributions must be declared once through the shared provider-neutral plugin/provisioning contribution list (`ProvisionWorkspaceRuntimeOptions.plugins`) and installed by `provisionWorkspaceRuntime()`.

On workspace startup, `provisionWorkspaceRuntime()` runs again and updates/repairs anything stale. Base preparation and workspace startup use the same contribution resolver and the same `plugins` list **by construction**, because base-prep drives the serve path (see below); there is no second list to keep in sync.

For Macro, the shared contributions should resolve to:

- `workspace-template/`
- `.agents/skills/macro-transform`
- `.agents/skills/macro-deck`
- Macro Python SDK from `src/plugins/macro/server/sdk/pyproject.toml`
- `bm` executable available on PATH

Do not implement these bullets as Vercel snapshot-specific copy/install code. They are examples of what Macro's existing plugin/runtime contributions should materialize through the shared provisioning path.

## Provider behavior

### Vercel Sandbox

Base artifact: Vercel snapshot.

Base preparation flow (**reuses the serve-time runtime + provisioning wiring — no new adapter**):

1. Create a seed runtime via the existing `RuntimeModeAdapter.create(ctx)` for `vercel-sandbox` with runtime `node24` (no snapshot source).
2. Run Vercel bootstrap (Layer A) in the seed.
3. Obtain the provisioning adapter from the same `modeAdapter.createProvisioningAdapter(runtimeLayout, ctx)` the serve path uses (`registerAgentRoutes.ts:387`), and run `provisionWorkspaceRuntime()` with the serve-time `plugins`/contributions.
4. Run smoke checks (see below).
5. Snapshot the seed sandbox.
6. Compute the base runtime hash (§2) and deploy the app with `BORING_AGENT_BASE_RUNTIME` pointing at `{ snapshotId, hash, runtimeProfile }`.

> Note: this **replaces** the tools-only `bakeSnapshotIfNeeded()` recipe path (dnf packages → setupCommands → pip packages with no `provisionWorkspaceRuntime()`). We keep the low-level snapshot helpers (create-from-snapshot, `snapshot()`) but drive them from the real runtime/provisioning path so the base equals a real provisioned workspace.

Workspace creation flow:

1. The vercel mode (which already parsed `BORING_AGENT_BASE_RUNTIME` at construction) maps a valid snapshot pointer to `source: { type: 'snapshot', snapshotId }`; the binding call site wraps this with the try-base/else-plain fallback.
2. Run bootstrap (idempotent, no marker — near-noop when primitives are present).
3. Run `provisionWorkspaceRuntime()` (fingerprints skip unchanged installs).
4. Serve workspace.

Fallback:

1. Create plain `node24` sandbox.
2. Run bootstrap.
3. Run full `provisionWorkspaceRuntime()`.
4. Serve workspace if successful.
5. Do not auto-promote this interactive workspace as a reusable base.

### local / bwrap

Base artifact: future prepared managed runtime directory, e.g.:

```text
/var/cache/boring/runtime/{baseHash}/.boring-agent
```

Only managed runtime paths may be copied into a workspace. Use an allow-list based on `BORING_AGENT_RUNTIME_DIR_NAMES` / runtime layout. Never cache or overwrite user files.

Initial implementation can defer local/bwrap base cache and simply rely on full provisioning (the `local` adapter already exposes `createProvisioningAdapter`).

### direct

Direct mode remains simple:

1. Reuse existing workspace state if fingerprints match.
2. Else run full provisioning in place.
3. Optional local cache can come later.

### Future Docker/Kubernetes

Base artifact: OCI image or image plus writable workspace volume.

Same invariant:

```text
start from image -> provisionWorkspaceRuntime() verifies/repairs -> correct
```

## Implementation phases

### Phase 1: Fix Vercel Node bootstrap commands

Make `buildDeploymentSnapshotRecipe({ runtime })` runtime-family aware and fix the two divergent call sites.

- `snapshots/deploymentSnapshot.ts`: replace `UV_SETUP_COMMANDS` so Node runtimes install `python3-pip` (via `sudo dnf`) first, install `uv` with `--user`, and verify the explicit `UV_BIN`:
  ```bash
  sudo dnf install -y python3-pip
  python3 -m pip install --user --upgrade uv
  /home/vercel-sandbox/.local/bin/uv --version
  ```
  - Node runtime: install `python3-pip`, install `uv --user`, verify explicit `UV_BIN`.
  - Python runtime: existing `uv` may already be available; verify or install appropriately.
- `vercel-sandbox/bake.ts`: `makeInstallCommand('dnf', …)` must emit `sudo dnf install -y …` (currently no sudo, `bake.ts:107-113`).
- The provisioning adapter must invoke `uv` by explicit `UV_BIN`, not bare `uv`, so correctness does not depend on PATH.

Concrete files to inspect/update:

- `packages/agent/src/server/sandbox/snapshots/deploymentSnapshot.ts` (`UV_SETUP_COMMANDS`, `buildDeploymentSnapshotRecipe`)
- `packages/agent/src/server/sandbox/vercel-sandbox/bake.ts` (`makeInstallCommand`)
- tests that assert default UV setup commands / install commands

### Phase 2: Add optional base artifact to Vercel mode

`vercel-sandbox.ts` is already ~700 lines. Keep `create()` source-driven and pure; do **not** smear pointer-parsing, validation, and fallback branches into it. Split the responsibilities:

- **Parse, in the mode factory:** in `createVercelSandboxModeAdapter`, read `BORING_AGENT_BASE_RUNTIME` via the existing `getEnvVar` (alongside runtime/timeout/team/project/auth) and parse it into a `BaseRuntimePointer`. Do not modify `ModeContext`. Reject pointers whose `provider`/`kind` don't match.
- **Map, in `create()`:** if a valid artifact is present, set `source: { type: 'snapshot', snapshotId: artifact.ref }`; otherwise build a plain runtime. `create()` does exactly what it's told and throws on a bad source. **No base-hash recomputation here** (see Deployment pointer). Any optional hash check is a cheap string compare against an app-embedded constant, or omitted in v1.
- **Fall back, at the one binding call site:** the "try base source → on error retry plain source" policy lives in the single runtime-binding call site that already orchestrates creation — not as branches inside `create()`. That call site emits the structured fallback-reason telemetry. One legible policy block, one place.
- Never let a bad base pointer prevent workspace creation if fallback provisioning can succeed.

### Phase 3: Add base runtime preparation script

Add an **internal CI script/function** (not a polished CLI surface) that drives the **serve-time path**: create runtime → bootstrap → `provisionWorkspaceRuntime()` → smoke → snapshot. It does **not** introduce a new provisioning adapter; it calls `modeAdapter.create()` + `modeAdapter.createProvisioningAdapter()` exactly like `registerAgentRoutes.ts`.

Keep the signature minimal and concrete — only `vercel-sandbox` and `boring-macro` exist today, so a `--provider/--app/--env` flag matrix is speculative generality. A single function with the two values it actually needs is enough:

```ts
// internal, CI-invoked
prepareBaseRuntime({ runtime: 'node24', runtimeProfile: 'node24-python-tools' })
```

Promote it to a flagged `boring-agent prepare-base-runtime` CLI command only when a second provider or app forces the abstraction. Reuse the low-level Vercel snapshot helpers for create-from/snapshot; contribution materialization goes through `provisionWorkspaceRuntime()`. Output: `{ snapshotId, hash, runtimeProfile }` for the deployment pointer.

### Phase 4: Wire CI/deploy

CI should:

1. Build app/plugin packages.
2. Resolve the exact same plugin/runtime contributions used at workspace serve time (same `plugins` list).
3. Compute provisioning fingerprint from normalized contribution inputs (`fingerprint.ts`).
4. Compute the base runtime hash from provider/runtime/bootstrap identity + provisioning fingerprint (the extended `buildSnapshotRecipeHash`).
5. If the deployment pointer already has the same base hash and smoke still passes, reuse it (CI-side check — there is no on-host serve cache anymore).
6. Else create seed runtime.
7. Bootstrap, run `provisionWorkspaceRuntime()`, smoke, snapshot.
8. Deploy app with `BORING_AGENT_BASE_RUNTIME` JSON pointer.
9. Run production agent smoke.

### Phase 5: Existing workspace update path

For existing workspaces:

- do not delete user state just because the base changed
- re-run the idempotent bootstrap on next use (near-noop when primitives are present)
- run `provisionWorkspaceRuntime()` on next use
- recreate from latest base only when sandbox is expired, missing, unrecoverable, or explicitly reset

## Acceptance criteria

Initial Vercel implementation is acceptable when:

- A `node24` Vercel sandbox can start from `BORING_AGENT_BASE_RUNTIME` snapshot via the existing `source: { type: 'snapshot' }` branch.
- Workspace startup still calls `provisionWorkspaceRuntime()` through the serve-time provisioning adapter.
- Macro workspace has Node, npm, pnpm, Python, pip, explicit `UV_BIN`, Macro skills, Macro SDK, and `bm` available.
- If `BORING_AGENT_BASE_RUNTIME` is missing, malformed, stale, or invalid, a plain `node24` sandbox plus full provisioning still works.
- Internal provisioning uses `/home/vercel-sandbox/.local/bin/uv` explicitly, not bare `uv`.
- There is no Vercel-specific duplicate list of Macro skills/templates/SDKs/CLIs.
- There is exactly one base runtime hash (the extended `buildSnapshotRecipeHash`) and one base pointer (`BORING_AGENT_BASE_RUNTIME`); the old `snapshotId` config and local cache are removed.

## Smoke and diagnostics

Provider smoke:

```bash
node --version
npm --version
pnpm --version
python3 --version
pip3 --version
/home/vercel-sandbox/.local/bin/uv --version
bm --help
```

Track:

- base pointer parse success/failure
- base hash mismatch
- base resolution/start time
- sandbox create time
- bootstrap verify/update time
- runtime provisioning time
- first command latency
- fallback usage rate and reason

Fallback reasons should distinguish:

- missing credentials
- base pointer missing
- base not found/expired
- base hash mismatch
- bootstrap failed
- missing `pip3`
- missing `uv`
- app SDK provisioning failed
- provider API throttling

## Fallback semantics

All providers must support fallback.

Order:

1. Try configured `BORING_AGENT_BASE_RUNTIME` pointer.
2. Else create plain runtime.
3. Run bootstrap.
4. Run full `provisionWorkspaceRuntime()`.
5. If successful, serve workspace.
6. Do **not** automatically create/promote a reusable base from this interactive fallback path yet.
7. If full provisioning fails, return actionable provisioning error.

Future behavior is tracked separately: a successful first fallback could trigger creation of a reusable base from a clean seed runtime. It must not snapshot/promote user workspace state.

GitHub issue: [https://github.com/hachej/boring-ui/issues/123](https://github.com/hachej/boring-ui/issues/123)

## Garbage collection

For now, GC is manual/provider-native because there is no registry. (With the local cache removed, there is no on-host cache file to prune; snapshots are managed provider-side / by CI.)

Later retention policy, if registry/history is added:

- Keep current base for each app/env/provider.
- Keep previous N bases for rollback.
- Keep bases referenced by active workspaces if provider exposes references.
- Delete seed sandboxes after snapshot/cache creation.
- Periodically delete unreferenced bases older than TTL.

## Open questions

- Later: if deployment env pointer is not enough, should full base registry/history live in object storage or DB?
- How much app-specific state should be included in a base before base creation time becomes too expensive?
- How should provider-specific base expiry be detected and repaired?
- Later: should a successful first fallback trigger asynchronous creation of a clean reusable base, and should promotion require CI/admin approval?
- Does `sandbox.snapshot()` stopping the active session (`modes/vercel-sandbox.ts:492-495`) complicate CI base-prep (snapshot is the last step, so likely fine — confirm during Phase 3)?


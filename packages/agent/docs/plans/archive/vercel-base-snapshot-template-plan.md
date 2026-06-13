# Vercel Base Snapshot Template Plan

Status: draft for review
Date: 2026-04-30
Owner package: `@boring/agent`
Consumers: `apps/full-app`, future `@boring/cloud`

## Problem

New Vercel sandboxes currently pay cold-start setup cost every time they need
runtime dependencies, template files, or package installs. We also need a clear
policy for what happens when the app changes its default sandbox image while
existing workspaces already have user files.

The product invariant stays:

> One workspace maps to one durable sandbox identity.

A reusable base snapshot can improve first boot, but it must not become the
source of truth for an existing workspace. Once a workspace has user mutations,
the workspace's own persistent sandbox state or workspace snapshot wins.

## Validated Provider Facts

Official Vercel docs checked on 2026-04-30:

- `Sandbox.create()` accepts `source: { type: "snapshot", snapshotId }`.
- `sandbox.snapshot()` captures filesystem and installed packages, then stops
  the source sandbox automatically.
- Snapshots expire after 30 days by default; `expiration: 0` disables expiry.
- Non-persistent sandboxes lose filesystem data when stopped unless a snapshot
  exists.
- Beta persistent sandboxes use a durable `name`; stopping auto-saves state,
  and resuming creates a new compute session from that saved state.
- Beta persistence is enabled by default and can be disabled with
  `persistent: false`.

Implementation note:

- Keep a code comment next to `snapshot({ expiration: 0 })` that cites this
  provider behavior. If Vercel changes the zero-expiry contract, bake tooling
  must fail validation instead of creating snapshots that expire unexpectedly.

Sources:

- https://vercel.com/docs/vercel-sandbox/sdk-reference
- https://vercel.com/docs/vercel-sandbox/concepts/snapshots
- https://vercel.com/docs/vercel-sandbox/concepts
- https://vercel.com/changelog/vercel-sandbox-persistent-sandboxes-beta

## Goals

- Define an app-level base snapshot that all new Vercel workspaces can start
  from.
- Keep base snapshot state separate from workspace state.
- Make invalidation explicit: bake a new base snapshot, rotate config, keep old
  snapshots while any workspace still references them.
- Support both stable snapshot-based sandboxes and beta persistent named
  sandboxes.
- Keep `@boring/agent` core-free and app-agnostic.
- Keep full-app wiring thin: it supplies config and stores, but does not own
  sandbox lifecycle behavior.
- Keep the DB model provider-neutral so Fly, Modal, local volumes, or future
  providers can use equivalent metadata.

## Non-Goals

- Do not reset existing workspaces to the new base snapshot automatically.
- Do not put secrets, user files, provider tokens, or per-user auth material in
  the base snapshot.
- Do not delete old provider snapshots during rollout.
- Do not replace the persistent sandbox adapter plan.
- Do not require `@boring/core` to import `@boring/agent`.

## Mental Model

There are two snapshot classes:

1. Base snapshot
   - App/deployment-level template.
   - Contains shared tools and dependencies.
   - Used only when provisioning a workspace that has no runtime resource yet.
   - Rotated by operators or CI when the manifest changes.

2. Workspace snapshot or persistent state
   - Workspace-level durable state.
   - Contains user files and installed packages created inside that workspace.
   - Used to recover a stopped or expired workspace.
   - Always wins over the base snapshot after first provisioning.

Restore priority:

1. Existing persistent sandbox name, when using Vercel persistent beta.
2. Existing active stable sandbox id.
3. Existing workspace snapshot id.
4. App-level base snapshot id, only for first provisioning.
5. Empty sandbox or template tarball fallback.

## App-Level Configuration

Add config fields read by the agent package and provided by the app shell:

```text
BORING_AGENT_VERCEL_BASE_SNAPSHOT_ID=snap_...
BORING_AGENT_VERCEL_BASE_SNAPSHOT_VERSION=boring-node24-2026-04-30-a1b2c3d4
BORING_AGENT_VERCEL_BASE_SNAPSHOT_RUNTIME=node24
BORING_AGENT_VERCEL_BASE_SNAPSHOT_MANIFEST_PATH=./sandbox-template.manifest.json
BORING_AGENT_VERCEL_BASE_SNAPSHOT_CACHE_PATH=~/.config/boring-agent/base-snapshots.json
```

Rules:

- `BASE_SNAPSHOT_ID` is optional. Without it, current behavior remains.
- `BASE_SNAPSHOT_VERSION` is required when `BASE_SNAPSHOT_ID` is set.
- `BASE_SNAPSHOT_RUNTIME` should default to the adapter runtime, not to the
  current bake helper's `python3.13` default.
- Version is a human-readable label plus manifest hash.
- Full app stores these as environment variables or deployment secrets.
- Future cloud can store the same fields in deployment/app runtime template
  metadata.

## Provider-Neutral DB Model

The workspace runtime store should track runtime resources generically, not as
Vercel-only columns.

Recommended logical fields for a workspace runtime resource:

```ts
type WorkspaceRuntimeResource = {
  workspaceId: string
  provider: "vercel" | "local" | "fly" | "modal" | string
  resourceKind: "sandbox" | "volume" | "snapshot" | string
  handleKind: "session" | "persistent-name" | "volume-path" | string
  handle: string
  currentSessionId?: string
  currentSnapshotId?: string
  baseSnapshotId?: string
  baseSnapshotVersion?: string
  templateVersion?: string
  runtime?: string
  state: "pending" | "provisioning" | "ready" | "stopped" | "error"
  status?: string
  expiresAt?: string
  provisionLockToken?: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
  lastSeenAt?: string
}
```

For Vercel stable:

- `handleKind = "session"`
- `handle = sandboxId`
- `currentSnapshotId = latest workspace snapshot id`
- `baseSnapshotId/baseSnapshotVersion = provenance only`

For Vercel persistent beta:

- `handleKind = "persistent-name"`
- `handle = deterministic sandbox name`
- `currentSessionId = latest session id, metadata only`
- `currentSnapshotId = provider-reported persisted snapshot when available`
- `baseSnapshotId/baseSnapshotVersion = provenance only`

Important rule:

- `baseSnapshotId` is never the recovery source after user mutations unless
  there is no workspace state yet.
- `templateVersion` is first-class because it drives workspace upgrade
  decisions. Do not bury it only in generic metadata.
- `expiresAt` is first-class because stable workspace snapshots can expire and
  cleanup/resume code must not assume stored snapshot ids are valid forever.

## Base Snapshot Registry

The app or future cloud layer must keep an app-level registry for base
snapshots. Environment variables are enough to select the active pointer, but
not enough for audit, rollback, or cleanup.

Recommended logical fields:

```ts
type WorkspaceBaseSnapshotRegistryEntry = {
  provider: "vercel" | string
  snapshotId: string
  version: string
  manifestHash: string
  runtime: string
  status: "baking" | "ready" | "failed" | "retired"
  active: boolean
  previousSnapshotId?: string
  sourceSandboxId?: string
  manifest: Record<string, unknown>
  createdAt: string
  readyAt?: string
  retiredAt?: string
  expiresAt?: string
}
```

Registry rules:

- One active base snapshot per app/runtime/template lane.
- Old base snapshots remain registered after rotation.
- Cleanup can delete only snapshots that are not active, not previous rollback
  candidates, and not referenced by any workspace runtime resource.
- Keep old base snapshots for a minimum retention window, initially 14 days.

## Current Code Touchpoints

Existing useful pieces:

- `createDefaultVercelClient()` in
  `packages/agent/src/server/runtime/modes/vercel-sandbox.ts` already supports
  creating from `source: { type: "snapshot", snapshotId }`.
- `resolveSandboxHandle()` in
  `packages/agent/src/server/sandbox/vercel-sandbox/resolveSandboxHandle.ts`
  already recreates from a stored snapshot id.
- `bakeSnapshotIfNeeded()` in
  `packages/agent/src/server/sandbox/vercel-sandbox/bake.ts` already has a
  local cache and package hash, but it is not wired into the mode adapter.

Gaps:

- `bakeSnapshotIfNeeded()` hashes only package lists. It should hash the full
  base manifest.
- `bakeSnapshotIfNeeded()` defaults to `python3.13`; full-app likely wants
  `node24` or the adapter runtime.
- Stable `Sandbox.create()` source is one of snapshot or tarball. If a
  workspace also needs app template files, apply the template overlay after
  creation from the base snapshot.
- Current handle records do not distinguish base snapshot provenance from
  workspace snapshot recovery.

## Base Manifest

Create a manifest that describes the base image inputs:

```json
{
  "schemaVersion": 1,
  "name": "boring-full-app-node",
  "runtime": "node24",
  "systemPackages": ["git", "jq", "ripgrep", "tar", "gzip"],
  "commands": [
    "corepack enable",
    "corepack prepare pnpm@latest --activate"
  ],
  "markerPath": "/vercel/sandbox/.boring/base-snapshot.json"
}
```

Hash inputs:

- manifest schema version
- runtime
- system packages
- package manager versions
- setup commands
- copied template files, if any
- agent package version or template version

Marker file written into the seed sandbox:

```json
{
  "kind": "boring-base-snapshot",
  "version": "boring-node24-2026-04-30-a1b2c3d4",
  "runtime": "node24",
  "hash": "a1b2c3d4...",
  "createdAt": "2026-04-30T00:00:00.000Z"
}
```

## Bake Flow

1. Load and validate the base manifest.
2. Compute the manifest hash.
3. Acquire a distributed bake lock for the manifest hash.
4. Check registry or cache for an existing snapshot with that hash.
5. If cache hits and `Snapshot.get()` reports a usable terminal status, reuse
   it.
6. Create a seed sandbox with the manifest runtime.
7. Run setup commands with a restricted environment. Pass only explicitly
   allowlisted variables; never inherit the app server environment.
8. Install system packages and runtime dependencies.
9. Write the marker file.
10. Run smoke checks:
   - runtime version
   - `git --version`
   - `rg --version`
   - package manager version
   - marker file content
11. Snapshot with `expiration: 0` for managed app templates.
12. Poll `Snapshot.get()` until the snapshot is usable or failed.
13. Record snapshot id, version, hash, runtime, source sandbox id, expiry, and
    status.
14. Release the distributed bake lock.

Operational note:

- `sandbox.snapshot()` stops the seed sandbox. Do not run more setup commands
  after snapshotting.
- If a second bake process sees the same manifest hash while the first one owns
  the lock, it should wait and reuse the winner's snapshot instead of baking a
  duplicate.

## Runtime Provisioning Flow

For a new workspace:

1. Resolve workspace id and deterministic provider handle.
2. Attempt to create or claim a `provisioning` runtime resource row with a
   unique `provisionLockToken`.
3. If another request already owns provisioning, poll the row until it reaches
   `ready` or `error`.
4. If a ready resource exists, restore from that resource and ignore the base
   snapshot.
5. If no ready resource exists and `BASE_SNAPSHOT_ID` is configured, create the
   sandbox from that snapshot.
6. Persist the provider handle and base snapshot provenance on the locked row.
7. Apply app template overlay if needed.
8. On overlay failure, mark the runtime resource `error`, keep enough metadata
   to debug the provider handle, and do not mark the workspace `ready`.
9. For persistent beta, rely on provider persistence. Do not call
   `sandbox.snapshot()` after provisioning.
10. For stable sandboxes, do not call `sandbox.snapshot()` during first
    provisioning because snapshotting stops the sandbox. Schedule workspace
    snapshots only on explicit save, graceful stop, or idle maintenance with a
    clear reconnect path.
11. Mark workspace runtime `ready`.

For an existing workspace:

1. Resume by persistent name or sandbox id.
2. If stable session is gone and a workspace snapshot exists, recreate from the
   workspace snapshot.
3. If stable session is gone and no workspace snapshot exists, show a conflict
   error and require explicit reset. Do not fall back to the base snapshot.

Persistent beta validation gate:

- Before implementation, run a live provider probe for
  `Sandbox.create({ name, persistent: true, source: { type: "snapshot" } })`.
- If Vercel rejects that combination, first provisioning must either create an
  empty named persistent sandbox and run setup commands, or apply a small
  post-create template overlay. The fallback must be measured before rollout.

## Invalidation Policy

Snapshots are immutable. Invalidation means rotating the pointer.

Process:

1. Change the base manifest or dependency versions.
2. Bake a new snapshot.
3. Smoke test a new sandbox created from the new snapshot.
4. Update `BORING_AGENT_VERCEL_BASE_SNAPSHOT_ID`.
5. Update `BORING_AGENT_VERCEL_BASE_SNAPSHOT_VERSION`.
6. Deploy the app.
7. New workspaces use the new base.
8. Existing workspaces continue using their own workspace resource.
9. Keep old base snapshots until no workspace records reference them.
10. Delete old snapshots only through a separate explicit cleanup task.

Existing workspace upgrades:

- Do not recreate existing workspaces from the new base.
- Run an explicit workspace migration command inside each workspace.
- Verify files and dependency state.
- Save or wait for persistent state to be saved.
- Update the workspace resource metadata with the applied template version.

## Implementation Phases

### Phase 1 - Contracts and Config

- Add base snapshot config schema.
- Add provider-neutral runtime resource fields or metadata mapping.
- Add `provisioning`, `templateVersion`, `expiresAt`, and
  `provisionLockToken` to the runtime resource model.
- Add app-level base snapshot registry storage.
- Extend `SandboxHandleRecord` to carry:
  - `currentSnapshotId`
  - `baseSnapshotId`
  - `baseSnapshotVersion`
  - `runtime`
  - `handleKind`
- Keep backward compatibility for existing records.
- Confirm and lock down `expiration: 0` semantics in a provider smoke test.

### Phase 2 - Resolver Behavior

- Teach Vercel stable resolver to use base snapshot only when no workspace
  resource exists.
- Keep workspace snapshot as the only stable recovery source after first
  provisioning.
- Preserve the full-app policy where unavailable workspace sandboxes return a
  clear conflict instead of silent replacement.
- Add the provisioning claim/lock path so concurrent requests cannot create two
  sandboxes for the same workspace.
- Define the template overlay strategy:
  - preferred: bake template files into the base snapshot when shared by all
    workspaces
  - fallback: keep overlays small and fail provisioning if the overlay exceeds
    a configured size limit

### Phase 3 - Bake Command

- Replace package-list hash with manifest hash.
- Add runtime support with a `node24` full-app default.
- Add `expiration` support.
- Add `Snapshot.get()` validation before cache reuse.
- Poll snapshot creation until a usable terminal status before publishing the
  snapshot id.
- Add a distributed bake lock around manifest hash.
- Run bake setup commands with an explicitly allowlisted environment.
- Add smoke checks and marker writing.
- Define CI or release ownership for bake automation:
  - trigger on manifest change, package/runtime version change, or scheduled
    security refresh
  - run in CI or a controlled release job with Vercel credentials
  - publish the resulting snapshot id/version through deployment config without
    manual copy-paste

### Phase 4 - Persistent Beta Alignment

- If persistent beta is enabled, create named sandbox from base snapshot on
  first provisioning.
- Store sandbox name as durable handle.
- Treat session id as metadata.
- Verify file operations and `runCommand` auto-resume stopped named sandboxes.
- Validate that Vercel supports `name` plus `source: snapshot` in the same
  create request.
- Do not call `sandbox.snapshot()` as part of persistent beta recovery unless
  Vercel exposes it as provider metadata. Provider auto-save is the recovery
  path.

### Phase 5 - Tests

- Unit test resolver priority:
  - existing workspace snapshot beats base snapshot
  - base snapshot used only for first provisioning
  - missing workspace snapshot returns conflict in full-app policy
- Unit test manifest hashing and cache reuse.
- Unit test no secret keys are accepted in base manifest env sections.
- Unit test bake subprocesses receive only an allowlisted environment.
- Unit test concurrent provisioning for one workspace creates one provider
  handle.
- Unit test duplicate bake calls with one manifest hash create one snapshot.
- Unit test provisioning failure between sandbox create and ready state moves
  the runtime to `error`.
- Unit test workspace snapshot expiry returns conflict instead of panic or base
  fallback.
- Unit test template overlay failure does not mark workspace `ready`.
- E2E test workspace creation starts from base and shows expected tools.
- E2E test workspace switching preserves file tree and workbench state.
- E2E test stopped sandbox resumes and user-created files remain visible.
- E2E test base invalidation affects new workspaces only.

### Phase 6 - Rollout

- Bake a dev base snapshot.
- Enable in local full-app environment.
- Run workspace lifecycle E2E.
- Deploy to Fly with base snapshot env vars.
- Create one new workspace and verify first boot.
- Stop/resume the workspace and verify files persist.
- Bake a second base snapshot and verify only new workspaces use it.
- Keep the previous base snapshot id in rollback config until the new snapshot
  is stable.
- Add an alert/log signal for workspace provisioning failures, initially
  workspace creation failure rate above 5 percent over 5 minutes.
- Do not retire old base snapshots before the minimum retention window.

## Risks

- Beta persistent SDK behavior can change before GA.
- Snapshot storage costs and retention limits need an operator budget.
- Old workspaces with no workspace snapshot cannot be recovered after stable
  sandbox stop.
- Using `expiration: 0` avoids surprise expiry but requires cleanup discipline.
- Template overlay after snapshot creation can reintroduce cold-start cost if it
  grows large.
- The base snapshot can accidentally capture secrets if bake commands read app
  env. Bake must run with a restricted environment.
- A broken base snapshot can break all new workspace creation until the pointer
  is rolled back.
- Concurrent provisioning or concurrent baking can create orphaned provider
  resources unless guarded by locks.

## Open Questions

- What exact Vercel snapshot statuses should block cache reuse?
- Should a base snapshot be per app, per tenant, or per workspace template?
- Should workspace reset create a new deterministic sandbox name generation, or
  delete/reuse the old persistent name?
- What cleanup command should own old snapshot deletion?
- What is the maximum acceptable template overlay size before it must be baked
  into the base snapshot?
- Should bake run in CI, a release job, or an admin-only app command?

Questions that must be closed before Phase 2 implementation starts:

1. Live validation of persistent `name` plus `source: snapshot`.
2. Vercel snapshot statuses considered usable for cache and restore.
3. Template overlay strategy and size limit.
4. Bake automation owner and credential boundary.

## Review Log

- Claude Code: `revise`.
  - Main feedback: add provisioning state and lock, poll snapshot status after
    bake, promote expiry/template version into the model, add bake automation
    ownership, add rollback signals, and split persistent beta recovery from
    stable snapshot recovery.
  - Incorporated into this plan.
- Gemini: `revise`.
  - Main feedback: do not call `sandbox.snapshot()` during initial provisioning
    because it stops the sandbox, validate named persistent sandbox creation
    from a snapshot, add provisioning failure handling, add a registry for
    cleanup, and strip bake environment variables.
  - Incorporated into this plan.

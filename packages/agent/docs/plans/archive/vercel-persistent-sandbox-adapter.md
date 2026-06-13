# Vercel Persistent Sandbox Adapter Plan

Status: draft
Date: 2026-04-29
Owner package: `@boring/agent`
Consumer app: `apps/full-app`

## Summary

Move full-app workspaces from Vercel Sandbox stable session IDs to Vercel
Sandbox beta persistent names.

The product invariant stays:

> One Boring workspace maps to one durable sandbox identity.

With Vercel stable `@vercel/sandbox@1.10.0`, the durable thing we stored was a
session-like `sandboxId`. When that sandbox stopped and there was no snapshot,
the filesystem was not recoverable. With Vercel beta persistent sandboxes, the
durable thing is the sandbox `name`; sessions are compute instances that can be
stopped and resumed from persisted state.

This is not a drop-in package bump. Beta removes the old `sandbox.fs.readdir`
style API and exposes persistent sandbox methods that resume sessions under
the hood. We need a new adapter path that speaks the beta API cleanly.

## Validated Facts

Versions checked:

- Current repo dependency: `@vercel/sandbox@1.10.0`
- Current beta: `@vercel/sandbox@2.0.0-beta.14`

Official docs say:

- Stable `Sandbox.get({ sandboxId })` reconnects to an active sandbox.
- Stable snapshots recreate by starting a new sandbox from a snapshot.
- Beta persistent sandboxes use `Sandbox.create({ name })` and
  `Sandbox.get({ name })`.
- Beta persistence is enabled by default and can resume a stopped sandbox by
  creating a new session from persisted filesystem state.

Live validation performed against beta:

1. Created named sandbox with `persistent: true`.
2. Wrote `probe.txt`.
3. Stopped the sandbox with `blocking: true`.
4. Fetched with `Sandbox.get({ name, resume: false })`; status was `stopped`.
5. Called `readFileToBuffer({ path: "probe.txt" })`.
6. SDK resumed the sandbox and returned the file content.
7. Session list became `["stopped", "running"]`.
8. Test sandbox was deleted.

Conclusion: beta file operations do resume a stopped persistent sandbox. We do
not need a noop wake command before reads if the adapter uses beta `Sandbox`
methods. Command-backed operations also resume through `runCommand`.

## Goals

- Make `apps/full-app` use persistent Vercel sandboxes by default once the
  adapter is proven.
- Keep `@boring/agent` standalone and core-free.
- Preserve the existing stable Vercel adapter for standalone users until beta
  is GA or explicitly adopted.
- Store durable sandbox identity as a sandbox name, not a session id.
- Keep session id as metadata only.
- Make stopped sandbox recovery automatic when Vercel persistence is enabled.
- Keep no-snapshot data-loss protection for the stable adapter.
- Keep path validation inside the workspace adapter before any command or file
  operation crosses into the remote sandbox.
- Keep full-app wiring simple: it injects stores and chooses mode/channel; it
  does not own sandbox lifecycle behavior.

## Non-Goals

- Do not delete existing Vercel sandboxes or snapshots.
- Do not migrate old stopped stable sandboxes that have no snapshot. Their
  filesystem data is already unrecoverable.
- Do not remove manual snapshot support. Keep it as fallback and for stable.
- Do not make `@boring/core` import `@boring/agent`.
- Do not hand-roll shell escaping for file operations. Use validated paths plus
  argv-based Node scripts or beta SDK file methods.

## Proposed User-Facing Policy

Default full-app policy:

- `1 workspace = 1 persistent Vercel sandbox name`
- Name format is deterministic from workspace id and deployment namespace.
- Current session id can change over time.
- Stopping a sandbox is allowed; the next file or command operation resumes it.
- Workspace reset is the explicit destructive action that creates a new durable
  sandbox name or deletes the existing one.

Standalone agent policy:

- `vercel-sandbox` remains stable SDK behavior by default.
- Add opt-in persistent beta channel for users who want named persistence.

## Package Strategy

Add the beta SDK as an npm alias instead of replacing stable immediately:

```json
{
  "dependencies": {
    "@vercel/sandbox": "^1.10.0",
    "@vercel/sandbox-beta": "npm:@vercel/sandbox@2.0.0-beta.14"
  }
}
```

Rationale:

- Stable adapter can continue importing `@vercel/sandbox`.
- Persistent adapter imports `@vercel/sandbox-beta`.
- Type surfaces can differ without conditional imports or unsafe casts.
- We can remove the alias after beta reaches GA.

## Runtime Selection

Prefer a channel flag over exposing beta as the only mode:

```text
BORING_AGENT_MODE=vercel-sandbox
BORING_AGENT_VERCEL_SANDBOX_CHANNEL=stable | persistent-beta
```

Defaults:

- Agent package standalone: `stable`
- Full app: `persistent-beta`

Alternative:

- Add a new runtime mode id, `vercel-sandbox-persistent`.

Recommendation:

- Use the channel flag internally first. The mode remains conceptually Vercel
  sandbox; the channel selects provider API generation.

## Store Contract

Current `SandboxHandleRecord` assumes `sandboxId` is durable. That is true for
stable only. Add a discriminated union.

Target shape:

```ts
export type SandboxHandleRecord =
  | {
      kind: "vercel-session"
      workspaceId: string
      sandboxId: string
      snapshotId?: string
      createdAt: string
      lastUsedAt: string
    }
  | {
      kind: "vercel-persistent"
      workspaceId: string
      sandboxName: string
      currentSessionId?: string
      currentSnapshotId?: string
      status?: string
      persistent: true
      createdAt: string
      lastUsedAt: string
      lastSeenAt?: string
    }
```

Compatibility rules:

- Existing records with no `kind` are read as `vercel-session`.
- Stable resolver only accepts `vercel-session`.
- Persistent resolver only accepts `vercel-persistent`.
- If channel changes for a workspace, return a clear configuration error and
  require explicit reset/migration.

## Core DB Changes

Core owns the DB-backed store, so add fields to `WorkspaceRuntime`.

Recommended columns:

- `sandbox_handle_kind text null`
- `sandbox_name text null`
- `sandbox_id text null`
- `sandbox_current_session_id text null`
- `sandbox_status text null`
- `sandbox_persistent boolean null`
- `sandbox_sdk_channel text null`
- `sandbox_snapshot_id text null`
- `sandbox_created_at timestamptz null`
- `sandbox_last_seen_at timestamptz null`
- `sandbox_last_used_at timestamptz null`

Mapping:

- Stable:
  - `sandbox_handle_kind = "vercel-session"`
  - `sandbox_id = "sbx_..."`
  - `sandbox_snapshot_id = "snap_..." | null`
- Persistent beta:
  - `sandbox_handle_kind = "vercel-persistent"`
  - `sandbox_name = "boring-<namespace>-<workspace-hash>"`
  - `sandbox_current_session_id = "sbx_..." | null`
  - `sandbox_snapshot_id = current Vercel snapshot id | null`
  - `sandbox_persistent = true`
  - `sandbox_sdk_channel = "persistent-beta"`

Name generation:

- Add `BORING_AGENT_VERCEL_SANDBOX_NAME_PREFIX`.
- Default prefix: `boring`.
- Include deployment namespace, default `dev`.
- Hash workspace id to avoid provider naming constraints.
- Example: `boring-dev-ws-6f8d4a9c2b0e`.

The exact name validator must be backed by either Vercel docs or live API
errors. Until documented, keep names lowercase alphanumeric plus hyphens.

## Agent Architecture

Add persistent beta files under the existing Vercel sandbox area:

```text
packages/agent/src/server/sandbox/vercel-sandbox/
  persistentClient.ts
  resolvePersistentSandboxHandle.ts
  createPersistentVercelSandboxWorkspace.ts
  createPersistentVercelSandboxExec.ts
  persistentFileOps.ts
```

Keep stable files in place:

```text
resolveSandboxHandle.ts
createVercelSandboxWorkspace.ts
createVercelSandboxExec.ts
periodicSnapshot.ts
```

`createVercelSandboxModeAdapter()` becomes a small dispatcher:

1. Resolve auth.
2. Read `BORING_AGENT_VERCEL_SANDBOX_CHANNEL`.
3. If `stable`, use current stable adapter path.
4. If `persistent-beta`, use new persistent path.

Longer-term cleanup:

- Extract common auth, timeout, template packaging, logging, and dirty tracking
  helpers after both paths are tested.

## Persistent Resolver

New resolver behavior:

1. Normalize workspace id.
2. Compute deterministic sandbox name.
3. Load store record.
4. If record exists:
   - verify `kind === "vercel-persistent"`
   - prefer stored `sandboxName`
   - call `Sandbox.get({ name })`
5. If not found:
   - call `Sandbox.create({ name, persistent: true, ...template/source })`
6. If create conflicts because another process won:
   - call `Sandbox.get({ name })`
7. Persist metadata:
   - `sandboxName`
   - `currentSessionId`
   - `currentSnapshotId`
   - `status`
   - timestamps

Use `Sandbox.get({ name })` with default `resume: true` for normal route
resolution. Use `resume: false` only for diagnostics or non-mutating status
checks where waking the sandbox would be surprising.

## Workspace Adapter

Beta SDK has no `sandbox.fs.readdir`. Implement the `Workspace` interface with
a mix of beta methods and command-backed Node scripts.

Path rules:

- Accept only user relative paths.
- Use existing `validatePath` logic.
- Convert validated paths to sandbox-relative paths under `/vercel/sandbox`.
- Never concatenate user paths into shell command strings.

Operation mapping:

| Workspace method | Persistent implementation |
|---|---|
| `readFile` | `sandbox.readFileToBuffer({ path, cwd })` |
| `writeFile` | `sandbox.writeFiles([{ path, content }])` |
| `mkdir` | `sandbox.mkDir(path)` for simple mkdir; Node script for recursive if needed |
| `readdir` | `runCommand(node, ["-e", script, "--", path])` returning JSON |
| `stat` | `runCommand(node, ["-e", script, "--", path])` returning JSON |
| `unlink` | Node script with `fs.rm(path, { recursive: false })` |
| `rename` | Node script with `fs.rename(from, to)` |

Node script requirements:

- Lives in source as a string constant or small packaged helper.
- Receives paths through argv, not interpolated source.
- Emits a single JSON object.
- Maps common errors to stable Boring error codes.
- Has unit tests for path traversal, missing path, and bad JSON.

Cache:

- Keep existing short metadata caches for `readdir` and `stat`.
- Invalidate on write, unlink, mkdir, rename, and any sandbox command.
- Since beta can resume and create a new session, cache keys must not depend on
  session id unless we intentionally want session-local caches.

## Exec Adapter

Beta `sandbox.runCommand()` is compatible enough for the current exec shape.
Create a beta-specific exec wrapper anyway so types do not depend on stable
`Sandbox`.

Behavior:

- Run `sh -c` exactly as the stable exec adapter does for agent commands.
- Preserve timeout, heartbeat, output cap, stdout/stderr streaming.
- Invalidate workspace metadata cache after command completion.
- Persist latest session metadata after resume if available.

Risk:

- `sh -c` is acceptable for agent-authored commands, but file operations must
  not use shell strings.

## Snapshot Policy After Persistent Beta

Persistent beta changes the primary policy:

- Automatic Vercel persistence is primary.
- Manual dirty periodic snapshots are fallback only.

For stable:

- Keep current dirty snapshot scheduler.
- Keep `SANDBOX_EXPIRED` if no snapshot exists.

For persistent beta:

- Do not run periodic snapshot scheduler by default because `snapshot()` stops
  the current session.
- Store `currentSnapshotId` if Vercel reports one.
- Offer explicit "checkpoint now" later if product needs it.
- On app shutdown, do not force snapshot; let Vercel persistence handle stop.

## Full-App Wiring

Full-app should only configure and inject:

- `WorkspaceRuntimeSandboxHandleStore`
- `BORING_AGENT_MODE=vercel-sandbox`
- `BORING_AGENT_VERCEL_SANDBOX_CHANNEL=persistent-beta`
- credentials and timeout/prefix env vars

Full-app should not:

- import Vercel SDK directly
- know how resume works
- mutate sandbox handles outside the store implementation

## Migration Strategy

No silent migration from stable stopped sandboxes.

For active stable workspaces:

1. Leave current stable record intact.
2. When full-app switches to persistent beta, create a new persistent sandbox
   name for the workspace.
3. Seed from template or current workspace source of truth if available.
4. If old stable sandbox is running and user asks to migrate files, add a
   separate explicit migration command later.

For stopped stable workspaces with no snapshot:

- Return clear status: old sandbox expired and had no recoverable snapshot.
- Create new persistent sandbox only after explicit reset or provisioning path.

For development local state:

- Allow `BORING_AGENT_VERCEL_SANDBOX_CHANNEL=stable` to keep using current
  DB rows during rollout.

## Rollout Phases

### Phase 1 - Types, Store, Config

- Add beta dependency alias.
- Extend config schema with:
  - `BORING_AGENT_VERCEL_SANDBOX_CHANNEL`
  - `BORING_AGENT_VERCEL_SANDBOX_NAME_PREFIX`
  - `BORING_AGENT_VERCEL_SANDBOX_NAMESPACE`
- Add discriminated sandbox handle type.
- Update `FileHandleStore`.
- Update `WorkspaceRuntimeSandboxHandleStore`.
- Add DB migration and local store support.
- Add type tests.

Acceptance:

- Existing stable tests pass.
- Old JSON records without `kind` still load as stable records.
- Core store round-trips stable and persistent records.

### Phase 2 - Persistent Resolver

- Add beta client wrapper.
- Add deterministic name generator.
- Add `resolvePersistentSandboxHandle()`.
- Add race-safe get/create/get behavior.
- Add tests for stopped status, missing record, conflict, and wrong kind.

Acceptance:

- Resolver never stores session id as durable identity.
- `Sandbox.get({ name })` path resumes by default.
- Wrong channel for existing record gives a stable explicit error.

### Phase 3 - Persistent Workspace And Exec

- Add persistent workspace adapter.
- Add command-backed `readdir`, `stat`, `unlink`, `rename`.
- Add persistent exec wrapper.
- Generalize metadata invalidation to support both stable and beta sandbox
  object types.
- Wire persistent path into runtime mode dispatcher.

Acceptance:

- File tree loads after a sandbox was stopped.
- Read/write/mkdir/rename/delete work after stop/resume.
- Agent command execution resumes stopped sandbox.
- No file operation interpolates user path into shell source.

### Phase 4 - Full-App Default And Smoke

- Set full-app env defaults to persistent beta.
- Add README/env example docs.
- Add an opt-in live smoke script for beta persistence:
  - create named sandbox
  - write file
  - stop
  - read file
  - list sessions
  - delete test sandbox
- Run local full-app against Vercel beta channel.

Acceptance:

- `/api/v1/tree` works for a new workspace.
- Stop sandbox in Vercel, reload file tree, it resumes and still sees files.
- DB row stores sandbox name and latest session id.
- Stable channel still works in package tests.

### Phase 5 - Cleanup After Beta GA

- Revisit dependency alias.
- If Vercel stable catches up, remove stable-specific snapshot recreation where
  no longer needed.
- Decide whether to rename channel from `persistent-beta` to `persistent`.
- Keep backwards compatibility for old stable records until an explicit cleanup
  bead removes it.

## Test Matrix

Unit tests:

- Config channel parsing.
- Name generation is deterministic and provider-safe.
- Store contract discriminates stable vs persistent.
- Persistent resolver get/create/conflict.
- Persistent workspace path validation.
- Persistent `readdir` and `stat` JSON parsing.
- Persistent mutations invalidate caches and mark dirty.
- Persistent exec streams stdout/stderr and handles timeout.

Integration tests with mocked beta SDK:

- Stopped sandbox resumes on `readFileToBuffer`.
- Stopped sandbox resumes on `runCommand`.
- Session id changes after resume and store is updated.
- Wrong channel existing record returns stable error.

Opt-in live smoke:

- Requires Vercel token/team/project env.
- Creates a unique sandbox name.
- Deletes it at the end.
- Must not run in default CI.

Full-app smoke:

- Sign up/login.
- Create workspace.
- Fetch file tree.
- Write file.
- Stop sandbox externally or via test helper.
- Fetch file tree again.
- Assert file remains.

## Risks

- Beta API can change. Mitigation: isolate imports behind
  `persistentClient.ts` and use package alias.
- Provider naming constraints are not clearly documented. Mitigation: hashed
  lowercase names, live smoke test, explicit error if rejected.
- `snapshot()` stops sessions. Mitigation: disable periodic snapshot scheduler
  by default in persistent beta.
- Filetree via `runCommand` may be slower than old `fs.readdir`. Mitigation:
  cache metadata and use one Node script that returns exactly what the UI needs.
- Race on first workspace open. Mitigation: create conflict falls back to get.
- Channel switch can strand old stable records. Mitigation: explicit error and
  reset path, no silent replacement.

## Open Questions

- Should full-app default to `persistent-beta` immediately, or behind an env
  flag until a live smoke passes on the deployment host?
- Do we want a user-visible "restart sandbox" action, or should resume remain
  invisible?
- Should workspace reset delete the persistent sandbox remotely, or only detach
  it from the DB row? Deletion is destructive and needs explicit UX.
- Should we expose session history/snapshots in workspace settings later?
- Do we seed persistent sandboxes from tarball template only, or also support
  importing from a running stable sandbox as a separate migration action?

## Done Criteria

- Full-app uses persistent Vercel sandbox names by default.
- One workspace can survive sandbox stop and reload file tree without losing
  files.
- DB shows durable sandbox name plus current session id.
- No silent empty sandbox creation on stable expired handles.
- Stable `vercel-sandbox` package behavior remains tested.
- `pnpm --filter @boring/agent typecheck` passes.
- Relevant agent/core/full-app tests pass.
- Live smoke script passes against Vercel beta and cleans up after itself.

# Objectives plugin

A thin Goal primitive for Boring workspace: **Objective**.

## Architecture note

This plugin is an in-repo, concrete `Objective` primitive, built under an
explicit owner ruling (2026-08-22) as a thin, forward-compatible seed of the
ratified kernel's `Objective`/`Outcome` records (see
`docs/plans/long-term/ratified/VISION.md`). The ratified plan places
objective storage in a separate kernel repo, after K1/P0 work, and defines
`Outcome` as a distinct record — this plugin's embedded `outcome?: string`
field is a placeholder for that distinct Outcome record, not a substitute
for it. This plugin is expected to be superseded or absorbed by the kernel
implementation when that work lands; it is not a competing or permanent
architecture.

Vocabulary is owner-ratified — this primitive is always called "Objective",
never "goal", "investigation", or "action".

```ts
interface Objective {
  id: string
  title: string
  objective: string        // the statement — what "done" means
  metric: string
  baseline: number
  target: number
  current: number
  status: "active" | "paused" | "achieved" | "abandoned"
  constraints: string[]
  evidenceRefs: string[]
  outcome?: string
  createdAt: string
  updatedAt: string
}
```

## What this plugin provides

- **Durable, single-writer-safe store** — `FileObjectiveStore` persists
  Objectives at `<workspaceRoot>/.boring/objectives.json` as a versioned,
  revisioned document (`{ version: 1, revision, objectives: [...] }`).
  Every mutation rereads the file, applies the change to a draft, then
  re-reads once more immediately before committing to confirm no other
  writer advanced the revision in between; a mismatch fails the mutation
  loudly instead of silently clobbering the newer write. Writes go through
  a cloned draft written atomically (tmp + rename) — there is no in-memory
  cache for `list`/`get` to observe ahead of a successful commit, so a
  failed write leaves nothing observable. Records loaded from disk are
  validated against `ObjectiveSchema` per-record; invalid records are
  skipped and reported via `getLoadDiagnostics()` rather than crashing
  consumers, and a legacy unversioned `{ objectives: Record<id, Objective> }`
  file migrates to the versioned shape on first write. In-memory keying uses
  a `Map`, and ids are restricted to a canonical server-generated pattern
  (`/^[a-z0-9][a-z0-9-]{0,62}$/`), so a stored `__proto__`-keyed record can't
  reach `Object.prototype`.
- **Workspace trust boundary** — every read/write re-resolves the `.boring`
  directory with a realpath containment check
  (`src/server/pathSafety.ts#ensureContainedDir`) and rejects if the
  resolved path escapes `workspaceRoot`, including a workspace-controlled
  symlink swapped in after the store was constructed.
- **Bridge ops** — `objective.v1.{list,get,create,update}`, registered as
  trusted WorkspaceBridge handlers. `list`/`get` allow browser/runtime/server
  callers (the pane only ever calls `get`). `create`/`update` allow only
  `runtime`/`server` callers — core's browser bridge policy grants every
  workspace member each operation's declared capability, so capability
  naming alone is not a role boundary; these mutations stay agent/
  server-domain. `create` accepts an optional `clientRequestId`; a retried
  create with the same key returns the original objective instead of
  duplicating it, and both the create/update input schemas refuse a
  payload whose serialized size would exceed a 24 KiB aggregate cap —
  safely under the bridge's 32 KiB output envelope, so a schema-valid
  Objective can never become unreadable through the bridge/pane.
- **Agent tools** — `list_objectives`, `get_objective`, `create_objective`,
  `update_objective`. Zod-validated, calling the store directly (same
  pattern as `ask_user` calling its runtime directly rather than round-
  tripping through the bridge). `create_objective` accepts the same
  `clientRequestId` idempotency key as the bridge op.
- **One Workbench surface** — a generic panel for kind `"objective"`. The
  agent opens it with `exec_ui openSurface({ kind: "objective", target:
  objectiveId })`. The panel shows title, the objective statement, metric
  progress (baseline → target, current), status, constraints, evidence
  references, and outcome. Since the agent updates Objectives server-side
  with no push channel to the browser, the pane refreshes on a 15s interval
  and on tab visibility change, guarded by a request-generation counter so
  a stale in-flight response (a slow fetch for a previous objective, or a
  superseded poll tick) can never overwrite newer state.

## Registration

Not wired into any app composition (that decision is queued for owner
review). To register it in a workspace server/front composition:

```ts
import objectivesPlugin from "@hachej/boring-objectives"
import { createObjectivesServerPlugin } from "@hachej/boring-objectives/server"

// front
const frontPlugins = [objectivesPlugin]

// server
const serverPlugins = [createObjectivesServerPlugin({ workspaceRoot })]
```

## Design notes

- Objectives are workspace-scoped, not session-scoped — unlike ask-user's
  blocking per-session questions, an Objective has no waiter/blocker
  semantics. There is intentionally no attention-blocker/inbox integration
  here; this is a thin CRUD primitive, not a blocking human-gate.
- The bridge framework's declarative `idempotencyPolicy` is `"none"` on
  these ops; idempotency is instead handled explicitly via the optional
  `clientRequestId` field on `create`/`create_objective`, persisted on the
  record and deduped inside the store's mutate path (see above).
- There is no store-level change-listener/subscriber mechanism. An earlier
  draft had one, but nothing consumed it — the browser can't subscribe to a
  server-process-local listener anyway without a push channel this plugin
  doesn't have — so it was removed rather than kept as unused complexity.
  The pane's interval/visibility refresh is the real invalidation path.

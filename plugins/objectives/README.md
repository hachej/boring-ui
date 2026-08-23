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

  **Concurrency contract: single live writer + safe restart overlap, not
  N-writer serializability.** This file is owned by exactly one workspace
  server process at a time. The store still has to survive a *restart*
  overlap — an old process still finishing a write while its replacement
  starts up — and multiple `FileObjectiveStore` instances constructed
  in-process. Both are handled by an owner-token lock file
  (`<path>.lock`, holding `{ pid, token, timestamp }`), acquired via
  exclusive-create (`open(path, "wx")`) before every mutation:
  - The pre-commit revision recheck happens *inside* the held lock, so two
    writers can never both observe a matching revision and both commit —
    the second blocks on lock acquisition until the first's commit and
    release complete, then re-reads the now-current revision.
  - Release deletes the lock file only if it still contains the releasing
    writer's own token, so a writer whose stale lock was reclaimed by
    someone else can never delete the reclaimer's replacement lock.
  - A lock is reclaimed only once clearly stale (30s, generous for a local
    JSON-file write) — the safe-restart-overlap escape hatch for a holder
    that crashed without releasing. Lock acquisition itself times out
    (5s) rather than hanging forever behind a wedged lock.

  Every mutation also rereads the file fresh (never a cached copy) and
  writes through a cloned draft, atomically (tmp + rename) — there is no
  in-memory cache for `list`/`get` to observe ahead of a successful
  commit, so a failed write leaves nothing observable. Records loaded
  from disk are validated against `ObjectiveSchema` per-record; invalid
  records (including ids that predate the canonical format, see below)
  are skipped and reported via `getLoadDiagnostics()` rather than
  crashing consumers, and a legacy unversioned
  `{ objectives: Record<id, Objective> }` file migrates to the versioned
  shape on first write. In-memory keying uses a `Map`, and ids are
  restricted to the canonical server-generated `obj-<uuid>` pattern
  (enforced on load, not just on generation), so a stored `__proto__`-
  keyed record can't reach `Object.prototype`.
- **Workspace trust boundary** — every read/write re-resolves the `.boring`
  directory with a realpath containment check
  (`src/server/pathSafety.ts#ensureContainedDir`), and separately lstats the
  resolved `objectives.json` path itself
  (`src/server/pathSafety.ts#assertFileNotSymlink`) since the store file is
  one path segment deeper than the directory check covers. Both checks
  reject if the resolved path escapes `workspaceRoot`, including a
  workspace-controlled symlink swapped in after the store was constructed.
  For mutations, both checks are re-run a second time *after* the write
  lock is acquired, narrowing (not eliminating) the gap between "path
  verified safe" and "path actually read/written" to inside the lock; the
  residual TOCTOU window — keying the lock file's own path off an earlier,
  unlocked resolution — is documented in `objectiveStore.ts`'s `mutate()`.
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

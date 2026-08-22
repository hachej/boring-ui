# Objectives plugin

A thin Goal primitive for Boring workspace: **Objective**.

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

- **Durable store** — `FileObjectiveStore` persists Objectives at
  `<workspaceRoot>/.boring/objectives.json` with atomic (tmp + rename)
  writes, mirroring `plugins/ask-user`'s `FileAskUserStore`. Objectives
  survive process restarts.
- **Bridge ops** — `objective.v1.{list,get,create,update}`, registered as
  trusted WorkspaceBridge handlers (browser/runtime/server callers), so the
  front can rehydrate an objective on mount/reload the same way ask-user's
  `ask-user.v1.pending` rehydrates a pending question.
- **Agent tools** — `list_objectives`, `get_objective`, `create_objective`,
  `update_objective`. Zod-validated, calling the store directly (same
  pattern as `ask_user` calling its runtime directly rather than round-
  tripping through the bridge).
- **One Workbench surface** — a generic panel for kind `"objective"`. The
  agent opens it with `exec_ui openSurface({ kind: "objective", target:
  objectiveId })`. The panel shows title, the objective statement, metric
  progress (baseline → target, current), status, constraints, evidence
  references, and outcome.

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
- `idempotencyPolicy` on the bridge ops is `"none"`. A retried
  `objective.v1.create` call can create a duplicate objective. This is an
  accepted simplification for a thin primitive; revisit with a
  client-derived idempotency key (see `plugins/ask-user`'s
  `deriveIdempotencyKey`) if duplicate-objective risk becomes a real
  problem.

# Issue 590 — boring-automation plugin

## Problem Statement

Add a self-contained trusted plugin, `boring-automation`, for scheduled agent prompts. Users define automations with a cron schedule, timezone, model, and editable prompt, then inspect prior runs as normal chat sessions.

This supersedes the recurring-jobs portion of #197. Boring Claw and GitHub issue auto-picker controls remain out of scope.

## Solution

Create `plugins/boring-automation/` as a trusted app/internal plugin. The plugin owns automation configuration, local prompt files, schedule policy, run metadata, and UI. It does not own chat transcripts; runs reference normal Pi sessions by `sessionId`.

Keep the first implementation deliberately local and single-workspace. Do not design hosted persistence, distributed locking, or generic lifecycle APIs until Slice 0 confirms the actual runtime topology and missing seams.

## User Stories / Scenarios

- A CLI user can create an automation with an editable Markdown prompt under `.pi/automation/prompts/`.
- A user can set title, enabled state, cron, timezone, and model.
- A user can expand an automation and inspect prior runs with start time, status, duration, and token usage when available.
- Clicking a run opens its existing Pi chat session.
- Editing an automation does not rewrite the prompt/model snapshots attached to previous runs.
- Hosted users receive the same UX only after hosted topology and persistence ownership are explicitly resolved.

## Decisions

1. **Trusted plugin**
   - This is an app/internal plugin, not a route-free runtime `.pi/extensions` plugin.

2. **Automation domain stays in the plugin**
   - Core/workspace/agent changes are allowed only for generic missing seams.
   - No automation-specific concepts move into core.

3. **No hidden background timer**
   - `WorkspaceServerPlugin` has no supported start/dispose lifecycle.
   - The plugin must not hide `setInterval` inside route registration.
   - MVP exposes deterministic manual/due-run operations; an external trigger or later generic lifecycle seam invokes them.

4. **Local storage is single-workspace by construction**
   - One `FileAutomationStore` is rooted at one workspace's `.pi/automation/` directory.
   - Store calls do not thread `workspaceId`; the host selects the workspace/store before calling plugin logic.
   - Hosted multi-tenant scoping is designed only after Slice 0 and must use a host-verified workspace identity.

5. **Markdown is canonical in CLI mode**
   - Prompt body lives at `.pi/automation/prompts/<automation-id>.md` so users and agents can edit it directly.
   - Local metadata lives in `.pi/automation/store.json`.
   - Hosted prompt storage is undecided until the hosted persistence slice; likely DB text, but the local Markdown requirement remains.
   - Because local prompt and metadata are separate resources, `store.json` is written last as the commit point. A prompt file without a store entry is a recoverable orphan eligible for cleanup; a store entry whose prompt file is missing loads with an empty body and can be repaired by saving the prompt again. Both partial-failure states are tested.

6. **Run state has one writer**
   - The future executor owns run creation and lifecycle transitions.
   - Public HTTP routes may list/read runs, but must not expose generic create/patch run-history endpoints.
   - Tests call the store/executor seam directly.

7. **Transcript ownership remains unchanged**
   - Runs store `sessionId`; transcripts remain in the normal Pi session store.
   - Hosted transcripts remain on the durable host volume via `BORING_AGENT_SESSION_ROOT`, not automation tables.

8. **Minimal truthful snapshots**
   - Runs snapshot `promptSnapshot` and `modelSnapshot`.
   - `scheduledFor` records which scheduled occurrence ran.
   - Cron/timezone remain automation configuration, not duplicated on every run.

9. **Token accounting is deferred**
   - Use existing Pi usage/metering seams if they can attribute usage to a run/session.
   - Do not invent a second token-accounting system.

10. **Inbox visual language without cross-plugin imports**
    - Do not import ask-user's private Inbox components.
    - Use local styling initially; extract a generic shared primitive only when a second real caller proves the abstraction.

## Flag / Abstraction

- Needed now?: A thin plugin-local `AutomationStore` interface is acceptable for dependency injection and tests.
- Not needed now?: No hosted store contract, distributed lease abstraction, generic scheduler interface, or cross-store conformance promise before Slice 0.
- Path:
  - Slice 1 tests the concrete `FileAutomationStore` behavior.
  - When a real second store exists, extract only the shared semantics both stores can honestly satisfy and add conformance tests then.
- Rollback:
  - Remove the plugin from app composition.
  - Local files remain under `.pi/automation/`; transcripts require no migration.

## Proposed Local Types

```ts
type Automation = {
  id: string
  title: string
  enabled: boolean
  cron: string
  timezone: string
  model: string
  createdAt: string
  updatedAt: string
}

type AutomationRun = {
  id: string
  automationId: string
  sessionId: string | null
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled"
  trigger: "manual" | "scheduled"
  scheduledFor: string | null
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  promptSnapshot: string
  modelSnapshot: string
  error: string | null
  createdAt: string
  updatedAt: string
}
```

Patch semantics must be storage-neutral before a second store is added: nullable persisted fields use explicit `null` consistently rather than JSON-only "missing property means cleared" behavior.

## Known Seams

- Trusted plugin shape: `packages/workspace/docs/PLUGIN_SYSTEM.md` and `PLUGIN_STRUCTURE.md`.
- Model override: Pi chat `PromptPayload.model` is honored.
- Headless session launch: public `Agent.send()` is canonical and already creates normal sessions, forwards model/context, and streams terminal events; Slice 3A must expose the host's existing workspace-scoped agent through a minimal trusted dispatcher.
- Chat opening: plugin-facing `WorkspaceShellCapabilities.openDetachedChat(sessionId)` exists.
- Token usage: the executor aggregates live Pi `usage` events from `Agent.send()`; it must not query billing tables directly.
- Hosted workspace identity: raw `x-boring-workspace-id` is insufficient authorization; hosted composition injects a verified actor resolver.
- Error boundary: stores throw domain errors only; route code maps those errors to HTTP status and persistence code never carries HTTP status codes.

## Test Seams

- Highest public seams:
  - automation/prompt CRUD routes;
  - read-only run-history route;
  - front list/edit/expand/open-session behavior.
- Store seam:
  - concrete file-store tests for atomic metadata writes, editable Markdown prompts, missing/orphan prompt recovery, and run metadata.
- Avoid testing:
  - cron-library internals;
  - duplicated transcript rendering;
  - speculative Postgres semantics before a Postgres implementation exists.

## Acceptance

### Slice 1 acceptance

- Trusted plugin package and placeholder front contribution exist.
- `FileAutomationStore` persists local automation/run metadata in `.pi/automation/store.json`.
- Prompt Markdown is directly editable under `.pi/automation/prompts/`.
- Automation and prompt CRUD routes work.
- Run history is read-only over public HTTP.
- File-store recovery behavior for missing/orphan prompt files is explicit and tested.
- No scheduler, session launcher, Postgres store, distributed lock, or empty future seam file ships.

### Feature acceptance

- Automations can be configured with schedule, timezone, model, enabled state, and Markdown prompt.
- Manual/due execution creates normal Pi sessions through a supported headless seam.
- Run history shows status, time, duration, session link, and token totals when available.
- Run click opens the existing chat session surface.
- Hosted storage and trigger behavior are implemented only after topology decisions are approved.

## Proof

Slice 1:

```bash
pnpm --filter @hachej/boring-automation typecheck
pnpm --filter @hachej/boring-automation test
pnpm --filter @hachej/boring-automation build
```

UI slice:

- component/integration tests;
- screenshot showing automation list, expanded run history, and chat opening.

Execution slice:

- deterministic manual-run test;
- fake-clock due-run policy tests;
- manual workspace demo linking to the resulting session.

## Slices

### Slice 0: Seam confirmation spike — complete

**Delivered:**
- canonical headless path: inject the host's existing workspace-scoped `Agent` dispatcher and consume `Agent.send()`;
- trigger model: plugin-owned deterministic due policy invoked by CLI/OS cron or a host/platform trigger; no hidden timer;
- hosted topology: orchestration on the authenticated public host, execution through the existing sandbox/remote-worker runtime, transcripts on `BORING_AGENT_SESSION_ROOT`;
- hosted gates: generic/app-owned migration registration, verified actor resolver, service principal, and billing owner decision;
- token path: aggregate live Pi `usage` events for the first executor slice.

**Proof:** [`seam-spike.md`](./seam-spike.md) with code references, decisions, rejected alternatives, and residual risks.

**Review budget:** inside.

### Slice 1: Local plugin shell, file store, and safe routes

**Delivers:**
- package shell and placeholder panel/command;
- shared local schemas/types/error codes;
- thin plugin-local store seam plus concrete `FileAutomationStore` tests;
- `.pi/automation/store.json` metadata and canonical Markdown prompts;
- automation/prompt CRUD routes;
- read-only run-history route;
- no public run create/patch routes;
- no per-call workspace context in the local store;
- no empty `schedule.ts` or future implementation scaffolding.

**Blocked by:** None.

**Proof:** Slice 1 commands above.

**Review budget:** inside.

### Slice 2: Front UI

**Delivers:**
- automation list/cards;
- prompt editor;
- cron/timezone/model/enabled controls;
- expanded read-only run history;
- run click through plugin-facing `openDetachedChat(sessionId)`;
- loading, empty, validation, and error states.

**Blocked by:** Slice 1.

**Proof:** component tests and screenshot/manual workspace proof.

**Review budget:** inside.

### Slice 3A: Generic workspace agent dispatcher

**Delivers:**
- an automation-agnostic trusted-host capability that resolves the existing workspace runtime;
- delegation to the existing `Agent.send()`, `interrupt()`, and `stop()` rather than creating a second runtime;
- an explicit trust boundary: upstream actor resolution authorizes context; the dispatcher trusts that caller-supplied context;
- tests for workspace/user context, normal session creation, model forwarding, terminal streaming, interruption/stop, and failure behavior.

**Blocked by:** None.

**Review budget:** medium; public/generic agent-workspace seam.

### Slice 3B: Plugin manual-run executor

**Delivers:**
- executor-owned run creation and transitions;
- prompt/model snapshots;
- normal Pi session creation via Slice 3A;
- live usage aggregation with missing usage represented as unknown;
- deterministic `Run now` operation and proof linking to the normal session.

**Blocked by:** Slice 3A.

**Review budget:** medium.

### Slice 4: Pure due policy and external trigger adapter

**Delivers:**
- cron/timezone validation;
- deterministic `findDue(now)` / `runDue(now)`;
- no-backfill, overlap, DST, and stale-run policies;
- local CLI/OS-cron invocation and a host-callable adapter;
- no plugin-owned background timer.

**Blocked by:** Slice 3B.

**Review budget:** medium.

### Slice 5: Hosted persistence and verified actor composition

**State:** `ready-for-human` before implementation.

**Delivers after owner decisions:**
- app-owned registration of plugin migrations using core's DB connection;
- plugin-backed Postgres store;
- verified actor resolver for hosted routes;
- stored automation owner and fail-closed reassignment behavior;
- duplicate-safe scheduled-occurrence lease.

**Blocked by:** owner decisions on migration registration, billing identity, and hosted automation role policy.

**Review budget:** high.

### Slice 6: Hosted platform trigger

**Delivers:**
- authenticated internal service-principal invocation;
- duplicate-safe hosted due runs;
- operational proof across restart/multiple invocations.

**Blocked by:** Slice 5.

**Review budget:** high.

## Schedule Policy To Preserve During Replan

- no hidden in-process timer without lifecycle/dispose support;
- no unbounded backfill after downtime;
- skip/conflict while the same automation is already running;
- timezone-aware due calculation with explicit DST behavior;
- stale-running reconciliation after crash/redeploy;
- `Run now` remains deterministic and testable.

## Wide Refactor Strategy

Not a wide refactor. Any missing generic workspace/agent capability must be planned independently and remain automation-agnostic.

## Out of Scope

- Hosted Markdown as a predetermined canonical format.
- Prompt version-history UI beyond run snapshots.
- New transcript viewer.
- Hidden plugin timers.
- Automation-specific core logic.
- Runtime/untrusted plugin support.
- Boring Claw/GitHub auto-picker controls from #197.

## Open Questions / Gates

Confirmed by Slice 0:

- headless execution uses the host's existing `Agent.send()` through a minimal trusted dispatcher seam;
- due evaluation is externally invoked, never a hidden plugin timer;
- hosted orchestration stays on the public host while sandbox/worker executes workspace operations;
- first-pass token totals come from live usage events, not direct billing-ledger queries.

Owner decisions still required before Slice 5:

1. Should hosted migrations use app-owned explicit registration (recommended first) or a generic trusted-plugin migration contribution?
2. Is scheduled usage billed to the automation owner (recommended) or a future workspace billing account?
3. Which roles may create, edit, disable, delete, or reassign hosted automations?

## Loop Exit

- Slice 0 state: complete; see `docs/issues/590/seam-spike.md`.
- `ready-for-agent`: Slice 2 UI, Slice 3A generic dispatcher, then Slice 3B local manual executor.
- `ready-for-human`: Slice 5 hosted migration/billing/role decisions.
- First hosted blockers: owner decisions on migration registration, scheduled billing identity, and hosted automation role policy.
- Next recommended work: Slice 2 can proceed independently; execution should start with Slice 3A.

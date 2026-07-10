# Issue 590 — boring-automation plugin

## Problem Statement

Add a self-contained trusted plugin, `boring-automation`, for scheduled agent prompts. Users define automations with a cron schedule, timezone, model, and editable prompt, then inspect prior automation runs as normal chat sessions.

This supersedes the recurring-jobs portion of #197. The #197 GitHub issue auto-picker / Boring Claw operator surface is intentionally not part of this plugin slice; it can be revived later as a separate operator plugin if that product direction returns.

The plugin must work first in local CLI mode and later in hosted mode without moving automation-specific concepts into core. Generic seams may still be needed in workspace/agent for headless session launch or hosted plugin persistence; those are explicit gates, not assumed.

## Solution

Create `plugins/boring-automation/` as an app/internal trusted plugin with its own front, server routes, shared types, persistence abstraction, schedule calculation, and run metadata. The plugin stores automation metadata and run metadata only. It does **not** own chat transcript storage; each run links to a normal Pi chat session via `sessionId`.

Initial package shape:

```txt
plugins/boring-automation/
  src/
    front/
      index.tsx
      AutomationPanel.tsx
      AutomationCard.tsx
      PromptEditor.tsx
      RunsList.tsx
    server/
      index.ts
      routes.ts
      store.ts
      fileStore.ts
      schedule.ts
    shared/
      constants.ts
      error-codes.ts
      schema.ts
      types.ts
```

Do **not** add `scheduler.ts`, `sessionLauncher.ts`, or `postgresStore.ts` in Slice 1. Those depend on seams that must be confirmed first.

## User Stories / Scenarios

- As a local CLI user, I can create an automation whose prompt is an editable markdown file under `.pi/automation/prompts/`.
- As a user, I can choose a cron schedule, timezone, model, enabled state, and prompt.
- As a user, I can expand an automation card and see prior runs with start time, duration, status, and token totals when available.
- As a user, I can click a run and open the associated chat session using the existing workspace chat/session surface.
- As a user, changing the automation prompt later does not rewrite prior run history because each run stores snapshots.
- As a hosted user, I can use the same automation UX once plugin-owned hosted persistence and execution topology are decided.

## Decisions

1. **Trusted app/internal plugin, not runtime plugin**
   - Required because the feature needs server routes, persistence, and eventually headless session launch.
   - Runtime/generated `.pi/extensions` plugins are route-free and are not appropriate.

2. **Self-contained plugin domain**
   - Automation types, validation, stores, routes, schedule calculation, and UI live in `plugins/boring-automation`.
   - Workspace/agent/core changes are allowed only for generic seams, and must be planned explicitly.

3. **No plugin-owned background timer in MVP**
   - `WorkspaceServerPlugin` currently has no lifecycle/dispose hook for long-running services.
   - MVP should not hide a `setInterval` inside route registration.
   - The plugin will expose deterministic routes such as `POST /api/v1/boring-automation/runs/run-now` and, later, `POST /api/v1/boring-automation/runs/run-due`.
   - Schedule calculation belongs to the plugin; the trigger can be a host cron, CLI command, or future generic lifecycle hook.

4. **Storage split by host mode**
   - CLI/local: filesystem store under the workspace.
   - Hosted: plugin-owned DB tables, but only after the migration/connection ownership decision is made.

5. **Prompt storage**
   - CLI/local canonical prompt body: `.pi/automation/prompts/<automation-id>.md`.
   - Hosted canonical prompt body: DB text column.
   - Hosted markdown export/import is out of scope for MVP.

6. **Transcript storage**
   - Runs reference existing Pi sessions by `sessionId`.
   - Session transcripts remain in the existing Pi session store. In hosted deployments, that means durable host volume via `BORING_AGENT_SESSION_ROOT`, not Postgres.
   - Do not duplicate chat transcript data inside automation tables/files.

7. **Run snapshots**
   - Each run stores `promptSnapshot`, `modelSnapshot`, `cronSnapshot`, and `timezoneSnapshot`.

8. **Token totals are a separate slice**
   - Status, timing, and session link come first.
   - Token totals should use existing usage/metering seams if they are queryable/capturable for headless runs; otherwise split into a separate follow-up.

9. **Inbox visual language without cross-plugin dependency**
   - Do not import `plugins/ask-user` Inbox components from `boring-automation`.
   - Slice 2 should either duplicate the small row/card styling locally or extract a generic run/session block to a shared UI package as a separate decision. Default: local duplication for MVP to avoid cross-plugin coupling.

## Flag / Abstraction

- Needed?: Yes, an `AutomationStore` abstraction inside the plugin.
- Path:
  - `FileAutomationStore` for CLI/local.
  - `PostgresAutomationStore` later for hosted, after the migration mechanism is decided.
  - Shared store conformance suite authored in Slice 1 and reused by every implementation.
- Rollback:
  - Plugin can be disabled/removed from app composition.
  - File data remains under `.pi/automation/`; hosted data remains in plugin-owned tables.
  - No transcript migration is needed because transcripts stay in the normal session store.

## Proposed Types

`workspaceId` is a route/security concern and a hosted-store partition key. The file store is workspace-root scoped and single-workspace; it may store `workspaceId` for validation, but it must not create nested multi-workspace layouts unless a real multi-workspace-per-tree case appears.

```ts
type Automation = {
  id: string
  workspaceId?: string
  title: string
  enabled: boolean
  cron: string
  timezone: string
  model: string
  promptRef?: string
  createdAt: string
  updatedAt: string
}

type AutomationRun = {
  id: string
  automationId: string
  workspaceId?: string
  sessionId?: string
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled"
  trigger: "manual" | "scheduled"
  scheduledFor?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  promptSnapshot: string
  modelSnapshot: string
  cronSnapshot: string
  timezoneSnapshot: string
  error?: string
}
```

```ts
interface AutomationStore {
  listAutomations(ctx: AutomationStoreCtx): Promise<Automation[]>
  getAutomation(ctx: AutomationStoreCtx, id: string): Promise<Automation | null>
  createAutomation(ctx: AutomationStoreCtx, input: AutomationCreate): Promise<Automation>
  updateAutomation(ctx: AutomationStoreCtx, id: string, patch: AutomationPatch): Promise<Automation>
  deleteAutomation(ctx: AutomationStoreCtx, id: string): Promise<void>

  getPrompt(ctx: AutomationStoreCtx, automationId: string): Promise<string>
  updatePrompt(ctx: AutomationStoreCtx, automationId: string, body: string): Promise<void>

  createRun(ctx: AutomationStoreCtx, input: AutomationRunCreate): Promise<AutomationRun>
  updateRun(ctx: AutomationStoreCtx, runId: string, patch: AutomationRunPatch): Promise<AutomationRun>
  listRuns(ctx: AutomationStoreCtx, automationId: string): Promise<AutomationRun[]>
  findRunningRun(ctx: AutomationStoreCtx, automationId: string): Promise<AutomationRun | null>
}

type AutomationStoreCtx = {
  workspaceId?: string
}
```

## Known Seams To Use Or Confirm

- **Plugin structure/routes:** `packages/workspace/docs/PLUGIN_SYSTEM.md` and `PLUGIN_STRUCTURE.md`; use trusted app/internal plugin shape.
- **No lifecycle hook today:** `WorkspaceServerPlugin` has routes/tools/provisioning/etc. but no supported timer lifecycle. This blocks plugin-owned cron loops.
- **Model override:** `PromptPayload.model` is honored by the Pi chat prompt path; model support should flow through that path rather than inventing a model runner.
- **Headless session launch:** not yet a clean public plugin API. Needs a spike before any run execution slice.
- **Chat opening UI:** plugin-facing `WorkspaceShellCapabilities` exposes `openDetachedChat(sessionId)`. `openChatPane` is internal today; if the desired UX needs pane-not-detached behavior, expose a small generic plugin-facing capability before wiring run clicks.
- **Token accounting:** existing metering/usage code exists under `packages/agent/src/server/pi-chat/metering.ts` and governance plugin code. Slice 6 must decide whether usage can be queried after a run or must be captured during execution.
- **Workspace resolution for routes:** plugin routes are registered as raw Fastify plugins. Resolve the current workspace via the host request context when available (`request.workspaceContext?.workspaceId`), otherwise the workspace header used by agent routes (`x-boring-workspace-id`) with the same default-workspace fallback policy as agent routes. Slice 1 must verify this hook/header is in scope for plugin routes before inventing any new resolver.

## Test Seams

- Highest public seam:
  - plugin server routes for CRUD, prompt editing, run metadata, and later manual/due run triggers;
  - front panel behavior for list/edit/expand/open session.
- Existing prior art:
  - `plugins/ask-user` for trusted plugin structure, front panel, routes, app-left action, and file-backed store style.
  - `plugins/ask-user` store tests for file-backed store style. There is no reusable store-conformance factory today; `boring-automation` should author a new shared conformance suite in Slice 1.
  - agent Pi chat routes/session store for normal session lifecycle.
  - workspace shell capabilities for opening chat panes/detached chat.
- Avoid testing:
  - low-level cron library internals;
  - duplicated transcript rendering;
  - implementation details of existing chat UI.

## Acceptance

- A trusted `boring-automation` plugin exists and is self-contained for automation domain logic.
- Local CLI mode can persist automations and prompts under `.pi/automation/`.
- Shared store conformance tests exist from Slice 1.
- Automations can be created, edited, listed, enabled/disabled, and deleted.
- Prompt body can be edited.
- Runs are listed under each automation with status, start time, duration, and token totals when available.
- Manual/due run trigger routes exist before any autonomous scheduling claim.
- Scheduled execution uses a supported trigger model; no hidden route-registration timer.
- Runs create/link normal Pi chat sessions only after the headless session-launch seam is confirmed or added.
- Clicking a run opens the existing chat/session surface.
- Each run snapshots prompt/model/cron/timezone.

## Proof

- Exact commands:
  - `pnpm --filter @hachej/boring-automation test`
  - `pnpm --filter @hachej/boring-automation typecheck`
  - relevant workspace/app integration test command once composed.
- Screenshot/demo:
  - Automations panel with at least one expanded automation and run list.
  - Prompt editor visible.
  - Run click opening chat session pane/detached chat once UI seam is wired.
- Manual steps:
  1. Create automation.
  2. Edit prompt/model/cron.
  3. Trigger a run manually or via due-run route.
  4. Verify run row records status/duration/session link.
  5. Click run and inspect chat session.

## Slices

### Slice 0: Seam confirmation spike

**Delivers:**
- Documented answer for scheduler trigger model: external host/CLI trigger vs new generic workspace plugin lifecycle hook.
- Documented answer for headless session launch: existing API, new exported service, or required agent/workspace change.
- Documented hosted topology: persistent Node vs serverless, vercel-sandbox constraints, single vs multi-instance.
- Documented workspace route scoping path for plugin routes, including whether `request.workspaceContext?.workspaceId` is available to root-registered plugin routes and the `x-boring-workspace-id` fallback/default behavior.
- No production feature code required.

**Blocked by:** None.

**Proof:**
- short markdown note appended to this issue or `docs/issues/590/seam-spike.md` with code references and chosen path.

**Review budget:** inside; must complete before Slice 3, Slice 4, and Slice 5a.

### Slice 1: Plugin shell + file store + CRUD routes

**Delivers:**
- `plugins/boring-automation` package skeleton.
- shared schemas/types/error codes/constants.
- `AutomationStore` interface.
- shared store conformance suite, run against `FileAutomationStore`.
- `FileAutomationStore` using:

  ```txt
  .pi/automation/
    store.json          # automations + run metadata; single atomic state file
    prompts/
      <automation-id>.md
  ```

- CRUD routes for automations and prompts.
- Run metadata routes only; no run execution and no session launch.
- Explicit plugin-route workspace resolution for local mode, even if it resolves to an implicit single workspace.

**Blocked by:** None, after this revised plan.

**Proof:**
- `pnpm --filter @hachej/boring-automation test`
- `pnpm --filter @hachej/boring-automation typecheck`

**Review budget:** inside.

### Slice 2: Front UI

**Delivers:**
- Automations panel/page.
- Automation cards.
- Expand/collapse run list.
- Prompt editor.
- Cron/timezone/model/enabled fields.
- Initial empty/loading/error states.
- Run row styling locally matching Inbox visual language without importing ask-user internals.
- Run click opens plugin-facing `openDetachedChat(sessionId)`. If the intended UX requires an in-pane chat instead of detached chat, this slice includes a small generic workspace capability exposure rather than using the internal `openChatPane` directly.

**Blocked by:** Slice 1; chat-open capability confirmation.

**Proof:**
- front unit tests for data hooks/components.
- screenshot/manual workspace check.

**Review budget:** inside if capability exists; otherwise small workspace API change requires review.

### Slice 3: Manual run trigger + headless session launch

**Delivers:**
- `POST` route for `Run now`, always present for deterministic tests.
- Supported headless path to create/get a normal Pi session and submit the prompt with `{ model }`.
- Run lifecycle records queued/running/succeeded/failed/cancelled, timestamps, duration, sessionId, and error.
- Stale `running` reconciliation policy: runs older than a configured timeout are marked failed before starting new work.
- Overlap policy: skip/return conflict if an automation already has a running run.

**Blocked by:** Slice 0 headless session-launch answer; Slice 1.

**Proof:**
- route test with fake headless launcher.
- manual workspace demo showing a created session.

**Review budget:** high if it requires agent/workspace API changes; split if new generic seam is needed.

### Slice 4: Due-run trigger and schedule policy

**Delivers:**
- Schedule calculation for enabled automations.
- `POST /run-due` style route that runs all automations due at or before a supplied/current timestamp.
- Cron policy:
  - no backfill for missed downtime beyond the current due check;
  - skip-if-overlapping;
  - timezone-aware due calculation;
  - explicit DST behavior documented by chosen library.
- No plugin-owned long-running timer unless Slice 0 chose and implemented a lifecycle hook.

**Blocked by:** Slice 0 scheduler trigger answer; Slice 3.

**Proof:**
- fake-clock tests for due calculation, no-backfill, overlap, and timezone/DST policy.
- manual `run-due` route test.

**Review budget:** inside if external trigger model; high if adding lifecycle hook.

### Slice 5a: Hosted DB store and migration ownership

**Delivers:**
- Decision on plugin-owned hosted DB migration mechanism.
- plugin-owned DB schema/tables for automations and runs.
- `PostgresAutomationStore` passing the same conformance suite from Slice 1.
- Hosted route/store context must use a host-verified workspace resolver or middleware; raw `x-boring-workspace-id` header trust is not sufficient for multi-tenant hosted mode.

**Blocked by:** Slice 0 hosted topology answer; migration ownership decision.

**Proof:**
- DB/store tests.
- migration/schema proof command chosen by the hosted app.

**Review budget:** high; no current plugin Postgres prior art.

### Slice 5b: Hosted composition wiring

**Delivers:**
- Hosted app composes `boring-automation` with `PostgresAutomationStore`.
- Hosted transcripts remain on durable session volume via `BORING_AGENT_SESSION_ROOT`.
- Workspace/user scoping is enforced by route/store context.

**Blocked by:** Slice 5a.

**Proof:**
- hosted integration test or smoke path.

**Review budget:** medium/high.

### Slice 5c: Hosted duplicate-run locking

**Delivers:**
- Lease/advisory-lock strategy for scheduled due runs in multi-instance hosted mode.
- Tests for duplicate-trigger prevention.

**Blocked by:** Slice 5a and hosted topology answer.

**Proof:**
- lock/lease tests.

**Review budget:** medium/high.

### Slice 6: Token accounting

**Delivers:**
- Confirmed usage capture/query strategy using existing Pi chat metering/usage seams.
- Aggregated input/output/total tokens on `AutomationRun`.
- Tests for successful and missing-usage cases.

**Blocked by:** Slice 3 and usage seam confirmation.

**Proof:**
- usage aggregation tests.

**Review budget:** medium; split further if the existing usage seam is not queryable.

### Slice 7: UI polish

**Delivers:**
- Duration/token/status formatting.
- Sorting/filtering run history.
- Empty/error/loading refinements.

**Blocked by:** Slice 2; optionally Slice 6 for token display.

**Proof:**
- screenshot/manual run history proof.

**Review budget:** inside.

## Wide Refactor Strategy

Not a wide refactor. However, later slices may require small generic workspace/agent seams:

- plugin-facing chat-open capability exposure if not already available;
- headless session-launch service/API;
- optional plugin lifecycle hook if external triggers are rejected.

Any such change must be planned as a generic platform seam, not automation-specific core logic.

## Out of Scope

- Hosted markdown files as canonical prompt storage.
- Prompt version history UI beyond per-run snapshots.
- Complex recurrence UI beyond cron/timezone validation.
- Hidden plugin-owned in-process timers without lifecycle/dispose support.
- New transcript viewer.
- Moving automation concepts into core.
- Untrusted/runtime plugin support.
- Boring Claw / GitHub issue auto-picker operator controls from #197; #590 only carries forward the recurring scheduled-prompt automation part.

## Open Questions / Gates

Blocking only later slices, not Slice 1:

1. Slice 0: exact headless session-launch API/path.
2. Slice 0: hosted topology and vercel-sandbox implications.
3. Slice 0/Slice 5a: plugin-owned DB migration ownership.
4. Slice 2: plugin-facing exposure of `openDetachedChat`.
5. Slice 5b: hosted workspace/user scoping must validate/normalize workspace ids before plugin store access; raw workspace headers are local-mode fallback only.
6. Slice 6: usage capture/query path for token totals.

## Loop Exit

- State: `ready-for-agent` for Slice 1 after Opus 4.8 review edits.
- Plan path: `docs/issues/590/plan.md`.
- Review path: `docs/issues/590/thermo-review-opus48.md`.
- Blockers: Slice 0 must complete before run execution, due scheduling, Slice 5a DB/migration work, and hosted composition/locking.
- Next action: implement Slice 1 or run Slice 0 if the owner wants to de-risk execution before any code.

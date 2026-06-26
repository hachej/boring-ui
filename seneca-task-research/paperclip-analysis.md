# Paperclip analysis for Seneca/background-agent task management

Scope: direct read of cloned repo `/tmp/paperclip-LqFh5p/paperclip`; no files modified except this report.

## Executive takeaways

Paperclip’s strongest lesson is that background-agent management is not just `Task + Run + Session`. It is a **task execution control plane** with separate durable concepts for: task intent, assignment/checkout lock, wake request, run attempt, run event/log stream, per-agent/per-task session continuity, workspace/environment lease, activity/audit trail, blocker graph, and recovery/supervision state.

For Seneca, keep the first version smaller than Paperclip, but do not collapse these into chat sessions. Add explicit task assignment/checkout and run/wakeup/session tables around existing Pi session persistence.

## 1. Task / issue model

### Paperclip model shape

Paperclip’s primary task row is `issues`, not a thin todo item:

- `packages/db/src/schema/issues.ts:22-72` defines `issues` with `companyId`, `projectId`, `projectWorkspaceId`, `goalId`, `parentId`, `title`, `description`, `status`, `workMode`, `priority`, `assigneeAgentId`, `assigneeUserId`, `checkoutRunId`, `executionRunId`, `executionAgentNameKey`, `executionLockedAt`, origin/idempotency fields, execution policy/state, monitor fields, execution workspace fields, and lifecycle timestamps.
- `packages/shared/src/types/issue.ts:532-584` mirrors this to UI/API as `Issue`, including `checkoutRunId`, `executionRunId`, `executionWorkspaceId`, `blockedBy`, `blocks`, `blockerAttention`, recovery/watchdog summaries, labels, and timestamps.
- Status values are documented in the agent skill: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled` (`skills/paperclip/SKILL.md:139-148`).
- `workMode` is separate from status (`standard` vs planning-mode work; see schema `work_mode` at `packages/db/src/schema/issues.ts:33` and shared type field at `packages/shared/src/types/issue.ts:543`).

### Dependencies and blockers

Paperclip treats blockers as first-class issue relations, not prose:

- Agent instructions require `blockedByIssueIds` for dependencies and warn that `parentId` alone is not a blocker (`skills/paperclip/SKILL.md:153-176`, `skills/paperclip/SKILL.md:310`).
- Checkout refuses blocked work with unresolved blockers: `server/src/services/issues.ts:5557-5561` loads dependency readiness and throws `Issue is blocked by unresolved blockers`.
- Queued runs are also gated at claim time: `server/src/services/heartbeat.ts:7414-7421` cancels queued runs for unresolved blockers unless it is an allowed interaction wake.

### Design lesson for Seneca

Use `Task` as the durable business object, but include enough execution-control fields from day one:

- status/work mode/priority
- assignee agent/user
- parent/children and explicit `blockedByTaskIds`
- current checkout/run lock fields
- origin/idempotency fields for recurring or generated tasks
- workspace/session linkage fields
- lifecycle timestamps and terminal reason

Do not encode “blocked”, “waiting for user”, “review”, or “agent is still working” only in chat text.

## 2. Agent heartbeat runtime

### Paperclip heartbeat primitives

Paperclip has a DB-backed wake/run pipeline:

- `agent_wakeup_requests` is the durable wake queue: `companyId`, `agentId`, `source`, `reason`, JSON payload, `status`, `coalescedCount`, requester, `idempotencyKey`, `runId`, requested/claimed/finished timestamps (`packages/db/src/schema/agent_wakeup_requests.ts:6-37`).
- `heartbeat_runs` is each execution attempt: `invocationSource`, `triggerDetail`, `status`, start/finish/error fields, `wakeupRequestId`, usage/result JSON, `sessionIdBefore/After`, log refs/excerpts, process PID/group, output heartbeat fields, retry/liveness fields, and `contextSnapshot` (`packages/db/src/schema/heartbeat_runs.ts:6-58`).
- `heartbeat_run_events` is append-only-ish run event/log persistence with `runId`, monotonic `seq`, `eventType`, stream/level/message/payload (`packages/db/src/schema/heartbeat_run_events.ts:4-28`).

Runtime claim/execution pattern:

- `startNextQueuedRunForAgent()` enforces per-agent invokability and concurrency, sorts queued runs by issue readiness/status/priority, claims up to available slots, then launches `executeRun()` (`server/src/services/heartbeat.ts:8316-8391`).
- `claimQueuedRun()` checks agent invokability, budgets, daily caps, pause holds, dependency gates, and stale issue context before atomically changing a run from `queued` to `running` via `WHERE id = ? AND status = 'queued'` (`server/src/services/heartbeat.ts:7369-7468`).
- Claim is deliberately “lazy locking”: only when a run becomes `running` does it stamp the issue `executionRunId`/`executionLockedAt` (`server/src/services/heartbeat.ts:7491-7515`).
- Orphan recovery scans `running` runs with no live in-memory execution/process and marks/retries/finalizes them (`server/src/services/heartbeat.ts:8057-8149`).

### Design lesson for Seneca

Model **wake request** separately from **run**. A task assignment/comment/schedule should create or coalesce a wake request, which then creates/points to a run. This avoids duplicate wakes, allows debouncing comments, makes “queued vs running vs deferred” visible, and gives recovery code something to reason about.

## 3. Agent-task session continuity

Paperclip does not rely only on global agent session state:

- `agent_task_sessions` stores a unique session record per `(companyId, agentId, adapterType, taskKey)` with session params/display id, last run, and last error (`packages/db/src/schema/agent_task_sessions.ts:7-34`).
- `deriveTaskKeyWithHeartbeatFallback()` resolves task key from context `taskKey`/`taskId`/`issueId`; timer wakes use a synthetic `__heartbeat__` key only for addressability (`server/src/services/heartbeat.ts:2266-2302`).
- `shouldResetTaskSessionForWake()` forces fresh sessions for assignment/review/approval/timer wake reasons to avoid stale or bloated context (`server/src/services/heartbeat.ts:2304-2328`).
- `getTaskSession()`, `upsertTaskSession()`, and `clearTaskSessions()` manage the per-task session row (`server/src/services/heartbeat.ts:3743-3760`, `server/src/services/heartbeat.ts:4938-4987`).
- Runs record `sessionIdBefore` and `sessionIdAfter` (`packages/db/src/schema/heartbeat_runs.ts:24-25`) for audit/debug.

Relevant release-note failures: stale session reuse across heartbeat runs and adapter/model swaps were real bugs (`releases/v2026.403.0.md:40-44`, `releases/v2026.618.0.md:39`).

### Design lesson for Seneca

Do not use a single “agent last session” for all background work. Add a per-task/per-agent session binding that can be reset on assignment/model/tooling changes. Store both before/after session ids on each run.

## 4. Run/event persistence and logs

Paperclip persists both structured run rows and streaming event/log rows:

- Run status/result/usage/log pointers live on `heartbeat_runs` (`packages/db/src/schema/heartbeat_runs.ts:11-58`).
- Events/log lines live in `heartbeat_run_events` and are indexed by `(runId, seq)` and `(companyId, runId)` (`packages/db/src/schema/heartbeat_run_events.ts:4-28`).
- UI spec says run detail should show queued→running→outcome timeline, session before/after, tokens, cost, error code, exit/signal, and stream `heartbeat_run_events` ordered by `seq` (`docs/specs/agent-config-ui.md:145-183`).

### Design lesson for Seneca

Persist a bounded summary on `Run`, but keep detailed transcript/log events in a separate append-only table or file-backed log referenced from `Run`. UI needs list rows cheap; detail pages need drill-down.

## 5. Atomic checkout / assignment

Paperclip requires checkout before work:

- Agent instructions: “You MUST checkout before doing any work”; checkout uses `POST /api/issues/{issueId}/checkout` with `X-Paperclip-Run-Id`; 409 means stop/pick another task (`skills/paperclip/SKILL.md:60-69`).
- Route enforces that an agent can only checkout as itself and requires a run id for agent callers (`server/src/routes/issues.ts:6708-6734`).
- Service checkout first clears terminal stale locks, blocks unresolved dependencies, then atomically updates only if status is expected, assignee is empty/same-agent, and execution lock is empty/same-run (`server/src/services/issues.ts:5533-5594`).
- If already owned by same run, it returns normally; otherwise it returns `409 Issue checkout conflict` with current assignee/run lock details (`server/src/services/issues.ts:5709-5727`).
- Stale lock adoption exists but is careful: terminal/missing run locks can be adopted or cleared (`server/src/services/issues.ts:4033-4087`, `server/src/services/issues.ts:3903-3973`).

### Design lesson for Seneca

Use a compare-and-set style checkout:

- `expectedStatuses` guard
- `assigneeAgentId` empty or caller
- `checkoutRunId` null or same run
- `executionRunId` null or same run
- return stable `409` with owner/run details
- self-checkout idempotent
- stale terminal run cleanup path

Avoid direct “PATCH task status=in_progress” as the work claim path.

## 6. UI supervision surfaces

Paperclip exposes work through task boards, detail threads, live runs, agent run lists, and recovery surfaces:

- `ui/src/pages/Issues.tsx:1-113` loads tasks, agents/projects, company live runs via `heartbeatsApi.liveRunsForCompany`, refreshes every 5s, and derives `liveIssueIds` for list status.
- `ui/src/pages/IssueDetail.tsx:286-324` resolves active/running issue runs from live run and issue lock state; issue detail imports `IssueChatThread`, `IssueRunLedger`, `heartbeatsApi`, and optimistic run helpers (`ui/src/pages/IssueDetail.tsx:8-99`).
- Agent config UI spec includes grouped heartbeat run rows with status icon, invocation source chip, token/cost, result/error, expandable logs, session before/after, and live appends (`docs/specs/agent-config-ui.md:145-183`).
- Plugin UI slots include `taskDetailView`, `detailTab`, context menus, and toolbar buttons (`ui/src/plugins/slots.tsx:152`; `ui/src/plugins/launchers.tsx:108`).

### Design lesson for Seneca

Build three surfaces, not one:

1. **Task list/supervision panel**: cheap rows with status, assignee, blockers, current run, needs-input.
2. **Task detail thread**: durable comments/events/artifacts and action buttons.
3. **Run detail/log panel**: transcript/log stream, status timeline, stop/retry/cancel controls.

Reuse existing boring-ui session browser/chat panes for opening output, but do not make session list the source of truth for task status.

## 7. CLI / API / agent tools

Paperclip’s agent-facing contract is explicit and small:

- Hot endpoints are documented in `skills/paperclip/SKILL.md:403-420`: identity, inbox-lite, assignments, checkout, task context, update, comments, interactions, create subtask, release, search, documents, approvals, attachments, execution workspace/runtime, agents, dashboard.
- `cli/src/commands/client/issue.ts:170-350` registers `issue list/get/delete/heartbeat-context/create/update`.
- `cli/src/commands/client/issue.ts:360-418` registers comment add/list/get/delete.
- `cli/src/commands/client/issue.ts:542+` includes child issue creation from JSON payload.
- Agent instructions require `X-Paperclip-Run-Id` on all mutating issue API requests so actions can be attributed to the run (`skills/paperclip/SKILL.md:28`, `skills/paperclip/SKILL.md:60-65`).

### Design lesson for Seneca

Expose the same core service through UI, REST, CLI, and agent tools. Minimal v1 tool/API set:

- `task_create`, `task_list`, `task_view`, `task_update`, `task_comment`
- `task_checkout`, `task_release`
- `task_context` compact endpoint
- `run_list`, `run_view`, `run_events`, `run_cancel/retry`
- `agent_inbox` compact endpoint

Require `runId` on agent mutations for audit.

## 8. Failure modes Paperclip had to harden against

Avoid these in Seneca v1 design:

1. **Double work / weak claim semantics**: solved by checkout CAS and 409 conflicts (`server/src/services/issues.ts:5533-5727`).
2. **Stale checkout/execution locks**: Paperclip has `clearCheckoutRunIfTerminal`, `clearExecutionRunIfTerminal`, adoption paths, and a recovery sweeper (`server/src/services/issues.ts:4033-4087`; release notes `releases/v2026.618.0.md:15`).
3. **Zombie/lost runs**: orphan reaper handles running DB rows with no process handle (`server/src/services/heartbeat.ts:8057-8149`; release notes `releases/v2026.618.0.md:42`).
4. **Queued work becoming stale**: queued claim cancels if issue reassigned/cancelled/blocked/stale before start (`server/src/services/heartbeat.ts:7414-7455`).
5. **Blocked dependency fanout waste**: scheduler/claim gates blocked issues and wakes dependents only when blockers resolve (`skills/paperclip/SKILL.md:153-176`; `server/src/services/heartbeat.ts:7414-7421`).
6. **Session contamination**: per-task sessions and reset-on-wake avoid reusing wrong/stale sessions (`server/src/services/heartbeat.ts:2266-2328`; `releases/v2026.618.0.md:39`).
7. **Missing progress evidence**: liveness classification records `livenessState`, `lastUsefulActionAt`, `nextAction`; run summary counts comments/doc revisions/work products/activity/events (`packages/db/src/schema/heartbeat_runs.ts:50-56`; `server/src/services/heartbeat.ts:8000-8052`).
8. **Recovery loops**: release notes show bounded retries, blocked recovery issues, and cancellation on ownership changes (`releases/v2026.427.0.md:9-22`, `releases/v2026.428.0.md:13-14`).
9. **UI invisibility of background state**: Paperclip surfaces live runs in task list/detail and run logs in agent pages (`ui/src/pages/Issues.tsx:97-107`; `docs/specs/agent-config-ui.md:145-183`).
10. **Unaudited agent mutations**: run id header links task mutations/comments to the current run (`skills/paperclip/SKILL.md:28`).

## 9. Recommended Seneca data-model delta vs current Task/Run/Session plan

Current boring-ui/Seneca context found in this repo says there is **no durable Task/BackgroundAgent model yet**; existing primitives are session-centric and `SessionSummary` cannot represent task state, owner, parent/child, or durable blockers (`seneca-task-research/local-session-context.md:244-260`). Existing Pi session persistence should be reused, but not treated as the task store.

### Add / adjust v1 entities

#### `Task`

Delta from a minimal Task:

- `id`, human identifier/title/description
- `workspaceId` / project/workspace scope
- `status`: `backlog | todo | in_progress | in_review | blocked | done | cancelled`
- `workMode`: `standard | planning` (or equivalent)
- `priority`
- `assigneeAgentId`, optional `assigneeUserId`
- `parentTaskId`
- `blockedByTaskIds` via relation table, not prose
- `checkoutRunId`, `executionRunId`, `executionLockedAt`
- `sessionKey` or `taskKey`
- `originKind`, `originId`, `originFingerprint` for recurring/generated/idempotent tasks
- `createdBy*`, `startedAt`, `completedAt`, `cancelledAt`, `updatedAt`
- optional `requiresInput` / `reviewState` / `blockerOwner` fields if not modeled as thread interactions

#### `TaskComment` / `TaskEvent`

Add durable comments/events separate from Pi transcript:

- comment body, author agent/user/system, `runId`, createdAt
- event/action log for checkout/update/comment/status changes
- maybe attachment/artifact references later

#### `WakeRequest` (new, do not skip)

Paperclip evidence strongly supports adding this between task and run:

- `id`, `workspaceId`, `agentId`, `taskId?`
- `source`: assignment/comment/timer/manual/automation
- `reason`, payload/context snapshot
- `status`: queued/claimed/deferred/cancelled/failed/done
- `coalescedCount`, `idempotencyKey`
- `runId?`, requester, timestamps, error

#### `Run`

Delta from a minimal Run:

- link to `wakeRequestId`, `taskId?`, `agentId`, `workspaceId`
- `invocationSource`, `triggerDetail`, `contextSnapshot`
- `status`: queued/running/succeeded/failed/cancelled/timed_out/scheduled_retry
- `sessionIdBefore`, `sessionIdAfter`
- process/runtime info if local execution: pid/group, startedAt, lastOutputAt
- usage/cost/result JSON, error and stable `errorCode`
- log pointer/excerpts
- retry fields: `retryOfRunId`, scheduled retry fields, attempt
- liveness fields: `livenessState`, `lastUsefulActionAt`, `nextAction`

#### `RunEvent`

- `runId`, monotonically increasing `seq`, `eventType`, stream/level/message/payload, createdAt
- store enough to render live logs without loading the whole transcript

#### `AgentTaskSession`

Add explicit per-agent/per-task continuity:

- unique `(workspaceId, agentId, adapterType/runtimeKind, taskKey)`
- `sessionId` / `sessionParamsJson` / display id
- `lastRunId`, `lastError`, timestamps
- reset when model/adapter/runtime changes or on assignment/timer reasons as needed

#### `AgentRuntimeState` (optional but useful)

- per-agent aggregate state: last run/status/error, global legacy session fallback, total tokens/cost if metering is used

### v1 constraints for Seneca

- Do not make Pi chat session the only task/run record.
- Do not let `status=in_progress` be directly patchable by agents as claim; require checkout.
- Do not browse task/session lists through routes that boot a runtime; existing analysis warns current session list can boot runtime (`seneca-task-research/local-session-context.md:296`).
- Keep task supervision server-side/trusted; runtime plugins may render UI but should not define durable backend routes.
- Require stable error codes for checkout conflicts, blocked dependencies, stale locks, unauthorized agent mutation, missing run id.

## 10. Concrete implementation lessons for boring-ui/Seneca

1. **Start with a small Paperclip-inspired core, not the whole org-chart product.** Seneca likely needs local/workspace task supervision, not company/goal/budget/approval breadth on day one.
2. **Checkout is the critical primitive.** It prevents duplicate agent work and gives UI a single active owner/run.
3. **WakeRequest is worth the extra table.** It enables coalescing, idempotency, deferred wakes, and clear UI states.
4. **Session continuity must be task-scoped.** Existing Pi sessions are reusable storage, but add `AgentTaskSession` mapping to prevent cross-task context bleed.
5. **Separate list vs detail payloads.** Task lists need cheap rows; task detail can load comments, run ledger, blockers, artifacts.
6. **Persist run events separately.** UI supervision needs logs/timeline even when the live process is gone.
7. **Build recovery from day one, even if simple.** At minimum: clear terminal run locks, reap orphan running runs, cancel stale queued runs, surface blocked recovery instead of infinite retry.
8. **Make blockers machine-readable.** Use relation rows and wake dependents when blockers resolve; do not rely on comments.
9. **Require run attribution headers/tool params.** Every agent mutation should carry `runId`.
10. **Design UI around supervision, not chat.** Task list + detail thread + run log panel should coexist with open-session/chat panes.

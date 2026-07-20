---
github: https://github.com/hachej/boring-ui/issues/786
issue: 786
state: needs-review
updated: 2026-07-20
track: owner
---

# gh-786 Human Intention and Inbox on explicit task-session provenance

## Objective

Restack PR #796 on PR #804 and keep it focused on **Human Intention + Inbox**:

- `ask_user` may associate one review artifact (`surfaceKind` + `target`);
- the request and artifact project through Workspace Attention into Inbox;
- Inbox opens the artifact independently from the answer surface;
- Inbox renders the pending structured form inline;
- the producing native Pi `sessionId` resolves through the existing Tasks binding store so Inbox can show the concerned task(s), and TaskCards can show pending human intention.

The integration must reuse #804's explicit task-session bindings. It must not create an Inbox/task mapping, infer tasks, or make Tasks a hard dependency of `ask_user`.

## Stack and Scope

Target stack:

```text
PR #811 / #775  authoritative native Pi first persistence
        ↓
PR #804 / #776  explicit task ↔ native-session bindings
        ↓
PR #796 / #786  Human Intention + Inbox + task provenance consumer
```

PR #796 currently contains unrelated planning/delegation workflow commits and agent attachment/core-skill changes. The restack must replay only the Human Intention/Inbox work onto `issue/776-task-session-binding`:

- `56befa8f7` — Human Intention artifact contract (retain product code; exclude unrelated skill/docs edits)
- `ae0171e37` — inline Inbox form
- `37063181d` — Inbox demo fixture
- `3aa19969a` — artifact type cleanup
- `679a291bc` — server-backed demo/runtime corrections
- `0d44b3b5b` — ask-user test cleanup

Move the planning/delegation bundle and unrelated agent attachment/core-skill commits to separate ownership. Do not carry them in focused PR #796.

Do not rewrite or force-push the remote PR branch until the restacked diff, plan review, and owner approval are complete. The dirty canonical checkout currently on `fix/786-human-intention-artifacts` is user/host state and must not be overwritten.

## Existing Foundations

### From PR #804

- Plugin-owned `.pi/tasks/session-links.json` is the sole task-session binding store.
- Links are explicit `{adapterId, taskId, nativeSessionId}` tuples.
- Trusted workspace/principal resolution and exact native-session authorization already exist.
- TaskCards reopen exact sessions and never infer relationships.
- `ToolExecContext.sessionId` is authoritative for `manage_tasks.bind_session: "current"`.
- Tasks has generic app-left overlay/search plumbing that can open Tasks filtered to an exact task.

### From focused PR #796 commits

- `ask_user` tool execution receives a runtime-owned `sessionId` outside model parameters.
- `AskUserArtifact` carries `surfaceKind` and `target`.
- Workspace Attention blockers project into Inbox items.
- Inbox can open an associated artifact independently.
- Inbox detail can host the live structured question form and submit/cancel through the existing Questions runtime.

## Non-Negotiable Invariants

1. **One provenance source:** Tasks remains the only owner of task ↔ native-session bindings.
2. **No inference:** never derive a task from title, prompt, issue number, branch, artifact path, or request text.
3. **Trusted session identity:** `ask_user` records only the runtime-owned producing native session ID; the model cannot supply or replace it.
4. **Authorized reverse lookup:** resolving session IDs to tasks uses trusted workspace/principal context and exact session authorization.
5. **No disclosure oracle:** unauthorized, missing, and cross-workspace session IDs return no task/session metadata and are represented only as omitted inputs.
6. **Optional integration:** Human Intention and Inbox continue to work when Tasks is disabled, unavailable, or has no matching link.
7. **No automatic UI opening:** creating a request does not auto-open Inbox, Questions, Tasks, Chat, or an artifact.
8. **Independent surfaces:** opening the artifact does not answer the request; opening the answer form does not open the artifact.
9. **Exact navigation:** Chat actions reopen the producing native session; task actions open only explicitly linked tasks.
10. **No destructive approval reuse:** this slice does not create or imply one-shot mutation grants for task delete.
11. **Stable errors and bounds:** IDs, request arrays, artifact targets, and response sizes are bounded and use canonical stable codes.
12. **No transcript projection:** Tasks and Inbox may show authorized session/task/request metadata, never transcript bodies.

## Domain Model

### Human Intention request

Keep the focused #796 v1 shape rather than introducing a second generic workflow engine:

```ts
interface AskUserArtifact {
  surfaceKind: string
  target: string
}

interface AskUserQuestion {
  questionId: string
  sessionId: NativePiSessionId       // trusted producer identity
  ownerPrincipalId: string
  status: "ready" | "answered" | "cancelled" | "abandoned"
  title?: string
  context?: string
  schema?: AskUserFormSchema
  artifact?: AskUserArtifact
  createdAt: string
  updatedAt: string
}
```

“Human Intention” is the product abstraction; `ask_user` remains the agent-facing v1 tool and wire contract. One optional artifact is sufficient for this focused PR. Artifact arrays, comments, non-blocking notices, and general approval workflows remain future additive versions.

### Derived task provenance

Task provenance is a live authorized projection, not persisted on the Inbox record:

```ts
interface HumanIntentionTaskRef {
  adapterId: string
  taskId: string
  number: string
  title: string
  statusId: string
  url?: string
}

interface SessionTaskMatch {
  sessionId: NativePiSessionId
  tasks: HumanIntentionTaskRef[]
}
```

A session may be explicitly linked to multiple tasks; show every authorized match in deterministic adapter/task order. Unlinking updates future projections naturally.

## Server Design

### 1. Preserve trusted ask-user attribution

Verify the Pi tool adapter passes the exact native session ID to `ask_user.execute`. Add integration coverage proving:

- model parameters cannot include `sessionId`;
- the persisted `AskUserQuestion.sessionId` equals the producing native Pi session;
- browser/request fields cannot spoof workspace, principal, or session identity.

If the runtime cannot provide a durable native session ID, fail closed with a stable error instead of creating sessionless provenance.

### 2. Add bounded Tasks reverse resolution

Extend the Tasks service/store with a single-scan reverse lookup and trusted route, for example:

```http
POST /api/boring-tasks/sessions/tasks
{
  "sessionIds": ["native-id-1", "native-id-2"]
}
```

Response:

```json
{
  "ok": true,
  "matches": [
    {
      "sessionId": "native-id-1",
      "tasks": [
        {
          "adapterId": "github:workspace",
          "taskId": "776",
          "number": "#776",
          "title": "Bind tasks to native Pi session IDs",
          "statusId": "ready-for-agent"
        }
      ]
    }
  ],
  "omittedSessionIds": ["missing-or-denied"]
}
```

Rules:

- strict body with exactly `sessionIds`;
- 1–50 deduplicated IDs, each using the existing byte bound;
- resolve trusted actor/workspace from the request, never headers/query/body identity;
- authorize every native session before reading/projecting task links;
- scan the v1 link file once, not once per task/session;
- resolve task display metadata through `TaskManagementService` exact lookup;
- omit stale task links from display without deleting them;
- cap tasks per session and total projected tasks;
- deterministic output ordering;
- no transcript loading or bodies.

Do not add another file, table, Inbox field, or work-queue mapping.

### 3. Keep plugin dependency optional

Inbox calls the Tasks projection route as an optional enhancement. A 404/plugin-unavailable response yields an Inbox item with session/artifact/form but no task chips. Authorization/server errors produce a small non-blocking provenance-unavailable state; they do not block answering the request.

## Frontend Design

### Inbox

For each open Human Intention item:

- show kind, title, age, and source;
- show related task chips resolved from the producing session;
- show **Open task** per explicit task;
- show **Open chat** only for the exact authorized producing session;
- show **Open artifact** independently when an artifact exists;
- render the pending form inline in detail;
- submit/cancel exactly once through the existing answer token/runtime;
- never require opening the Questions workbench pane.

Batch unique visible/pending session IDs into one reverse-resolution call. Cache only in memory by workspace/principal/request set and abort stale requests. Do not persist the derived tasks in Inbox state.

### Task pane

The Tasks plugin consumes generic Workspace Attention blockers, not ask-user internals:

1. collect unresolved blockers with an authorized native `sessionId` and Inbox projection;
2. resolve those session IDs through the bounded reverse endpoint;
3. map matches to already loaded task tuples;
4. render a calm **Needs you** indicator/count on affected TaskCards;
5. disclose request title, kind, and age on explicit expansion;
6. provide explicit **Open Inbox item** and exact **Open chat** actions.

Add a typed Workspace shell capability/event for opening an existing Inbox item by ID. Do not simulate DOM clicks or auto-open the Inbox.

When the request resolves or disappears from Workspace Attention, the task indicator clears without mutating the task-session link.

### Artifact and answer separation

- `Open artifact` uses the artifact's registered `surfaceKind` + `target`.
- Inline form remains in Inbox while the artifact may open in Workbench.
- Submitting does not close the artifact automatically.
- Opening/closing the artifact does not submit, cancel, or dismiss the Human Intention.

## Restack Procedure

1. Keep `.worktrees/plan-796-on-804` as the clean planning lane based on `origin/issue/776-task-session-binding`.
2. After plan approval, create `.worktrees/pr-796-on-804` on a new local restack branch based on the latest #804 head.
3. Selectively replay/reconstruct only the six focused Human Intention/Inbox commits listed above.
4. Resolve conflicts in favor of #804's native-session, trusted-context, playground composition, and shell-capability contracts.
5. Confirm the resulting diff excludes planning/delegation and unrelated attachment/core-skill changes.
6. Implement the reverse Tasks projection and cross-surface UX as separate commits.
7. Run all proof/review gates.
8. Present the restacked commit range and force-with-lease command for owner approval.
9. Only after explicit approval, update `fix/786-human-intention-artifacts` and retarget PR #796 to `issue/776-task-session-binding`.

## Test Seams

### Highest public seams

- real `ask_user` Pi tool execution in a native session;
- trusted Tasks reverse-resolution HTTP route;
- Workspace Attention → Inbox projection;
- TaskCard Human Intention disclosure;
- typed shell navigation to Inbox/task/chat/artifact.

### Automated coverage

- artifact schema strictness, bounds, and backwards compatibility;
- trusted runtime session attribution and spoof rejection;
- reverse lookup: dedupe, bounds, deterministic ordering, multi-task session, stale links;
- missing/nonexistent/cross-workspace/unauthorized indistinguishability;
- optional Tasks plugin unavailable behavior;
- Inbox artifact open independent from answer submit;
- inline form submit/cancel and token replay protection;
- related-task chips and exact task opening;
- TaskCard **Needs you** count and clearing after resolution;
- exact chat ID opening with no new session;
- folder and CLI workspaces isolation;
- restart persistence for question, task link, and native session.

### Avoid testing

- transcript text;
- implementation-private React state;
- DOM-click simulations for cross-surface navigation;
- title/prompt/task-number inference.

## Live Proof

Use a fresh playground workspace and record identifiers only:

1. Open task `github:workspace/#776` and start a task chat.
2. First send persists native session `S` and creates exactly one task link.
3. In `S`, invoke `ask_user` with a structured form and associated artifact.
4. Verify no UI surface auto-opens.
5. Open Inbox manually:
   - request appears;
   - related task is exactly `#776` through `S`;
   - artifact and answer controls are independent.
6. Open Tasks manually:
   - `#776` shows **Needs you**;
   - no unrelated task does.
7. Open chat from Inbox and TaskCard; both select exact `S` and create no session.
8. Open artifact; request remains pending.
9. Submit the Inbox form once; agent resumes and replay fails.
10. Verify Inbox item resolves and TaskCard indicator clears while task link remains.
11. Restart and repeat read paths against persisted task/session/question state.
12. Repeat with one session linked to two tasks and with a denied session; show all authorized tasks and no denied metadata.

Do not record transcript bodies, answers, tokens, or secrets.

## Slices

### Slice A — Focus and restack PR #796

**Delivers:** clean Human Intention/Inbox-only commit range on top of #804; unrelated planning/attachment/core-skill work excluded.

**Blocked by:** approved plan; stable #804 head.

**Proof:** commit/file allowlist, range diff, focused existing ask-user tests.

**Review budget:** inside if reconstructed selectively; raw rebase exceeds budget.

### Slice B — Trusted producing-session contract

**Delivers:** authoritative native session attribution for `ask_user`, fail-closed absence, spoof rejection.

**Blocked by:** Slice A and #804 trusted tool context.

**Proof:** tool adapter/runtime integration tests using exact native IDs.

**Review budget:** inside.

### Slice C — Tasks reverse provenance resolver

**Delivers:** bounded authorized `sessionIds → task summaries` service/store/route using the existing link file.

**Blocked by:** Slice A.

**Proof:** store/service/route authorization, bounds, stale, multi-task, isolation tests.

**Review budget:** inside.

### Slice D — Human Intention Inbox experience

**Delivers:** associated artifact projection, independent artifact opening, inline form, related task chips, exact task/chat actions, optional Tasks behavior.

**Blocked by:** Slices B and C.

**Proof:** ask-user/Inbox component and playground tests.

**Review budget:** inside.

### Slice E — TaskCard pending-human-intention experience

**Delivers:** generic Attention-derived **Needs you** indicator/disclosure and typed Inbox opener.

**Blocked by:** Slices C and D's stable projection contract.

**Proof:** TaskCard/controller tests; no ask-user value import in Tasks.

**Review budget:** inside.

### Slice F — Integrated proof and PR restack handoff

**Delivers:** full live matrix, docs, visual proof, review closure, and owner-approved remote restack instructions.

**Blocked by:** Slices A–E.

**Proof:** package gates plus the 12-step live proof.

**Review budget:** exceeds a single review; use independent spec, standards/security, and maintainability reviewers.

## Acceptance

1. PR #796 is reviewably focused on Human Intention + Inbox and based on PR #804.
2. `ask_user` can associate one artifact and renders its pending structured form inline in Inbox.
3. Artifact opening and answer submission are independent.
4. The request stores the trusted producing native session ID, never a model-supplied identity.
5. Inbox derives related tasks only from #804's explicit authorized bindings.
6. TaskCards derive pending Human Intention only from unresolved Attention items joined through explicit session links.
7. Multi-task sessions show every authorized task; absent/denied sessions leak nothing.
8. Human Intention works without Tasks and no second provenance store exists.
9. Exact task/chat/Inbox/artifact navigation creates no new session or binding.
10. Resolution clears Inbox/Task attention while preserving task-session links and transcripts.
11. Relevant Tasks, ask-user, Workspace, Agent, CLI, restart, and live gates pass.
12. The remote PR branch/base are not rewritten without explicit owner approval.

## Out of Scope

- artifact arrays or automatic artifact discovery;
- comments/review threads;
- non-blocking notification campaigns;
- generic approval grants for destructive task actions;
- persisting task IDs inside ask-user/Inbox records;
- heuristic task matching;
- a second session/task store;
- automatic opening of any UI surface;
- planning/delegation skill packaging currently mixed into PR #796;
- unrelated agent image attachment/core-skill changes currently mixed into PR #796.

## Open Questions

1. Should a later v2 rename the agent tool from `ask_user` to a broader public name, or keep `ask_user` permanently as the stable agent API?
2. Should resolved Human Intention items remain visible in Inbox history, or continue disappearing with the current Attention lifecycle? This plan preserves current lifecycle unless separately approved.
3. Should task cards display all pending requests inline or only a count plus the most recent request? Recommended v1: count plus most recent, with explicit expansion.

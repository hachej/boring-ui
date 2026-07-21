---
github: https://github.com/hachej/boring-ui/issues/786
issue: 786
state: ready-for-agent
updated: 2026-07-20
track: owner
---

# gh-786 Human Intention and Inbox on explicit task-session provenance

## Objective

Restack PR #796 on PR #804 and keep it focused on **Human Intention + Inbox**:

- `ask_user` accepts intentional `artifacts[]`, projects the blocking request through Workspace Attention into Inbox, opens artifacts independently, and renders the pending structured form inline;
- a distinct non-blocking `manage_handover` tool lets the agent upsert/remove/list curated human-facing outputs during a run;
- successful runs project one structured Handover timeline card from transcript tool calls, while failed/interrupted runs publish nothing;
- the same artifact-list React primitive renders in Chat Handover cards and `ask_user` Inbox detail;
- the producing native Pi `sessionId` resolves through the existing Tasks binding store so Inbox can show concerned task(s), TaskCards can show pending human intention, and expanded linked sessions can show their latest successful Handover.

The integration must reuse #804's explicit task-session bindings. It must not create an Inbox/task mapping, infer tasks/artifacts from prose or diffs, or make Tasks a hard dependency of `ask_user`/Handover.

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
- PR #796 introduced the initial `surfaceKind` + `target` artifact seam, which this plan replaces with unified `HumanArtifact[]`.
- Workspace Attention blockers project into Inbox items.
- Inbox can open associated artifacts independently.
- Inbox detail can host the live structured question form and submit/cancel through the existing Questions runtime.

## Non-Negotiable Invariants

1. **One provenance source:** Tasks remains the only owner of task ↔ native-session bindings.
2. **No inference:** never derive a task from title, prompt, issue number, branch, artifact path, or request text.
3. **Trusted session identity:** `ask_user` records only the runtime-owned producing native session ID; the model cannot supply or replace it.
4. **Authorized reverse lookup:** resolving session IDs to tasks uses trusted workspace/principal context and exact session authorization.
5. **No disclosure oracle:** unauthorized, missing, and cross-workspace session IDs return no task/session metadata and are represented only as omitted inputs.
6. **Optional integration:** Human Intention and Inbox continue to work when Tasks is disabled, unavailable, or has no matching link.
7. **No automatic UI opening:** creating a request or registering an output does not auto-open Inbox, Questions, Tasks, Chat, Workbench, or an artifact.
8. **Independent surfaces:** opening an artifact does not answer a request; opening the answer form does not open an artifact.
9. **Exact navigation:** Chat actions reopen the producing native session; task actions open only explicitly linked tasks; artifact actions open only registered Workspace surfaces.
10. **Intentional artifacts only:** artifact membership comes only from `manage_handover` calls or `ask_user.artifacts[]`, never message parsing, git diffs, or filesystem discovery.
11. **Stateless Handover projection:** successful Handover cards are reduced from structured native transcript tool calls; no handover registry/file/table/finalized event is persisted.
12. **Run boundary:** each successful agent run starts with an empty registry and may publish one card; aborted/error/interrupted runs publish nothing and do not carry registrations forward.
13. **Inbox semantics:** `ask_user` is blocking and projects to Inbox; informational Handover is non-blocking and never creates an Inbox item.
14. **No destructive approval reuse:** this slice does not create or imply one-shot mutation grants for task delete.
15. **Stable errors and bounds:** IDs, request arrays, artifact targets, serialized metadata, and response sizes are bounded and use canonical stable codes.
16. **No transcript-body projection:** Tasks and Inbox may show authorized session/task/request/Handover metadata, never assistant/user transcript text.

## Domain Model

### Shared artifact contract

PR #796 has not merged, so replace its singular `artifact` field outright; do not carry a dual compatibility alias.

```ts
interface HumanArtifact {
  id: string                 // stable within one agent run
  surfaceKind: string        // registered Workspace surface
  target: string             // resolver-owned opaque target
  title: string
  description?: string
}
```

Both tools use the exact same `HumanArtifact[]` schema and reusable React list component. Artifact IDs are explicit run-local keys. Upserting an existing ID replaces metadata while preserving its original display position; removal is explicit.

Hard safety bounds:

- at most 100 artifacts in one run;
- at most 256 KiB serialized artifact metadata per run;
- bounded IDs/titles/descriptions/surface kinds/targets;
- registration order is display order;
- the UI initially renders 10 rows and offers **Show N more**.

### Blocking Human Intention (`ask_user`)

```ts
interface AskUserQuestion {
  questionId: string
  sessionId: NativePiSessionId       // trusted producer identity
  ownerPrincipalId: string
  status: "ready" | "answered" | "cancelled" | "abandoned"
  title?: string
  context?: string
  schema?: AskUserFormSchema
  artifacts: HumanArtifact[]
  createdAt: string
  updatedAt: string
}
```

`ask_user({ artifacts })` is a single atomic call: it validates/upserts those artifacts into the current run's projected registry and attaches them to the blocking question. Every attached artifact is included in the successful run's final Handover. The question/form is interaction state, not an artifact and never appears recursively inside `artifacts[]`.

### Non-blocking Handover (`manage_handover`)

```ts
type ManageHandoverInput =
  | { action: "upsert"; artifact: HumanArtifact }
  | { action: "remove"; artifactId: string }
  | { action: "list" }
```

`manage_handover` is a distinct non-blocking tool for curated human-facing outputs produced during work. It does not create Workspace Attention or Inbox items. The tool's successful structured calls are the registry operations; there is no server-side handover store.

At the end of each successful agent run, a pure reducer folds `manage_handover` calls and `ask_user.artifacts[]` in transcript order into one Handover projection. A failed/aborted/interrupted run produces no card and the next run starts empty. The final assistant prose gives a concise outcome summary and does not duplicate the artifact list.

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

### 2. Add `manage_handover` and stateless projection

Register exactly one discriminated `manage_handover` tool from the Ask User plugin. It receives trusted `ToolExecContext` but does not persist mutable state. Each successful result returns canonical structured details containing the accepted operation so live and hydrated transcript reducers see identical inputs.

Extend the plugin-injected system prompt:

- `ask_user` means “I am blocked and need human input to continue”;
- `manage_handover` registers intentional human-facing outputs during normal work;
- register plans, reports, screenshots, demos, generated documents, and other reviewable deliverables;
- do not register routine source edits, lockfiles, caches, logs, or inferred files unless explicitly requested as outputs;
- upsert/remove registrations as work evolves;
- artifact-producing successful runs must register their outputs; runs without human-facing artifacts do not call the tool;
- final assistant prose summarizes the outcome but never repeats the artifact list.

Implement one pure reducer shared by live event projection and history hydration:

```text
start each agent run with empty ordered registry
→ apply successful manage_handover upsert/remove operations
→ atomically upsert ask_user artifacts
→ successful terminal assistant stop: emit one projected Handover
→ aborted/error/interrupted stop: emit nothing
```

The reducer operates on structured transcript parts and stop state, not assistant text. It appends no custom transcript event and uses no plugin file/database. Give each projected card/anchor a deterministic ID derived from existing native transcript message/tool IDs.

### 3. Add bounded Tasks reverse resolution

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

### 4. Keep plugin dependency optional

Inbox calls the Tasks projection route as an optional enhancement. A 404/plugin-unavailable response yields an Inbox item with session/artifact/form but no task chips. Authorization/server errors produce a small non-blocking provenance-unavailable state; they do not block answering the request.

## Frontend Design

### Inbox

For each open Human Intention item:

- show kind, title, age, and source;
- show related task chips resolved from the producing session;
- show **Open task** per explicit task;
- show **Open chat** only for the exact authorized producing session;
- render the shared artifact-list component when `artifacts[]` is non-empty;
- open each available registered Workspace surface independently;
- keep unavailable artifacts visible with a disabled **Unavailable** state and no resolver details;
- render the pending form inline in detail;
- submit/cancel exactly once through the existing answer token/runtime;
- never require opening the Questions workbench pane.

Batch unique visible/pending session IDs into one reverse-resolution call. Cache only in memory by workspace/principal/request set and abort stale requests. Do not persist the derived tasks in Inbox state.

### Chat Handover card

Project a distinct structured timeline card immediately after the successful run's final assistant response. Do not embed it inside assistant Markdown and do not render raw registration tool cards as the final UX.

The card:

- uses the shared artifact-list component;
- shows only the stateless reducer's final ordered registry;
- initially shows 10 of at most 100 entries;
- opens available artifacts through the typed Workspace surface capability;
- keeps unavailable artifacts visibly disabled;
- is the sole artifact list—the final prose does not duplicate it;
- renders for every successful artifact-producing run, while Chat retains chronological history.

Superseded upserts/removals are reducer inputs, not separate visible Handover cards.

### Task pane

The Tasks plugin consumes generic Workspace Attention blockers, not ask-user internals:

1. collect unresolved blockers with an authorized native `sessionId` and Inbox projection;
2. resolve those session IDs through the bounded reverse endpoint;
3. map matches to already loaded task tuples;
4. render a calm **Needs you** indicator/count on TaskCards affected by unresolved blocking `ask_user` requests;
5. disclose request title, kind, and age on explicit expansion;
6. provide explicit **Open Inbox item** and exact **Open chat** actions;
7. only after the linked-session disclosure is expanded, lazily load the latest successful Handover projection for each linked session;
8. render that latest Handover's full shared artifact list inline under its session row;
9. open a clicked artifact directly in Workbench through its registered surface resolver.

Add a typed Workspace shell capability/event for opening an existing Inbox item by ID. Do not simulate DOM clicks or auto-open the Inbox.

When the request resolves or disappears from Workspace Attention, the **Needs you** indicator clears without mutating the task-session link. Informational Handover never creates **Needs you** or Inbox state. Chat keeps all historical Handovers; TaskCards show only the latest successful Handover per linked session.

### Shared artifact component and answer separation

Workspace owns the generic `HumanArtifact` contract, reusable presentational artifact-list component, and authorized surface-opening capability. The Ask User plugin owns `ask_user` and `manage_handover`; Tasks consumes Workspace primitives and never imports Ask User values.

- artifact opening uses each registered `surfaceKind` + `target`;
- the same component renders in Chat Handover, Inbox `ask_user`, and expanded TaskCard session output;
- Inbox's inline form remains available while artifacts open in Workbench;
- submitting does not close artifacts automatically;
- opening/closing an artifact does not submit, cancel, or dismiss Human Intention;
- informational Handover is never projected to Inbox.

## Restack Procedure

1. Keep `.worktrees/plan-796-on-804` as the clean planning lane based on `origin/issue/776-task-session-binding`.
2. After plan approval, create `.worktrees/pr-796-on-804` on a new local clean-room restack branch based on the latest #804 head.
3. Do **not** rebase or merge the polluted PR #796 branch wholesale. Reconstruct the focused feature by selectively replaying only the useful product hunks from the six Human Intention/Inbox commits listed above; split mixed commits instead of carrying unrelated files.
4. Preserve tested behavior rather than commit ancestry: compare the clean implementation and tests against the source branch, but resolve every overlap in favor of #804's native-session, trusted-context, playground composition, and shell-capability contracts.
5. Confirm the resulting diff excludes planning/delegation and unrelated attachment/core-skill changes.
6. Implement the reverse Tasks projection and cross-surface UX as separate commits.
7. Run all proof/review gates.
8. Present the restacked commit range and force-with-lease command for owner approval.
9. Only after explicit approval, update `fix/786-human-intention-artifacts` and retarget PR #796 to `issue/776-task-session-binding`.

## Test Seams

### Highest public seams

- real `ask_user` and `manage_handover` Pi tool execution in a native session;
- live and hydrated structured-transcript Handover projection;
- trusted Tasks reverse-resolution and latest-Handover summary routes;
- Workspace Attention → Inbox projection;
- TaskCard Human Intention/latest-Handover disclosure;
- typed shell navigation to Inbox/task/chat/artifact.

### Automated coverage

- unified `artifacts[]` schema strictness, ID upsert/remove ordering, 100-count and 256-KiB bounds;
- `ask_user` atomic artifact registration and attachment;
- `manage_handover` exact action schemas and structured results;
- successful-run projection versus failed/aborted/interrupted suppression and empty next-run registry;
- parity between live event reduction and hydrated transcript reduction;
- final prose never parsed and registration tool rows never mistaken for final cards;
- trusted runtime session attribution and spoof rejection;
- reverse lookup: dedupe, bounds, deterministic ordering, multi-task session, stale links;
- missing/nonexistent/cross-workspace/unauthorized indistinguishability;
- optional Tasks plugin unavailable behavior;
- Inbox multi-artifact opening independent from answer submit;
- inline form submit/cancel and token replay protection;
- related-task chips and exact task opening;
- TaskCard **Needs you** count and clearing after resolution;
- lazy latest-Handover lookup per linked session and inline artifact opening;
- unavailable artifact rendering without resolver-detail leakage;
- exact chat ID opening with no new session;
- folder and CLI workspaces isolation;
- restart parity for question, task link, native session, and stateless Handover cards.

### Avoid testing

- assistant prose or transcript bodies;
- implementation-private React state;
- DOM-click simulations for cross-surface navigation;
- title/prompt/task-number/artifact-path inference.

## Live Proof

Use a fresh playground workspace and record identifiers only:

1. Open task `github:workspace/#776` and start a task chat.
2. First send persists native session `S` and creates exactly one task link.
3. In `S`, upsert two curated outputs with `manage_handover`, update one by stable ID, and remove one obsolete output.
4. Invoke `ask_user` with a structured form and multiple `artifacts[]`; verify those artifacts atomically join the run registry.
5. Verify no UI surface auto-opens.
6. Open Inbox manually:
   - blocking request appears;
   - related task is exactly `#776` through `S`;
   - the shared artifact list and answer controls are independent;
   - no informational Handover Inbox item exists.
7. Open Tasks manually:
   - `#776` shows **Needs you**;
   - no unrelated task does;
   - expanding linked session `S` lazily shows only its latest successful Handover artifact list.
8. Open chat from Inbox and TaskCard; both select exact `S` and create no session.
9. Open artifacts from Inbox and TaskCard; each opens its registered Workbench surface and the request remains pending.
10. Submit the Inbox form once; agent resumes and replay fails.
11. At successful run end, verify one distinct Handover card appears after concise final prose, in registration order, with upserts/removals applied and `ask_user` artifacts included.
12. Run an interrupted/error case and verify no card; start another run and verify the registry is empty.
13. Verify Inbox resolves and TaskCard **Needs you** clears while task/session link and latest Handover remain.
14. Restart and verify stateless history hydration renders the identical Handover without another store/event.
15. Repeat with one session linked to two tasks, an unavailable artifact, 11+ artifacts (collapsed after 10), and a denied session; show all authorized tasks/outputs and no denied metadata.

Do not record transcript bodies, answers, tokens, or secrets.

## Slices

Execution graph root: `wt-391-forward-786-human-intention-handover-cks`

The approved plan is decomposed into eleven self-contained child Beads (`.1`–`.11`). Bead `.11` adds the owner-requested bounded Autoresearch convergence loop from PR #881 and blocks the `.10` owner handoff. `br dep cycles` reports no cycles. Remote PR #796 is not rewritten until both the Autoresearch terminal state and `.10` owner handoff are complete.

### Slice A — Focus and restack PR #796

**Delivers:** clean-room Human Intention/Inbox-only commit range built directly on #804; useful behavior retained without inheriting polluted ancestry; unrelated planning/attachment/core-skill work excluded.

**Blocked by:** approved plan; stable #804 head.

**Proof:** source-hunk/behavior checklist, commit/file allowlist, range diff, focused existing ask-user tests, and explicit proof that no wholesale merge/rebase of the polluted branch occurred.

**Review budget:** inside if reconstructed selectively; raw rebase exceeds budget.

### Slice B — Shared artifact contract and component

**Delivers:** Workspace-owned `HumanArtifact`, bounded `artifacts[]` validation, reusable 10-row-collapsed artifact list, typed authorized surface opening, unavailable state.

**Blocked by:** Slice A.

**Proof:** schema/bounds/order/component/accessibility tests across light/dark and narrow layouts.

**Review budget:** inside.

### Slice C — Trusted tools and stateless Handover reducer

**Delivers:** authoritative native session attribution; plural `ask_user.artifacts[]`; one `manage_handover` tool; injected usage prompt; pure live/history reducer; successful/failed run semantics.

**Blocked by:** Slices A–B and #804 trusted tool context.

**Proof:** exact schemas, spoof rejection, upsert/remove/list, ask-user atomic registration, run-boundary and hydration-parity tests.

**Review budget:** inside.

### Slice D — Tasks reverse provenance and Handover summaries

**Delivers:** bounded authorized `sessionIds → task summaries` using the existing link file plus lazy `sessionIds → latest successful Handover` projection without a new store.

**Blocked by:** Slices A and C.

**Proof:** store/service/route authorization, bounds, stale, multi-task, unavailable artifact, isolation, no transcript-body tests.

**Review budget:** inside.

### Slice E — Human Intention Inbox experience

**Delivers:** multi-artifact projection, shared artifact list, independent opening, inline form, related task chips, exact task/chat actions, optional Tasks behavior.

**Blocked by:** Slices B–D.

**Proof:** ask-user/Inbox component and playground tests.

**Review budget:** inside.

### Slice F — Chat Handover timeline card

**Delivers:** distinct post-response card for every successful artifact-producing run, concise non-duplicating final prose, no Inbox projection, live/history parity.

**Blocked by:** Slices B–C.

**Proof:** timeline/reducer/history tests plus successful, failed, interrupted, empty, 11+, and unavailable-artifact visual cases.

**Review budget:** inside.

### Slice G — TaskCard Human Intention and latest outputs

**Delivers:** generic Attention-derived **Needs you** disclosure, typed Inbox opener, and lazy inline latest-Handover artifact list per linked session.

**Blocked by:** Slices D–F.

**Proof:** TaskCard/controller tests; no ask-user value import in Tasks; no eager board-wide transcript reads.

**Review budget:** inside.

### Slice H — Bounded Autoresearch UI convergence

**Delivers:** at most five writer rounds applying PR #881's explicit-only Autoresearch protocol to the complete task → native session → Human Intention Inbox → shared artifact → Handover workflow. It captures desktop/mobile E2E evidence and grills each green revision with independent blind functional and UI/interaction/accessibility reviewers. PR #881's unrelated Automation product changes are never merged into this stack.

**Blocked by:** Slices A–G.

**Proof:** commit/tree-bound iteration records, exact deterministic commands, evidence digests, normalized findings, full E2E screenshots, and an explicit `success`, `stalled`, `blocked-owner`, or `cap-exhausted` terminal state.

**Review budget:** maximum five writer iterations, at most three selected findings per iteration, with deterministic gates before model review.

### Slice I — Integrated proof and PR restack handoff

**Delivers:** full live matrix, docs, visual proof, review closure, and owner-approved remote restack instructions.

**Blocked by:** Slices A–H.

**Proof:** package gates plus the 15-step live proof and Autoresearch terminal record.

**Review budget:** exceeds a single review; use independent spec, standards/security, and maintainability reviewers.

## Acceptance

1. PR #796 is reviewably focused on Human Intention, Handover, and Inbox and based on PR #804.
2. Workspace owns one plural `HumanArtifact[]` contract and reusable artifact-list component; no singular `artifact` compatibility field remains.
3. `ask_user` atomically registers/attaches multiple artifacts and renders its pending structured form plus shared artifact list inline in Inbox.
4. Artifact opening and answer submission are independent.
5. `manage_handover` provides bounded `upsert`, `remove`, and `list`; the injected system prompt requires curated intentional registration for artifact-producing runs.
6. Each successful run projects one distinct Chat Handover card from structured transcript calls; final prose does not duplicate it.
7. Failed/interrupted runs project nothing, carry no registry into the next run, and require no new persisted event/store.
8. The request stores the trusted producing native session ID, never model-supplied identity.
9. Inbox derives related tasks only from #804's explicit authorized bindings and never receives informational Handover items.
10. TaskCards derive pending Human Intention only from unresolved Attention joined through explicit session links.
11. Expanded TaskCard session rows lazily render only the latest successful Handover per linked session and open artifacts directly in Workbench.
12. Multi-task sessions show every authorized task; absent/denied sessions leak nothing; unavailable artifacts disclose no resolver detail.
13. Human Intention/Handover work without Tasks and no second provenance or handover store exists.
14. Exact task/chat/Inbox/artifact navigation creates no new session or binding.
15. Resolution clears Inbox/Task attention while preserving task-session links, transcripts, and informational Handover history.
16. The 100-artifact/256-KiB bounds, registration ordering, stable-ID upsert semantics, and collapse-after-10 UX are proven.
17. Relevant Tasks, ask-user, Workspace, Agent, CLI, restart, and live gates pass.
18. The remote PR branch/base are not rewritten without explicit owner approval.

## Out of Scope

- automatic artifact discovery from messages, git diffs, or files modified;
- arbitrary URLs or shell-open targets outside registered Workspace surfaces;
- comments/review threads;
- informational Inbox campaigns;
- generic approval grants for destructive task actions;
- persisting task IDs inside ask-user/Inbox records;
- heuristic task matching;
- a second session/task store;
- automatic opening of any UI surface;
- planning/delegation skill packaging currently mixed into PR #796;
- unrelated agent image attachment/core-skill changes currently mixed into PR #796.

## Open Questions

1. Should resolved Human Intention items remain visible in Inbox history, or continue disappearing with the current Attention lifecycle? This plan preserves current lifecycle unless separately approved.
2. Should task cards display all pending blocking requests inline or only a count plus the most recent request? Recommended v1: count plus most recent, with explicit expansion.

## Grilled Product Decisions

Locked with the owner on 2026-07-20:

- `ask_user` remains the distinct blocking tool and Inbox producer.
- `manage_handover` is distinct, non-blocking, and never produces Inbox items.
- the agent intentionally registers artifacts; no prose/diff/file inference;
- `ask_user.artifacts[]` performs atomic implicit upserts and every attached artifact enters the successful run Handover;
- artifacts are generic registered Workspace surfaces;
- stable run-local IDs provide ordered upsert/remove semantics;
- successful-run Handover projection is stateless from transcript calls; failed/interrupted runs publish nothing and next run starts empty;
- Chat renders a distinct card after concise final prose;
- the shared full artifact component renders in Chat, Inbox, and expanded TaskCard linked sessions;
- TaskCards show only the latest successful Handover per linked session and load it lazily;
- clicking a TaskCard/Inbox/Chat artifact opens its Workbench surface directly;
- Handover is curated human-facing output, normally under 10 entries, with hard cap 100, metadata budget 256 KiB, registration order, and collapse after 10.

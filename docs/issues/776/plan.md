---
github: https://github.com/hachej/boring-ui/issues/776
issue: 776
state: in-progress
updated: 2026-07-17
flag: not-needed
---

# gh-776 Task ↔ Native Pi Session Binding and Task Management

## Objective

Make Tasks the durable control surface for work without making chat the primary UI:

1. a task can own explicit links to every native Pi session that worked on it;
2. the task card can start a new task-scoped chat or reopen an exact linked session;
3. native Pi agents can inspect and update tasks through one `manage_tasks` domain tool, including explicitly binding the executing or another authorized session;
4. Inbox/work-run records can route back to the producing session without creating or auto-opening chat; and
5. task artifact folders remain a separate, explicit workspace affordance.

The canonical identity is always the pair `{ adapterId, taskId }`. Session links are opaque native Pi IDs. No title, prompt, branch, issue number, generated ID format, or filesystem name may be used to infer a relationship.

## Current State

PR #804 implements the first slice on top of #775:

- `FileTaskSessionLinkStore` at `.pi/tasks/session-links.json`;
- trusted exact POST routes for list/link/unlink;
- authorization of a requested native session before linking;
- task-launched browser-local detached chat linked at first successful native persistence;
- fail-closed adoption and no native session/link for an unsent draft;
- folder-mode, CLI workspaces-mode, and playground composition; and
- focused store, route, handoff, composition, and native first-send tests.

The remaining work is not complete merely because links can be written. The task disclosure, exact-session reopen flows, task management tool, artifact-folder affordance, and #786 Inbox provenance consumer still need implementation.

### Delivery boundary

- **#776 core closure:** Slices 1–5, including `manage_tasks` list/get/move/bind/unlink, exact-session task UI, and the artifact-folder affordance.
- **Follow-on completion tracked from this plan:** Slice 6 agent-driven delete after a trusted approval broker exists, and Slice 7 provenance after a later #786 record shape carries a producing session ID.
- The explicit-ID agent action is a deliberate extension to #776's original exclusion of a manual link-existing-session UI: it accepts a caller-known exact ID after authorization but provides no discovery/search UI.

This boundary keeps the complete requested design in one place without making #776 uncloseable on later #786 approval/provenance work.

## Non-Negotiable Invariants

1. **One owner:** `plugins/tasks` owns task-session bindings. Core agent metadata and Inbox/work-queue records may reference a native session ID but must not create a second task-session store.
2. **Explicit only:** only a user action, first-native-persistence callback carrying `{adapterId, taskId}`, or `manage_tasks.bind_session` may create a link.
3. **Native ID only:** browser-local draft IDs are never persisted as links.
4. **No session creation on read:** listing, disclosure expansion, popover open, full-chat open, Inbox open, and artifact open create no native session.
5. **No automatic UI:** nothing auto-opens Chat, Questions, a popover, or a folder.
6. **Trusted workspace scope:** routes and tools resolve a `Workspace` through trusted host bindings. They do not accept raw workspace paths or user-supplied workspace/principal IDs.
7. **Fail closed:** unauthorized and nonexistent sessions are indistinguishable to callers that are not already entitled to the binding.
8. **Exact dispatch:** `UiBridge.postCommand` remains the single UI command source; plugin UI uses shell capabilities rather than dispatching competing commands.
9. **Idempotent tuple:** at most one stored link exists for `(adapterId, taskId, sessionId)`. A native session may be explicitly linked to more than one task.
10. **No destructive model confirmation:** a boolean, phrase, or token supplied only by the model is never sufficient to execute `delete`.
11. **No implicit cascade:** moving, closing, or deleting a task does not silently delete session transcripts or task-session links.
12. **Bounded reads:** card expansion and agent tool listing are bounded; the board does not poll every linked transcript.

## Domain Model

```ts
type BoringTaskKey = {
  adapterId: string
  taskId: string
}

type BoringTaskSessionLink = BoringTaskKey & {
  id: string
  sessionId: string
  createdAt: string
}

type StoredTaskSessionLinks = {
  version: 1
  links: BoringTaskSessionLink[]
}
```

### Identity and lifecycle

- `adapterId` is the public name across cards, HTTP, tool inputs, and links. Existing internal `sourceId` naming may remain behind `TaskSourceService`, but new public contracts do not introduce a second identity term.
- `taskId` is the adapter's stable opaque ID. `number` is display-only.
- Link creation verifies both that the exact task exists in its adapter and that the exact native session is authorized in the current workspace/principal scope.
- Link deletion uses the opaque `linkId`. It must work even if the native transcript or upstream task has disappeared.
- Deleting or closing the upstream task retains links for provenance. Cleanup is a separate explicit unlink operation.

## Storage Architecture

Introduce a `TaskSessionLinkStore` interface and keep `FileTaskSessionLinkStore` as the local implementation:

- root: `.pi/tasks/session-links.json` through `Workspace` operations;
- strict schema/version validation;
- process-local serialization for read-modify-write;
- temp-file write followed by atomic rename;
- idempotent tuple insertion;
- deterministic ordering for persisted output and list results;
- stable typed missing/corrupt/write error codes (never classify missing files by matching error-message text);
- best-effort removal of failed temp writes and bounded startup cleanup of orphan temp siblings;
- a store cache keyed by stable trusted workspace identity rather than incidental `Workspace` object identity; and
- injectable clock/ID seams for tests.

Do not claim cross-process transactional safety for the JSON file. Hosted or genuinely multi-writer runtimes must inject a transactional store behind the same interface rather than writing the file from multiple processes.

## Trusted Runtime Composition

### Routes

Continue resolving route access from `WorkspaceAgentServerPluginContext.trusted`:

1. derive the actor from the authenticated request;
2. resolve the actor's workspace binding;
3. cache stores by resolved `Workspace` object, not raw path;
4. authorize transcript access through `WorkspaceAgentDispatcherResolver`; and
5. map internal failures to stable task error codes without transcript disclosure.

### Agent tools

`AgentTool.execute` currently provides an authoritative native `ctx.sessionId`, but not a request or a `Workspace`. Add a narrow trusted tool-execution binding seam rather than passing spoofable workspace IDs or constructing filesystem adapters from `workspaceRoot`.

The seam resolves lazily for each execution of the already-running workspace agent runtime:

```ts
type TrustedTaskToolBindingResolver = {
  resolve(ctx: ToolExecContext): Promise<{
    workspace: Workspace
    taskService: TaskManagementService
    linkStore: TaskSessionLinkStore
    authorizeSession(sessionId: string): Promise<void>
  }>
}
```

Requirements:

- the resolver is installed by folder/workspaces host composition and resolves the runtime executing this tool call; a shared tool array never eagerly captures one workspace;
- folder mode uses the existing late-bound dispatcher proxy so plugin construction cannot capture an uninitialized resolver;
- CLI workspaces mode passes a per-workspace `trustedPluginContext` through `getWorkspaceBridgeCore`, mirroring the trusted context currently hand-built for task-session routes;
- `session: "current"` comes only from `ToolExecContext.sessionId`;
- explicit `{ id }` values go through request-less trusted `authorizeSession` in the same resolved actor/workspace binding;
- tool input cannot override workspace ID, user ID, storage scope, or filesystem root; and
- no shared/front module gains a value import from `@hachej/boring-agent` or `node:*`.

If the trusted tool binding is unavailable, session mutation actions return a stable unavailable error; they do not fall back to paths.

## Task Management Service

Expand `TaskSourceService` into the single server-side domain service used by HTTP routes and `manage_tasks`. UI routes and tools must not reimplement adapter lookup, capability checks, or task identity validation.

Required operations:

- `listTasks(ctx, filters)` — bounded task/card summaries plus board configs/capabilities;
- `getTask(ctx, {adapterId, taskId})` — exact lookup, preferably through an adapter `getTask` capability, with a bounded list fallback only for legacy adapters;
- `moveTask(ctx, {adapterId, taskId, statusId})` — validates adapter and destination status before mutation;
- `deleteTask(ctx, {adapterId, taskId}, approval)` — executes only after a trusted approval grant is consumed;
- `listSessionLinks(ctx, key)`;
- `bindSession(ctx, key, sessionId)` — verifies task, authorizes session, then idempotently writes;
- `unlinkSession(ctx, {linkId})` — returns the removed link without requiring transcript loading.

GitHub's existing `deleteTask` currently closes an issue. Surface the adapter-defined effect in capability metadata and user/tool output (for example `deleteEffect: "close"`) instead of telling the user that GitHub data was permanently deleted.

## `manage_tasks` Agent Tool

Expose exactly one first-party Tasks tool:

```ts
manage_tasks({ action: "list", adapterId?, statusId?, query?, limit? })
manage_tasks({ action: "get", adapterId, taskId })
manage_tasks({ action: "move", adapterId, taskId, statusId })
manage_tasks({ action: "bind_session", adapterId, taskId, session: "current" })
manage_tasks({ action: "bind_session", adapterId, taskId, session: { id: "native-pi-id" } })
manage_tasks({ action: "unlink_session", linkId })
manage_tasks({ action: "delete", adapterId, taskId, approvalId })
```

### Contract

- Use an exact discriminated JSON Schema with `additionalProperties: false` per action.
- `list` defaults to a small limit and enforces a hard maximum. It returns only model-useful fields, not entire provider payloads.
- `get` returns the task, adapter capability/effect metadata, allowed board statuses, and explicit session links.
- `move` returns the updated task and does not infer status from prose.
- `bind_session` never accepts a title or browser-local ID. `"current"` fails with `TASK_SESSION_CURRENT_UNAVAILABLE` if `ctx.sessionId` is absent.
- explicit `{id}` authorization failure returns `TASK_SESSION_FORBIDDEN` without confirming existence.
- `unlink_session` accepts `linkId` so a stale or unauthorized transcript can still be removed from an authorized workspace binding.
- results provide concise text plus structured `details` with stable `ok`, `code`, action, task key, link, or task fields.
- tool instructions explain when to use each action and explicitly say not to bind merely because a task number appears in a prompt.

### Human-approved delete

Ship list/get/move/bind/unlink independently. Do not expose an executable `delete` action until a trusted human-approval broker exists.

Delete is two-phase:

1. a request creates an approval record scoped to workspace, actor, executing native session, adapter, task, adapter-described effect, expiry, and nonce;
2. the Questions/Inbox UI shows the exact task and effect;
3. a human approves or rejects through an authenticated UI action; and
4. `manage_tasks.delete` retries with the opaque `approvalId`; the server atomically verifies and consumes the grant before mutation.

The approval broker requires its own owned follow-up (or an explicitly expanded later #786 slice); #786's sessionless MVP does not provide it. Until that owner lands, agent-driven `delete` is deferred and is not part of #776's closure gate.

Reject wrong-session, wrong-task, wrong-workspace, expired, rejected, or replayed grants. A model-provided `confirmed: true`, copied approval text, or self-authored token is invalid. If #786 supplies the approval broker, Tasks consumes it; Tasks does not create a parallel Inbox store.

## HTTP API

Keep exact POST routes under `/api/boring-tasks` and share domain methods with the tool:

- `/sessions/list { adapterId, taskId }`
- `/sessions/link { adapterId, taskId, sessionId }`
- `/sessions/unlink { linkId }`
- existing task source list/move/delete routes remain compatibility surfaces while migrating their public request naming toward `adapterId`;
- add exact task `get` only if the UI requires it; otherwise keep exact lookup internal to the service.

All routes reject unknown keys, arrays, empty strings, IDs over 512 UTF-8 bytes, and request bodies over the host's bounded JSON limit. The same limits apply in stores and tools. Legacy task list/move/delete routes stop trusting `x-boring-workspace-id` or query `workspaceId`; they resolve the same authenticated actor/Workspace binding as session routes and reject caller attempts to select another workspace.

The existing HTTP delete surface must not remain an unguarded compatibility bypass. Its UI first presents the exact adapter-described effect; execution consumes a host-issued one-shot grant through the same approval broker as the tool. Until that exists, disable the mutable HTTP capability rather than treating a model- or caller-supplied confirmation flag as approval.

Stable error families:

- existing `TASK_SOURCE_*` codes remain compatibility aliases while consumers migrate atomically to `TASK_ADAPTER_*`;
- `TASK_INVALID_BODY`, `TASK_INVALID_ID`, `TASK_NOT_FOUND`;
- `TASK_ADAPTER_NOT_FOUND`, `TASK_ADAPTER_*_UNSUPPORTED`, `TASK_STATUS_NOT_FOUND`; 
- `TASK_SESSION_INVALID_BODY`, `TASK_SESSION_FORBIDDEN`, `TASK_SESSION_CURRENT_UNAVAILABLE`;
- `TASK_SESSION_LINK_MISSING`, `TASK_SESSION_LINK_STORE_INVALID`, `TASK_SESSION_LINK_STORE_ERROR`;
- `TASK_DELETE_APPROVAL_REQUIRED`, `TASK_DELETE_APPROVAL_INVALID`, `TASK_DELETE_APPROVAL_EXPIRED`.

HTTP status codes are transport details; UI and tools branch on stable codes.

## Task Card UX

### Start task chat

- **New chat** opens a browser-local detached draft with task title/context and explicit `{adapterId, taskId}` callback state.
- It creates no native session or link before first send.
- At the first `native_persisted` receipt, link the exact returned native ID before adopting the draft as durable.
- Linking is idempotent across retries.
- If linking fails, keep adoption fail-closed, surface a retryable error, and best-effort discard the just-created native session; never silently adopt an unlinked task chat.

### Session disclosure

Each card renders a collapsed, lazy disclosure:

- count from explicit links;
- on expansion, fetch links and resolve authorized native session summaries in one bounded request/cache read;
- the activity contract returns authorized summaries plus a bounded `omittedSessionIds` list drawn only from already-visible links; denied and missing transcripts are both omitted, while the link remains available for unlink;
- raw `/sessions/list` intentionally returns only opaque link/session IDs within the trusted workspace even if a transcript later becomes unavailable; it never returns transcript metadata;
- order available rows by native latest-message time descending, then `createdAt`, with unavailable rows last;
- status priority: `Working > Queued > Error > Idle`;
- relative activity time with an accessible full local timestamp;
- unavailable/missing sessions show no transcript metadata and retain **Unlink**;
- **Open popover** calls `openDetachedChat(exactSessionId, ...)`;
- **Open full chat** uses a new shell capability that selects the existing native session in the full Chat surface without creating one;
- **Unlink** confirms the exact task/session row, removes by `linkId`, and leaves the transcript intact.

Do not poll every card. Refresh activity when the disclosure opens, after a local link/unlink, or through the existing session activity subscription/cache while visible.

### Cross-bundle shell bridge

Keep plugin UI independent of React bundle identity:

- direct `WorkspaceShellCapabilities` calls are the normal path;
- the existing trusted DOM bridge remains a compatibility fallback for task-launched browser-local chat;
- add typed host capabilities/events for exact native-session popover and full-chat selection rather than importing host state into `plugins/tasks`; full-chat selection is a new host surface, not an alias for the existing detached popover;
- validate event payloads at the host boundary; and
- do not use global events as a second data store.

## Artifact Folder Affordance

Artifact folders are configured paths, not session bindings and not #786 artifact collections.

Add `plugins.tasks.artifactPathTemplate`, defaulting to `docs/issues/{taskId}`. For the GitHub adapter, stable `taskId` is the issue number, so issue #776 resolves to `docs/issues/776`; `number` remains display-only for adapters where it differs. Document placeholders `{adapterId}`, `{taskId}`, and `{number}`. The resolver:

- substitutes each placeholder through a deterministic safe-segment encoder;
- prevents substituted `/` or `\\` from creating path segments and rejects Windows drive/device names, titles, absolute paths, NULs, `.`/`..`, traversal, empty output, and paths outside the workspace;
- never passes a resolved path through a shell command;
- delegates path validation and filesystem mutation to the Workspace adapter;
- reveals an existing folder through a shell/UI command;
- for a missing folder, shows the resolved path and requires explicit user confirmation before creation;
- creates only that directory after confirmation, then reveals it; and
- never creates a folder merely by rendering a card, linking a session, or calling `manage_tasks`.

Multiple artifacts, review state, runs, and Inbox records remain #786's work-queue model. `ask_user.artifact` remains an optional focused decision target, not an artifact index.

## Inbox / Work-Queue Provenance

#786 may store an explicit producing `sessionId` on a work run or Inbox projection. Its consumer behavior is:

- render **Open chat** only when an authorized native session ID is already present;
- open the exact session through the shared detached-chat capability;
- never infer a task-session link from the Inbox title, artifact path, or task number;
- never create a task link as a side effect of opening provenance;
- never auto-open Chat or Questions; and
- render unavailable without transcript disclosure when authorization fails.

If a work run intentionally binds its producing session to a task, it calls the Tasks domain service/tool explicitly. The work queue does not write `.pi/tasks/session-links.json` itself.

## Implementation Slices

### Slice 0 — #775 native persistence seam

**Status:** implemented on the stacked branch; dependency must merge before #776 rebases to `main`.

**Delivers:** authoritative native ID at first persistence, idempotent native start coordination, and browser-local adoption callback.

**Proof:** #775 focused service/front tests and native persistence smoke.

### Slice 1 — Binding store, trusted routes, and creation handoff

**Status:** implemented in PR #804; revalidate after #775 lands/rebase.

**Delivers:** file store, list/link/unlink routes, persisted-session authorization, first-native-persistence linking, folder/workspaces composition.

**Remaining hardening:** extract store interface, verify exact task existence before new links, deterministic storage output, and retain stable error compatibility.

**Proof:** store concurrency/idempotency/corruption tests; route authorization/validation tests; native first-send integration; unsent and link-failure cases.

### Slice 2 — Shared task management service

**Delivers:** canonical `adapterId` domain inputs, exact `getTask`, bounded filters, adapter effect metadata, and shared task/link methods used by routes/tools.

**Blocked by:** Slice 1.

**Proof:** service tests for adapter isolation, capability failures, exact lookup, bounded fallback, task existence on bind, and no link cascade.

### Slice 3 — Trusted tool binding and `manage_tasks` read/mutate actions

**Delivers:** lazy trusted workspace tool-execution binding plus list/get/move/bind_session/unlink_session in one tool; folder-mode late-bound proxy; and CLI `getWorkspaceBridgeCore` per-workspace trusted plugin context.

**Blocked by:** Slice 2 and explicit host composition changes in both folder and workspaces modes.

**Proof:** schema table tests for every action/unknown field; authoritative `current` session test; explicit-ID authorization tests; wrong-workspace/absent-current failures; tool catalog and both-mode integration tests.

### Slice 4 — TaskCard linked-session disclosure

**Delivers:** lazy count/activity rows, a bounded authorized activity resolver with `omittedSessionIds`, exact popover/full-chat reopen, the new full-chat selection host capability, unavailable state, and unlink UX.

**Blocked by:** Slice 1; owns the missing activity/status read seam and host full-chat surface; may proceed in parallel with Slice 3 after shared contracts settle.

**Proof:** component/controller tests plus browser smoke proving reopen creates no session and uses the exact ID.

### Slice 5 — Artifact folder affordance

**Delivers:** validated template resolver, explicit missing-folder confirmation, create/reveal command path.

**Blocked by:** shell capability and Workspace path-operation seams.

**Proof:** traversal/placeholder/path-kind tests; existing-folder reveal; cancel creates nothing; confirm creates once and reveals.

### Slice 6 — Trusted delete approval

**Delivers:** capability-described delete/close effect, approval request UI, one-shot server grant, and `manage_tasks.delete`.

**Blocked by:** a separately owned trusted approval-broker follow-up, which may be implemented by a later explicitly expanded #786 slice but is not supplied by #786's sessionless MVP.

**Proof:** no-grant rejection; authenticated approve/reject; wrong scope/session/task, expiry, and replay rejection; adapter mutation exactly once.

### Slice 7 — #786 provenance consumer

**Delivers:** explicit Inbox/work-run **Open chat** using the same exact-session capability.

**Blocked by:** Slice 4 capability and a later #786 slice that persists an explicit producing `sessionId`; #786's sessionless MVP is insufficient.

**Proof:** explicit ID opens exact session; absent/forbidden ID has no opener; no native session, task link, Chat pane, or Questions pane is created/opened as a side effect.

## Test and Proof Matrix

### Package gates

- `pnpm --filter @hachej/boring-tasks typecheck`
- `pnpm --filter @hachej/boring-tasks test`
- `pnpm --filter @hachej/boring-tasks build`
- focused affected `@hachej/boring-agent`, `@hachej/boring-workspace`, and CLI tests
- workspace/CLI typecheck where trusted composition changes

### Required integration scenarios

1. Task → new browser-local draft → first send → one native ID → one idempotent link.
2. Close unsent draft → no native session and no link.
3. First persistence succeeds but link fails → no silent durable adoption; retry/discard behavior is visible.
4. Expand task → multiple links ordered by native activity; one missing transcript is unavailable and unlinkable.
5. Open popover and full Chat → both select the exact native ID and create nothing.
6. `manage_tasks.bind_session` with `"current"` → binds the authoritative tool execution session.
7. Explicit `{id}` → authorized same-workspace ID succeeds; unauthorized/nonexistent/cross-workspace IDs fail without disclosure.
8. `manage_tasks.move` → validates and returns the exact updated task.
9. Delete without a human-approved one-shot grant → no adapter mutation; wrong-task/session/workspace, expired, rejected, and replayed grants fail; an approved grant mutates exactly once.
10. Missing artifact folder → cancel creates nothing; approve creates and reveals the validated path.
11. Inbox record with explicit session → Open chat selects exact session; absent/forbidden record has no opener and no side effects.
12. Folder mode and CLI workspaces mode → stores, tools, routes, and authorization remain workspace-isolated.
13. Mixed authorized/denied activity → authorized summaries plus bounded `omittedSessionIds`, with no denied transcript metadata.
14. Forged legacy route workspace headers/query values cannot select or mutate another workspace.
15. Over-length IDs, unknown keys, and oversized bodies fail before store or adapter access.

### Live proof

Run the workspace playground with a fresh profile and record:

- task ID and adapter ID;
- native ID returned by first persistence;
- exact `.pi/tasks/session-links.json` entry;
- popover and full-chat reopen of that same ID;
- `manage_tasks` current-session binding result;
- artifact folder cancel/confirm behavior; and
- Inbox provenance open when Slice 7 lands; and
- native `pi /resume` lists and resumes the same linked native sessions.

Do not include transcript content, tokens, or secrets in proof logs.

## Rollout and Compatibility

- Keep the version-1 file readable; additive fields require a versioned migration and tests.
- Existing links remain valid through #775/#776 rebases because native IDs are opaque.
- Keep current HTTP paths during UI/tool migration; route handlers delegate to the new service.
- Gate UI affordances and tool actions by actual adapter/runtime capability.
- A runtime plugin change to `agentTools` still requires the existing restart warning/boot-time composition behavior.
- If #782's request-scoped first-party plugin composition lands first, adopt its proven pattern rather than maintaining a Tasks-only fork.

## Acceptance Criteria

1. A task retains and lists multiple explicit native Pi sessions across restart.
2. Starting task chat links exactly once at first native persistence; unsent drafts link nothing.
3. Reopening a linked row in popover or full Chat selects the exact native session and creates nothing.
4. Missing/unauthorized sessions reveal no transcript metadata and remain explicitly unlinkable.
5. `manage_tasks` provides bounded list/get/move/bind/unlink operations through shared task services.
6. `bind_session: "current"` derives only from trusted execution context; explicit IDs require authorization; neither path infers.
7. Task mutation and bindings are isolated by workspace, principal/runtime, adapter, and task.
8. Artifact folders resolve safely and are created only after explicit user confirmation.
9. All errors have stable codes and all relevant package/integration/live proofs pass.

Follow-on acceptance after separately owned dependencies land:

10. Delete/close cannot execute from model-supplied confirmation; it consumes a genuine one-shot human approval.
11. Inbox/work-run provenance opens only an already-authorized explicit session and never creates a second binding store.

## Dependencies

- **#775:** authoritative native-session materialization and first-persistence callback.
- **#782:** preferred request-scoped first-party-plugin composition precedent when merged and green.
- **#786:** work-run/artifact/Inbox provenance and preferred trusted approval projection; must consume, not duplicate, Tasks links.

## Out of Scope

- title/branch/prompt/task-number heuristics;
- automatic link repair or automatic session-to-task discovery;
- manual search UI for arbitrary existing sessions (the explicit-ID agent action is supported);
- automatic opening of Chat, Questions, Inbox, or folders;
- board-wide transcript polling or task activity rollups;
- storing transcript bodies in the Tasks plugin;
- a second Inbox/work-queue task-session map;
- automatic artifact discovery/review workflows owned by #786;
- hosted Postgres implementation in the local file-store slice; and
- session deletion or transcript deletion when a task/link is removed.

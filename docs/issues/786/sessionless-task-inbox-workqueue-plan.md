---
github: https://github.com/hachej/boring-ui/issues/786
issue: 786
---

# Sessionless Task Inbox + Artifact Review Work Queue Plan

## Status

Revised after adversarial review.

## Problem

Boring UI currently makes chat sessions too central. For agentic work, the user often does not want to manage sessions directly. They want:

- a task pane for overview;
- an Inbox for action-required items;
- artifacts/questions opened directly for review;
- optional session provenance for feedback/debugging.

The system should support local task decomposition through BR/Beads, external GitHub issue inflow, and session-bound artifacts/feedback without flooding GitHub or forcing every unit of work to become a chat session.

## Decisions from grill

1. **Task/source is the primary user mental model.** Sessions are secondary provenance/debug routes.
2. **BR/Beads is authoritative for local tasks.** Use it for local decomposition and sequencing.
3. **GitHub stays separate.** A GitHub issue can be used directly when self-contained; no automatic BR shadow task.
4. **No automatic GitHub/BR sync.** Manual links/decomposition only.
5. **Sessionless review/control-plane state gets its own Boring store.** Local MVP: `.pi/work-queue/store.json` behind a store interface.
6. **Inbox is action-required only.** No FYI spam.
7. **A task/source can have several sessions.** No generic `Continue` button.
8. **Feedback and artifacts may be bound to sessions.** Bind at run/artifact/inbox level, not as one task-level session.

## Important scoping correction

The work queue is **not** a new task authority.

- BR owns local task status/decomposition.
- GitHub owns GitHub issue/PR status.
- The future durable task service owns hosted task lifecycle if/when introduced.
- The work queue owns only **local adjunct state**: runs, artifact projections, Inbox review/question/approval items, and provenance links.

`WorkRun.status` is a **run status**, never a BR/GitHub task status.

## Package / ownership proposal

Create a first-party internal work-queue plugin/package rather than putting this in `plugins/tasks` or `plugins/ask-user`.

Suggested package shape:

```txt
plugins/work-queue/
  src/shared/      pure types only
  src/server/      store, routes, future agent tool registration
  src/front/       projection into WorkspaceAttentionProvider / Inbox
```

Rules:

- `shared` and `front` must not import Node APIs.
- server owns all file writes through one API boundary.
- `WorkspaceAttentionProvider` remains runtime projection state only.
- `plugins/tasks` can later consume work-queue summaries, but does not own the store.

## Core model

### SourceRef

Represents where work came from without forcing all sources into one tracker.

```ts
type SourceRef =
  | { type: 'br'; id: string; title?: string }
  | { type: 'github'; repo: string; number: number; kind: 'issue' | 'pr'; url: string; title?: string }
  | { type: 'manual'; id: string; title: string }
```

### SourceLink

Manual grouping/decomposition only. This models “GitHub issue #421 decomposed into BR beads A/B/C” without syncing or shadowing.

```ts
type SourceLinkRelation = 'decomposes' | 'implements' | 'references'

type SourceLink = {
  id: string
  parent: SourceRef
  child: SourceRef
  relation: SourceLinkRelation
  createdAt: string
  createdBy: 'human' | 'agent'
}
```

No SourceLink creation writes to GitHub or BR. It is work-queue grouping metadata only.

### WorkRun

A durable local record of an agent run or human-triggered workflow.

```ts
type WorkRunStatus = 'queued' | 'running' | 'needs_input' | 'ready_for_review' | 'done' | 'failed' | 'canceled'

type WorkRun = {
  id: string
  source: SourceRef
  title: string
  status: WorkRunStatus
  sessionId?: string
  agent?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  summary?: string
  artifactIds: string[]
  inboxItemIds: string[]
}
```

### WorkArtifact

Artifacts are projections of the workspace artifact publication protocol, not a side-channel content store. Large bodies stay in files or surfaces; metadata lives in the work-queue store.

MVP supports user-workspace relative files only. Later versions can add explicit filesystem support once `openArtifact` carries filesystem/mode through cleanly.

```ts
type WorkArtifactKind = 'html' | 'markdown' | 'diff' | 'image' | 'question' | 'log' | 'other'

type WorkArtifactReviewState = 'unreviewed' | 'accepted' | 'changes_requested' | 'dismissed'

type WorkArtifact = {
  id: string
  runId: string
  source: SourceRef
  kind: WorkArtifactKind
  title: string
  // MVP: workspace-relative file path, opened via workspace.open.path.
  path?: string
  // Future: align with data-artifact payload / WorkspaceShellArtifactTarget.
  filesystem?: 'user' | 'company_context'
  version: number
  sessionId?: string
  reviewState: WorkArtifactReviewState
  createdAt: string
  updatedAt: string
}
```

Future artifact producer integration should consume/project the reserved `data-artifact` event shape where available: `{ artifactId, kind, title, filesystem, path, version }`. The work queue indexes artifacts for review; it is not the artifact content publication protocol.

### WorkInboxItem

Inbox items are only for user action.

For PR1/MVP, support only `review`. Defer `question`, `approval`, `blocked`, and `failure` until the durable-to-front projection is proven.

```ts
type WorkInboxKind = 'review' // PR1 only

type WorkInboxStatus = 'open' | 'resolved' | 'dismissed'

type WorkInboxItem = {
  id: string
  runId: string
  source: SourceRef
  kind: WorkInboxKind
  status: WorkInboxStatus
  title: string
  body?: string
  artifactId: string
  sessionId?: string
  createdAt: string
  updatedAt: string
  priority?: number
}
```

Later expansion can map blocked/failure to existing `notice` with `requiresAction`, or extend the workspace/ask-user Inbox kind unions deliberately.

## Store

Create a workspace-local store similar to existing plugin file stores.

Local path:

```txt
.pi/work-queue/store.json
```

Shape:

```ts
type WorkQueueState = {
  version: 1
  sourceLinks: Record<string, SourceLink>
  runs: Record<string, WorkRun>
  artifacts: Record<string, WorkArtifact>
  inboxItems: Record<string, WorkInboxItem>
}
```

Implementation notes:

- Add a `WorkspaceWorkQueueStore` interface.
- Add `FileWorkspaceWorkQueueStore` for local CLI/workspace mode.
- Keep artifact contents in existing workspace files, not embedded in JSON.
- Use stable UUIDs for run/artifact/inbox ids.
- Sort views by `updatedAt`, not insertion order.
- Do not store private transcript content in artifact metadata.
- `.pi/` is already gitignored in this repo, but the implementation should ensure `.pi/work-queue/` remains runtime state.

### Concurrency requirement

Atomic temp-write + rename prevents torn files but **does not** prevent lost updates across multiple store instances.

PR1 may use a single host-side writer API plus process-local write serialization. It must not claim robust multi-process writes.

Before supporting multiple independent writers, add either:

- file locking / CAS with reload-before-commit and conflict retries; or
- an append-only JSONL event log with derived projection.

Required later race test: two independent store instances create different inbox items without losing either update.

### Hosted mode requirement

The file store is local-first. Hosted mode needs a second durable adapter keyed by workspace/tenant, not a sandbox-local file. The interface must be written so a hosted database adapter can replace the file store later.

## UI behavior

### PR1: read-only review Inbox vertical slice

The smallest coherent first PR is:

1. A file store can contain a review item for an existing HTML/Markdown artifact.
2. A front projector loads open review items and projects them into existing `WorkspaceAttentionProvider` blockers.
3. The existing Inbox opens the artifact directly in the workbench via `workspace.open.path`.
4. No chat/session opens as part of this flow.

For PR1, avoid:

- task pane redesign;
- BR/GitHub source grouping;
- Accept/Reject mutations;
- blocked/failure kinds;
- agent skill migrations;
- multi-process write guarantees.

### Later: Task pane overview

The task pane becomes an overview across sources:

- BR local tasks;
- GitHub issue/PR source rows when explicitly opened by adapter or manually referenced;
- local work runs grouped under their source;
- counts of open inbox items and artifacts.

Task/source rows should show:

- title/source;
- current local run status summary;
- artifact count;
- inbox count;
- associated session count/pills as provenance only.

No generic `Continue` button. Session affordances are provenance/debug/feedback routes, not the primary task action.

### Inbox

Inbox shows only open `WorkInboxItem`s.

PR1: only artifact review items.

Later:

- question;
- approval;
- blocked/failure only when a human decision is required.

No running/done/FYI items.

Click behavior:

- `review` + artifact path: open artifact directly in Workbench.
- later `question`: open Questions surface directly.
- later `blocked`/failure`: open a run detail surface or associated session only if human action is required.

### Artifact review

PR1 only opens the artifact.

Later review actions:

- **Accept**: marks artifact `accepted`, resolves related review inbox item.
- **Request changes / feedback**: records feedback text, sets artifact `changes_requested`, and either:
  - opens the associated producing session when `sessionId` exists; or
  - creates a linked feedback run/session when none exists.

The follow-up rule must be explicit before implementation: either request-changes resolves the current review item and waits for a new artifact version, or keeps the item open until replacement artifact is produced. Recommended: resolve current item and create a new review item for the next artifact version.

### Session provenance

Sessions are optional and many-to-one:

- one source/task can have many runs;
- each run can have one session;
- each artifact/inbox item can point to the session that produced it.

The UI can display session pills/counts, but deleting/closing a session must not delete artifacts or inbox items.

Do not infer all task↔session links solely from `WorkRun.sessionId`. If the task-session binding store from the parallel session-linking work exists, compose with it for session lists/popovers.

## Integration with existing systems

### BR/Beads

- BR remains local task authority.
- Work queue records can use `SourceRef { type: 'br', id }`.
- Do not store work-run metadata in BR comments/tables for MVP.
- A BR task-source adapter for `plugins/tasks` is a separate prerequisite before claiming full BR task-pane support.

### GitHub

- GitHub issue/PR can be used as `SourceRef` directly.
- No automatic BR task creation.
- No automatic GitHub write-back in MVP.
- Manual human/skill workflows can still create/update GitHub issues explicitly.

### WorkspaceAttentionProvider

Current provider is runtime/in-memory and blocker-oriented. It should become a projection target, not the durable store.

PR1 projection:

1. Server route lists open review inbox items from `.pi/work-queue/store.json`.
2. The route returns a joined, validated DTO — not raw `WorkInboxItem` rows — so the front projector does not need a second artifact lookup.

   ```ts
   type OpenWorkQueueReviewItemDto = {
     blockerId: string // `work-queue:${inboxItem.id}`
     inboxItemId: string
     artifactId: string
     title: string
     body?: string
     sourceLabel: string
     artifactPath: string // required, non-empty, user-workspace relative path
     updatedAt: string
     priority?: number
     sessionId?: string
   }
   ```

3. The server skips or reports invalid open review items whose artifact is missing, pathless, absolute, or traversal-based. PR1 tests must cover missing artifact, missing path, absolute path, and `..` traversal.
4. Front projector fetches DTOs and calls `addBlocker` with:
   - `id: dto.blockerId`
   - `reason: 'work-queue.review'`
   - `inbox.kind: 'review'`
   - `inbox.sourceLabel: dto.sourceLabel`
   - `surfaceKind: 'workspace.open.path'`
   - `target: dto.artifactPath`
   - no `pruneWhenSessionMissing` for sessionless items.
5. Projection refresh reconciles work-queue-owned blockers: add/update DTO ids and remove prior `work-queue:*` blockers absent from the latest DTO set.
6. Opening the item reuses existing Inbox artifact opening.

Later action mutations should write the work queue store first, then refresh projection.

### Artifact surface

Use existing `openSurface` behavior via `workspace.open.path`:

- HTML path -> `html-viewer`;
- Markdown path -> `markdown-editor`/viewer;
- image path -> `image-viewer`.

MVP artifacts are user-workspace relative paths only. Extend filesystem/mode support later if needed.

## Proposed implementation slices

### Slice 0 — Ownership, contracts, and host composition

- Create/choose `plugins/work-queue` package boundary.
- Add pure shared types.
- Decide route prefix, e.g. `/api/boring-work-queue/*`.
- Define local-only file-store adapter and future hosted adapter seam.
- Register the new work-queue package in the target host's server plugin defaults and front plugin list for the CLI/workspace app, or explicitly scope PR1 acceptance to a test harness. A package that only passes its own tests is not enough; the projector and routes must actually load in the product UI.
- Do **not** import ask-user private Inbox modules from the work-queue plugin. Work queue contributes attention blockers only. PR1 assumes the target host already has the ask-user Inbox overlay enabled.

Proof:

```bash
pnpm --filter @hachej/boring-work-queue test -- --run
```

### Slice 1 — Store + seedable review item API

- Add `WorkspaceWorkQueueStore` interface.
- Add `FileWorkspaceWorkQueueStore` with process-local serialization and atomic write.
- Add route(s):
  - `GET /api/boring-work-queue/inbox/open` returning `OpenWorkQueueReviewItemDto[]` joined with artifact metadata and source label.
  - test-only or internal `POST /api/boring-work-queue/dev/seed-review` if needed for proof, or store fixture loading in tests.
- Limit to `manual` source refs, user-workspace relative file artifacts, and `review` inbox items.
- Validate artifact paths before returning DTOs: non-empty, relative, no `..`, no absolute paths.

Tests:

- load missing store -> empty state;
- save/list open review items sorted by updatedAt;
- artifact bodies are not embedded;
- process-local serial writes preserve updates.

### Slice 2 — Front projection into existing Inbox

- Add front projector that fetches open review items.
- Project them into `WorkspaceAttentionProvider` blockers.
- Verify sessionless items are not pruned by session list changes.
- Reuse existing ask-user Inbox overlay and artifact shell.

Tests:

- projected blocker has `id='work-queue:<inboxItemId>'`;
- projected blocker has `inbox.kind='review'` and required `inbox.sourceLabel`;
- projected blocker uses `surfaceKind='workspace.open.path'` and target path;
- projection removes stale `work-queue:*` blockers absent from the latest DTO set;
- missing session id does not prune the item;
- clicking Inbox item opens artifact without opening chat.

### Slice 3 — HTML artifact proof

- Add a fixture/demo HTML artifact entry.
- Verify it appears in Inbox and opens in workbench.

Acceptance for first PR:

- A pre-existing `.pi/work-queue/store.json` review entry for an HTML artifact appears in Inbox.
- Clicking it opens the HTML artifact in Workbench.
- No chat/session opens.
- No GitHub or BR records are created or mutated.

### Slice 4 — Review state mutations

- Add Accept and Request Changes actions.
- Persist artifact review state and inbox status.
- Request Changes records feedback and routes to producing session when present.

### Slice 5 — Source/task pane integration

- Add BR/Beads task-source adapter or explicit BR reader before claiming BR overview support.
- Add work-queue summaries/counts to task/source rows.
- Add session provenance display, not a generic Continue button.

### Slice 6 — Agent/tool integration

- Add internal API/tool for agents to register runs, artifacts, and review inbox items.
- Update feedback/plan/implementation skills to register artifacts/questions instead of relying on chat messages only.

## Non-goals for MVP / PR1

- Full GitHub/BR bidirectional sync.
- Automatic GitHub-to-BR shadow tasks.
- BR task pane support without a BR source adapter.
- Task pane redesign.
- Accept/Reject review mutation.
- Blocked/failure inbox kinds.
- Replacing sessions internally.
- Full comment-thread review UI.
- Persisting full chat transcripts in work queue metadata.
- Robust multi-process file writes.
- Hosted durable store implementation.

## Open risks

1. Current generic Inbox lives under `plugins/ask-user`; reusing it is pragmatic but architecturally awkward. Later extraction may be needed.
2. Artifact review actions may belong in workbench chrome, not every viewer panel.
3. Work queue file concurrency must be upgraded before many independent writers can mutate it.
4. Session ids may be missing for subagent runs; feedback fallback path must be defined before Request Changes implementation.
5. Hosted mode requires a durable adapter, not sandbox-local `.pi/work-queue/store.json`.

## Full vision acceptance criteria

- A task/source can have multiple associated sessions.
- An HTML artifact can appear in Inbox as a review item and open directly in the workbench.
- Accepting the artifact clears the Inbox item without touching GitHub/BR.
- Requesting changes opens the associated session if one exists or creates a linked feedback run/session.
- A GitHub issue can be used as the source without creating a BR task.
- A BR task can be used as the source without creating/updating GitHub.
- Closing or deleting a chat session does not delete the artifact or Inbox item metadata.

## First PR acceptance criteria

- Given a local work-queue store containing one open review item for a valid workspace-relative HTML file, Inbox shows one review item.
- The projected blocker includes required `inbox.sourceLabel` and a namespaced `work-queue:*` id.
- Clicking that Inbox item opens the HTML file in Workbench through `workspace.open.path` / `html-viewer`.
- Invalid artifact paths or missing artifacts are skipped/reported without crashing the projector.
- The projected item is sessionless and is not pruned when known session ids change.
- The implementation does not create or mutate GitHub issues, BR tasks, or chat sessions.

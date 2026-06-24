# Workspace Attention Inbox Plan

## Goal

Build a generic Workspace Inbox on top of the workspace/plugin/chat attention layer introduced by PR #378. The inbox is a mailbox-style view of everything that needs the human owner: unanswered agent questions, PR/issue reviews, triage decisions, email/LinkedIn replies, approval requests, and any future source where an agent is blocked on user input.

This must not be hardcoded to the current GitHub triage process. GitHub triage is only the first source adapter.

## User experience

### Primary workflow

1. User opens **Inbox** from the workspace left rail.
2. Inbox shows a searchable/filterable list of attention items, like email.
3. Each row shows:
   - source icon/name: Questions, GitHub, Email, LinkedIn, Custom
   - title
   - short reason: `needs answer`, `needs review`, `needs approval`, `needs reply`
   - urgency/priority
   - owner/session/workspace when relevant
   - last updated time
   - status: open, snoozed, done, plus unread/read state when persisted sources support it
4. User clicks an item.
5. Workspace opens the best context surface:
   - ask-user question opens Questions pane
   - PR review opens PR tracker detail / GitHub link
   - issue triage opens issue board/detail
   - email/linkedin opens source URL or plugin panel
   - custom source can open any `SurfaceOpenRequest`
6. Detail pane shows context, action buttons, and source metadata.
7. Completing the source action marks item done, or source adapter removes it on refresh.

### Filters

Must-have first pass:

- search by title/body/source/id
- source filter
- reason/type filter: answer, review, approve, reply, triage, other
- status filter: open, snoozed, done
- workspace/session filter when available
- sort by updated/priority/source

### Visual direction

Mailbox layout:

- left tab: Inbox
- center panel: split view
  - top toolbar: search + filters + refresh
  - left/list column: items
  - right/detail column: selected item context/actions
- unread/open items get stronger visual weight
- blocked composer attention can link to the same item instead of only showing a one-off bar

## Current code anchors

### PR #378 base

Build on `feat/multi-project-inline-left-pane` from PR #378, because it adds:

- multi-project left bar and session browsing
- per-project waiting/blocked session badges
- question focus behavior when ask-user opens
- plugin/skills nav polish

The inbox should integrate with that left-rail/attention model, not create a separate navigation island.

### Existing ask-user pattern

`plugins/ask-user` already proves the pattern:

- provider owns runtime state
- pending questions are persisted server-side
- front provider polls `/api/v1/ui/state`
- provider registers a `WorkspaceAttentionBlocker`
- blocker has `surfaceKind`, `target`, and actions
- surface resolver opens the Questions pane

Inbox should generalize this pattern instead of special-casing questions.

### Existing triage process

Current `boring-triage` labels are simple routing state:

- exactly one `state:*`
- exactly one `phase:*`
- exactly one `track:*`
- gate is the first unmet gate: clarity, plan, implementation, proof, merge

Inbox source adapter should map this into generic items:

- `state:blocked phase:grill` => needs owner answer / clarity
- `state:active phase:review` => needs review/proof decision
- `state:ready phase:merge track:owner` => needs owner merge decision
- `track:fast` can be lower priority or auto-hidden depending config

But the core inbox model must know nothing about these label names.

## Architecture

### 1. Add generic attention item model

New shared type in workspace or a new plugin package:

```ts
export type WorkspaceInboxItemStatus = "open" | "snoozed" | "done"
export type WorkspaceInboxItemKind = "answer" | "review" | "approve" | "reply" | "triage" | "other"
export type WorkspaceInboxItemPriority = "low" | "normal" | "high" | "urgent"

export interface WorkspaceInboxAction {
  id: string
  label: string
  tone?: "default" | "secondary" | "destructive"
  requiresPayload?: boolean
}

export interface WorkspaceInboxItem {
  id: string
  sourceId: string
  sourceLabel: string
  kind: WorkspaceInboxItemKind
  status: WorkspaceInboxItemStatus
  priority: WorkspaceInboxItemPriority
  title: string
  summary?: string
  body?: string
  url?: string
  workspaceId?: string
  sessionId?: string
  createdAt?: string
  updatedAt?: string
  dueAt?: string
  readAt?: string
  labels?: string[]
  searchText?: string
  openSurface?: SurfaceOpenRequest
  actions?: WorkspaceInboxAction[]
  raw?: unknown
}
```

`raw` is adapter-owned and never required by generic UI.

### 2. Defer source adapter contract until after blocker proof

Phase 1 should not over-design a backend/source system. It consumes existing React attention state through `useWorkspaceAttention()` and maps blockers into inbox rows.

Add a source adapter contract in Phase 2/3, once the UI is proven and once we know whether aggregation should be front-only, server-backed, or both:

```ts
export interface WorkspaceInboxSource {
  id: string
  label: string
  refresh(): Promise<WorkspaceInboxItem[]>
  act?(itemId: string, actionId: string, payload?: unknown): Promise<void>
}
```

Future source examples:

- `ask-user` source: pending questions
- `github-triage` source: issues/PRs needing owner input
- `external-link` source: manually created URL tasks
- future `email` source: Gmail/IMAP adapter
- future `linkedin` source: browser/session/manual adapter

### 3. Build an app/internal plugin first

Create `plugins/workspace-inbox/` as a trusted repo plugin:

- `src/shared/types.ts`
- `src/front/index.tsx`
- `src/front/InboxPanel.tsx`
- `src/front/useInboxItems.ts`
- `src/server/index.ts` if server refresh/actions are needed
- `package.json#boring` with front and optional server

Reason: inbox is a shipped workspace surface, likely needs providers, static front composition, and eventually trusted routes. Runtime `.pi/extensions` is wrong for the durable foundation.

### 4. Front contribution

Plugin contributes:

- left tab: `workspace-inbox.tab`
- panel: `workspace-inbox.panel`
- command: `Open Inbox`
- surface resolver: `kind: "inbox-item"` opens selected item in inbox
- provider: only if statically composed by the app shell; do not rely on hot-loaded dynamic provider mounting

The panel renders:

- toolbar
- filter chips
- mailbox list
- detail pane
- actions

### 5. Generic source bridge

First implementation can be front-only and derive from existing state:

- `useWorkspaceAttention()` blockers become inbox items.
- `ask-user` blocker becomes an `answer` item.
- default fields for blocker-derived items:
  - `sourceId: "workspace-attention"`
  - `sourceLabel: "Workspace attention"`
  - `kind` derived from `reason`, default `other`
  - `status: "open"`
  - `priority: "normal"`
  - no `updatedAt` unless a source provides one
- if blocker has both `surfaceKind` and `target`, clicking opens that surface via the existing UI command/surface dispatch path.
- if either is missing, show fallback action text instead of pretending context can open.

This gives immediate value with no new backend.

Then add source adapters incrementally:

- GitHub tracker source consumes only a stable exported helper/API/file contract from `github-pr-tracker`; do not deep-import tracker front internals.
- Future server route `/api/v1/inbox/items` aggregates trusted sources.

### 6. GitHub triage source adapter

Map GitHub PR/issue tracker data into inbox items.

Rules:

- Open issue with `state:blocked` or `phase:grill` => `kind: answer`, high priority.
- PR with reviewDecision `REVIEW_REQUIRED` or labels/phase review => `kind: review`.
- PR/issue with `state:ready phase:merge track:owner` => `kind: approve`.
- Missing proof signals from PR tracker can become `kind: review`, summary `Proof missing`.
- Items open the existing GitHub PR Tracker panel/detail when possible, else external GitHub URL.

Do not bake label parsing into inbox core. Put it in `githubTriageSource.ts`.

### 7. Ask-user integration

Two options:

A. Minimal first pass: Inbox consumes `WorkspaceAttentionBlocker` and shows blocker-derived items.

B. Better second pass: ask-user exports an `inboxSource` or emits an inbox-compatible item.

Do A first. It avoids changing ask-user and proves UI.

### 8. External/manual integrations

Define a generic `link` item source so agents can create a user-input task without a dedicated integration:

```ts
{
  sourceId: "manual",
  kind: "reply",
  title: "Reply to LinkedIn message from Alice",
  url: "https://linkedin.com/...",
  summary: "Agent drafted reply; needs human approval."
}
```

Possible creation paths later:

- agent tool `create_inbox_item`
- slash command `/inbox add <url> <reason>`
- webhook route for apps
- browser extension bridge

Keep this out of phase 1 unless needed for proof.

## Implementation phases

### Phase 0 — branch and baseline

- Start from PR #378 branch: `feat/multi-project-inline-left-pane`.
- Do not work on dirty unrelated checkout.
- Verify PR #378 still typechecks before inbox work.

Proof:

```bash
gh pr checkout 378
pnpm --filter @hachej/boring-workspace typecheck
```

### Phase 1 — inbox UI over existing blockers

Build front-only plugin that lists `WorkspaceAttentionBlocker` items.

Tasks:

1. Create `plugins/workspace-inbox` package.
2. Add shared `WorkspaceInboxItem` types.
3. Implement `blockersToInboxItems(blockers)`.
4. Implement mailbox panel with search/filter/sort.
5. Click item opens context only when both `blocker.surfaceKind` and `blocker.target` are present, using the existing UI command/surface dispatch path.
6. Add left tab and command.
7. Register plugin in workspace playground and full-app if desired.

Acceptance:

- pending ask-user question appears in Inbox
- click opens Questions pane when the blocker includes a complete surface target
- rows can be searched by available blocker fields (`id`, `reason`, `label`, `sessionId`)
- source/kind/status/priority filters use deterministic defaults for blocker-derived rows
- composer blocker still works
- no server route needed

Tests:

```bash
pnpm --filter @hachej/boring-workspace-inbox test
pnpm --filter @hachej/boring-workspace-inbox typecheck
pnpm --filter @hachej/boring-workspace-inbox build
pnpm --filter @hachej/boring-ask-user test
pnpm --filter @hachej/boring-workspace typecheck
```

### Phase 2 — GitHub triage source

Add adapter that converts GitHub tracker data into inbox items.

Tasks:

1. Expose/read tracker data through a stable public helper/API/file contract from `github-pr-tracker`.
2. Add `githubTriageSource.ts` in inbox plugin.
3. Implement pure mapping tests for labels/status -> item kind/priority.
4. Open existing PR tracker detail for PRs, issue board for issues, external link fallback.
5. Add filters for source/kind/status.

Acceptance:

- owner-review PRs show as review items
- blocked/grill issues show as answer items
- ready owner merge items show as approve items
- inbox core has no hardcoded triage label logic

Tests:

```bash
pnpm --filter @hachej/boring-workspace-inbox test -- githubTriageSource
pnpm --filter @hachej/boring-workspace-inbox typecheck
pnpm --filter @hachej/boring-workspace typecheck
```

### Phase 3 — durable generic inbox store/actions

Add server-backed store only after UI/source shape is validated.

Tasks:

1. Define `InboxStore` interface.
2. File-backed store for local CLI/workspace mode.
3. Optional core DB-backed store later for full-app.
4. Add routes:
   - `GET /api/v1/inbox/items`
   - `POST /api/v1/inbox/items/:id/actions`
   - `POST /api/v1/inbox/items/:id/snooze`
   - `POST /api/v1/inbox/items/:id/done`
5. Add route schemas and stable error codes for every failure path.
6. Enforce auth/workspace scoping at the route boundary.
7. Make source actions idempotent (`done`, `snooze`, and external action retries are safe).
8. Add agent tool `create_inbox_item` for generic human-input tasks.

Acceptance:

- manual/link item survives reload
- source-generated items dedupe by stable id
- user can mark/snooze generic items

### Phase 4 — multi-workspace/project rollup (explicitly out of scope for first inbox PR)

Use PR #378 multi-project browsing model.

Tasks:

1. Add workspace/project fields to item list.
2. Aggregate attention across accessible workspaces when host can list without booting every workspace.
3. Badge projects by open inbox count, not only blocked sessions.
4. Clicking cross-workspace item loads/selects workspace only when needed, mirroring PR #378 browse-without-loading behavior.

Acceptance:

- Inbox can show items from multiple projects
- project badge count matches visible inbox filter
- opening item loads only required workspace/session

## Data ownership decisions

- Inbox core owns display, filtering, generic item status.
- Source adapters own domain mapping and source-specific actions.
- Existing plugins own their domain panels.
- Inbox opens context via surface resolvers; it does not import PR tracker or ask-user internals unless those plugins publish a stable helper.
- No node imports in shared code.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Inbox becomes GitHub-triage-specific | Keep label parsing in GitHub source only; pure generic item contract. |
| Duplicates from blockers + source adapters | Stable item ids: `${sourceId}:${domainId}` and source precedence rules. |
| Clicking item cannot open context | Every item supports either `openSurface` or `url`; detail shows fallback link. |
| Too much backend too early | Phase 1 front-only over blockers. Add routes after proof. |
| Cross-workspace boot cost | Follow PR #378 no-boot listing; only load workspace on item open. |
| Privacy/secrets in item bodies | Store summaries/metadata; source adapters decide redaction. Do not persist raw external message bodies by default. |

## Open questions

1. Should full-app enable Inbox immediately, or prove in workspace-playground first?
2. Should generic manual items be included in phase 1, or wait until after blocker/GitHub proof?
3. What exact item statuses do we want: `open/snoozed/done` enough, or also `waiting_on_agent`?
4. Do we want inbox notifications/badges in the PR #378 left rail in phase 1, or only after list UI works?

Placement decision is not open for the first implementation: use repo-level `plugins/workspace-inbox/`, prove it in `workspace-playground`, then statically compose where shipped.

## Recommended first cut

Ship the smallest useful slice:

1. Create `plugins/workspace-inbox`.
2. Build mailbox UI over `useWorkspaceAttention()` blockers.
3. Register in workspace-playground on top of PR #378.
4. Add pure mapping module/tests for future GitHub triage source, but do not wire it until UI feels right.
5. Then add GitHub source and PR/issue opening.

This gives a real inbox for agent questions immediately and creates the stable generic seam for PR reviews, owner approvals, email, LinkedIn, and future human-input tasks.

# Issue #380 — Real Workspace Inbox Implementation Plan

## Status

- Issue: [#380 Allow external harnesses to create review/question hooks](https://github.com/hachej/boring-ui/issues/380)
- Local PoC worktree: `/home/ubuntu/projects/boring-ui-v2-inbox-poc`
- PoC route: `http://100.68.199.114:5204/?inboxDemo=1&fresh=1`
- Plan state: APPROVED by thermo-nuclear review; implementation started

## Goal

Ship a real, extensible **Workspace Inbox** that surfaces questions, reviews, approvals, and other owner-decision work in the plugin-tabs app shell.

The Inbox should feel like a lightweight Gmail-style triage surface:

- visible from the app-left explorer alongside **Plugins** and **Skills**;
- opens as an overlay on top of chats without destroying work context;
- row click opens/reuses a generic **Inbox Preview** workspace tab;
- row `open in new tab` opens a dedicated item tab;
- row `chat` opens a detached chat popover for quick inspection/reply;
- pinned inbox items move to a Pinned section;
- simple filters exist from day one: All / Questions / Reviews;
- future external hooks can create durable inbox items through stable APIs.

## Key architecture decision

### Inbox domain belongs to a plugin/package. Detached popover belongs to workspace shell.

**Inbox ownership:**

- The inbox list, filters, inbox item rendering, item actions, persistence, and external-hook/domain adapters should live in a first-party inbox plugin/package, not directly in the generic workspace shell.
- Candidate package: `plugins/inbox` or `packages/workspace/src/plugins/inboxPlugin` for the first slice.
- Rationale: inbox item semantics are product/domain logic. Workspace should not learn every inbox item type.

**Workspace shell ownership:**

- Reusable detached/floating panel infrastructure belongs in `@hachej/boring-workspace`.
- The detached chat popover should be built as a reusable primitive, not as inbox-only chrome.
- Rationale: detached chat/panel behavior is a workspace layout capability that other surfaces will want (review preview, artifact inspect, quick file preview, command output, etc.).

**Boundary:**

- Inbox plugin asks the shell to open things:
  - open generic inbox preview panel;
  - open dedicated inbox item panel;
  - open detached chat for `sessionId`;
  - open resolved artifact/surface for item-specific targets.
- Workspace shell provides generic APIs/components for overlay, detached panel, and chat-session opening.

## PoC learnings to preserve

1. **Inbox in the app-left explorer is the correct entry point.**
   - It belongs next to Plugins and Skills, not in the old `workbench-left` source rail.

2. **Inbox overlay should not replace the workspace.**
   - Users need to triage while preserving the active chat/workbench state.

3. **Generic preview tab is the right default.**
   - Row click should update a reusable `Inbox Preview` tab.
   - Dedicated tabs are only for explicit `open in new tab`.

4. **Detached chat popover feels correct for quick inspection/reply.**
   - It should start near the Inbox side of the window to avoid colliding with the workspace/artifact area.
   - It should be draggable from the header only.
   - It should have close and dock controls.

5. **Blue Gmail colors are wrong for this product.**
   - Use workspace accent/orange tokens consistently in light and dark mode.

6. **Item toolbar clutter is not needed.**
   - Remove fake archive/snooze/more controls until real actions exist.

## Target user experience

### App-left entry

- App-left primary actions show:
  - New chat
  - Search
  - Inbox
  - Plugins
  - Skills
- Inbox action toggles Inbox overlay.
- Inbox overlay should close with X / Escape once supported by shell overlay conventions.

### Inbox overlay

- Header:
  - Inbox icon in accent/orange treatment.
  - Title: `Inbox`.
  - Subtitle: `Questions, reviews, and owner decisions`.
  - Close control.
  - Refresh control only if backed by a real reload/sync action; otherwise omit.

- Filters:
  - `All <count>`
  - `Questions <count>`
  - `Reviews <count>`
  - Keep filter model simple, local, and deterministic.
  - Future: add status/source filters only after durable item schema exists.

- Sections:
  - `Pinned` — only visible when non-empty.
  - `Inbox` — unpinned filtered items.

- Row content:
  - unread/attention dot using accent token;
  - sender/type (`question`, `review`, etc.);
  - subject/title;
  - subtitle metadata (`Session <id> · target`);
  - badge (`question`, `review`, etc.);
  - relative timestamp (`4m`, `2h`, `Mar 3`);
  - pin/star button;
  - chat button when `sessionId` exists;
  - open-in-new-tab button.

### Workspace preview behavior

- Row click:
  - opens or updates a stable `Inbox Preview` panel in the workspace surface;
  - does not create a new tab every time;
  - does not close Inbox;
  - title remains `Inbox Preview`.

- Open-in-new-tab icon:
  - opens dedicated panel id for that inbox item;
  - title is item title;
  - allows side-by-side comparison of multiple inbox items.

- Detail content:
  - no fake toolbar;
  - title, type badge, timestamp, session/target/source metadata;
  - real item actions;
  - for items with `surfaceKind`, offer `Open artifact`.

### Detached chat behavior

- Chat icon opens a detached/floating chat window anchored near the Inbox/app-left side.
- Inbox remains open.
- Main chat/workspace remains uninterrupted.
- Floating chat uses the real chat host for the session.
- Controls:
  - close;
  - dock/open as main chat tab;
  - draggable header.
- Header-only drag; body remains selectable/interactable.
- Placement is clamped inside viewport and starts away from workspace/artifact surface.

### Dock behavior

- Dock button:
  - opens/focuses the normal chat pane for that session;
  - closes detached chat;
  - closes Inbox overlay to show the chat.

### Ownership rule for production

PoC can temporarily run detached chat with a conservative bridge policy. Production should implement explicit foreground ownership:

- exactly one chat host owns agent→workspace UI command dispatch for a session;
- when detached popover opens, it becomes foreground owner for that session;
- matching main chat pane becomes passive for command dispatch;
- closing/docking returns ownership to active main pane;
- transcript rendering can remain multi-mounted if safe, but workspace mutations must have one owner.

## Data model

Introduce a first-class inbox item model. Start narrow but typed.

```ts
export type InboxItemKind = "question" | "review" | "approval" | "notice"
export type InboxItemStatus = "open" | "resolved" | "dismissed"

export interface WorkspaceInboxItemAction {
  id: string
  label: string
  tone?: "primary" | "neutral" | "danger"
}

export type WorkspaceInboxItemArtifactTarget =
  | { type: "surface"; surfaceKind: string; target?: string; params?: Record<string, unknown> }
  | { type: "panel"; panelComponentId: string; params?: Record<string, unknown> }

export interface WorkspaceInboxItemSourceBase {
  label: string
}

export type WorkspaceInboxItemSource =
  | WorkspaceInboxItemSourceBase & { type: "ask-user" }
  | WorkspaceInboxItemSourceBase & { type: "external-hook"; externalId: string }
  | WorkspaceInboxItemSourceBase & { type: "review"; reviewId: string }
  | WorkspaceInboxItemSourceBase & { type: "plugin"; pluginId: string }

export interface WorkspaceInboxItem {
  id: string
  kind: InboxItemKind
  status: InboxItemStatus
  title: string
  description: string
  source: WorkspaceInboxItemSource
  /** Null means there is intentionally no associated chat. */
  sessionId: string | null
  /** Human-readable target summary for list rows, e.g. "PR #380". */
  targetLabel: string
  artifact: WorkspaceInboxItemArtifactTarget | null
  createdAt: string
  /** Required; equals createdAt until the item changes. */
  updatedAt: string
  /** Required; default 0. Higher sorts earlier after timestamp ties. */
  priority: number
  actions: WorkspaceInboxItemAction[]
}

export type WorkspaceInboxItemViewModel = WorkspaceInboxItem & {
  /** Client-local or server-merged view state; not part of the canonical item. */
  pinned: boolean
}
```

### Compatibility with `WorkspaceAttentionBlocker`

Do not make the final inbox UI depend directly on blocker shape forever.

- First implementation slice defines `WorkspaceInboxItem`, `WorkspaceInboxItemViewModel`, and adapter contracts before any shell API or UI consumes them.
- Existing ask-user/review blockers can appear in Inbox immediately through `attentionBlockerToInboxItem`.
- Later, durable inbox items become the canonical source, and blockers become a compatibility/source adapter.

## Shell/plugin contract

The inbox plugin must not reach into `WorkspaceAgentFront` internals. The shell owns a small command contract that plugin UI can call through context, registered command, or injected props.

Initial contract:

```ts
export type WorkspaceInboxShellResult =
  | { success: true }
  | { success: false; reason: "no-artifact" | "open-failed" | "invalid-session" | "placement-failed"; message: string }

export interface WorkspaceInboxShellApi {
  openInboxPreview(item: WorkspaceInboxItem): WorkspaceInboxShellResult
  openInboxItemPanel(item: WorkspaceInboxItem): WorkspaceInboxShellResult
  openInboxArtifact(item: WorkspaceInboxItem): WorkspaceInboxShellResult
  openDetachedChat(sessionId: string, options?: { anchor?: DOMRect; title?: string }): WorkspaceInboxShellResult
}
```

Semantics:

- `openInboxPreview` opens/reuses stable `workspace.inbox.preview` panel.
- `openInboxItemPanel` opens dedicated panel id `workspace.inbox.detail.<item.id>`.
- `openInboxArtifact` resolves `item.artifact` via `openSurface`/`openPanel` and returns `{ success: false, reason: "no-artifact" }` when `item.artifact === null`.
- Inbox plugin shows a small inline/toast error for shell API failures and does not silently swallow failures.
- `openDetachedChat` delegates to the reusable detached chat shell and does not close Inbox by default.

Implementation preference:

- Expose this to first-party plugin UI through a workspace-shell context/hook, e.g. `useWorkspaceInboxShell()`.
- Keep the implementation in `WorkspaceAgentFront`/workspace shell; keep item semantics in the inbox plugin.
- Do not import `WorkspaceAgentFront` from the inbox plugin.
- Do not make the plugin call `dispatchUiCommand` directly except through this contract or existing public workspace APIs.

## Proposed package/module layout

### Workspace shell primitives

```
packages/workspace/src/front/detached/
  DetachedPanelPopover.tsx
  useDetachedPanelPosition.ts
  detachedPanelTypes.ts
```

Responsibilities:

- draggable header;
- bounds/clamping;
- default side-aware placement;
- close/dock controls slots;
- z-index and focus policy;
- no inbox-specific semantics.

### Detached chat shell

```
packages/workspace/src/front/chrome/chat/DetachedChatPopover.tsx
```

Responsibilities:

- compose `DetachedPanelPopover` + `ChatPanelHost`;
- show session title;
- close/dock behavior;
- participate in foreground-owner model.

### Inbox plugin/package

Boundary rule:

- The inbox plugin may value-import public workspace front APIs and shell contexts, just like other first-party workspace plugins.
- It must not value-import `@hachej/boring-agent` and must not depend on private `WorkspaceAgentFront` implementation details.
- The plugin owns inbox item rendering/model/adapters; the shell owns detached chat and layout commands.

Option A for first implementation (lowest friction):

```
packages/workspace/src/plugins/inboxPlugin/front/
  InboxOverlay.tsx
  InboxDetailPanel.tsx
  inboxItemModel.ts
  attentionBlockerAdapter.ts
  definition.ts
  index.ts
```

Option B for long-term package boundary:

```
plugins/inbox/
  src/front/...
  src/shared/...
  src/server/...
```

Recommendation:

- Start in `packages/workspace/src/plugins/inboxPlugin` as a built-in first-party plugin to avoid premature package overhead and because the first slice adapts in-memory `WorkspaceAttentionBlocker` state already owned by workspace front.
- Treat this as a first-party built-in plugin, not base shell code: no feature logic in `WorkspaceAgentFront` beyond the shell command/context implementation.
- Keep all inbox code in the workspace package until the extraction trigger below is met.

Extraction trigger:

- Extract `packages/workspace/src/plugins/inboxPlugin` to `plugins/inbox` only when:
  1. Slice 4 durable store is complete;
  2. external hook intake API is stable;
  3. inbox has enough server/shared code that independent package tests materially reduce workspace package complexity.
- Do not extract solely because the UI exists; avoid premature package complexity.

## Persistence and external hook API decision

V1 persistence target: **core DB-backed Postgres store** for full-app/core hosts, with an in-memory/dev adapter only for `workspace-playground` smoke.

Ownership/location:

- Schema/migrations live in `packages/core/drizzle`.
- Server store and route implementation live in core/server integration code, exposed to workspace hosts as a workspace-scoped inbox store.
- Workspace package owns shared/front types and plugin UI; core owns durable multi-user persistence.
- Playground uses a non-production memory store seeded by `?inboxDemo=1`; it must not be mistaken for durable behavior.

External hook create endpoint contract:

```ts
export interface CreateWorkspaceInboxItemRequest {
  kind: InboxItemKind
  title: string
  description: string
  source:
    | { type: "external-hook"; externalId: string; label: string }
    | { type: "review"; reviewId: string; label: string }
  sessionId?: string | null
  targetLabel?: string
  artifact?: WorkspaceInboxItemArtifactTarget | null
  priority?: number
  actions?: WorkspaceInboxItemAction[]
}

export interface CreateWorkspaceInboxItemResponse {
  item: WorkspaceInboxItem
  created: boolean
}

export interface WorkspaceInboxItemViewState {
  itemId: string
  pinned: boolean
}

export interface ListWorkspaceInboxItemsResponse {
  items: WorkspaceInboxItem[]
  viewState: WorkspaceInboxItemViewState[]
}
```

Read path:

- Route shape: `GET /api/workspaces/:workspaceId/inbox/items`.
- Returns open items by default, sorted by `updatedAt desc`, with optional query params:
  - `status=open|resolved|dismissed|all`;
  - `kind=question|review|approval|notice`.
- Response separates canonical item data from per-user view state. UI merges `items + viewState + blocker-projected items` into `WorkspaceInboxItemViewModel[]`.
- Durable items win on id collision with blocker-projected items.
- Refresh control calls this read path; failure shows non-blocking inline/toast error and keeps the last successful list.

HTTP/API policy:

- Create route shape: `POST /api/workspaces/:workspaceId/inbox/items`.
- Canonical workspace scope is the `:workspaceId` route param. Request body must not include `workspaceId`.
- Auth: caller must be an authenticated workspace member or authorized harness token scoped to that workspace.
- Idempotency: require `Idempotency-Key` header; additionally enforce `(workspaceId, source.type, externalId/reviewId)` uniqueness where present.
- Stable error codes:
  - `INBOX_UNAUTHORIZED`
  - `INBOX_FORBIDDEN`
  - `INBOX_NOT_FOUND`
  - `INBOX_INVALID_REQUEST`
  - `INBOX_IDEMPOTENCY_CONFLICT`
  - `INBOX_CONFLICT`
  - `INBOX_STORE_UNAVAILABLE`
- Mapping defaults:
  - `status = "open"`
  - `targetLabel = ""` when omitted
  - `artifact = null` when omitted
  - `priority = 0` when omitted
  - `actions = []` when omitted
  - `createdAt`/`updatedAt` assigned by server.
- Redaction: request bodies must contain display-safe fields only; server logs stable ids/error codes, not full descriptions.

Idempotency/source uniqueness semantics:

| Case | Result |
| --- | --- |
| Same workspace + same `Idempotency-Key` + same normalized body | Return original item with `created: false` |
| Same workspace + same `Idempotency-Key` + different normalized body | `INBOX_IDEMPOTENCY_CONFLICT` |
| Different `Idempotency-Key` + same `(workspaceId, source.type, externalId/reviewId)` | Return existing item with `created: false` |
| Different workspace + same source id | Allowed; workspace scope is part of uniqueness |
| Missing `Idempotency-Key` | `INBOX_INVALID_REQUEST` |

Closing #380 requires Slice 4. Slices 1-3 are UX/architecture prep and must not be marked as closing the issue.

## Implementation slices

### Slice 0 — Inbox model and adapter contract

Goal: create the types that shell APIs, plugin UI, and durable APIs depend on.

Tasks:

1. Add `WorkspaceInboxItem`, `WorkspaceInboxItemViewModel`, source, action, artifact, and shell result types.
2. Add `attentionBlockerToInboxItem` adapter contract.
3. Add pure helpers for defaulting, stable ids, sorting, filtering, and pin view-model merge.
4. Add unit tests for helper invariants.

### Slice 1a — Detached shell primitives

Goal: land reusable detached/floating shell infrastructure without inbox semantics.

Tasks:

1. Add `DetachedPanelPopover` primitive.
2. Add `DetachedChatPopover` using existing `ChatPanelHost`.
3. Add minimal foreground chat owner state in `WorkspaceAgentFront` before shipping any detached chat composer behavior.
4. Add `WorkspaceInboxShellApi` provider/context in the shell, using Slice 0 item/result types, but only with no-op/test harness consumers until Slice 1b.

### Slice 1b — Inbox plugin integration

Goal: move PoC Inbox shape into maintainable plugin boundaries.

Tasks:

1. Move Inbox UI out of `WorkspaceAgentFront` and into built-in inbox plugin module.
2. Keep blocker adapter source for initial data.
3. Register `Inbox Preview` and `Inbox Detail` panels through the inbox plugin or core registration depending on plugin boot order.
4. Add `Inbox` primary action to `AppLeftPane` behind `showInbox` prop.

Decomposition guardrails:

- No inbox or detached-popover component file should exceed **400 lines** without extracting local subcomponents/helpers.
- If any file exceeds **500 lines**, extract subcomponents immediately before review.
- `InboxOverlay.tsx` should stay mostly composition; extract at minimum:
  - `InboxFilterBar.tsx`;
  - `InboxSection.tsx`;
  - `InboxRow.tsx`;
  - `InboxDetailPanel.tsx`;
  - `inboxItemModel.ts` / pure helpers.
- `DetachedPanelPopover.tsx` should own generic chrome only; chat-specific behavior belongs in `DetachedChatPopover.tsx`.
- Avoid adding more one-off branches to `WorkspaceAgentFront`; if wiring grows beyond shell callbacks/state, extract a `useDetachedChatController` hook.

Detached chat safety in Slice 1:

- Detached chat starts **read-only / inspect-only** by default.
- Its composer is disabled or hidden via a `composingEnabled={false}` policy until the full ownership model lands.
- The dock button remains available for replying in the main chat pane.
- No host may opt into detached-chat composing before Slice 5; this avoids partial ownership semantics.

Verification:

- `pnpm --filter @hachej/boring-workspace exec tsc --noEmit -p tsconfig.front.json`
- `pnpm --filter @hachej/boring-workspace exec vitest run src/app/front/__tests__/WorkspaceAgentFront.test.tsx src/__tests__/WorkspaceProvider.test.tsx src/__tests__/plugin-integration.test.tsx`
- Manual route with seeded blockers.

### Slice 2 — Inbox behavior hardening

Goal: keep behavior deterministic while UI moves onto typed items.

Tasks:

1. Keep pin/filter/sort logic on `WorkspaceInboxItemViewModel`, not blocker.
2. Add deterministic timestamp handling.
3. Add unit tests for sorting, filtering, pin grouping, adapter behavior.
4. Add overlay tests for blocker-adapted items and empty states.

Verification:

- Model/helper unit tests.
- Existing overlay tests.

### Slice 3 — UX polish and accessibility

Goal: production-quality triage UI.

Tasks:

1. Keyboard navigation for rows and controls.
2. Escape closes overlay/popover according to shell policy.
3. Focus return to Inbox action after close.
4. ARIA labels for filters, row actions, popover dialog.
5. Confirm contrast in light/dark themes using accent tokens.
6. Ensure row controls do not cause nested interactive markup errors.
7. Add simple visual/state tests where practical.

Pin state policy for Slices 1-3:

- Pin state is client-local only.
- Store it by workspace id + inbox item id, not by array index or transient row order.
- It is represented on `WorkspaceInboxItemViewModel.pinned` after merging client state.
- `WorkspaceInboxItem` must not contain `pinned`.
- No server pin endpoint exists before Slice 4.
- When the durable inbox view-state endpoint lands, server pin state wins on conflict, and client-local pins are treated as migration hints only.

Verification:

- Testing Library coverage for row click, open dedicated tab, pin, filter, chat popover close/dock.
- Manual keyboard smoke.

### Slice 4 — Durable inbox store and external hook intake

Goal: real #380 capability.

Status/view-state mutation contract:

- `PATCH /api/workspaces/:workspaceId/inbox/items/:itemId`
  - body: `{ status?: "open" | "resolved" | "dismissed" }`
  - canonical item mutation; requires workspace permission.
  - invalid transitions return `INBOX_CONFLICT`.
- `PATCH /api/workspaces/:workspaceId/inbox/items/:itemId/view-state`
  - body: `{ pinned?: boolean }`
  - per-user/workspace view-state mutation.
  - `WorkspaceInboxItem` still does not contain `pinned`; the UI receives it through `WorkspaceInboxItemViewState` and merges to `WorkspaceInboxItemViewModel`.
- Pin persistence is deferred until this view-state endpoint exists; before then pins remain local-only.

Tasks:

1. Add core DB-backed inbox item store abstraction and Postgres migration.
2. Add workspace-scoped server routes, starting with `POST /api/workspaces/:workspaceId/inbox/items`.
3. Add idempotency key support and uniqueness on stable source ids.
4. Add redaction/safe fields contract.
5. Add status update endpoint (`resolved`, `dismissed`) and separate per-user view-state endpoint for pin state.
6. Wire ask-user and review hook adapters.
7. Add playground memory adapter only for local smoke/demo.

Verification:

- route tests for auth, idempotency, redaction, workspace scoping, list/read behavior, status mutation, and per-user pin view-state;
- local playground smoke;
- no secrets/log leakage.

### Slice 5 — Complete production foreground chat ownership + composer enablement

Goal: make detached chat fully safe for real sending/streaming and enable composing by default.

Tasks:

1. Expand the minimal Slice 1 foreground owner into explicit `foregroundChatOwner` state, then extract to `useChatForegroundOwner` if it grows:
   - `{ kind: "main"; sessionId: string }`
   - `{ kind: "detached"; sessionId: string }`
2. Main chat pane bridge enabled iff it owns foreground for its session:
   - if no detached chat exists, current active main pane owns as today;
   - if detached chat exists for session `S`, main pane `S` is passive and detached `S` owns;
   - other main panes can still own only if active and no detached owner conflicts.
3. Detached chat bridge enabled while open and owner.
4. Closing detached chat returns owner to active main pane.
5. Docking detached chat opens/focuses main pane and transfers owner.
6. For v1, allow only one detached chat popover at a time. Opening another replaces the previous detached owner. Rationale: this intentionally defers window-manager complexity (stacking, focus cycling, per-popover persistence) until usage proves multi-popover demand.
7. Enable detached chat composing by default only after the ownership tests pass.
8. Add tests for ownership transitions.

Ownership check mechanism:

- `WorkspaceAgentFront` computes `bridgeEnabled` before constructing each `ChatPanelHost` params object.
- `ChatPanelHost` should remain dumb: it receives `bridgeEndpoint: null`/disabled params when it is not owner.
- Do not add owner checks inside low-level stream dispatch unless a later multi-owner shell requires it; keep ownership policy centralized in shell state.

Verification:

- test that main pane bridge is disabled while detached owner is active;
- test that detached pane receives bridge ownership while open;
- test that ownership returns on close;
- test that docking transfers ownership to main pane;
- test replacing one detached chat with another leaves only one detached owner;
- manual: popover-initiated tool/UI command opens workspace artifact once.

## Acceptance criteria

Architecture/UX prep:

- Inbox entry appears in plugin-tabs app-left explorer next to Plugins/Skills.
- Inbox overlay lists typed inbox items with timestamps, filters, pinned section.
- Row click opens/reuses generic `Inbox Preview` panel.
- Row open-in-new-tab opens a dedicated item panel.
- Chat icon opens detached chat popover without closing Inbox or disturbing main workspace.
- Detached popover can be dragged by header and docked to main chat.
- Workspace shell owns reusable detached popover/chrome primitives.
- Inbox semantics/data live in an inbox plugin/module.
- Existing `WorkspaceAttentionBlocker` behavior remains compatible.
- No broad regression in plugin-tabs, Skills, Plugins, chat panes, workbench, or session persistence.

Issue #380 closure criteria:

- External harness can create a durable `question` inbox item through the workspace-scoped API.
- External harness can create a durable `review` inbox item through the workspace-scoped API.
- Created items are auth/workspace scoped and cannot leak across workspaces.
- Idempotency key reuse returns the same item or stable conflict error as specified.
- Durable items survive page reload/server restart in full-app/core Postgres mode.
- API route tests cover auth, workspace scoping, idempotency, validation, redaction, and stable error codes.
- Inbox UI displays durable external items and blocker-projected items together with durable items winning on id collision.

## Migration strategy from attention blockers

Initial implementation should run as a projection over existing `WorkspaceAttentionBlocker` state:

1. `WorkspaceAttentionBlocker` remains the source for ask-user/composer blocking behavior.
2. Inbox plugin adapts blockers to transient `WorkspaceInboxItem` values.
3. The adapter uses blocker id as inbox id to prevent duplicates.
4. When durable inbox store lands, source adapters must provide idempotent source ids:
   - ask-user: `ask-user:<questionId>`;
   - external hook: `external-hook:<hookId>`;
   - review: `review:<reviewId>`.
5. During migration, UI merges durable items and blocker-projected items by canonical id; durable item wins when both exist.
6. Blocker projection becomes fallback-only only after all of these are true:
   - ask-user/review hooks in production write durable inbox items;
   - feature flag `inboxDurableSourceOnly` is enabled for the host;
   - existing blocker-backed items have been migrated by one-time sync or verified to be transient-only.
7. Until all three completion criteria are met, UI merges both sources with durable items winning on id collision.

## Performance budget

- Inbox overlay must render 100 items without noticeable jank in local smoke testing.
- Sorting/filtering/pin merging must be memoized over the item array.
- If real workspaces exceed 100 visible inbox items, add list virtualization before expanding filters/labels.
- Do not introduce worker-thread filtering until profiling proves it is necessary; keep v1 direct and measurable.

## Keyboard navigation matrix

| Key | Action |
| --- | --- |
| `j` / `ArrowDown` | Move focus to next item |
| `k` / `ArrowUp` | Move focus to previous item |
| `Enter` | Open focused item in Inbox Preview |
| `o` | Open focused item in dedicated tab |
| `p` | Toggle pin on focused item |
| `c` | Open detached chat when focused item has `sessionId` |
| `Escape` | Close overlay or detached popover |

Implement the matrix in Slice 3; before then, native Tab/Enter behavior is acceptable for the first structural slice.

## Detached popover primitive tests

Required coverage for `DetachedPanelPopover` / `DetachedChatPopover`:

- renders title/chrome/actions;
- close fires and returns focus where practical;
- dock action fires without triggering drag;
- drag starts only from header/handle, not body;
- drag is clamped to viewport/container bounds;
- Escape dismissal if enabled by the shell policy;
- z-index places popover above chat overlay but below app-global modals if such modal layer exists;
- pointer-up outside the header stops dragging cleanly;
- detached chat close/dock ownership transitions are covered in `WorkspaceAgentFront` tests.

## Risks and mitigations

### Risk: duplicate chat ownership

Mitigation: detached chat is read-only in early slices; foreground owner state is required before production sending support is enabled.

### Risk: inbox plugin depends too much on workspace internals

Mitigation: define small shell callback/command contract for open preview, open dedicated, open detached chat.

### Risk: durable inbox duplicates ask-user state

Mitigation: adapter should initially project ask-user state into inbox items; only promote durable records where external hooks/reviews need persistence beyond plugin runtime state.

### Risk: detached popover becomes a one-off

Mitigation: implement reusable `DetachedPanelPopover` first, then compose detached chat and future previews from it.

### Risk: item model overfits current blockers

Mitigation: model fields are minimal: id, kind, status, title, source, session, artifact, timestamps, actions.

## Non-goals for first production slice

- Full email client behavior.
- Complex labels/folders.
- Cross-workspace global inbox.
- Server persistence for every blocker on day one.
- Multi-popover window manager.
- Drag persistence across reloads.
- Rich threaded review conversations inside inbox detail.

## Decisions and defaults

1. First production inbox starts under `packages/workspace/src/plugins/inboxPlugin` as a built-in first-party workspace plugin. Default chosen.
2. Client-local pin migration key is `workspaceId + source.type + item.id`. If source provides a stable external id, include it in `item.id` before persistence. Default chosen.
3. Detached-chat composing remains globally disabled until Slice 5 foreground ownership is complete. No host opt-in before then. Default chosen.
4. Ask-user/blocker adaptation lands before durable external review items, because it validates the UI without introducing server persistence. External hook/review durability follows in Slice 4. Default chosen.
5. Inbox is enabled by default only in plugin-tabs hosts, but hosts can pass `showInbox={false}` while persistence is still transient. Default chosen.

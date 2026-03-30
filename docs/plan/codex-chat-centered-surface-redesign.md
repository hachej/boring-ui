# Chat-Centered Surface Redesign: Implementation Plan

## Status

Draft v5 - 2026-03-29

Requested location: `docs/plan/codex-chat-centered-surface-redesign.md`

Builds on:

- `docs/plans/chat-centered-surface-redesign.md` as the authoritative product, interaction, and visual brief
- the validated "Stage + Wings" proof-of-concept described in that brief
- the current shell implementation in `src/front/App.jsx` and related layout modules

Companion plan:

- `docs/plan/pi-coding-agent-vercel-chat-migration.md` — details the chat rendering migration (pi-web-ui → Vercel useChat) and agent runtime upgrade (pi-agent-core → pi-coding-agent for server mode)

This document is the shell implementation plan. The companion plan covers the chat/agent stack migration. Together they form the complete execution strategy.

---

## Objective

Transform boring-ui from an IDE-first Dockview shell into a chat-first AI agent workspace with four coordinated shell elements:

1. a minimal nav rail on the left
2. an on-demand browse drawer for sessions and workspace browsing
3. a permanently visible chat stage in the center
4. a collapsible Surface on the right for artifacts, files, reviews, charts, tables, documents, images, dashboards, and parity workbench tools such as terminal-style views when needed

The key product change is structural, behavioral, and mental-model level, not merely cosmetic:

- chat becomes the command center rather than one more dockable pane
- the Surface becomes the artifact/workbench channel rather than the editor area wearing a new skin
- browsing becomes progressive disclosure rather than a permanently pinned IDE scaffold
- chat and Surface become independent workbenches with intentionally different persistence rules

---

## Success Definition

The redesign is successful when all of the following are true on supported desktop widths:

- the default workspace launches as rail + centered chat, without a permanent file tree or an empty editor scaffold
- chat is always visible and does not unmount when artifacts open, close, or switch
- the first artifact or explicit open action reveals the Surface as a cohesive floating island
- `open_file`, `open_panel`, review flows, and artifact cards all converge on the same Surface artifact lifecycle
- session switching changes the conversation while preserving the Surface and its open artifacts
- users can still reach files, search, git-style work queues, data, and session history without regressing discoverability
- the shell reads visually as a chat workspace first, not as Dockview with a chat sidebar
- the old shell can coexist behind a flag until persistence, tests, telemetry, and parity are stable

A release should not be considered done merely because the layout looks different. It is done when the new mental model is true in code, state, persistence, tool routing, and interaction behavior.

---

## Strategic Reframe

The design brief already points to the right product model. The implementation plan should make that model explicit so that engineering choices do not accidentally recreate the old shell.

### 1. Default state should feel calm

The clean desktop default is intentionally sparse:

```text
┌──┐┌──────────────────────────────────┐
│  ││          Chat Stage              │
│  ││   centered, always visible       │
│  ││   no permanent editor scaffold   │
└──┘└──────────────────────────────────┘
```

The user should not land inside an IDE-shaped shell whose primary surfaces are empty until they open files. The workspace should feel ready to converse immediately.

### 2. Browsing and working should be distinct

The shell needs two different left-side concepts, not one overloaded sidebar:

- **Browse Drawer**: progressive-disclosure discovery and lists
  - sessions
  - workspace navigation
  - search results
  - git/change lists
  - data sources
- **Surface Explorer**: artifact-centric context for what is already open or immediately relevant to the active workbench state

This is a critical synthesis. The browse drawer is not a rebadged permanent file tree. The Surface explorer is not a full replacement for every discovery workflow. Each has a narrower, clearer job.

### 3. Chat and Surface are independent workbenches

Chat is session-scoped. Surface is workspace-persistent.

That means:

- switching sessions changes the conversation, draft state, and chat scroll position
- switching sessions does **not** clear the Surface, close artifacts, or reset the workbench
- artifacts should carry source-session metadata so the user can understand where they came from and jump back to the originating conversation when useful

### 4. Everything opened for inspection or action should become an artifact

Files, reviews, charts, tables, documents, images, dashboards, terminal-like tools, and future generated outputs should all flow through a first-class artifact model. The user should experience one coherent workbench, not a growing pile of special cases.

### 5. Dockview should become an implementation detail, not the user-facing shell model

The redesign does not require a reckless big-bang Dockview deletion. It does require removing Dockview from the top-level product mental model. If Dockview remains inside the Surface, its native chrome must be subordinate to the Surface shell rather than visually reasserting the old IDE structure.

---

## Current Shell Analysis

The current layout implementation is entirely Dockview-driven:

- `App.jsx` initializes a Dockview root with left (filetree/data-catalog), center (editor tabs), and right (agent chat) groups.
- `src/front/registry/panes.jsx` registers panels with hard placements: filetree is essential/left, editor is center, agent is right.
- `src/front/hooks/useDockLayout.js` discovers groups by panel placement and manages collapse state for three columns.
- `src/front/layout/LayoutManager.js` still persists legacy shell concepts such as `filetree`, `terminal`, and `shell` collapsed state and panel sizes.
- `src/front/panels/AgentPanel.jsx` mounts chat inside a dock panel container instead of as the primary page structure.
- `src/front/providers/pi/sessionBus.js` scopes session coordination by `panelId`, which only makes sense when chat is panel-based.
- `src/front/utils/frontendState.js` publishes generic `open_panels` and `active_panel_id`, but does not describe chat-stage, browse-drawer, or artifact-surface state explicitly.
- `src/front/providers/pi/chatPanelTools.js` filters out the `artifacts` tool, which is another signal that artifact handling is not first-class in the current shell.

There is already useful groundwork for the redesign:

- `chart-canvas` style center panels already exist as non-editor content, so the app can already open polymorphic "artifact-like" views.
- `open_panel` and `open_file` already exist as UI bridge tools and backend UI-state commands.
- `AgentPanel` already separates runtime choice from presentation, which makes it reusable in a non-Dockview chat stage.
- the current file tree, data catalog, review, search, and terminal-related logic can be reused as content modules even if their host shell changes completely.

The main issue is therefore not lack of capability. It is that those capabilities are organized by a panel manager instead of by the target product model.

---

## Product Decisions

These decisions keep the redesign tractable, prevent the implementation from drifting back toward the old shell, and integrate the best parts of the validated brief:

1. **Chat becomes a first-class shell primitive and is always visible on supported desktop widths.**
2. **The Surface is the only place where artifacts open.** Files, diffs, charts, tables, documents, images, dashboards, and parity workbench tools all route there.
3. **The default left edge is minimal.** There is no permanent file tree. The nav rail is always present; the browse drawer is optional and closed by default.
4. **Browse is progressive disclosure.** Session history, workspace lists, search results, git/change lists, and similar discovery surfaces live in a contextual browse drawer rather than as always-pinned columns.
5. **The Surface explorer is artifact-centric.** It manages open artifacts and contextual sections; it should not silently become a full legacy IDE sidebar.
6. **Chat and Surface have different persistence semantics.** Chat is session-scoped. Surface is workspace-persistent.
7. **Split chat panes are removed from the primary UX.** Session switching replaces multi-chat tiling.
8. **Dockview is retained initially only as an implementation detail for Surface internals where it still adds real value.**
9. **The redesign ships behind a feature flag first, with the old shell available until persistence, parity, and tests are stable.**
10. **This track changes the shell, not the agent brain.** The companion plan (`pi-coding-agent-vercel-chat-migration.md`) upgrades the server runtime to pi-coding-agent and replaces pi-web-ui rendering with Vercel useChat. This plan focuses on shell structure; the companion plan covers the chat/agent stack.
11. **Responsive behavior is defined up front.** The redesign is desktop-first for v1, tablet-supported in simplified form, and does not require a full mobile parity pass before launch.
12. **Power-user parity matters.** Existing capabilities such as file browse, reviews, search, and terminal-like workbench tools should remain reachable, even if their location and host change.
13. **Use shadcn/ui components wherever possible.** Buttons, inputs, tabs, dropdowns, popovers, command palette, kbd hints, and scroll areas should use shadcn primitives rather than custom implementations. This accelerates delivery, ensures accessibility, and provides a consistent baseline.
14. **Respect the current design system.** The redesign extends the existing boring-ui design tokens and component patterns rather than introducing a parallel system. New shell components (rail, drawer, Surface chrome) should consume the same CSS variables, font scale, and radius/spacing tokens already in use. The POC design tokens should be reconciled with existing tokens, not layered on top.

---

## Target UX Contract

### Default, Drawer, And Surface States

The shell should support three primary visual states and one combined state:

```text
DEFAULT
┌──┐┌──────────────────────────────────┐
│  ││          Chat Stage              │
│  ││      centered, always visible    │
└──┘└──────────────────────────────────┘

WITH BROWSE DRAWER
┌──┐┌────────────────┐┌─────────────────┐
│  ││ Sessions /     ││ Chat Stage      │
│  ││ Workspace      ││                 │
└──┘└────────────────┘└─────────────────┘

WITH SURFACE
┌──┐┌──────────────────┐┌─ Surface ────────────────────┐
│  ││   Chat Stage     ││ [Artifacts] [tabs...]      ✕ │
│  ││                  ││ ┌explorer┐┌───────────────┐  │
│  ││                  ││ │open art││ active viewer │  │
└──┘└──────────────────┘└────────────────────────────┘

WITH DRAWER + SURFACE
┌──┐┌──────────────┐┌────────────────┐┌─ Surface ──────┐
│  ││ browse/list  ││ Chat Stage     ││ explorer/view │
└──┘└──────────────┘└────────────────┘└───────────────┘
```

The default state should be the calmest state. The presence of a drawer or Surface should always correspond to intentional user or agent activity.

### 1. Nav Rail

The nav rail is a 48px icon strip pinned to the left and always visible.

Core responsibilities:

- brand / workspace anchor
- new chat action
- sessions destination
- workspace destination
- command palette access
- settings/profile

Behavioral rules:

- one destination may be active at a time
- selecting a destination can open the browse drawer in the corresponding mode
- selecting the same active destination toggles the drawer closed
- the rail itself should never expand into a legacy sidebar
- the rail remains visible even when both drawer and Surface are closed

Recommended v1 destinations:

- brand
- `+` new chat
- sessions
- workspace
- command palette / search trigger if needed
- settings/profile pinned to bottom

The workspace destination should open a drawer with tabs or internal modes for Files, Search, Git/Changes, and Data. This preserves rail minimalism without losing the useful browse-mode idea.

### 2. Browse Drawer / Left Wing

The browse drawer is a progressive-disclosure left wing. It should feel lightweight, contextual, and dismissible.

Responsibilities:

- session history and session switching
- workspace browse lists
- search results
- git/change queues
- data/catalog discovery
- lightweight commands that are inherently list-driven rather than artifact-driven

Rules:

- closed by default
- width target: `220px` to `280px`
- may slide over the stage at narrower widths rather than permanently consuming layout width
- list-oriented, not a second full workbench
- selecting an item may switch chat, open/focus an artifact in the Surface, or reveal a contextual section

Important distinction:

- the browse drawer is for discovery and navigation
- the Surface explorer is for open-artifact context and local workbench navigation

Those responsibilities should not blur unless a temporary implementation shortcut is explicitly called out as transitional.

### 3. Chat Stage

The chat stage is the permanent center of the product.

Rules:

- always mounted on desktop in chat-centered mode
- never closable like a dock panel
- visually centered, with a comfortable max content width
- message column target width: `680px` max, with generous outer gutters
- session switching changes only the active conversation and chat-scoped state
- message list supports artifact cards that open or focus items in the Surface
- the active artifact can be reflected back into chat via highlighted cards or badges
- composer is the dominant action affordance and remains easy to refocus
- chat scroll position should be preserved per session

Interaction details to preserve from the design brief:

- pill-shaped composer (border-radius 24px)
- high-contrast send button (white on dark, circular)
- keyboard shortcut hints rendered as `<kbd>` elements inside the composer (e.g., `⌘` `K`)
- message avatars: small icon badges per role (user icon for human, sparkles icon for agent)
- artifact cards that feel like openings into the Surface rather than mini-panels
- keyboard-first flows for new chat, command palette, surface toggle, and composer focus

### 4. Surface

The Surface is the persistent artifact workbench on the right.

Responsibilities:

- hold open artifacts in tabs
- expose an artifact explorer
- render the active viewer
- host review, inspect, edit, export, accept/reject, and similar artifact actions
- persist independently from the active chat session

Rules:

- hidden by default until the first artifact opens or the user explicitly reveals it
- appears as a floating island, not as a hard-edged IDE column
- default width target: `600px`
- minimum width target: `420px`
- large-screen default may expand toward `680px` to `780px` depending on artifact type
- maximum width: `65%` of viewport (prevents Surface from consuming the whole stage)
- resizable via a drag handle on the left edge; handle shows a subtle accent indicator on hover/drag
- top bar owns the visible tabs, explorer toggle, and close action
- viewer header includes: type icon + title + type badge + export button
- Surface can collapse to a 36px vertical handle strip (rounded corners, PanelRightOpen icon + artifact count badge); clicking restores to previous width
- explorer is collapsed by default
- explorer width target: `190px`
- explorer groups artifacts by category (e.g., Data, Documents, Code) with item counts per group
- each explorer item shows: icon (colored by type) + title + active dot indicator
- artifact tabs support drag-to-reorder and drag-to-split (side-by-side artifact viewing within the Surface)
- split views allow comparing two artifacts (e.g., diff + original, chart + table) without leaving the Surface
- this is the primary reason to retain Dockview inside the Surface — its split/tab infrastructure is already battle-tested
- **Surface must never unmount on close** — use `display: none` or `transform: translateX(100%)`, not conditional rendering (`{isOpen && <Surface/>}`). Unmounting destroys Monaco editor state, chart state, scroll position, and Dockview layout. The POC validates this: `poc-stage-wings/src/App.jsx` keeps Surface always mounted, toggling visibility via the `collapsed` prop.
- close/hide should not destroy chat state or artifact state
- if Dockview is reused inside the Surface, Dockview header chrome must not leak into the visible shell hierarchy
- Dockview context menus and popups must portal outside the Surface island to avoid `overflow: hidden` clipping

Minimum v1 artifact support:

- code/editor
- review/diff
- chart
- table

Strong parity targets for v1 or immediate follow-up:

- document
- image
- dashboard/custom renderers
- terminal-style workbench views where those already exist in the current product

Diff artifact specifics:

- inline diff view with added (green) / removed (red) line highlighting
- "Accept" and "Reject" action buttons below the diff, styled as green/red pill buttons
- accept commits the change, reject reverts it, both close the diff
- these buttons are the primary action for code artifacts from agent edits

### 5. Artifact Cards And Lifecycle

Artifacts should have one lifecycle no matter how they were created.

Entry points:

- user clicks a file or result in browse drawer
- agent emits an artifact card in chat
- `open_file` tool call
- `open_panel` tool call
- review action
- chart/data action
- command palette result
- explorer selection

Lifecycle expectations:

1. artifact is normalized into a shared model
2. Surface opens if needed
3. artifact is deduplicated against existing open artifacts by canonical key
4. matching artifact is focused if already open; otherwise a new artifact is created
5. chat card, explorer entry, and tab state stay in sync
6. artifact remains restorable even if the Surface is temporarily closed
7. dirty-state and destructive-close rules are respected for editable artifacts

Streaming artifact behavior:

When an agent writes or edits a file, the artifact should open immediately in a "streaming" state — not wait until the tool call completes. Vercel AI SDK supports streaming tool arguments; use this to feed content into the Surface renderer in real-time. The POC's `VercelPiChat.jsx` demonstrates tool-call cards appearing inline during streaming; the production version should also stream the artifact content into the Surface viewer simultaneously.

Artifact states: `loading` → `streaming` → `ready` → `error`

- `loading`: Surface opens, shows skeleton/spinner
- `streaming`: content arrives incrementally (code streams into editor, chart data builds progressively)
- `ready`: tool call complete, artifact fully rendered
- `error`: tool failed, show error with retry

Agent edit locking:

When the agent is actively writing to an artifact (status = `streaming`), the Surface viewer must enter a read-only "Agent is editing..." state to prevent user cursor collisions. Rules:

- agent starts `write_file` or `edit_file` → artifact locks, viewer shows "Agent is editing..." badge
- agent tool completes → lock releases, viewer becomes interactive
- if user was editing the same file, their unsaved changes are preserved in a shadow buffer and offered as a merge/diff after agent finishes
- the artifact model tracks `lockedBy: 'agent' | null` alongside `status`

Artifact card behavior in chat:

- clickable
- icon + title + type + optional status + chevron affordance (opacity increases when active)
- three visual states:
  - default: subtle gradient background, muted border
  - open (in Surface tabs but not active): slightly elevated border
  - active (currently viewed in Surface): accent background, accent border, glow
- supports jump-to-surface behavior
- should not attempt to become a full viewer inside the chat timeline

### 6. Session Model

The session model must embody the "two workbenches" idea.

Rules:

- active chat session changes the conversation in the chat stage
- Surface remains as-is across session switches
- artifacts may carry `sourceSessionId` and optional source-message metadata
- Surface may show artifacts that originated from a non-active session
- when that happens, the Surface should be able to show provenance subtly, for example with a session badge or "jump to chat" affordance
- new chat does not create a new visible chat panel; it creates or activates a new session in the single chat stage
- no multi-chat tiling in the primary shell

Session drawer details:

- sessions grouped by recency (`Today`, `Yesterday`, older buckets)
- status dots with specific color mapping:
  - active: accent blue (`var(--accent)`)
  - paused: warning yellow (`var(--warning)`)
  - idle: muted gray (`var(--text-tertiary)`)
- should scale to many sessions without reintroducing panel clutter

### 7. Empty States

Each zone should have an intentional empty state that teaches the product model without tooltips or guided tours:

- **Chat** (no messages): centered Sparkles icon, "What can I help with?", hint that results appear on the Surface
- **Surface** (no artifacts): Sparkles icon in gradient container, "The Surface is clear", 3 actionable suggestion pills (e.g., "Generate a dashboard", "Analyze a spreadsheet", "Draft a presentation")
- **Browse drawer** (no sessions): "No sessions yet" with new-chat action
- **Surface explorer** (no artifacts in session): "No artifacts yet"

Empty states should feel intentional and calm, not broken or incomplete.

### 8. Responsive Contract

The redesign should define scope boundaries instead of leaving responsiveness vague.

Desktop large (`>= 1440px`):

- full rail + optional drawer + centered chat + Surface
- chat stage retains generous gutters even when Surface is open
- Surface can use its default width comfortably

Desktop standard (`1200px - 1439px`):

- same shell model
- drawer may behave more like overlay than reserved width
- Surface defaults a bit narrower
- explorer remains collapsed by default

Tablet / narrow desktop (`1024px - 1199px`):

- chat remains primary
- only one wing should aggressively claim width at a time
- drawer and Surface may overlay rather than both staying fully expanded
- Surface may open as a larger sheet-like overlay instead of a fully detached island

Below `1024px`:

- not a v1 default-on target
- either fall back to a simplified stacked mode or remain on the legacy responsive shell until a dedicated mobile pass exists

### 9. Keyboard, Accessibility, And Motion Contract

Core keyboard shortcuts:

- `Cmd+K` — command palette
- `Cmd+N` — new chat session
- `Cmd+1` — toggle browse drawer (spatial symmetry with `Cmd+2`)
- `Cmd+2` — toggle Surface
- `Cmd+B` — toggle browse drawer (alias for `Cmd+1`, familiar from VS Code)
- `Esc` — focus chat composer; if already focused, close transient overlays first

Accessibility expectations:

- rail, browse drawer, chat stage, and Surface should each have clear landmarks
- full keyboard navigation for rail, tabs, drawer lists, explorer, and artifact actions
- focus should never disappear into hidden Dockview internals
- visible focus treatment must remain strong in the dark theme
- color is not the only signal for active/open/dirty state
- reduced-motion users should get shorter or disabled spring transitions
- blur and transparency should degrade safely where unsupported

---

## Architecture Direction

### A. Separate shell state from chat state, browse state, and artifact state

Today `App.jsx` mixes shell layout, panel orchestration, session behavior, and artifact opening inside a Dockview-driven tree. The redesign should separate those concerns explicitly:

- **shell layout**
  - nav rail
  - browse drawer
  - chat stage frame
  - Surface frame
- **chat state**
  - active session
  - session list
  - chat drafts and scroll positions
- **browse state**
  - active drawer mode
  - drawer open/closed
  - list filters/search state
- **Surface state**
  - open/closed
  - collapsed/expanded
  - width
  - explorer open/closed
  - active artifact id
  - open artifact order
- **artifact state**
  - artifact records
  - renderer selection
  - per-artifact UI state
  - provenance and dirty-state metadata

A top-level shell reducer or shell-specific state hook should own these boundaries rather than continuing to route everything through Dockview panel identity.

### B. Introduce a first-class shell state model

A stronger state contract will prevent regression into panel-shaped assumptions.

Suggested shape:

```ts
type BrowseMode = 'sessions' | 'files' | 'search' | 'git' | 'data'
type RailDestination = 'none' | 'sessions' | 'workspace' | 'settings'

type ChatCenteredShellState = {
  railDestination: RailDestination
  browseDrawer: {
    open: boolean
    mode: BrowseMode
    width: number
  }
  chat: {
    activeSessionId: string | null
  }
  surface: {
    open: boolean
    collapsed: boolean
    width: number
    explorerOpen: boolean
    activeArtifactId: string | null
    orderedArtifactIds: string[]
  }
}
```

If the current front-end architecture is easier to evolve with a local reducer hook than a new global store, prefer the reducer hook first. A new global state library is not required for this project.

Session state ownership (unidirectional data flow):

The shell state, transport layer, and Vercel `useChat` must not all think they own the active session. The data flow is:

```
Storage (IndexedDB / JSONL)  →  source of truth
       ↓
Shell state (activeSessionId)  →  pointer only
       ↓
useChat (id prop)  →  controlled consumer, re-initialized on session switch
       ↓
Transport  →  reads messages from storage, streams new ones
```

- Storage is the source of truth for session content (messages, metadata)
- Shell state holds the *pointer* (`activeSessionId`) and shell layout state
- `useChat` is a controlled consumer — when `activeSessionId` changes, `useChat` reinitializes with the new session's message history via the `id` prop or a fresh transport
- The transport reads from and writes to storage, but does not own session selection

This prevents the three-way race condition where shell state, `useChat` internal state, and storage disagree about which session is active.

### C. Introduce a stronger artifact model with canonical identity

The redesign needs a shared artifact model rather than ad hoc panel IDs.

Recommended starting point:

```ts
type SurfaceArtifact = {
  id: string
  canonicalKey: string
  kind: string  // 'code' | 'review' | 'chart' | 'table' | 'document' | 'image' | ... extensible
  title: string
  source: 'user' | 'agent' | 'system'
  sourceSessionId?: string
  sourceMessageId?: string
  rendererKey: string
  params?: Record<string, unknown>
  // Content: renderers read from params or fetch via canonicalKey (e.g., file path → API read).
  // The artifact model stores metadata + pointers, not the full content blob.
  // For streaming artifacts, the renderer subscribes to the transport's stream directly.
  status: 'loading' | 'streaming' | 'ready' | 'error'
  lockedBy?: 'agent' | null
  dirty?: boolean
  shadowBuffer?: string   // user's unsaved edits preserved while agent holds the lock
  createdAt: number
}
```

Key rules:

- `canonicalKey` deduplicates the same logical artifact, for example the same file path or same review id
- `id` is instance identity, not logical identity
- provenance fields make it possible to relate an artifact back to the session and message that created it
- `kind` is a string rather than a union to keep the model extensible without type changes
- fields like `retention`, `capabilities`, `subtitle`, and `panelComponent` can be added when a real use case demands them — ship the minimum that makes dedupe, provenance, and rendering work

Ordering rules:

- new artifacts append to the end of the tab order by default
- user can reorder tabs via drag-and-drop (persisted)
- focusing an existing artifact does NOT move it in the tab order
- closing an artifact activates the most recently active sibling, not the positional neighbor
- this matches browser tab behavior, which users already understand

The initial implementation can derive these artifacts from existing panel-opening intents rather than requiring the agent protocol to change first.

### D. Unify chat rendering under Vercel AI SDK, keep PI agent runtime

The codebase currently has two chat rendering paths — Pi Agent (`pi-web-ui` shadow DOM widget) and Vercel AI SDK (`useChat`). The redesign **unifies rendering under Vercel AI SDK `useChat`** while keeping PI agent as the runtime brain.

See companion plan: `docs/plan/pi-coding-agent-vercel-chat-migration.md`

What gets replaced:

- `PiNativeAdapter` (shadow DOM, Lit web components, 300+ CSS overrides) → deleted
- `PiBackendAdapter` → replaced by `DefaultChatTransport` pointing at `/api/v1/agent/chat`
- `pi-web-ui` + `mini-lit` dependencies → removed

What stays:

- `pi-agent-core` `Agent` class (browser mode runtime)
- `pi-ai` (multi-provider model routing)
- `defaultTools.js` (browser mode — tools call boring-ui backend API)
- session management and event bus (refactored)

What gets built:

- `PiAgentCoreTransport` — custom `ChatTransport` wrapping PI Agent Core for browser mode
- `ChatStage.jsx` — unified chat renderer using `useChat` + custom message components
- Custom tool renderers, artifact cards, composer — all React, all composable with Surface

The redesign should reuse the PI agent runtime, not rewrite it. The work is in replacing the rendering layer (shadow DOM → React) and changing state ownership (panel-scoped → shell-scoped).

Transport selection:

- **Browser mode**: `useChat` → `PiAgentCoreTransport` → `pi-agent-core` Agent (in-browser, custom tools via backend API)
- **Server mode**: `useChat` → `DefaultChatTransport` → `/api/v1/agent/chat` → `pi-coding-agent` (server-side, compaction, built-in tools)

### E. Treat session state as session-scoped, not panel-scoped

`sessionBus.js` currently keys everything by `panelId`. In the new shell the stable key should be the active chat workspace context, not a dock panel instance.

Required consequences:

- new chat creates or activates a session, not a new agent panel
- session toolbar ownership moves from panel header chrome into chat stage chrome
- per-session scroll/draft state can be preserved without panel IDs
- panel identity must stop leaking into backend UI state as the main representation of conversation state

### F. Keep Dockview only where it still adds value, and hide it behind Surface chrome

A full Dockview removal is not required for v1. The pragmatic shape is:

- top-level page layout becomes regular React layout and CSS grid/flex
- Dockview is retained inside the Surface specifically for tab management, drag-to-reorder, and split-view capabilities — this is its core value
- artifact tabs can be dragged to split the Surface into side-by-side views (e.g., diff + original, chart + table)
- visible tab chrome, close buttons, explorer toggle, and Surface frame belong to the Surface shell, not Dockview defaults

Implementation rule:

- Dockview's native tab bar and header chrome should be suppressed in favor of custom Surface tab chrome
- a user should perceive one Surface with splittable tabs, not "a Dockview app inside a floating box"
- split state is part of Surface persistence

### G. Distinguish browse modules from renderer modules

The redesign should split module responsibilities more clearly than the current pane registry does.

Suggested categories:

- **browse modules**
  - sessions list
  - workspace file/data/search/git lists
- **artifact renderers**
  - code/editor
  - review
  - chart
  - table
  - document
  - image
  - dashboard/custom
  - terminal-like tools

This separation matters because list/discovery experiences and active-workbench experiences behave differently and persist differently.

### H. Add an artifact registry / renderer registry instead of overloading pane registry forever

The existing pane registry can remain as a compatibility layer, but the new shell should introduce a clearer abstraction such as:

- artifact kind -> renderer
- artifact kind -> capabilities
- tool action / UI action -> artifact factory
- browse destination -> browse module

This can start light-weight in v1 and later absorb more of the pane registry's responsibilities.

### I. Make chat cards, browse entries, and Surface tabs all point at the same artifact controller

Today the product risks creating separate concepts for "the thing the agent mentioned," "the thing in the editor," and "the thing the file tree selected." In the redesigned shell those should all converge on the same controller and same identity model.

There should be one code path for:

- open artifact
- focus artifact
- reveal artifact
- close artifact
- restore artifact

That unification is one of the highest-leverage improvements in this redesign.

The specific bridge between Vercel AI SDK tool rendering and the Surface:

When `useChat` receives a tool-result part (e.g., agent called `write_file`), the custom React component rendering that tool result (`ToolCallCard.jsx`) fires a side-effect into the artifact controller:

```jsx
// Inside ToolCallCard render:
useEffect(() => {
  if (toolResult?.status === 'complete' && toolResult?.params?.path) {
    artifactController.open({
      kind: 'code',
      canonicalKey: toolResult.params.path,
      title: toolResult.params.path,
      source: 'agent',
      sourceSessionId: activeSessionId,
    })
  }
}, [toolResult?.status])
```

The AI SDK handles the *timeline rendering* (showing the tool card in chat). The *side-effect* of opening the Surface is explicitly bridged through the artifact controller. This pattern is validated in the POC (`poc-stage-wings/src/VercelPiChat.jsx` line ~190, `onOpenArtifact` callback from tool result cards).

### J. Define an agent-to-Surface artifact protocol

The agent runtime needs a structured way to declare artifacts, not just raw tool calls.

Today the agent can `open_file` or `open_panel`. The new shell needs richer intent:

```ts
type AgentArtifactIntent = {
  action: 'create' | 'update' | 'focus'
  kind: string
  canonicalKey: string
  title: string
  params: Record<string, unknown>
  autoOpen?: boolean    // default true for single artifacts, false for batch
  sourceMessageId?: string
}
```

The shell should expose a single bridge function that replaces the existing `PI_OPEN_FILE_BRIDGE` and `PI_OPEN_PANEL_BRIDGE` with a unified entry point. Existing bridges remain as thin adapters during migration.

Benefits:

- agent tool renderers don't need to know about Surface internals
- batch artifact creation (agent edits 5 files) can be expressed as a group with `autoOpen: false`
- the bridge is testable independently from the UI

### K. Guard against context overflow in browser mode

Browser mode uses `pi-agent-core` without compaction. If a user opens 5 large files in the Surface and the agent tries to include them all in context, the token limit will be silently exceeded.

Requirements:

- the transport layer should estimate token usage before sending messages
- if estimated tokens exceed 80% of the model's context window, warn the user before sending
- the UI should show a context usage indicator (similar to Claude Code's token bar) so users can self-manage
- server mode handles this automatically via pi-coding-agent's compaction; browser mode needs the guardrail explicitly

### L. Preserve performance by avoiding unnecessary remounts

The new shell will feel worse than the old one if it remounts heavy viewers or the chat runtime on every interaction.

Performance requirements:

- chat adapter should not remount merely because the Surface opens or closes
- session switching should preserve chat scroll where possible
- heavy renderers should lazy-load
- browse lists with many items should virtualize if necessary
- Surface open/close animations should not trigger layout thrash across the whole app
- restore from persistence should be incremental rather than blocking first paint on full artifact hydration

### M. Isolate artifact renderer failures from the shell

A polymorphic rendering system will encounter renderer errors (bad chart data, corrupt file content, missing dependencies). These must not cascade.

Requirements:

- each artifact viewer should be wrapped in a React error boundary
- a failed renderer should show a graceful fallback (title + error message + retry button) without crashing the Surface shell, other tabs, or the chat stage
- the artifact model should track `status: 'error'` so the explorer and tabs can show error indicators
- error state should be recoverable (retry button re-mounts the renderer)

This is especially important because v1 will introduce multiple new renderer types (chart, table, document) alongside existing code/review renderers. New renderers are the most likely to fail.

---

## Detailed Interaction Model

### Chat Stage Behavior

- the chat stage is the visual center whether or not the Surface is open
- when Surface opens, the stage may shift left slightly, but it should not collapse into a narrow leftover column pinned against the rail
- the composer remains anchored and easy to refocus
- artifact cards in the timeline should support:
  - open
  - focus existing
  - indicate active/open
  - show simple type metadata
- long-running artifact generation can show pending cards that resolve into openable artifacts

### Browse Drawer Behavior

- opening the drawer should not destroy chat scroll or composer focus state
- selecting a session switches chat immediately
- selecting a file/search result/git item generally opens or focuses a Surface artifact
- selecting the active rail destination toggles the drawer closed
- clicking away or pressing `Esc` can close the drawer when focus is not in the composer

### Surface Behavior

- first artifact open reveals the Surface automatically
- Surface remembers width, collapsed/open state, explorer state, and artifact order
- closing the Surface hides the workbench but does not imply "close every artifact forever"
- reopening the Surface should restore prior artifact state where possible
- dirty artifacts need close guards
- explorer selection and tab selection should stay synchronized

### Source Provenance Behavior

Because the Surface persists across sessions, provenance matters.

Recommended affordances:

- subtle source-session badge on artifacts when not from the active session
- "jump to originating chat" action from the Surface header or tab menu
- optional chat-card highlight when an artifact opened from that card is active

This avoids the real-world confusion of a persistent workbench whose contents no longer obviously belong to the currently visible conversation.

---

## Execution Plan

### Phase 0: Baseline, Flag, And Delivery Safety Rails

Create a safe delivery envelope before any large shell edits.

Deliverables:

- snapshot the current layout boot path and smoke test it
- add a single feature flag: `features.chatCenteredShell` — this controls BOTH the shell redesign AND the Vercel chat migration (they are not independently useful). The companion plan's chat migration is not a separate flag; it ships as part of the shell flag.
- add a query override (`?shell=chat-centered`) for local development and visual diffing
- capture fresh UI baselines with the existing shell
- freeze an acceptance matrix for desktop-large, desktop-standard, and tablet widths
- record core smoke flows before shell extraction:
  - start chat
  - switch session
  - open file
  - open review
  - open chart
  - reopen from persistence

Primary files:

- `src/front/config/appConfig.js` or the runtime config layer
- `src/front/App.jsx`

Success criteria:

- old and new shells can coexist behind a switch
- no forced layout reset for users outside the flag
- baseline screenshots and smoke flows exist before structural refactors begin

### Phase 1: Extract A New Shell Host From `App.jsx`

Build the empty frame for the new shell without yet changing any functional behavior.

Deliverables:

- create a new shell entry such as `src/front/shell/ChatCenteredWorkspace.jsx`
- move rail, browse drawer, chat stage frame, and Surface frame into shell-specific components
- keep auth, workspace routing, providers, capabilities loading, and workspace plugin loading in `App.jsx`
- create an initial shell state hook or reducer such as `useChatSurfaceState.js` or `useChatCenteredShellState.js`

Recommended new modules:

- `src/front/shell/ChatCenteredWorkspace.jsx`
- `src/front/shell/NavRail.jsx`
- `src/front/shell/BrowseDrawer.jsx`
- `src/front/shell/SessionDrawer.jsx`
- `src/front/shell/SurfaceShell.jsx`
- `src/front/shell/useChatCenteredShellState.js`
- `src/front/shell/artifacts/*`
- `src/front/shell/browse/*`

Primary refactors:

- `App.jsx`: add conditional render for chat-centered shell when flag is on
- `App.jsx`: extract all layout initialization that is Dockview-specific into the legacy path

Success criteria:

- the app can render a static chat-first shell with placeholder rail, drawer, chat stage, and Surface frames
- providers still mount correctly
- no Dockview root is required to paint the shell

### Phase 2: Establish The New Shell State And Artifact Controller

Before moving UI behavior, create the new state model explicitly.

Deliverables:

- implement shell reducer/state hook
- implement artifact controller with:
  - open
  - focus
  - close
  - restore
  - dedupe by canonical key
- define artifact record shape in code and tests
- expose selectors for:
  - active session
  - drawer mode
  - open artifacts
  - active artifact
  - explorer open state

Primary files:

- `src/front/shell/useChatCenteredShellState.js`
- `src/front/shell/artifacts/useSurfaceArtifacts.js`
- `src/front/shell/artifacts/artifactModel.js`
- `src/front/hooks/usePanelActions.js`
- `src/front/utils/dockHelpers.js`

Success criteria:

- artifact operations work independently of Dockview root assumptions
- the new shell can reason about artifacts even before all renderer migration is complete
- duplicate opens of the same file or review focus instead of multiply cloning by default

### Phase 3: Make Chat The Permanent Center Stage

Move the agent experience out of the dock panel model.

Deliverables:

- mount the chat stage as a permanent React child of the new shell container
- replace `AgentPanel` framing with a unified `ChatStage` using Vercel `useChat`
- wire transport selection (browser: `PiAgentCoreTransport`, server: `DefaultChatTransport`)
- build custom message renderer, composer, tool cards, artifact cards (all React)
- move session controls out of the Dockview panel header into chat stage chrome
- remove the primary "split chat panel" behavior from the new shell
- remove `PiNativeAdapter` (shadow DOM) and `PiBackendAdapter` — replaced by transport layer
- preserve per-session chat scroll and composer draft state if feasible

See: `docs/plan/pi-coding-agent-vercel-chat-migration.md` Phases B-C for detailed component breakdown.

Primary files:

- `src/front/panels/AgentPanel.jsx` (gutted, becomes thin wrapper or deleted)
- `src/front/providers/pi/PiSessionToolbar.jsx`
- `src/front/providers/pi/sessionBus.js`
- `src/front/shell/ChatCenteredWorkspace.jsx`
- `src/front/shell/ChatStage.jsx` (new)
- `src/front/shell/ChatMessage.jsx` (new)
- `src/front/shell/ChatComposer.jsx` (new)
- `src/front/providers/pi/piAgentCoreTransport.js` (new)

Behavior changes:

- session state is keyed by workspace plus active chat context, not `panelId`
- new chat creates or switches sessions without creating another dock panel
- chat remains visible even when the Surface is closed
- session switch does not reconstruct the shell

Success criteria:

- there is exactly one visible chat stage in the new shell
- session switching works without any Dockview panel choreography
- closing or reopening the Surface never unmounts the chat runtime

### Phase 4: Build The Surface Shell And Surface Chrome

Create the persistent right-side artifact workbench.

Deliverables:

- a `SurfaceShell` state model covering:
  - open/closed
  - collapsed/expanded
  - width
  - explorer expanded/collapsed
  - active artifact id
  - open artifact order
- Surface top bar with:
  - explorer toggle
  - artifact tabs
  - optional provenance indicator
  - close/collapse action
- viewer host that can mount existing artifact-capable panels
- Surface shell styling and structure independent from nested renderer implementation details

Recommended approach:

- keep an internal Dockview instance inside the Surface only if it meaningfully reduces migration risk
- map artifact open/focus events to that nested instance
- hide or skin Dockview so the visible shell remains a single Surface island

Primary files:

- `src/front/hooks/usePanelActions.js`
- `src/front/registry/panes.jsx`
- `src/front/shell/SurfaceShell.jsx`
- `src/front/shell/artifacts/*`
- `src/front/styles.css`

Success criteria:

- `openFile` opens code in the Surface instead of the center dock
- review and chart surfaces can also mount inside the Surface
- Surface can be opened, closed, collapsed, resized, and restored without destroying artifact state or chat state

### Phase 5: Route Existing Open Actions Into The Artifact System

Unify how artifacts enter the Surface.

Deliverables:

- adapt `openFile` to create/focus `code` artifacts
- adapt existing review actions to create/focus `review` artifacts
- adapt chart/table openings to create/focus corresponding artifacts
- ensure agent-generated artifact cards use the same artifact controller
- add minimal provenance so artifacts know which session/message opened them

Primary files:

- `src/front/hooks/usePanelActions.js`
- `src/front/providers/pi/chatPanelTools.js`
- `src/front/components/chat/*`
- `src/front/shell/artifacts/*`

Success criteria:

- the same logical item opens only once unless explicitly duplicated
- chat cards, tool actions, and browse actions all converge on the same artifact
- the Surface feels like one workbench, not three separate opening mechanisms

### Phase 6: Build Browse Drawer And Migrate Workspace Flows

Add the progressive-disclosure browse layer AND migrate existing workspace content into it. These ship together because a drawer with no content is not testable. This phase is where parity risk is highest, so it should be explicit.

Deliverables:

- implement the nav rail destination model
- implement browse drawer open/close behavior
- support initial browse modes:
  - sessions
  - workspace
- inside workspace mode, support tabs or submodes for:
  - files
  - search
  - git/changes
  - data
- adapt `FileTreePanel` logic into a browse module
- adapt `DataCatalogPanel` logic into browse and artifact flows
- ensure search results and git/change lists have a clear home
- implement final responsibility split:
  - browse drawer for broad discovery/listing
  - Surface explorer for open-artifact management and local context
- keep existing logic as much as possible while changing the host container
- keep drawer list experiences lightweight and list-first

Primary files:

- `src/front/panels/FileTreePanel.jsx`
- `src/front/panels/DataCatalogPanel.jsx`
- `src/front/registry/panes.jsx`
- `src/front/shell/NavRail.jsx`
- `src/front/shell/BrowseDrawer.jsx`
- `src/front/shell/SessionDrawer.jsx`
- `src/front/shell/browse/*`
- `src/front/shell/SurfaceShell.jsx`
- `src/front/hooks/useDockLayout.js`
- `src/front/styles.css`

Important implementation rule:

- it is acceptable for some legacy modules to be hosted in transitional wrappers during migration
- it is **not** acceptable to leave the final user experience as "the old sidebar mounted in a drawer" without converging toward the clearer browse vs explorer split

Success criteria:

- the left edge of the app is a rail, not a file browser
- files, search, data, and review-oriented lists remain reachable
- users can discover workspace items without losing the clean default state
- sessions can be switched from the drawer
- workspace browse lists can open/focus artifacts in the Surface

### Phase 7: Rewire UI Bridge Commands And Frontend State Reporting

The backend and tool bridge must understand the new shell shape.

Deliverables:

- keep `open_panel` working, but route it through a surface-artifact adapter in chat-centered mode
- keep `open_file` working, but always target the Surface
- extend the frontend state snapshot to describe shell state explicitly
- extend UI-state tools so the agent can reason about chat stage, drawer state, and Surface state
- consider a future-friendly `open_artifact` abstraction if cheap, but do not block on it

Primary files:

- `src/front/hooks/usePanelActions.js`
- `src/front/utils/frontendState.js`
- `src/front/providers/pi/chatPanelTools.js`

Contract additions to consider:

- `shell.mode = "chat-centered"`
- `shell.rail_destination`
- `browse.open`
- `browse.mode`
- `surface.open`
- `surface.collapsed`
- `surface.active_artifact_id`
- `surface.open_artifacts`
- `chat.active_session_id`

Backward-compatibility rule:

- continue publishing `open_panels` during the transition, even if new shell metadata is added
- do not strand older tooling on day one

Success criteria:

- agent tool calls still work
- backend UI inspection becomes more truthful for the new shell
- no major shell behavior depends on pretending the new UI is still just Dockview panels

### Phase 8: Persistence And Migration Strategy

The redesign should not be forced through the old layout persistence model.

Deliverables:

- introduce a chat-centered shell persistence record separate from legacy Dockview host layout
- keep legacy layout storage only for Surface internals if Dockview remains there
- persist shell state separately from session state and artifact state
- bump `LAYOUT_VERSION` only where legacy host layouts must be invalidated

Primary files:

- `src/front/layout/LayoutManager.js`
- `src/front/shell/useChatCenteredShellState.js`

Recommended persistence split:

- shell state
  - rail destination
  - drawer open/closed
  - drawer mode
  - Surface open/closed
  - Surface collapsed
  - Surface width
  - Surface explorer open/closed
- chat state
  - active session id
  - optional per-session draft/scroll state if already persisted
- artifact state
  - artifact records
  - artifact order
  - active artifact id
  - optional nested Dockview snapshot for Surface internals only

Migration rules:

- do not attempt a perfect migration from old host Dockview layouts to the new shell
- prefer a one-time reset into the new default shell
- attempt best-effort recovery of open editor/review artifacts into initial Surface artifacts where practical
- do not preserve old concepts such as permanent `filetree` or `shell` collapsed state as first-class new-shell concepts
- **session migration**: existing pi-web-ui IndexedDB sessions must be migrated to the new storage format (or the new transport must be able to read the old IndexedDB format). Users should not lose chat history on rollout. Write a one-time migration script that runs on first load under the new flag.
- persistence version: use a single `SHELL_VERSION` constant shared between shell layout and session storage so that a cold-start can clear both atomically on breaking changes

Success criteria:

- no legacy `terminal`, `filetree`, or `shell` assumptions remain in new-shell persistence
- layout resets are deliberate, documented, and versioned
- reopening the app restores the new shell in a way that matches the new mental model

### Phase 9: Visual Language, Accessibility, And Interaction Polish

Apply the design brief fully after structure is working.

Deliverables:

- nav rail sizing and icon treatment
- centered chat column with stronger composer affordance
- floating Surface island styling
- backdrop blur, layered shadows, inner highlight, soft borders
- gradient or elevated artifact cards where appropriate
- mac-style floating scrollbars and scroll fade masks where technically safe
- keyboard shortcuts for:
  - new chat
  - toggle Surface
  - toggle browse drawer
  - focus composer
  - command palette
- reduced-motion handling
- strong focus states
- dark-theme contrast validation

shadcn/ui component mapping (extend existing `src/front/components/ui/`):

- `Button` — rail actions, Surface actions, diff accept/reject, export
- `Input` — composer input, search input in browse drawer
- `Tabs` — browse drawer modes, Surface explorer category tabs
- `Tooltip` — rail icon tooltips, artifact card tooltips
- `Dialog` — command palette overlay, confirmation dialogs
- `DropdownMenu` — tab context menus, artifact actions overflow
- `Badge` — artifact count, session status, dirty indicators
- `ScrollArea` — chat scroll, explorer scroll, drawer list scroll
- `Separator` — rail dividers, explorer section dividers
- Add `Command` (cmdk) for the command palette if not already present

Primary files:

- `src/front/styles.css`
- `src/front/components/ui/*` (extend existing shadcn components)
- chat component styles under `src/front/components/chat/*`
- new shell component styles
- Surface-specific chrome styling

Important rule:

- do not spend time polishing Dockview chrome globally if Dockview is no longer the top-level shell
- scope Dockview skinning to Surface internals only
- the visible shell should read as custom product chrome, not as a themed panel manager

Success criteria:

- the product reads visually as a chat workspace, not an IDE with a chat sidebar
- focus behavior and keyboard paths are reliable enough for daily use
- motion and blur do not break usability or performance

### Phase 10: Tests, Baselines, Telemetry, And Rollout

Lock the redesign down before making it the default.

Deliverables:

- update registry and layout tests that still assume `filetree` is the only essential host pane
- add unit tests for the new shell state hook and browse drawer behavior
- add tests for artifact open/focus/close/dedupe flows
- add tests for session switch with persistent Surface
- add tests for provenance and restore behavior where practical
- refresh Playwright baseline coverage for desktop-large, desktop-standard, and tablet
- instrument shell events for rollout confidence, for example:
  - first artifact open
  - Surface reopen after restore
  - session switch latency
  - artifact open latency
  - errors in artifact hydration

Tests likely affected:

- `tests/unit/test_*.py` tests that assume panel-based layout
- Playwright smoke tests that rely on specific Dockview selectors
- layout persistence and migration tests

Rollout sequence:

1. land behind flag
2. run visual baselines and smoke flows
3. enable for local development by default
4. validate persistence, tool bridge, and browse/workbench parity
5. enable for hosted environments in stages
6. remove the legacy shell once no active blockers remain

Success criteria:

- rollout can be monitored with real signals rather than vibes
- regressions show up early in both tests and instrumentation
- the old shell is only removed after the new mental model is truly stable

---

## Acceptance Matrix

The redesigned shell should be considered functionally credible only if these flows work end to end:

1. **Clean launch**
   - app opens into rail + chat
   - no permanent file tree
   - composer is ready

2. **Open file from agent**
   - agent emits artifact card
   - clicking the card opens the Surface
   - file appears once and focuses if reopened

3. **Open review or chart**
   - Surface renders non-code artifacts with the same overall lifecycle
   - artifact is listed in explorer and tab strip

4. **Switch sessions**
   - chat changes
   - Surface stays
   - provenance remains understandable

5. **Browse from drawer**
   - drawer can switch sessions and open workspace items
   - closing drawer returns focus sensibly

6. **Close and restore Surface**
   - chat remains intact
   - reopening restores artifact state

7. **Persistence restore**
   - shell returns in the new model
   - artifact order and active selection restore reasonably

8. **Keyboard loop**
   - `Cmd+N`, `Cmd+K`, `Cmd+1`/`Cmd+B`, `Cmd+2`, and `Esc` all behave consistently

9. **Tablet behavior**
   - drawer and Surface do not collapse the chat into unusable width
   - overlay behavior is coherent

10. **Agent proactive artifact emission**
    - agent tool call creates/edits a file
    - artifact card appears in chat timeline without user action
    - Surface opens automatically for single-artifact emissions
    - multi-artifact emissions show a summary card, not N individual auto-opens
    - chat retains composer focus during auto-open

11. **Security: XSS neutralization**
    - agent returns `<script>alert(1)</script>` in a message or tool output
    - the script does NOT execute in chat or Surface
    - DOMPurify strips it from markdown; iframe sandboxes it in dashboards

12. **Browser mode: context limit guardrail**
    - user sends messages until approaching model context window
    - UI shows context usage indicator
    - warning appears at 80% capacity before send

13. **File attachment storage**
    - user uploads a 10MB PDF in browser mode
    - file is stored in OPFS/Cache API, NOT IndexedDB
    - IndexedDB stores only metadata + reference

---

## Validated Design Tokens (from POC)

These values were validated through 8 rounds of Gemini 3.1 Pro + o3 feedback in `poc-stage-wings/`. During implementation, reconcile these with the existing boring-ui design tokens in `src/front/styles.css` rather than creating a parallel variable namespace. Where the existing system already defines equivalent tokens, prefer the existing names and update their values.

```css
--bg-canvas: #0a0a0a;
--bg-surface: #111113;  /* or rgba(17,17,19,.85) with backdrop-filter */
--bg-elevated: #151518;
--bg-hover: rgba(255,255,255,0.05);
--bg-active: rgba(255,255,255,0.08);
--border-subtle: rgba(255,255,255,0.06);
--accent: #3b82f6;
--accent-dim: rgba(59,130,246,0.12);
--success: #22c55e;
--warning: #f59e0b;
--danger: #ef4444;
--text-primary: #ededed;
--text-secondary: #888;
--text-tertiary: #555;
--font-sans: 'Inter', -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
--radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px; --radius-xl: 16px;
--chat-max-width: 680px;
--spring: cubic-bezier(0.25,1,0.5,1);
--emerge: cubic-bezier(0.16,1,0.3,1);
```

Surface island: `backdrop-filter: blur(16px)`, border-radius 16px, multi-layer shadow with inner top-highlight (`inset 0 1px 0 rgba(255,255,255,.08)`).
Chat input: border-radius 24px (pill), layered shadow on focus.
Send button: white on dark (`var(--text-primary)` bg), circular 32px.
Scrollbars: 12px with 3px transparent border (Mac-style floating).
Artifact cards: gradient background, 2px shadow, accent glow when active.

---

## Critical File Paths

Files that will change significantly:

- `src/front/App.jsx`
- `src/front/registry/panes.jsx`
- `src/front/hooks/useDockLayout.js`
- `src/front/hooks/usePanelActions.js`
- `src/front/layout/LayoutManager.js`
- `src/front/panels/AgentPanel.jsx`
- `src/front/panels/FileTreePanel.jsx`
- `src/front/panels/DataCatalogPanel.jsx`
- `src/front/providers/pi/PiSessionToolbar.jsx`
- `src/front/providers/pi/sessionBus.js`
- `src/front/providers/pi/chatPanelTools.js`
- `src/front/utils/frontendState.js`
- `src/front/styles.css`

New modules:

- `src/front/shell/ChatCenteredWorkspace.jsx`
- `src/front/shell/NavRail.jsx`
- `src/front/shell/BrowseDrawer.jsx`
- `src/front/shell/SessionDrawer.jsx`
- `src/front/shell/SurfaceShell.jsx`
- `src/front/shell/useChatCenteredShellState.js`
- `src/front/shell/artifacts/*`
- `src/front/shell/browse/*`

---

## Out Of Scope

- no attempt to preserve multi-chat split-panel UX in the new shell
- no full Dockview removal in v1 if Surface reuse is faster and safer
- no backend protocol redesign larger than what the UI-state bridge needs
- no perfect migration of every historical layout
- no requirement to make the new shell default on sub-`1024px` widths before a dedicated mobile pass
- no global design-system rewrite beyond what the shell actually needs

---

## Key Risks And Mitigations

#### Risk: mounting chat outside Dockview breaks PI runtime

Mitigation:

- PI agent runtime (`pi-agent-core` Agent class) is decoupled from rendering — it has zero DOM dependencies
- the new `PiAgentCoreTransport` wraps the Agent class behind the `ChatTransport` interface, keeping rendering completely separate from the agent loop
- test session creation, message streaming, and tool invocation in the new transport before wiring UI

#### Risk: nested Dockview inside Surface creates double-chrome artifacts

Mitigation:

- suppress Dockview tab bar and header globally inside Surface
- own all visible chrome from the `SurfaceShell` component

#### Risk: tool bridge contract breaks

Mitigation:

- preserve `open_panels` during the transition
- add shell metadata rather than breaking the current tool contract immediately
- centralize artifact routing so compatibility shims are thin and temporary

#### Risk: browse drawer and Surface explorer become redundant or confusing

Mitigation:

- define responsibilities clearly:
  - browse drawer = discovery/list navigation
  - Surface explorer = open-artifact/workbench context
- call out transitional wrappers as temporary, not the destination architecture

#### Risk: file browsing regresses when the permanent filetree disappears

Mitigation:

- keep existing file tree logic, but rehost it deliberately
- validate file open/search/browse parity in the acceptance matrix
- do not remove legacy access paths until the new browse flow is proven

#### Risk: session switching remains panel-shaped under the hood

Mitigation:

- explicitly rewrite `sessionBus` and toolbar ownership in Phase 3
- do not leave panel identity as a hidden dependency in the new shell

#### Risk: the Surface feels like "Dockview inside a floating box"

Mitigation:

- make Surface shell chrome authoritative
- suppress nested Dockview chrome where possible
- test the perception, not just the implementation

#### Risk: cross-session persistent artifacts become cognitively confusing

Mitigation:

- carry source-session provenance
- provide a jump-to-chat affordance
- surface provenance subtly but consistently

#### Risk: XSS in Surface renderers and chat markdown

Mitigation:

- all markdown/HTML rendering (chat messages, document artifacts, tool output) must pass through DOMPurify
- the old pi-web-ui used sandboxed iframes for HTML artifacts; the new Surface renderers do not — this is a real regression unless mitigated
- tool stdout/stderr must escape HTML entities before rendering
- **dashboard/custom renderers that require JS execution MUST use a sandboxed iframe** with `sandbox="allow-scripts"` (explicitly NOT `allow-same-origin`). DOMPurify strips scripts, so it is not a valid alternative for dashboards. Use DOMPurify only for static markdown/document artifacts.
- see companion plan security section for full details

#### Risk: power-user workflows such as terminal or git review regress

Mitigation:

- treat those as parity workbench artifacts or browse modules, not as expendable legacy features
- stage them after the core artifact lifecycle is stable, but before removing the old shell

---

## Recommended Delivery Slices

### First slice: prove the structural direction

1. add the feature flag
2. extract a new shell host from `App.jsx`
3. mount existing PI chat in a permanent center stage
4. create a closed-by-default Surface shell
5. route `open_file` into the Surface
6. prove that chat does not unmount when Surface opens or closes

This slice is enough to prove the product direction without yet moving the entire browse model.

### Second slice: prove the mental model

1. implement artifact dedupe/focus behavior
2. persist Surface state independently from chat
3. move session switching to chat-stage ownership
4. surface artifact cards in chat and make them focus the Surface
5. show that switching sessions preserves the Surface

This slice proves the "two workbenches" concept rather than just the new layout.

### Third slice: prove parity and remove the old sidebar assumption

1. implement browse drawer destinations
2. migrate session history, files, search, git/changes, and data flows
3. restore enough parity that the old permanent sidebar is no longer necessary
4. validate acceptance matrix and telemetry

Only after this slice should the team seriously discuss making the new shell the default.

---

## Unified Critical Path (both plans)

This merges the phasing from both plans into one dependency-correct sequence:

```
1.  Flag + baseline                    (Plan 1: Phase 0)
2.  Verify pi-coding-agent server-side (Plan 2: Phase A)
3.  Build transports (headless)        (Plan 2: Phase B)     ← no UI dependency
4.  Extract shell host                 (Plan 1: Phase 1)     ← parallel with step 3
5.  Shell state + artifact controller  (Plan 1: Phase 2)
6.  Build ChatStage React components   (Plan 2: Phase C)     ← depends on step 3
7.  Mount chat as center stage         (Plan 1: Phase 3)     ← depends on steps 5+6
8.  Wire session management            (Plan 2: Phase D)     ← depends on step 5
9.  Build Surface shell                (Plan 1: Phase 4)     ← depends on step 5
10. Route open actions → artifacts     (Plan 1: Phase 5)     ← depends on step 9
11. Wire UI bridge tools               (Plan 2: Phase E)     ← depends on steps 9+10
12. Browse drawer + workspace flows    (Plan 1: Phase 6)
13. Model selector + file attachments  (Plan 2: Phase G)     ← MUST land before flag flip
14. Security hardening (DOMPurify)     (Plan 2: Phase F)     ← parallel with 12+13
15. UI bridge + persistence            (Plan 1: Phase 7+8)
16. Observability                      (Plan 2: Phase H)
17. Visual polish + accessibility      (Plan 1: Phase 9)
18. Tests + baselines                  (Plan 1: Phase 10 + Plan 2: Phase J)
19. Feature flag rollout               (Plan 2: Phase I)     ← old shell still available as fallback
20. Post-GA cleanup: remove pi-web-ui  (Plan 2: Phase F deletion steps) ← ONLY after stable rollout
```

Steps 3+4 can run in parallel. Steps 12-14 can run in parallel. Steps 17-18 can overlap.

Key dependency gates:
- Chat cannot mount (step 7) until transport (step 3) AND shell state (step 5) AND ChatStage components (step 6) exist
- Surface (step 9) cannot open artifacts until artifact controller (step 5) exists
- Model selector + file attachments (step 13) must land before the feature flag enables the new shell for users
- **pi-web-ui deletion (step 20) happens ONLY after GA rollout is stable** — the old shell remains as fallback until then
- Security hardening (step 14) must complete before feature flag rollout (step 19)

---

## Final Recommendation

Do not treat this as a cosmetic reskin of Dockview. The winning version of this project is the one that faithfully implements the product model:

- calm default state
- chat as command center
- progressive-disclosure browse layer
- persistent Surface workbench
- one artifact lifecycle
- session-scoped chat plus workspace-persistent artifacts

Every technical choice in the implementation plan should be evaluated against that model. If a shortcut makes the new shell behave like the old panel manager with nicer styling, it is the wrong shortcut.

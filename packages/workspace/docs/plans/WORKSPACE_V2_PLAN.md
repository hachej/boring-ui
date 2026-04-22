# Workspace v2 — Architecture & Implementation Plan

## Vision

A clean-slate workspace package that provides **layout composition with persistence**, **shadcn-native UI**, and a **live collaboration surface** where agents and users share the same view. Agents can generate panes at runtime (dynamic `import()` from the agent workspace folder) and manipulate the UI through a shared state bridge.

## Decisions (from requirements interview)

| Decision | Choice | Notes |
|----------|--------|-------|
| Layouts | IDE + Chat-centered (presets, fully composable) | Both ship as thin config presets over DockviewShell. Every slot overridable. Apps can skip presets and compose DockviewShell directly, or skip dockview entirely and use standalone components. |
| Composability | 3-tier: presets → shell → standalone | Presets (IdeLayout/ChatLayout) for defaults with slot overrides. DockviewShell for custom group arrangements. Standalone components (FileTree, CodeEditor) for no-dockview apps. |
| Groups vs panels | Groups fixed, panels dynamic | LayoutConfig defines the group skeleton (declarative, static). Panels are dynamic content within groups (added/removed at runtime via useDockviewApi()). DockviewShell auto-manages placeholders and collapse. |
| Nested dockview | Supported (DockviewShell inside a pane) | ChatLayout's artifact surface renders its own DockviewShell with own state, persistence key, and API. Outer shell doesn't know inner is dockview. Follows v1's SurfaceDockview pattern. |
| Sizing constraints | GroupConfig only | PanelConfig has no constraints. Sizing is the group's concern, not the panel's. Clean separation: panels describe behavior, groups describe layout. |
| Panel engine | Dockview | Evaluated react-resizable-panels. Dockview wins: tabs, drag-drop, `toJSON`/`fromJSON`, group locking, header hiding. ~130h to replicate with resizable-panels. |
| Persistence | Zustand persist middleware, two keys | `boring-ui-v2:layout:{workspaceId}` (reset on schema change) + `boring-ui-v2:preferences` (theme, persists forever). Separate lifecycle. Auto-hydration on mount. `workspaceId` optional — falls back to `boring-ui-v2:layout` if not provided. |
| Styling | Full shadcn/tailwind | Minimal custom CSS (~150 lines dockview-overrides.css for sash/drop targets). All workspace code is tailwind-only. |
| Dockview styling | Wrap panels | All visible chrome is shadcn. Dockview is layout engine only. |
| Code editor | CodeMirror 6 (NEW, not a port) | v1 uses react-simple-code-editor + Prism. v2 upgrades to CodeMirror 6. Full rewrite of code editing, not a port. |
| Markdown editor | Tiptap (port from v1, reduced) | 10 extensions (down from 16). Drop Table suite (4 pkgs) + ImageResize + DiffExtension (deferred with diff mode). Replace with official Image. See Appendix J for full extension inventory. |
| Data layer | HTTP only, thin `DataProvider` context (React Query hooks + typed fetch) | Single HTTP provider shipped (no offline/second provider). `DataProvider` is a React context wrapper so panes can access data without threading fetch config through props — not an abstraction for swappable backends. |
| Panes | File tree, Markdown editor, Data catalog, Code editor | Core set. Agent pane consumed from `@boring/agent`. Each pane = component + dockview wrapper. Components reusable standalone. |
| Component vs Pane | Components export standalone | `FileTree` (component) usable anywhere. `FileTreePane` = FileTree in dockview. Apps like minimal import the component directly. |
| Layout toggle | Dropped | Apps that need IDE↔Chat toggle implement it themselves. Not workspace's job. |
| Offline mode | Dropped | agent-frontend's LightningFS/isomorphic-git stack not supported. HTTP-only. |
| Dynamic panes | Out of v2 scope | Post-launch feature — see Appendix I below. Not blocking v2 delivery. |
| Agent bridge | Read-only state + imperative commands | Agent reads Zustand store (reactive subscriptions). Writes go through typed bridge commands (openFile, openPanel, etc.) — NOT direct store mutations. See architecture below. |
| Boot boundary | Workspace = layout + context provider | App shell handles auth, routing, data fetching. Workspace provides `<WorkspaceProvider>` (registry + bridge + theme). Data provider injected by app shell. |
| Repo structure | v2 monorepo | `boring-ui-v2/packages/workspace`, `boring-ui-v2/packages/agent`, `boring-ui-v2/packages/core` |
| Capability gating | Hybrid | Static registration + optional runtime check for dynamic panes. |
| Pane lazy-loading | All panes lazy-loaded | Every built-in pane (including FileTree) loaded via dynamic import(). Only `empty` is eager. Initial bundle = shell + registry only. |
| Dynamic pane transform | Out of v2 scope | See Appendix I. Decision: server-side esbuild when implemented. |
| Migration | Hard cut | v2 replaces v1 when ready. No coexistence period. |
| Layout hooks | Shared from Phase 1 | Extract useSidebarLayout/usePanelSizing before building either layout. |
| Hydration strategy | Block mount | Don't render DockviewShell until Zustand onRehydrateStorage fires. Clean loading state. |
| Testing | 4-layer (unit + Storybook + Playwright + Bombadil) | Property-based exploration via Bombadil for unknown unknowns. |
| Language | TypeScript (.tsx) from day 1 | v1 is 100% .jsx with no types. v2 is clean-slate .tsx. Not a migration — new files with typed props. |
| React version | React 19 safe | dockview 4.13.1 already supports React 19. All deps compatible. |
| Git UI in workspace | Dropped entirely | No git status badges, no git diff viewer. Agent owns all git UI. |
| File tree sections | Dropped | Flat tree. No Projects/Sources sections. |
| Editor modes | Normal only in v1 | Drop git-diff modes entirely (side-by-side vs HEAD + unified). Git UI dropped, diff modes return when git routes ship in v1.x. |
| Backend | **None — workspace is frontend-only** | All HTTP routes (files, tree, stat, ui-bridge, agent) are hosted by `@boring/agent`. Workspace consumes them. See `boring-ui-v2/packages/agent/docs/plans/agent-package-spec.md` for the full HTTP surface. |
| ConnectedFileTree | Dropped (seventh pass) | Redundant. Keep FileTree (props) + FileTreePane (dockview wrapper). Pane IS the connected variant. |
| v1 REST bridge | Dropped (seventh pass) | Hard cut. No backward-compat REST endpoints. SSE + POST only (ninth pass). |
| Error recovery | 2-tier (seventh pass, clarified tenth) | Tier 1: error boundary per pane (includes stripping unknown panels during restore). Tier 2: full reset to defaults. The "strip unknown panels" step is part of Tier 1 restore, not a separate tier. |
| Bridge commands | Return Promise\<CommandResult\> (seventh pass, updated eighth) | openFile(), openPanel(), etc. return `Promise<CommandResult>` with seq, status, and optional error. Fire-and-forget still works. |
| Implementation ref | Added in sixth pass | API surface, WorkspaceProvider, core deps, bridge protocol, dockview config, shadcn inventory, phase DAG — see §Implementation Reference below Risk 14. |
| Bridge transport | SSE + POST, command-based (agent-hosted, tenth pass) | Workspace Zustand is the authority. Agent posts commands via `POST /api/v1/ui/commands`; SSE `GET /api/v1/ui/commands/next` streams `event: command` to workspace; workspace executes locally; workspace pushes state via `PUT /api/v1/ui/state`; agent reads via `get_ui_state` tool. All events carry `v:1` protocol version. Short-poll (2s) fallback. |
| Bridge validation | Per-kind Zod schemas (eighth pass, simplified ninth) | Zod validation per command kind (path length, allowed chars, registry existence). Rate limiting deferred to post-launch. |
| Bridge events | Typed BridgeEventMap + select() (eighth pass) | Discriminated union replaces `subscribe(event: string, handler: Function)`. Selector-based `select<T>(selector, handler)` for slice subscriptions. Apps extend via module augmentation. |
| Bridge state scope | Panels + lightweight file hints (eighth pass) | Bridge sends openPanels, activePanel, activeFile, visible file paths. NO full file tree state — agent queries files via its own tools. Eliminates bandwidth problem. |
| Shell API | Extended (eighth pass) | Add `activatePanel()`, `updatePanelParams()`, `movePanel()`, `batch()` to DockviewShellApi. Batch defers layout recalculation for multi-op sequences. |
| Panel lifecycle | Four hooks via PanelLifecycleApi (eighth pass, tenth) | PanelConfig gains `onActivate`, `onDeactivate`, `onClose` (returns Promise to block close), `serializeState`. Hooks receive workspace-owned `PanelLifecycleApi` (not raw DockviewPanelApi) to maintain dockview encapsulation. |
| Cascading errors | Dropped (ninth pass) | Individual pane error boundaries + bridge reconnection banner are sufficient for launch. WorkspaceHealthMonitor deferred to post-launch if correlated failures become a real problem. |
| Dirty files | Store-level slice (eighth pass) | `dirtyFiles: Map<path, { panelId, savedAt }>` in Zustand store. Editors call `bridge.markDirty/markClean`. Agent gets `bridge.getDirtyFiles()`. |
| Persistence hardening | Full (eighth pass) | Zod schema validation on restore, QuotaExceededError handling (disable + toast), cross-tab `storage` event listener, size budget <50KB. |
| Persist debounce | 300ms + flush (eighth pass) | `onDidLayoutChange` fires per-pixel during sash drags. Debounce toJSON/persist to 300ms. Flush on `beforeunload`. |
| File tree library | react-arborist (eighth pass) | ~15KB gz. Virtualized tree with keyboard nav, ARIA semantics, drag-and-drop. Replaces react-window + 300-500 LOC custom tree logic. |
| CM6 large files | Simple cutoff at 1MB (eighth pass) | Full highlighting <1MB, read-only above 1MB. No worker tokenization (doesn't exist in CM6). |
| Bundle budget | Two numbers (ninth pass) | Initial bundle (shell + registry) <150KB gz, total all-loaded <800KB gz. All panes lazy-loaded except `empty`. |
| Pane loading | All lazy (eighth pass) | Every built-in pane is lazy-loaded via dynamic import(). Initial bundle = dockview + shadcn + zustand + registry only. ChatLayout apps never download FileTree/editors. |
| Zustand selectors | Architectural (ninth pass) | `useWorkspaceStore()` is NOT exported. Only atomic hooks exported: `useActiveFile()`, `useActivePanel()`, `useSidebarState()`, `useOpenPanels()`, `useDirtyFiles()`. Selector discipline enforced by API design, not ESLint. |
| Nested shell isolation | Minimal + allowedPanels (ninth pass, tenth) | Each nested DockviewShell gets own `storageKey` + optional `allowedPanels` prop to filter registry. No panel ID namespacing, no bridge `shell` param. Add formal isolation protocol post-launch if multi-shell routing is needed. |
| CSP | Target policy + test (eighth pass) | `style-src 'unsafe-inline'` for CM6 style-mod, tiptap HTML sanitizer configured, Playwright CSP test. |
| definePanel() | Dropped (ninth pass) | Unnecessary — a typed object literal (`const myPanel: PanelConfig = { ... }`) gives the same autocomplete. Less API surface. |
| Test harness | @boring/workspace/testing (eighth pass) | TestWorkspaceProvider, createMockBridge(), renderPane(). Child apps run full test suite themselves. |
| Crash recovery | Accepted risk (eighth pass) | 1s auto-save debounce gap on crash accepted. No sessionStorage journal — complexity not worth it. |
| Command palette | Static + file quick-open, separate CommandRegistry (eighth pass, tenth) | `registry/CommandRegistry.ts` with `CommandConfig { id, title, run, shortcut?, when? }`. Exported via `useCommandRegistry()`. Separate from PanelRegistry. Dynamic command providers deferred to post-launch. |
| i18n | Dropped (ninth pass) | No `t()` wrapper, no `yarn extract-messages`. Plain strings. When i18n is needed, run a codemod (ast-grep/jscodeshift) to extract. |
| Editor lifecycle | Shared hook with flushSave (ninth pass, tenth) | `useEditorLifecycle()` hook (~100 LOC) for Tiptap and CM6: dirty tracking, auto-save debounce, external file change detection, bridge markDirty/markClean. Exposes `flushSave()` for onClose integration: onClose calls flushSave() first, then prompts if still dirty. Single save path. |
| Git sidebar | Dropped (ninth pass) | No git changes view in sidebar. Agent owns all git UI. File tree is files-only. |
| Offline mode | Permanently dropped (ninth pass) | No DataProvider abstraction, no LightningFS, no isomorphic-git, no Pyodide. HTTP-only is permanent. agent-frontend app cannot exist on v2. |
| Terminal/PTY | Not used (ninth pass) | Terminal panels are no longer used in any app. Remove from migration concerns and "files not to port" rationale. |
| Dockview risk | Accepted (ninth pass) | Single-maintainer risk accepted. DockviewShell encapsulates all dockview interaction — panes never import dockview directly. If dockview dies, only DockviewShell internals (~500 LOC) change. No adapter layer (YAGNI). |
| Sample app | Minimal playground (ninth pass) | `apps/workspace-playground`: IdeLayout + mock data provider, no backend needed. `pnpm --filter workspace-playground dev`. Isolated test environment for workspace package. |
| Bridge E2E test | Added (ninth pass) | Playwright test that opens workspace + simulates agent HTTP client. Agent posts openFile command via POST → workspace receives on SSE `event: command` → applies locally → assert file panel appears. Tests real bridge protocol. ~50 LOC. |
| CM6 languages | Measure first (ninth pass) | Bundle all 6 languages (JS/TS, Python, JSON, YAML, Markdown, SQL). Measure actual chunk size in Phase 2. Cut to 3 bundled + lazy rest only if total budget exceeded. |
| Store topology | Single store, partitioned persist (tenth pass) | One `useWorkspaceStore()`. Persist middleware uses `partialize` to route: layout→localStorage, preferences→localStorage, bridge state→ephemeral (NOT persisted). Single file `store/index.ts`. `persistence/` and `bridge/` are thin modules reading/writing the single store. |
| Bridge authority | Workspace Zustand is source of truth (tenth pass) | SSE streams commands (not state). Workspace executes locally, PUTs resulting state. Agent reads via `get_ui_state` tool. `causedBy: 'user' \| 'agent' \| 'restore'` on PUT body prevents echo loops. All events carry `v:1` protocol version field. |
| PanelLifecycleApi | Workspace-owned wrapper (tenth pass) | Lifecycle hooks (`onActivate`, `onDeactivate`, `onClose`) receive `PanelLifecycleApi { panelId, title, setTitle, close, focus, isActive }` — not raw `DockviewPanelApi`. PanelChrome adapts. Maintains dockview encapsulation. |
| Layout version | String + migration callback (tenth pass) | `version: '2.0'` (string, not number). `WorkspaceProviderProps.onLayoutVersionMismatch?(persisted, current, layout) => SerializedLayout \| null`. Default: null (reset). Zero cost now, clean extension point for future layout migrations. |
| Standalone contract | Props-only, zero context (tenth pass) | Tier 3 standalone components (`FileTree`, `CodeEditor`, `MarkdownEditor`) accept ALL data via props. Never call hooks internally. `CodeEditor` takes `content: string, onChange, language`. DataProvider only needed by pane wrappers. |
| Storage scoping | workspaceId in key (tenth pass) | Default key: `boring-ui-v2:layout:{workspaceId}`. Falls back to `boring-ui-v2:layout` if workspaceId not provided. Prevents data loss when multi-workspace arrives. |
| Nested shell guard | allowedPanels prop (tenth pass) | DockviewShell accepts optional `allowedPanels: string[]` to filter registry for nested instances. ChatLayout artifact surface uses this to prevent outer-shell panels from rendering inside. Outer shell has no restriction. |

## Architecture

### Package boundary

```
v2/packages/workspace/          # This package
  src/
    components/                  # shadcn-wrapped building blocks
    layouts/                     # IDE, Chat-centered, layout primitives
    panes/                       # Built-in pane implementations
    panels/                      # Dockview panel wrappers (shadcn chrome)
    persistence/                 # Single-key localStorage engine
    registry/                    # Panel registry + dynamic loader
    bridge/                      # Agent-UI shared state (the coworking surface)
    hooks/                       # Layout, persistence, panel lifecycle hooks
    theme/                       # shadcn theme config + dockview overrides
    index.ts                     # Public API
  docs/
    plans/                       # This file
```

### Dependency graph

```
@boring/workspace
  ├── @boring/core          (shared types, config, transport utils)
  ├── @boring/agent         (ChatPanel — consumed as peer dependency)
  ├── dockview-react        (layout engine)
  ├── @codemirror/*         (code editor)
  ├── shadcn/ui components  (vendored into components/ui/)
  └── tailwindcss           (styling)

@boring/agent
  ├── @boring/core
  └── (does NOT depend on workspace — workspace consumes agent)
```

### Composability model

The workspace is a library, not a framework. Three tiers of usage — pick the one that
matches your app's needs. Each tier is a superset of the one below.

#### Tier 1: Preset layouts (slot overrides)

Preset layouts define a group arrangement with sensible defaults. Every slot is overridable
by panel ID. The preset is ~30 lines — it builds a `LayoutConfig` and passes it to `DockviewShell`.

```tsx
import { WorkspaceProvider, IdeLayout } from '@boring/workspace'
import { ChatPanel } from '@boring/agent'
import { MyCustomTree } from './MyCustomTree'

// Register custom panel, then reference by ID in layout slot
<WorkspaceProvider
  panels={[
    { id: 'my-tree', component: MyCustomTree, title: 'Explorer' },
    { id: 'agent', component: ChatPanel, placement: 'right', hideHeader: true },
  ]}
>
  <IdeLayout
    sidebar="my-tree"       // override: your component instead of built-in FileTree
    center="empty"          // default
    right="agent"           // default
  />
</WorkspaceProvider>
```

**IdeLayout defaults**: `{ sidebar: 'filetree', center: 'empty', right: null }`
**ChatLayout defaults**: `{ nav: 'session-list', center: 'chat', sidebar: undefined, surface: undefined }`

#### Tier 2: DockviewShell (custom group arrangement)

Skip presets entirely. Define your own groups, positions, constraints.

```tsx
import { WorkspaceProvider, DockviewShell } from '@boring/workspace'

<WorkspaceProvider panels={[...]}>
  <DockviewShell
    layout={{
      groups: [
        { id: 'left', position: 'left', locked: true, panel: 'filetree', constraints: { minWidth: 200 } },
        { id: 'center', position: 'center', panel: 'empty' },
        { id: 'bottom', position: 'bottom', panel: 'terminal', constraints: { maxHeight: 300 } },
        { id: 'right', position: 'right', panel: 'agent', hideHeader: true },
      ]
    }}
  />
</WorkspaceProvider>
```

#### Tier 3: Standalone components (no dockview)

No layout engine at all. Import components and compose them in plain JSX.
No `WorkspaceProvider`, no `DataProvider`, no context — all data via props (tenth pass).

```tsx
import { FileTree, CodeEditor } from '@boring/workspace'

<div className="flex h-screen">
  <FileTree files={files} onSelect={setPath} />
  <CodeEditor content={fileContent} onChange={setContent} language="typescript" />
</div>
// DataProvider is only needed by pane wrappers (CodeEditorPane, FileTreePane).
```

#### Core principle: groups are fixed, panels are dynamic

**Groups** (the layout skeleton) are declarative and fixed — defined in LayoutConfig.
**Panels** (the content) are dynamic — they come and go at runtime.

LayoutConfig describes "the room has 3 zones." Runtime API handles "put this file on the desk."

DockviewShell auto-manages:
- **Placeholders**: if a dynamic group has no panels, the placeholder panel shows automatically
- **Collapse**: collapsible groups shrink to `collapsedWidth` when collapsed, restore on expand
- **Panel count**: dynamic groups accept new panels via `useDockviewApi().addPanel()`

#### Layout config type

```typescript
interface LayoutConfig {
  version: string                            // e.g. '2.0'. Increment when group structure changes.
                                              // On mismatch: call WorkspaceProviderProps.onLayoutVersionMismatch()
                                              // (default: discard persisted layout, use new config)
  groups: GroupConfig[]
}

interface GroupConfig {
  id: string                                 // unique group identifier
  position: 'left' | 'center' | 'right' | 'bottom'
  panel?: string                             // initial panel ID (from registry)
  locked?: boolean                           // prevent closing/dragging out
  hideHeader?: boolean                       // hide tab bar (for single-panel groups)
  dynamic?: boolean                          // accepts panels at runtime (default: false)
  placeholder?: string                       // panel shown when group is empty (requires dynamic: true)
  collapsible?: boolean                      // can be collapsed (sidebar pattern)
  collapsedWidth?: number                    // width when collapsed (e.g., 80 for icon-only sidebar)
  constraints?: {                            // sizing — ONLY GroupConfig has constraints (not PanelConfig)
    minWidth?: number
    maxWidth?: number
    minHeight?: number
    maxHeight?: number
  }
}
```

**Only GroupConfig has sizing constraints.** PanelConfig describes behavior (icon, title,
filePatterns). GroupConfig describes layout (size, locked, collapsible). Clean separation —
panels don't dictate their container size.

#### Runtime API — `useDockviewApi()`

Exposed by DockviewShell for panes and hooks that need to manipulate the layout at runtime.

```typescript
interface DockviewShellApi {
  addPanel(groupId: string, config: { id: string, component: string, params?: Record<string, unknown> }): void
  removePanel(panelId: string): void
  activatePanel(panelId: string): void
  updatePanelParams(panelId: string, params: Record<string, unknown>): void
  movePanel(panelId: string, target: { groupId: string } | { direction: 'left' | 'right' | 'up' | 'down', referencePanelId: string }): void
  getGroup(id: string): DockviewGroupApi | null
  getActivePanel(): string | null
  setGroupCollapsed(groupId: string, collapsed: boolean): void

  /** Batch multiple operations into a single layout recalculation + persistence write.
   *  Defers onDidLayoutChange until the callback completes. */
  batch(fn: () => void): void
}
```

Panes access this via `useDockviewApi()` hook (available inside WorkspaceProvider).
Bridge commands (`openFile`, `openPanel`) use this internally.

Preset layouts are just functions that return a `LayoutConfig`:

```typescript
// layouts/IdeLayout.tsx — ~30 lines, not 200+
function IdeLayout({ sidebar = 'filetree', center = 'empty', right }: IdeLayoutProps) {
  const layout: LayoutConfig = {
    groups: [
      { id: 'sidebar', position: 'left', panel: sidebar, locked: true,
        collapsible: true, collapsedWidth: 0,
        constraints: { minWidth: 200, maxWidth: 400 } },
      { id: 'center', position: 'center', panel: center,
        dynamic: true, placeholder: 'empty' },
      ...(right ? [{ id: 'right', position: 'right' as const, panel: right, hideHeader: true,
        constraints: { minWidth: 300 } }] : []),
    ]
  }
  return <DockviewShell layout={layout} />
}
```

#### PanelConfig — the extension contract

Every panel registered in the workspace follows this contract. This is what a developer
implements to add a new pane.

```typescript
interface PanelConfig {
  id: string                                 // unique panel identifier
  component: React.ComponentType<PaneProps> | (() => Promise<{ default: React.ComponentType<PaneProps> }>)
  title?: string                             // display name in tab
  icon?: React.ComponentType<{ size: number }> // tab icon (lucide-react compatible)
  placement?: 'left' | 'center' | 'right' | 'bottom'  // preferred initial position
  essential?: boolean                        // cannot be closed by user
  hideHeader?: boolean                       // hide tab bar when sole panel in group
  requiresCapabilities?: string[]            // only available when capabilities satisfied
  filePatterns?: string[]                     // file globs this pane handles (e.g., ['*.csv', '*.parquet'])

  // Lifecycle hooks — called by DockviewShell, run outside React render cycle.
  // PanelChrome wires these automatically; pane components don't subscribe manually.
  // Hooks receive PanelLifecycleApi (workspace-owned type), NOT raw DockviewPanelApi.
  // This maintains dockview encapsulation — panel authors never import dockview types.
  onActivate?: (api: PanelLifecycleApi) => void
  onDeactivate?: (api: PanelLifecycleApi) => void
  onClose?: (api: PanelLifecycleApi) => void | Promise<void>  // return Promise to block close (e.g., call flushSave() then prompt if still dirty)

  // State serialization for persistence. DockviewShell calls serializeState() during
  // toJSON() and passes the result back via params.__restoredState on fromJSON().
  // Enables panels to persist scroll position, cursor, expansion state across sessions.
  // Max 4KB serialized per panel — PanelChrome enforces and logs warning if exceeded.
  serializeState?: (panelId: string) => Record<string, JsonSerializable> | null

  // NOTE: No constraints here. Sizing is GroupConfig's concern, not the panel's.
}

// Workspace-owned panel lifecycle API — wraps DockviewPanelApi.
// PanelChrome adapts dockview's API to this type before calling lifecycle hooks.
// Panel authors never import from dockview-react directly.
interface PanelLifecycleApi {
  panelId: string
  title: string
  setTitle(title: string): void
  close(): void
  focus(): void
  isActive: boolean
}

// Props injected into every pane component by the dockview wrapper
interface PaneProps {
  panelId: string                            // dockview panel ID
  params: Record<string, unknown>            // params passed when opening (e.g., { path: '/src/main.ts' })
  api: PanelLifecycleApi                     // workspace-owned panel API (not raw DockviewPanelApi)
  bridge: WorkspaceBridge                    // workspace bridge for agent interaction
}
```

#### Panel authoring — typed object literals

No factory function needed. A typed object literal gives full TypeScript autocomplete:

```typescript
import type { PanelConfig } from '@boring/workspace'

export const csvViewer: PanelConfig = {
  id: 'csv-viewer',
  component: () => import('./CsvViewer'),   // lazy by default
  title: 'CSV Viewer',
  icon: TableIcon,
  filePatterns: ['*.csv', '*.tsv'],
}

// Then in app shell:
<WorkspaceProvider panels={[csvViewer, imageViewer, agentPane]}>
```

**File-type routing**: when a file is opened, the registry checks `filePatterns` on all
registered panels. First match wins. Built-in defaults:

| Pattern | Panel |
|---------|-------|
| `*.md`, `*.mdx` | `markdown-editor` |
| `*` (fallback) | `code-editor` |

Apps can override by registering a panel with more specific patterns:

```tsx
<WorkspaceProvider
  panels={[
    { id: 'csv-viewer', component: CsvViewer, filePatterns: ['*.csv', '*.tsv'] },
    { id: 'image-viewer', component: ImageViewer, filePatterns: ['*.png', '*.jpg', '*.svg'] },
  ]}
/>
// Now opening a .csv file routes to CsvViewer instead of code-editor
```

### Agent-UI bridge (the "coworking surface")

**Recommended approach: shared reactive state store.**

The agent should feel like a co-user — seeing the same files, same open panels, same state. This means:

1. **Workspace state store** (Zustand) holds the canonical UI state:
   - Open panels and their params (which file, which view mode)
   - Active panel / active file
   - Sidebar collapse state
   - Dirty files map (which files have unsaved changes)
   - Notifications / toasts

2. **Bridge API** — a thin command layer the agent calls:
   ```typescript
   interface WorkspaceBridge {
     // Read (agent sees what user sees)
     getOpenPanels(): PanelState[]
     getActiveFile(): string | null
     getDirtyFiles(): string[]               // files with unsaved changes
     getVisibleFiles(): string[]             // file paths currently visible in the tree

     // Write (agent acts like a user) — all return Promise<CommandResult>
     openFile(path: string, opts?: { mode?: 'view' | 'edit' | 'diff' }): Promise<CommandResult>
     openPanel(config: DynamicPaneConfig): Promise<CommandResult>
     closePanel(id: string): Promise<CommandResult>
     expandToFile(path: string): Promise<CommandResult>
     showNotification(msg: string, level?: 'info' | 'warn' | 'error'): Promise<CommandResult>
     navigateToLine(file: string, line: number): Promise<CommandResult>
     markDirty(path: string): void
     markClean(path: string): void

     // Subscribe — typed events with discriminated union
     subscribe<K extends keyof BridgeEventMap>(
       event: K,
       handler: (data: BridgeEventMap[K]) => void
     ): Unsubscribe

     // Selector-based subscription (fires only when selected slice changes)
     select<T>(selector: (state: WorkspaceState) => T, handler: (value: T) => void): Unsubscribe

     // Connectivity
     onDisconnect(handler: () => void): Unsubscribe
     onReconnect(handler: () => void): Unsubscribe
   }

   interface CommandResult {
     seq: number
     status: 'ok' | 'error'
     error?: { code: string, message: string }
   }

   // Typed bridge events — exhaustive, no stringly typing
   interface BridgeEventMap {
     'panel:opened': { panelId: string; params: Record<string, unknown> }
     'panel:closed': { panelId: string }
     'panel:activated': { panelId: string; previousPanelId: string | null }
     'file:opened': { path: string; mode: 'view' | 'edit' | 'diff' }
     'file:saved': { path: string }
     'file:dirty': { path: string; dirty: boolean }
     'sidebar:toggled': { collapsed: boolean }
     'notification:shown': { message: string; level: 'info' | 'warn' | 'error' }
     'pane:error': { panelId: string; error: string; stack?: string }
   }
   // Apps extend via module augmentation:
   // declare module '@boring/workspace' {
   //   interface BridgeEventMap { 'myapp:custom': { payload: string } }
   // }
   ```

   **Bridge state scope**: The bridge sends `openPanels`, `activePanel`, `activeFile`,
   and `visibleFiles` (paths currently shown in the file tree). It does NOT send the full
   file tree state — the agent queries files via its own filesystem tools. This eliminates
   the bandwidth problem of broadcasting 10K+ file entries on every panel change.

3. **Transport**: **SSE + POST, command-based** (tenth pass). Workspace Zustand store is the authority. Agent posts commands via `POST /api/v1/ui/commands` → agent server validates and queues → SSE `GET /api/v1/ui/commands/next` delivers `event: command` to workspace → workspace executes locally → workspace `PUT /api/v1/ui/state` with `causedBy` field → agent reads via `get_ui_state` tool. All events carry `v:1` protocol version. Short-poll fallback (2s) for environments where SSE is unavailable. For browser-side agents (iframe/worker), **postMessage**. The bridge abstraction hides the transport.

4. **Server endpoint**: all UI bridge endpoints are hosted by `@boring/agent` (not workspace). Workspace is a client of `PUT /api/v1/ui/state` + SSE `GET /api/v1/ui/commands/next`. See `boring-ui-v2/packages/agent/docs/plans/agent-package-spec.md`.

### Server-side ownership

**Workspace v2 is frontend-only — no server code, no routes.** All backend routes are hosted by `@boring/agent`; workspace consumes them over HTTP.

| Routes | Owner | Notes |
|--------|-------|-------|
| `/api/v1/files` (GET/POST/DELETE) | **Agent** | Read/write/delete. Workspace consumes from file-tree + editor. |
| `/api/v1/tree` (GET) | **Agent** | Directory listing (lazy, per-dir). |
| `/api/v1/files/search` (GET) | **Agent** | Filename / glob search. Consumed by file-tree search input. |
| `/api/v1/stat` (GET) | **Agent** | File metadata. |
| `/api/v1/ui/state` (GET/PUT) | **Agent** | UI state KV (workspace writes layout state; agent reads via `get_ui_state` tool). |
| `/api/v1/ui/commands` (POST) | **Agent** | Agent posts UI command via `exec_ui` tool. |
| `/api/v1/ui/commands/next` (GET, SSE) | **Agent** | Workspace subscribes; receives commands; dispatches via Zustand store. |
| `/api/v1/agent/*` | **Agent** | Chat, sessions. |
| `/api/v1/git/*` | **Not in v1** | Git UI dropped; agent runs git via bash. Routes land when a UI needs them. |
| `/api/v1/workspaces/*` | **Cloud** (future) | Multi-workspace lifecycle. Not in v1. |
| Path validation + sandbox adapters (bwrap, directBash, nodeFs) | **Agent** | Moved in full from v1 workspace server. |

**Total v2 workspace server: 0 lines.** Workspace is a frontend library — installed into an app that also wires up `@boring/agent`'s backend. See `boring-ui-v2/packages/agent/docs/plans/agent-package-spec.md` for the full HTTP surface + rationale.

**Bridge transport (command-based, tenth pass)**: Agent posts commands via `POST /api/v1/ui/commands` → server validates and streams via SSE `GET /api/v1/ui/commands/next` (`event: command`) → workspace executes locally → workspace `PUT /api/v1/ui/state` with `causedBy` field. Workspace Zustand is the authority. All events carry `v:1` protocol version. No WebSocket.

### Dynamic panes (post-launch)

> Post-launch feature — see **Appendix I** below. Not part of v2 delivery.
> Prerequisite: Phases 1-3a must ship first. No current app uses dynamic panes.

## Phases

### Phase 1: Foundation (shadcn shell + dockview wrapper)

**Goal**: Empty workspace renders with shadcn-themed dockview. No panels, no data. Just the layout engine working with persistence.

**Tasks:**

1.1. **Project scaffold**
   - `v2/packages/workspace/package.json` with deps: `react`, `dockview-react`, `tailwindcss`, `class-variance-authority`, `clsx`, `tailwind-merge`
   - `tailwind.config.ts` with shadcn preset
   - `tsconfig.json` (strict, paths aliases)
   - CSS entry point with `@tailwind base/components/utilities` + shadcn CSS variables

1.2. **shadcn UI vendoring**
   - Vendor core components: `Button`, `Tabs`, `Tooltip`, `DropdownMenu`, `Sheet`, `ResizablePanel`, `ScrollArea`, `Input`, `Badge`, `Separator`
   - All under `src/components/ui/`
   - Tailwind-only, no custom CSS classes

1.3. **Dockview integration layer**
   - `DockviewShell` component: accepts `LayoutConfig` (groups with positions, constraints, initial panels), resolves panel IDs via registry, initializes dockview, manages lifecycle
   - `LayoutConfig` type: `{ groups: GroupConfig[] }` — the composability primitive. Presets build these, apps can build custom ones.
   - `PanelChrome` wrapper: shadcn header (title, icon, close button), body slot. Injects `PaneProps` into every panel component.
   - `TabBar` wrapper: shadcn-styled tabs replacing dockview's default tab component
   - `GroupChrome` wrapper: shadcn-styled group headers
   - `dockview-reset.css`: strip dockview's default theme, let wrappers take over
   - All visible chrome is tailwind classes on our wrapper components

1.4. **Persistence engine (Zustand persist middleware)**
   - Zustand store with `persist` middleware, two partitions:
     - `boring-ui-v2:layout:{workspaceId}` — `{ version: '2.0', layout: DockviewSerializedLayout, sidebar: CollapsedState, sizes: PanelSizes }`
     - `boring-ui-v2:preferences` — `{ theme: 'light' | 'dark' }` (never reset)
   - Layout partition: version mismatch → call `onLayoutVersionMismatch()` callback (default: reset to defaults). Apps can provide custom migration.
   - `partialize` selects which state slices persist to which key
   - Auto-hydration on mount via Zustand's `onRehydrateStorage`
   - `useLayoutPersistence()` hook: auto-save on dockview `onDidLayoutChange` (**debounced 300ms**,
     flush on `beforeunload`), auto-restore on mount. Critical: `onDidLayoutChange` fires per-pixel
     during sash drags — raw `toJSON()` without debounce freezes the main thread.
   - **Persistence hardening:**
     - Zod schema validation on restore (reject negative dimensions, path separators in panel IDs, strings >1KB)
     - `QuotaExceededError` handling: try/catch on `localStorage.setItem()`. On quota error, clear layout key
       and retry once. If still failing, disable persistence for session + toast "Layout changes won't be saved."
     - Cross-tab: listen to `window.addEventListener('storage', ...)` for layout key changes from other tabs.
       Do NOT auto-apply foreign changes mid-session (jarring UX). Last-writer-wins, documented.
     - Size budget: target <50KB serialized. Log warning if >100KB.

1.5. **Panel registry**
   - `PanelRegistry` class: `register(id, config)`, `get(id)`, `list()`, `has(id)`, `resolve(filePattern)`
   - Config shape: `PanelConfig` (see composability model — id, component, title, icon, placement, constraints, filePatterns, requiresCapabilities)
   - `filePatterns` enables file-type routing: `registry.resolve('data.csv')` → first panel whose glob matches
   - Lazy loading via `React.lazy()` for async components (PanelConfig accepts `() => Promise<...>`)
   - `useRegistry()` hook + `RegistryProvider` context
   - Built-in panels registered by default — **all lazy-loaded except `empty`**:
     - `filetree`: `() => import('./panes/FileTreePane')` (~15KB gz with react-arborist)
     - `code-editor`: `() => import('./panes/CodeEditorPane')` (~250KB gz with CodeMirror)
     - `markdown-editor`: `() => import('./panes/MarkdownEditorPane')` (~300KB gz with tiptap)
     - `data-catalog`: `() => import('./panes/DataCatalogPane')` (~2KB gz)
     - `empty`: eagerly loaded (shown immediately on shell mount, <1KB)
   - Initial bundle = dockview + shadcn + zustand + registry only (~120KB gz). Every pane is a
     separate chunk loaded on first use. ChatLayout apps never download FileTree or editors.
   - Apps add/replace panels via `WorkspaceProvider panels` prop — same PanelConfig contract
   - App-registered panels with matching `filePatterns` override built-in defaults (more specific wins)

1.6. **DockviewShell lifecycle managers** (internal to DockviewShell, not exported as hooks)
   - `wireGroupPlaceholder(api, groupId, placeholderId)` — add placeholder when group empties, remove when panel added
   - `wireCollapsible(api, groupId, collapsedWidth, expandedConstraints)` — manage collapse/expand with constraint switching
   - `useDockviewApi()` hook — exposes `DockviewShellApi` (addPanel, removePanel, activatePanel, updatePanelParams, movePanel, batch, getGroup, setGroupCollapsed) to panes
   - These live inside DockviewShell. Presets don't need to call them — the shell reads `dynamic`, `placeholder`, `collapsible` from GroupConfig and wires automatically.

1.7. **Layout presets** (thin config wrappers — ~30 lines each)
   - `IdeLayout`: builds a `LayoutConfig` with sidebar (left) + center (tabs) + optional right rail
     - Props: `{ sidebar?: string, center?: string, right?: string }` — panel IDs, all overridable
     - Defaults: `{ sidebar: 'filetree', center: 'empty', right: undefined }`
   - `ChatLayout`: builds a `LayoutConfig` with nav rail (left) + chat stage (center) + surface (right)
     - Props: `{ nav?: string, center?: string, surface?: string }`
     - Defaults: `{ nav: 'session-list', center: 'chat', surface: undefined }`
   - Both call `<DockviewShell layout={config} />` — they are not special, just convenience
   - Apps that need custom arrangements skip presets and use `DockviewShell` directly with a `LayoutConfig`

**Deliverable**: A working workspace that renders an empty IDE layout with shadcn-themed dockview panels. Panels can be opened/closed/resized. Layout persists to localStorage and restores on reload.

### Phase 2: Built-in panes

**Goal**: Ship the 4 core panes — file tree, markdown viewer, data catalog, code editor.

**Tasks:**

2.1. **File tree pane**
   - Virtualized tree using `react-arborist` (~15KB gz) — provides virtualized rendering,
     keyboard navigation (arrow keys for expand/collapse/navigate), ARIA tree semantics
     (`role="tree"` / `role="treeitem"` / `aria-expanded`), and drag-and-drop reordering.
     O(visible) rendering, handles 10K+ files. Eliminates ~400 lines of custom tree logic
     that would be needed with raw `react-window`.
   - Collapsible directories, file icons, click-to-open
   - Consumes file list from HTTP provider (`/api/v1/tree`, agent-hosted)
   - Polling: `refetchInterval: 3000` (3s) for file list, paused during edits
   - Search/filter input at top (shadcn `Input`) with debounced search (200ms).
     Client-side filter for <5K files; falls back to server-side `/api/v1/files/search`
     for larger workspaces via `/api/v1/files/search` (threshold configurable via WorkspaceProvider prop).
   - Context menu (shadcn `DropdownMenu`): new file, new folder, rename, delete, copy path, open to side
   - Drag-and-drop file moving: drag file/folder onto directory to move. Drop validation (can't drop into self/children). Visual drag-over feedback.
   - Flat tree (no section system). Single root directory.
   - No git status badges (git UI is agent responsibility)
   - Used by both IdeLayout (sidebar) and ChatLayout (file browser in surface)

2.2. **Markdown editor pane**
   - Port v1's tiptap editor: `packages/workspace/src/front/components/Editor.jsx` (912 lines)
   - 10 extensions (reduced from 16): StarterKit, Underline, Link, Placeholder, TaskList+TaskItem, TextAlign, Highlight, Image (official, no resize), CodeBlockLowlight, Markdown. (DiffExtension dropped with diff mode.)
   - **Dropped**: Table suite (4 packages), `tiptap-extension-resize-image` (third-party), FrontmatterEditor
   - Toolbar: Bold, Italic, Underline, Strikethrough, H1/H2/H3, Bullet/Ordered/Task list, Quote, Code block, Link, Horizontal rule, Highlight, Image (URL prompt)
   - Single mode: normal edit. Diff-vs-HEAD deferred to v1.x (git routes not in v1).
   - Restyle with shadcn/tailwind (replace v1's custom CSS classes)
   - Read/write via HTTP provider. Auto-save debounced 1000ms.
   - Tab dirty state + external file change detection (same as code editor)
   - Lazy-loaded: tiptap bundles (~650KB) only load on first markdown file open
   - The component (`MarkdownEditor`) is standalone; the pane wraps it in dockview

2.3. **Data catalog pane**
   - List of data sources / connections
   - shadcn `Card` components for each source
   - Click to preview data in center panel
   - Minimal — similar to current 87-line implementation

2.4. **Code editor pane** (NEW — v1 uses react-simple-code-editor, v2 upgrades to CodeMirror 6)
   - CodeMirror 6 integration (full rewrite, not a port)
   - **Large file handling** (CM6 has NO worker-based tokenization — Lezer parses incrementally on main thread):
     - **<1MB**: Full syntax highlighting, incremental Lezer parsing (default CM6 behavior)
     - **≥1MB**: Read-only mode with syntax highlighting disabled. Show banner:
       "Large file — editing disabled." + download link for files >10MB.
   - Language support: JS/TS, Python, JSON, YAML, Markdown, SQL (all bundled initially; measure chunk size in Phase 2 — cut to 3 bundled + lazy rest only if total budget exceeded)
   - Theme: wire CodeMirror theme to shadcn CSS variables via `EditorView.theme()`
   - Read/write via HTTP provider
   - Single mode: normal edit. Diff-vs-HEAD deferred to v1.x (git routes not in v1).
   - Line numbers, word wrap toggle
   - Tab dirty state: dot indicator on tab when unsaved changes exist
   - Auto-save: debounced 1000ms after last keystroke
   - External file change detection: if file changes on disk while editor is open, auto-sync when editor is not dirty. Suppress stale reads for 3s after save.
   - Lazy-loaded: CodeMirror bundles (~250KB gz) only load on first code file open

2.4a. **Shared editor lifecycle hook** (`useEditorLifecycle`)
   - Shared between CodeMirror and Tiptap editors (~100 LOC)
   - Handles: dirty state tracking (bridge `markDirty`/`markClean`), auto-save debounce (1000ms),
     external file change detection (auto-sync when not dirty, suppress stale reads 3s after save),
     tab dirty indicator wiring
   - Each editor provides an adapter: `{ isDirty: () => boolean, save: () => Promise<void>, getContent: () => string }`
   - Eliminates ~80 LOC duplication between CodeEditorPane and MarkdownEditorPane

2.5. **Empty/placeholder pane**
   - Shown when no file is open
   - shadcn-styled welcome screen with keyboard shortcuts
   - "Open file" action

2.6. **HTTP data provider**
   - Typed fetch client for `/api/v1/files`, `/api/v1/tree`, `/api/v1/stat`, `/api/v1/files/search` (all agent-hosted). Git routes NOT in v1 — git UI is dropped per decisions table.
   - React Query integration: `useFileContent(path)`, `useFileList(dir)`, `useFileWrite()`
   - `DataProvider` context so panes access data without knowing the transport
   - Error handling: 401 → redirect to auth, 404 → file not found UI

**Deliverable**: Functional IDE with file tree sidebar, code editor + markdown editor center, data catalog. Files load from server. Edits save back. Components also usable standalone (without dockview) for simple apps.

### Phase 3a: Agent integration — bridge + static pane

**Goal**: Agent pane renders in workspace. Agent can manipulate the UI through a shared state bridge.

**Tasks:**

3a.1. **Agent pane slot**
   - Workspace consumes `ChatPanel` from `@boring/agent` as peer dependency
   - Registered in panel registry with `placement: 'right'` (IDE) or `slot: 'chat'` (Chat layout)
   - Lazy-loaded with Suspense wrapper

3a.2. **Workspace bridge — state store**
   - Zustand store: `useWorkspaceStore()`
   - State: `{ panels, activePanel, activeFile, sidebar, notifications, dirtyFiles }`
   - `dirtyFiles` slice: `Map<string, { panelId: string, savedAt: number | null }>` — updated by
     editor panes via `bridge.markDirty(path)` / `bridge.markClean(path)`. Exposed to agents via
     `bridge.getDirtyFiles()`. Enables auto-save-before-commit workflows.
   - Actions: `openFile`, `openPanel`, `closePanel`, `showNotification`, `navigateToLine`
   - Subscribe API: `store.subscribe(selector, handler)`
   - **Zustand selector discipline (enforced by API design, not ESLint):**
     - `useWorkspaceStore()` is NOT exported from the public API
     - Only atomic selector hooks are exported:
       ```typescript
       export const useActiveFile = () => useWorkspaceStore(s => s.activeFile)
       export const useActivePanel = () => useWorkspaceStore(s => s.activePanel)
       export const useSidebarState = () => useWorkspaceStore(s => s.sidebar)
       export const useOpenPanels = () => useWorkspaceStore(s => s.panels)
       export const useDirtyFiles = () => useWorkspaceStore(s => s.dirtyFiles)
       ```
     - Internal code CAN use `useWorkspaceStore(selector)` with selectors. External consumers cannot.

3a.3. **Workspace bridge — server endpoint (command-based, tenth pass)**
   - Agent posts commands via `POST /api/v1/ui/commands` → server validates (Zod) → queues
   - SSE `GET /api/v1/ui/commands/next` delivers `event: command` to workspace
   - Workspace executes commands locally (Zustand store update)
   - Workspace pushes state via `PUT /api/v1/ui/state` with `causedBy: 'user' | 'agent' | 'restore'`
   - Agent reads state via `get_ui_state` tool (from server's cached copy)
   - All events carry `v:1` protocol version field
   - Workspace Zustand store is the authority — server is a relay and cache
   - Matches existing chat stream pattern, ~20 LOC server
   - **Short-poll fallback** (2s): `GET /api/v1/ui/commands/next?poll=true` + `PUT /api/v1/ui/state` for environments where SSE is unavailable

3a.4. **Chat-centered layout integration**
   - Chat layout shell with agent chat in main area
   - **Artifact surface = nested DockviewShell** (right panel, own state + persistence)
     - `ArtifactSurfacePane` renders its own `<DockviewShell>` with `storageKey="v2:surface"` and `allowedPanels` guard (tenth pass)
     - Follows v1's `SurfaceDockview` pattern: filtered registry via `allowedPanels`, gets layout via props, uses callbacks for state flow
     - Sync suppression flag prevents feedback loops between outer and inner state
     - Only rendered when artifacts exist (conditional mount)
   - Session list UI (workspace renders, agent owns state — see resolved questions)
   - **Chat hooks (simplified from v1's 8 → 2):**
     - `useArtifactPanels()` (~50 lines) — open/close/track artifact panels in the surface dockview
     - `useArtifactRouting()` (~30 lines) — optional convenience: maps tool names to panel types
     - **Eliminated by bridge**: useShellStatePublisher (→ store subscriptions), useShellPersistence (→ Zustand persist), useSessionState/Store/ServerSessions (→ agent owns via bridge props), useToolBridge (→ agent calls bridge.openPanel() explicitly)
   - NavRail props: `{ sessions, activeSessionId, onSwitch, onCreate, onNewChat, onToggleSurface, surfaceOpen }` — app shell passes user menu separately

**Deliverable**: Agent pane visible in workspace. Agent can open files, show artifacts, navigate. User sees agent actions in real-time.

### Phase 4: Polish & production hardening

**Goal**: Theme, responsive, keyboard shortcuts, error recovery.

**Tasks:**

4.1. **Theme system**
   - Light/dark mode via shadcn CSS variables
   - CodeMirror theme synced to workspace theme
   - Dockview chrome follows theme automatically (via wrapper components)
   - `useTheme()` hook + `ThemeProvider`

4.2. **Command Palette + Keyboard shortcuts**
   - `Cmd+P` → **Command Palette** (shadcn `CommandDialog`)
     - No prefix = file quick-open (fuzzy match)
     - `>` prefix = filter registered commands
     - Commands contributed via `registry.registerCommand({ id, title, run, shortcut? })`
     - Built-in commands: Toggle Sidebar, Toggle Agent Panel, Save File, Close Tab
   - `Cmd+B` → toggle sidebar
   - `Cmd+\` → toggle agent panel
   - `Cmd+S` → save active file
   - `Cmd+W` → close active tab
   - Panels and extensions register custom commands at runtime via the registry

4.3. **Responsive layout**
   - Mobile: sidebar collapses to sheet (shadcn `Sheet`)
   - Tablet: auto-collapse sidebar below breakpoint
   - Minimum panel sizes enforced

4.4. **Error handling & recovery**

   **Network errors:**
   - HTTP fetch wrapper: auto-retry 3x with exponential backoff for 5xx / network errors
   - 401/403: fire `onAuthError` callback (app shell handles redirect to login)
   - Timeout: 10s default, configurable per route. Show toast on timeout.
   - Offline detection: `navigator.onLine` + fetch probe. Show banner, disable writes.

   **Corrupted state:**
   - Zustand `onRehydrateStorage`: validate layout JSON against schema before applying
   - Invalid layout (missing required fields, negative dimensions): reset to defaults + toast
   - Corrupted dockview state (panel references non-existent component): strip unknown panels, keep valid ones
   - Reset button in UI: user can force-reset layout from workspace menu

   **Panel crashes:**
   - React error boundary per pane: crashed pane shows error + retry button, doesn't kill workspace
   - Error logged to console with panel ID and stack trace
   - Bridge notified: `bridge.emit('pane:error', { panelId, error })` so agent can react

   **Recovery hierarchy (2-tier — simplified from 3):**
   1. Retry (panel error boundary — per-pane, doesn't kill workspace)
   2. Full reset (corrupted layout → load default layout, lose customization)
   No middle tier ("strip invalid panels") — either the layout is valid or it resets.

   **Correlated failure handling**: Deferred to post-launch (ninth pass). For v2 launch,
   individual pane error boundaries + bridge SSE reconnection banner are sufficient.
   If correlated failures (backend crash killing all panes) become a real problem, add
   `WorkspaceHealthMonitor` then. Bridge `onDisconnect` / `onReconnect` callbacks
   still exposed on `WorkspaceBridge` for app-level handling.

4.5. **Testing (4-layer strategy)**

   **Layer 1: Unit tests (fast, precise)**
   - Hooks with mocked dockview API: `useSidebarLayout`, `usePanelSizing`, `usePanelActions`
   - Registry: register, get, capability checks, available panes
   - Persistence: Zustand store serialize/deserialize, version mismatch → callback (default reset)
   - Bridge: command validation, rate limiter, state subscriptions
   - Run: `vitest`, <5s total

   **Layer 2: Storybook visual regression (design correctness)**
   - Stories for each standalone component: FileTree, CodeEditor, MarkdownEditor, DataCatalog
   - Stories for shadcn-wrapped dockview chrome: PanelChrome, TabBar, GroupChrome
   - Stories for each pane in isolation (mocked data)
   - Screenshot comparison via Chromatic or Percy
   - Catches: CSS regressions, theme inconsistencies, responsive breakpoints

   **Layer 3: Playwright E2E (golden paths)**
   - Scripted scenarios: open file → edit → save, resize sidebar → persist → restore, open panel → close
   - Chat layout: session switch, artifact open, agent message
   - Bridge: agent opens file → workspace reflects, user action → bridge event fires
   - **Bridge protocol E2E** (~50 LOC): Playwright opens workspace UI + a separate HTTP client
     simulates the agent. Agent POSTs `openFile` command → SSE `event: command` delivers to workspace →
     workspace applies locally (Zustand) → file panel appears in the UI. Tests the real SSE/polling path end-to-end.
   - Run: CI, ~2 min

   **Layer 4: Bombadil property-based exploration (unknown unknowns)**
   - Framework: [Antithesis Bombadil](https://antithesishq.github.io/bombadil/) — autonomous
     random exploration of the workspace UI, validating invariants after every action.
   - **Properties (invariants that must always hold):**
     - Layout has no overlapping panels (no negative widths/heights)
     - Essential panels (filetree) cannot be closed
     - Sidebar collapse/expand is reversible (collapse → expand = same width)
     - Layout serialization round-trips: `toJSON() → fromJSON() → toJSON()` is idempotent
     - No React error boundary triggers during normal exploration
     - Bridge state matches visible UI (open panels list = actual rendered panels)
     - Active file in bridge = file shown in editor
   - **Actions (random sequences):**
     - Open/close panels, resize sashes, collapse/expand sidebar
     - Click files in tree, switch tabs, trigger keyboard shortcuts
     - Send bridge commands (openFile, openPanel, closePanel, showNotification)
     - Toggle theme, switch layouts (if toggle available)
     - Write dynamic pane JSX, trigger hot-reload
   - **Value**: Finds race conditions, state corruption, and edge cases that scripted tests
     miss. Especially valuable for dockview (huge state space) and bridge (async commands).
   - Run: Nightly CI or on-demand, 10-30 min exploration per run

   **CI Pipeline (zero manual testing):**
   ```
   On every PR:
     1. vitest run                    # Layer 1: unit tests (~5s)
     2. tsc --noEmit                  # Type check (~10s)
     3. playwright test               # Layer 3: E2E golden paths (~2 min)
     4. storybook build + chromatic   # Layer 2: visual regression (~3 min)
     └── Total: ~6 min per PR

   Nightly:
     5. bombadil explore --duration 30m   # Layer 4: property-based exploration
     6. axe-core scan (via Storybook)     # Accessibility audit
     └── Reports to Slack/GitHub issue if failures found

   On merge to main:
     7. Full E2E suite (all browsers)
     8. Bundle size check (fail if > budget)
   ```

   No human testing required for any phase. Every feature is covered by at least one
   automated layer before merge.

4.6. **Accessibility**
   - WCAG 2.1 AA target (shadcn components are already AA-compliant)
   - Keyboard navigation: Tab through panels, Escape to close, arrow keys in file tree
   - Focus management: focus ring on active panel, focus trap in modals (shadcn `Dialog`)
   - Screen reader: ARIA labels on panels (`aria-label="File tree"`, `role="tabpanel"`)
   - axe-core automated scanning on all Storybook stories (catches 57% of WCAG issues)
   - Manual screen reader testing deferred to post-launch (not blocking v2)

4.7. **Performance budgets**

   | Metric | Target | Measured by |
   |--------|--------|-------------|
   | Initial JS (shell + registry, no panes) | <150KB gzipped | `vite build` chunk analysis |
   | Total all-loaded ceiling | <800KB gzipped | sum of all workspace chunks |
   | Shell render (empty layout) | <500ms TTI | Playwright `performance.mark()` |
   | File tree (1000 files) | <200ms render | Vitest benchmark |
   | First CodeMirror render | <500ms | Playwright timer |
   | First tiptap render | <500ms | Playwright timer |
   | Layout persistence round-trip | <50ms | Vitest benchmark |
   | Bridge command latency | <100ms (SSE), <2s (short-poll fallback) | Playwright timer |

   **Budget enforcement**: CI runs `vite build` and checks two numbers: initial chunk <150KB gz,
   total workspace chunks <800KB gz. `import()` boundaries guarantee the initial bundle never
   includes editor code. Per-chunk budgets are not tracked individually — if total is under 800KB,
   the split between editors doesn't matter.

4.8. **i18n**: Deferred entirely. Plain English strings in JSX. No `t()` wrapper, no extraction
   tooling. When i18n is needed, run a codemod (ast-grep or jscodeshift) to extract strings —
   modern tooling makes this trivial on an existing codebase.

4.9. **Content Security Policy (CSP) compatibility**

   The workspace must work under a strict CSP in hosted/multi-tenant deployments.
   Target policy:
   ```
   default-src 'self';
   script-src 'self';
   style-src 'self' 'unsafe-inline';   // Required: CodeMirror 6 style-mod injects <style> tags
   connect-src 'self';                  // SSE + POST are standard HTTP, no wss: needed
   img-src 'self' data: blob:;         // Required: inline images in markdown
   font-src 'self';
   ```

   **Known CSP constraints:**
   - `style-src 'unsafe-inline'` required by CodeMirror 6's `style-mod` library (no nonce support upstream)
   - Tiptap HTML paste: configure `HTMLSanitizer` extension to strip `<script>`, `on*` attributes,
     `javascript:` URLs, and `<iframe>` on paste. Default tiptap does NOT sanitize HTML paste.
   - Dynamic panes (POST-LAUNCH): esbuild returns JS from `'self'` origin, no `'unsafe-eval'` needed.
   - `eval()` is never used. No `'unsafe-eval'` in script-src.
   - **Test**: Playwright test that sets strict CSP header and verifies workspace loads and functions
     (open file, edit, save, bridge command) without CSP violations.

4.10. **Test harness for consumer apps** (`@boring/workspace/testing`)

   Apps that consume `@boring/workspace` need to test their custom panels and integrations
   without standing up a real server or full provider tree. Workspace exports test utilities
   as a separate entry point, tree-shaken from production builds:

   ```typescript
   // @boring/workspace/testing
   export { TestWorkspaceProvider } from './testing/TestWorkspaceProvider'
   export { createMockBridge } from './testing/createMockBridge'
   export { createMockRegistry } from './testing/createMockRegistry'
   export { renderPane } from './testing/renderPane'
   ```

   `renderPane()` wraps the component in `TestWorkspaceProvider` (mock registry, mock bridge,
   mock data provider with fixture data, shadcn theme). Apps never assemble the provider tree manually.

   `createMockBridge()` returns a `WorkspaceBridge` with all methods as `vi.fn()` stubs plus
   optional state overrides. Supports `bridge.emit()` for simulating agent events in tests.

   Child apps can run the full workspace test suite against their own integrations.

4.11. **Sample app** (`apps/workspace-playground`)

   Minimal isolated test environment for the workspace package. No backend required.

   ```
   apps/workspace-playground/
   ├── package.json           # deps: @boring/workspace, @boring/core, vite, react
   ├── vite.config.ts
   ├── src/
   │   ├── main.tsx
   │   ├── App.tsx             # IdeLayout with mock data provider
   │   ├── mockProvider.ts     # In-memory file data (~50 fixture files)
   │   └── fixtures/           # .ts, .md, .json, .csv, .py sample files
   ```

   - `pnpm --filter workspace-playground dev` to run
   - Uses `WorkspaceProvider` with mock data (no `/api` proxy, no backend)
   - Renders `IdeLayout` with built-in panels (filetree, editors, empty)
   - Smoke test for the package: if the playground renders, the package works
   - Also usable as a visual development environment for workspace contributors

## File structure (Phase 1 target)

```
v2/packages/workspace/
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── src/
│   ├── index.ts                       # Public API
│   ├── globals.css                    # Tailwind directives + shadcn CSS vars
│   ├── lib/
│   │   └── utils.ts                   # cn() helper (clsx + twMerge)
│   ├── components/                    # Standalone React components (usable without dockview)
│   │   ├── FileTree.tsx               # File browser — standalone, imported by FileTreePane
│   │   ├── CodeEditor.tsx             # CodeMirror 6 wrapper — standalone
│   │   ├── MarkdownEditor.tsx         # WYSIWYG markdown (Milkdown or tiptap) — standalone
│   │   ├── DataCatalog.tsx            # Data source list — standalone
│   │   └── ui/                        # Vendored shadcn components
│   │       ├── button.tsx
│   │       ├── tabs.tsx
│   │       ├── tooltip.tsx
│   │       ├── dropdown-menu.tsx
│   │       ├── sheet.tsx
│   │       ├── scroll-area.tsx
│   │       ├── input.tsx
│   │       ├── badge.tsx
│   │       ├── separator.tsx
│   │       └── resizable.tsx
│   ├── dock/                          # Dockview integration (chrome + wrappers)
│   │   ├── PanelChrome.tsx            # Panel header + body wrapper (shadcn)
│   │   ├── TabBar.tsx                 # shadcn-styled tab component
│   │   ├── GroupChrome.tsx            # Group header wrapper
│   │   └── dockview-overrides.css     # Minimal overrides for dockview internals (<200 lines)
│   ├── layouts/
│   │   ├── DockviewShell.tsx          # Core dockview container — accepts LayoutConfig
│   │   ├── IdeLayout.tsx              # Preset: sidebar + center + right rail (~30 lines)
│   │   ├── ChatLayout.tsx             # Preset: nav rail + chat + surface (~30 lines)
│   │   └── types.ts                   # LayoutConfig, GroupConfig, IdeLayoutProps, ChatLayoutProps
│   ├── store/                         # Single Zustand store (tenth pass — one store, partitioned persist)
│   │   ├── index.ts                   # useWorkspaceStore (NOT exported). Persisted: layout, preferences. Ephemeral: bridge state.
│   │   └── selectors.ts              # Atomic hooks: useActiveFile, useActivePanel, useSidebarState, etc.
│   ├── persistence/
│   │   └── useLayoutPersistence.ts    # Auto-save/restore hook (wires dockview events to store)
│   ├── registry/
│   │   ├── PanelRegistry.ts           # Register/get/list/resolve panels
│   │   ├── CommandRegistry.ts         # Register/get commands (tenth pass — separate from panels)
│   │   ├── RegistryProvider.tsx       # React context
│   │   ├── types.ts                   # PanelConfig, PaneProps, CommandConfig, PanelLifecycleApi
│   │   └── dynamicLoader.ts           # Hot-load agent panes (Phase 3b, see Appendix I)
│   ├── panes/                         # Dockview pane wrappers (component + panel params)
│   │   ├── FileTreePane.tsx           # Wraps FileTree + dockview params
│   │   ├── MarkdownEditorPane.tsx     # Wraps MarkdownEditor + file load/save
│   │   ├── CodeEditorPane.tsx         # Wraps CodeEditor + file load/save
│   │   ├── DataCatalogPane.tsx        # Wraps DataCatalog
│   │   └── EmptyPane.tsx              # Placeholder
│   ├── bridge/                        # Agent-UI bridge (Phase 3) — reads/writes the single store
│   │   ├── commands.ts                # Command definitions (client-side types + dispatcher)
│   │   ├── client.ts                  # SSE subscriber + PUT helpers hitting @boring/agent
│   │   └── useWorkspaceBridge.ts      # Hook for panes to interact
│   ├── hooks/
│   │   ├── useDockLayout.ts           # Sidebar discovery, collapse
│   │   ├── useEditorLifecycle.ts      # Shared editor lifecycle (dirty, auto-save, external change)
│   │   ├── usePanelActions.ts         # Open/close/activate
│   │   ├── useFileData.ts             # React Query file hooks
│   │   └── useTheme.ts                # Light/dark mode
│   └── theme/
│       ├── codemirror-theme.ts        # CM6 theme from shadcn vars
│       └── tokens.ts                  # Design token constants
├── docs/
│   └── plans/
│       └── WORKSPACE_V2_PLAN.md       # This file
└── __tests__/
    ├── persistence.test.ts
    ├── registry.test.ts
    └── bridge.test.ts
```

## Resolved questions

| Question | Answer |
|----------|--------|
| Agent pane folder (DEFERRED) | `/workspace/panes/` — visible in workspace root when dynamic panes ship (Appendix I, post-v2). |
| Dynamic pane API (DEFERRED) | **Full bridge access.** Pane receives `{ theme, data, panelId, bridge: WorkspaceBridge }`. Agent panes can orchestrate the workspace. Not in v2 scope — see Appendix I. |
| Chat session ownership | **Agent owns session state** (CRUD, messages, active session). **Workspace owns session list UI** — renders `{ id, title, updatedAt }[]` from agent, calls agent's `switchSession()`/`createSession()`. Clean data/view split. |
| Monorepo tooling | **pnpm workspaces + Vite.** Already familiar from v1. Minimal config. |

### Dynamic pane props contract

```typescript
interface DynamicPaneProps {
  theme: 'light' | 'dark'
  data: unknown                    // passed by agent when opening the panel
  panelId: string
  bridge: WorkspaceBridge          // full workspace API
}
```

### Session list ownership boundary

```
@boring/agent (owns state):
  sessions: Session[]
  activeSessionId: string
  switchSession(id: string): void
  createSession(): Session
  deleteSession(id: string): void

@boring/workspace (owns UI):
  <SessionList
    sessions={agent.sessions}
    activeId={agent.activeSessionId}
    onSwitch={agent.switchSession}
    onCreate={agent.createSession}
    onDelete={agent.deleteSession}
  />
```

Workspace never knows what a "session" contains (messages, AI state). It just renders a list with titles and handles the chrome (active indicator, create button, context menu).

## v1 → v2 reference map

Guide for the implementing agent. For each v2 area, the v1 file(s) to study for patterns, logic to port, and lessons learned. All paths relative to repo root.

### Phase 1: Foundation

| v2 target | v1 reference | What to learn |
|-----------|-------------|---------------|
| `DockviewShell.tsx` | `packages/workspace/src/front/layouts/ide/IdeLayout.jsx` (lines 1–80, 400–500) | Dockview initialization: `<DockviewReact>` setup, `onReady` callback, component map registration, `api.fromJSON()` for restore. **Simplify**: v1 is 1718 lines — most is panel lifecycle that belongs in hooks, not the shell. |
| `PanelChrome.tsx` | `packages/workspace/src/front/components/DockTab.jsx` (143 lines) | Tab rendering with file icons, close button, active state. Replace all custom CSS classes with shadcn/tailwind. |
| `dockview-reset.css` | `packages/workspace/src/front/layouts/ide/IdeLayout.jsx` — look for `.dockview-*` overrides in imported CSS | Identify which dockview classes need zeroing out. Also check `node_modules/dockview-react/dist/styles/dockview.css` for the full default theme. |
| `store/index.ts` | `packages/workspace/src/front/persistence/LayoutManager.js` (618 lines) | Single Zustand store (tenth pass). Layout save/restore logic: `dockApi.toJSON()` serialization, localStorage read/write, validation. Persisted: layout, preferences. Ephemeral: bridge state. **Drop**: version migration system, `lastKnownGoodLayout` backup, multi-key storage. Keep: `toJSON()`/`fromJSON()` round-trip, validation. |
| `PanelRegistry.ts` | `packages/workspace/src/front/registry/panes.jsx` (484 lines) | Registration pattern: `register(id, { component, title, icon, placement, constraints, requires })`. Lazy loading via `React.lazy()`. Capability gating pattern. **Drop**: `requiresRouters`, `requiresFeatures` (legacy). Keep: `requiresCapabilities` for optional runtime gating. |
| `IdeLayout.tsx` | `packages/workspace/src/front/layouts/ide/IdeLayout.jsx` (full file, 1718 lines) | v1 is 1718 lines because layout logic, hooks, and panel lifecycle are inlined. **v2 approach**: IdeLayout is ~30 lines — it builds a `LayoutConfig` and passes it to `DockviewShell`. All the heavy logic lives in DockviewShell and shared hooks. Study v1 for the *group arrangement* (sidebar left locked, center tabs, right rail) and constraints, then express as a `LayoutConfig`. |
| `ChatLayout.tsx` | `packages/workspace/src/front/layouts/chat/ChatCenteredWorkspace.jsx` (434 lines) | Same simplification as IdeLayout. v2 ChatLayout is ~30 lines building a `LayoutConfig` (nav rail left, chat center, surface right). Study v1 for group arrangement + `SurfaceShell.jsx` (544 lines) for the artifact surface dockview. |
| `useDockLayout.ts` | `packages/workspace/src/front/hooks/useDockLayout.js` (337 lines) | Sidebar discovery (`findSidebarGroup()`), collapse toggle (`toggleSidebar()`), center group tracking. Panel activation. Group constraint management. |
| `usePanelActions.ts` | `packages/workspace/src/front/hooks/usePanelActions.js` (16 KB) | Open/close/activate panel logic. File-to-panel routing. Editor tab management. **Heavy file** — extract only the core open/close/activate pattern, leave file-specific logic to panes. |

### Phase 2: Built-in panes

| v2 target | v1 reference | What to learn |
|-----------|-------------|---------------|
| `FileTreePane.tsx` | `packages/workspace/src/front/components/FileTree.jsx` (1129 lines) + `packages/workspace/src/front/panels/FileTreePanel.jsx` (344 lines) | Tree rendering with sections (files, data catalog). Expand/collapse state. Click-to-open dispatching. Context menu (new/rename/delete). **Rewrite**: replace custom CSS with shadcn Tree/Accordion. Use CodeMirror file icons or lucide. |
| `MarkdownEditor.tsx` + `MarkdownEditorPane.tsx` | `packages/workspace/src/front/components/Editor.jsx` (912 lines) | Port directly. Keep tiptap. Restyle with shadcn/tailwind. Port: toolbar, frontmatter section, task lists, tables, code blocks with syntax highlighting. |
| `CodeEditorPane.tsx` | `packages/workspace/src/front/components/CodeEditor.jsx` (176 lines, uses `react-simple-code-editor` + Prism) + `packages/workspace/src/front/panels/EditorPanel.jsx` (417 lines) | File loading (`useFileContent()`), save (`useFileWrite()`), dirty state (`isDirty`, `isSaving`), external change detection, editor mode switching (normal/diff). **Full rewrite**: `react-simple-code-editor` → CodeMirror 6. Port the file load/save/dirty pattern, rewrite the editor internals. |
| `DataCatalogPane.tsx` | `packages/workspace/src/front/panels/DataCatalogPanel.jsx` (87 lines) | Simple list of data sources. Minimal. Port almost directly, just swap CSS to shadcn Card/Badge. |
| `EmptyPane.tsx` | `packages/workspace/src/front/panels/EmptyPanel.jsx` (44 lines) | Placeholder with welcome message. Trivial to rewrite with shadcn. |
| `useFileData.ts` | `packages/workspace/src/front/providers/data/queries.js` (10 KB) + `packages/workspace/src/front/providers/data/httpProvider.js` (8.4 KB) | React Query hooks: `useFileContent(path)`, `useFileList(dir)`, `useFileWrite()`, `useFileSearch()`. Query key patterns. HTTP provider with auth header injection, 401 retry. **Port**: the query hooks + HTTP client. **Drop**: `useGitStatus` (git UI dropped in v2), lightningFs, isomorphicGit, pyodide providers (all moved to agent or dropped). |

### Phase 3: Agent integration

| v2 target | v1 reference | What to learn |
|-----------|-------------|---------------|
| `bridge/client.ts` + `bridge/commands.ts` | `packages/workspace/src/server/services/uiStateImpl.ts` (201 lines) + `packages/workspace/src/front/utils/frontendState.js` (2.6 KB) | Current UI state bridge: panel snapshots, command queuing, client-scoped state. v2: bridge reads/writes the single Zustand store (tenth pass). SSE client in `bridge/client.ts`, command dispatcher in `bridge/commands.ts`. Study the state shape: `{ openPanels, activeFile, commands }`. |
| `bridge/client.ts` | `packages/workspace/src/server/http/uiStateRoutes.ts` (289 lines) | Current HTTP endpoints: `GET /ui/state`, `POST /ui/command`, `GET /ui/panels`. **Replace** with command-based bridge (tenth pass): SSE `event: command` stream + `PUT /api/v1/ui/state` with `causedBy` + POST commands. Port the command vocabulary (openPanel, navigateFile, showNotification). |
| `dynamicLoader.ts` | No direct v1 equivalent | New for v2. Reference: Vite's `import.meta.glob()` for dynamic imports. React `lazy()` + `Suspense` pattern from v1's pane registry (`panes.jsx` lines 20-50). Error boundary pattern from `PanelErrorBoundary.jsx` (58 lines). |
| Agent pane slot | `packages/workspace/src/front/registry/panes.jsx` — agent pane registration (lines 440-470) | How agent panel is registered with capability gating (`requiresCapabilities: ['agent.chat']`). Lazy loading pattern. |
| Session list UI | `packages/workspace/src/front/layouts/chat/ChatCenteredWorkspace.jsx` (lines 50-120) + `packages/workspace/src/front/layouts/chat/NavRail.jsx` (133 lines) | Session switcher in nav rail. Session create/switch callbacks. Active session indicator. **Port the UI**, not the state management (agent owns state in v2). |
| Tool → artifact routing | `packages/workspace/src/front/layouts/chat/utils/toolArtifactBridge.js` (6.4 KB) + `packages/workspace/src/front/layouts/chat/hooks/useToolBridge.js` (5.3 KB) | How tool results become panel openers. Map of tool names to panel types. **Simplify**: in v2 the agent explicitly calls `bridge.openPanel()` instead of workspace inferring panel type from tool results. Keep as optional convenience. |

### Phase 4: Polish

| v2 target | v1 reference | What to learn |
|-----------|-------------|---------------|
| Theme system | `packages/core/src/front/hooks/useTheme.jsx` | Light/dark toggle, localStorage persistence, system preference detection. Port directly, wire to shadcn CSS vars. |
| Keyboard shortcuts | `packages/core/src/front/hooks/useKeyboardShortcuts.js` | Shortcut registration pattern. v1 uses a custom hook. Consider `cmdk` or shadcn `CommandDialog` for `Cmd+P` file picker. |
| Responsive layout | `packages/workspace/src/front/hooks/useResponsiveSidebarCollapse.js` (1.5 KB) | Auto-collapse sidebar below breakpoint. Simple — port the breakpoint logic, use shadcn `Sheet` for mobile sidebar. |
| Panel error boundary | `packages/workspace/src/front/components/PanelErrorBoundary.jsx` (58 lines) | Error boundary wrapper with retry button. Port directly, style with shadcn. Critical for dynamic pane safety. |

### Files explicitly NOT to port

| v1 file | Reason |
|---------|--------|
| `components/Terminal.jsx` (578 lines) | Terminal/PTY no longer used in any app. Dead code. |
| `panels/TerminalPanel.jsx` (384 lines) | Same — terminal not used |
| `panels/ShellTerminalPanel.jsx` (298 lines) | Same — terminal not used |
| `components/SyncStatusFooter.jsx` (489 lines) | Git sync UI — agent responsibility |
| `hooks/useAutoSync.js` | Git auto-sync — agent responsibility |
| `hooks/useLightningFsGitBootstrap.js` (8.5 KB) | Browser git — dropped (HTTP only) |
| `providers/data/lightningFsProvider.js` | Browser FS — dropped |
| `providers/data/isomorphicGitProvider.js` | Browser git — dropped |
| `providers/data/pyodideRunner.js` | Browser Python — dropped |
| `hooks/useGitHubConnection.js` | Auth flow — agent/core responsibility |
| `hooks/useFrontendStatePersist.js` | Replaced by bridge in v2 |
| `components/FrontmatterEditor.jsx` | YAML editing — not in v2 scope |
| `chrome/UserMenu.jsx` | App chrome — belongs to app shell, not workspace |
| `server/adapters/*` (nodeFs, directBash, bwrap) | Filesystem/sandbox — moved to agent |
| `server/http/fileRoutes.ts`, `execRoutes.ts`, `gitRoutes.ts` | Backend routes — moved to agent |
| `server/jobs/execJob.ts` | Exec job manager — moved to agent |
| `server/workspace/paths.ts`, `helpers.ts` | Path validation — moved to agent |
| All `*.d.ts`, `*.d.ts.map`, `*.js` build artifacts | v1 build artifacts, not source |

## Risks & mitigations

### Risk 1: Dockview wrapping complexity

**Risk**: Dockview injects DOM for tabs, drag-drop ghosts, drop targets, sash handles, floating
groups. Not all of it can be wrapped in shadcn React components.

**Mitigation**: Best-effort wrap + single override file. Same approach as v1.

v1 solved this with:
- Custom React tab components passed via `tabComponents`/`defaultTabComponent` props → full control over tab chrome
- `.dockview-theme-abyss` CSS class (~200 lines in `packages/core/src/front/styles/base.css` lines 1519-1730) overriding `--dv-*` CSS variables and styling sash handles, active groups, content containers
- Dockview's own CSS variable system (`--dv-tab-*`, `--dv-tabs-container-*`) mapped to design tokens

**v2 approach**: Same pattern, but map `--dv-*` variables to shadcn's `--primary`, `--background`, `--border`, etc. instead of custom tokens. Custom tab/header React components use tailwind classes. One `dockview-overrides.css` file (<200 lines) for sash handles, drop targets, and drag ghosts that can't be wrapped in React.

**v1 files to study**:
- `packages/core/src/front/styles/base.css` lines 1519-1730 (dockview theme)
- `packages/workspace/src/front/components/DockTab.jsx` (custom tab component)
- `IdeLayout.jsx` lines 697-712 (DockviewReact props for custom components)

### Risk 2: Circular dependency (workspace ↔ agent)

**Risk**: Workspace imports `ChatPanel` from agent. Agent calls `WorkspaceBridge` from workspace.

**Mitigation**: Both — types in core + component via props. Zero direct cross-imports.

- `WorkspaceBridge` interface + command types live in `@boring/core`. Workspace implements it, agent consumes the type from core.
- `ChatPanel` is NOT imported by workspace. Instead, workspace accepts a `panels` config prop. The app shell passes the agent component in:

```tsx
// In the app shell (NOT in workspace or agent package):
import { IdeLayout } from '@boring/workspace'
import { ChatPanel } from '@boring/agent'

<IdeLayout
  panels={[
    { id: 'agent', component: ChatPanel, placement: 'right' }
  ]}
/>
```

Workspace never `import`s from agent. Agent never `import`s from workspace. Both import types from core.

### Risk 3: Third-party CSS overrides

**Risk**: "Full shadcn, zero custom CSS" is aspirational. Dockview and CodeMirror inject their own styles.

**Mitigation**: One `vendor-overrides.css` file, budget <200 lines. Same as v1 pattern.

v1 solved this with a single `base.css` containing all vendor overrides scoped by parent class:
- `.dockview-theme-abyss .dv-tab` for dockview
- `.editor-content .tiptap` for tiptap
- Xterm themed programmatically via `getComputedStyle()` reading CSS vars

**v2 approach**: Same pattern with shadcn CSS vars as the source of truth.
- `dockview-overrides.css` — map `--dv-*` vars to shadcn vars, style sash/drop targets (~150 lines)
- CodeMirror 6 — themed via `EditorView.theme()` API reading shadcn CSS vars at runtime (same approach as v1's xterm theming). Zero CSS override needed.
- Everything else: pure tailwind/shadcn

### Risk 4: Persistence resets during development

**Risk**: Single localStorage key with no migration means devs lose layout on every schema change during Phase 1-2.

**Mitigation**: Accepted. Schema changes are rare after Phase 1 stabilizes. Simple version check (version !== current → reset) is already in the plan. No migration system needed.

### Risk 5: Dynamic pane production viability — OUT OF SCOPE

Dynamic panes moved to post-launch. See **Appendix I** below.
Decision when it's time: server-side esbuild transform with two-layer validation.

### Risk 6: Phase 3 scope — SIMPLIFIED

**Risk**: Phase 3 was originally bridge + dynamic panes + chat layout + session UI.

**Mitigation**: Dynamic panes removed from v2. Phase 3 is now: bridge + static agent pane +
chat layout integration + session list UI. This is one coherent unit (agent needs the bridge,
both layouts need the agent pane, chat layout needs session list).

### Risk 7: Zustand hydration + dockview initialization race condition (CRITICAL)

**Risk**: v1 has a known timing issue. Layout persistence reads from localStorage (sync), then dockview
mounts and calls `onReady` (async, next render cycle). If the user switches projects quickly, `panelSizesRef`
may still hold the OLD project's sizes when `applyInitialSizes()` runs for the NEW project's panels.

v1's IdeLayout.jsx mitigates this with `layoutChromeHydratedPrefix` (line 127) — a flag that gates
panel building. But the flag is set BEFORE panels fully load, creating a window where stale refs leak.

**v2 approach**: Zustand persist middleware `onRehydrateStorage` callback fires AFTER hydration completes.
Gate dockview `onReady` behind a `hydrationComplete` flag from the store. Sequence:

```
1. WorkspaceProvider mounts → Zustand persist starts hydrating from localStorage
2. onRehydrateStorage fires → set hydrationComplete = true
3. DockviewShell mounts → onReady fires → check hydrationComplete before calling fromJSON()
4. If not hydrated yet → queue the onReady callback, execute after hydration
```

This is cleaner than v1's ref-based approach. Zustand gives us a proper lifecycle hook.

### Risk 8: Dual editor keybinding conflicts (tiptap + CodeMirror)

**Risk**: v2 ships both tiptap (markdown WYSIWYG) and CodeMirror 6 (code editing). Both register
global-ish keyboard handlers. When both editors exist in the same dockview layout:
- Ctrl+B → tiptap bold? CodeMirror fold? dockview toggle sidebar?
- Ctrl+Z → which editor's undo stack?
- Tab → tiptap list indent? CodeMirror tab insert?

**Mitigation**: Only the *focused* editor should capture keystrokes. Both tiptap and CodeMirror
already scope their handlers to their DOM container. But dockview's panel activation system
(`onDidActivePanelChange`) must coordinate:

1. When a panel activates, disable keyboard listeners on the previously active editor panel
2. tiptap: `editor.setEditable(false)` on blur, `true` on focus
3. CodeMirror: `EditorView.dispatch({ effects: readOnly.reconfigure(...) })` on blur/focus
4. Workspace-level shortcuts (Cmd+P, Cmd+B sidebar) registered on the workspace container,
   not on individual editors — they always win via `event.stopPropagation()` guard

**v1 file to study**: `packages/core/src/front/hooks/useKeyboardShortcuts.js` — already handles
shortcut priority. Port this pattern.

### Risk 9: FileTree hidden context dependency blocks standalone usage

**Risk**: The plan exports `FileTree` as a standalone component for apps like `minimal`. But v1's
`FileTree.jsx` calls `useDataProvider()` internally (line 55) — this throws if no `DataContext.Provider`
wraps the component. Users who import `FileTree` standalone get a runtime crash with no clear error.

**Mitigation**: Two-tier component API (no middle "Connected" layer):

```tsx
// Standalone (Tier 3 — prop-based, no context needed):
<FileTree
  files={files}
  onSelect={handleSelect}
  onExpand={handleExpand}
/>

// Pane (Tier 1/2 — dockview wrapper, reads from context):
<FileTreePane />  // internally calls useFileData(), wired to bridge
```

The pane wrapper (`FileTreePane`) reads from context internally — it IS the connected variant.
No separate `ConnectedFileTree`. Two layers: `FileTree` (pure props) and `FileTreePane` (context-aware dockview wrapper).

Same pattern for all components: `CodeEditor` (standalone) + `CodeEditorPane` (wrapper).

### Risk 10: ChatLayout / IdeLayout code duplication (~400 LOC)

**Risk**: Both layouts implement left sidebar discovery, panel sizing constraints, and collapse/expand
logic independently. v1's ChatCenteredWorkspace uses dockview for its artifact surface (`SurfaceShell.jsx`
with `SurfaceDockview`). That's ~400 lines of duplicated sidebar + sizing code.

**Simplification**: Extract shared hooks before building v2 layouts:

| Shared hook | Extracted from | Used by |
|-------------|----------------|---------|
| `useSidebarLayout()` | `useDockLayout.js` lines 59-172 | IdeLayout, ChatLayout |
| `usePanelSizing()` | `IdeLayout.jsx` lines 623-680 | IdeLayout, ChatLayout |
| `usePanelConstraints()` | `IdeLayout.jsx` lines 210-280 | IdeLayout, ChatLayout |

Both are preset configs over DockviewShell (different group arrangements — chat has nav rail + surface,
IDE has sidebar + editor tabs). DockviewShell handles all shared concerns (persistence, constraints,
placeholders, collapse). Presets are ~30 lines each.

v2 architecture:
```
DockviewShell (handles groups, constraints, placeholders, collapse internally)
  ├── wireGroupPlaceholder()     (dynamic groups auto-manage empty state)
  ├── wireCollapsible()          (sidebar collapse/expand with constraint switching)
  ├── useDockviewApi()           (runtime API exposed to panes: addPanel, removePanel, etc.)
  ├── IdeLayout → LayoutConfig   (sidebar + center[dynamic] + right rail)
  └── ChatLayout → LayoutConfig  (nav rail + center + surface[nested DockviewShell])
```

### Risk 11: Panel ID not found in registry (seventh-pass)

**Risk**: `<IdeLayout sidebar="typo" />` passes a panel ID that isn't registered. DockviewShell
calls `api.addPanel()` with an unknown component — silent failure or crash.

**Mitigation**: DockviewShell validates all panel IDs against the registry in `onReady` before
calling `api.addPanel()`. Unknown ID → console.error with available IDs, skip the panel.
In dev mode, throw to catch typos early.

### Risk 12: Persisted layout shadows new LayoutConfig (seventh-pass)

**Risk**: User's localStorage has a saved layout. App ships a new LayoutConfig with different
groups. Persisted layout wins → user never sees the new arrangement.

**Mitigation**: LayoutConfig includes a `version: string` field (e.g., `'2.0'`). Persisted layout stores the
config version it was created from. On restore, if versions differ → call `onLayoutVersionMismatch()` callback
(defaults to reset). Apps can provide custom migration logic. See tenth-pass decisions.

### Risk 13: filePatterns routing precedence (seventh-pass)

**Risk**: Multiple panels register overlapping file patterns. `*.ts` vs `*.test.ts` vs `*` —
which wins? App-registered vs built-in — who takes priority?

**Mitigation**: Explicit precedence rules:
1. App-registered panels always checked before built-in panels
2. Within each group: longest suffix match wins (`*.test.ts` > `*.ts` > `*`)
3. If tied: first registered wins (registration order is deterministic)
4. `bridge.openFile(path, { panel: 'code-editor' })` with explicit panel ID bypasses routing

### Risk 14: Bridge command lifecycle — async but returns void (seventh-pass)

**Risk**: `bridge.openFile('/file.ts')` returns void but is async internally (needs HTTP fetch +
dockview panel creation). Agent calls openFile then immediately reads `getOpenPanels()` —
file isn't there yet.

**Mitigation**: Bridge commands return `Promise<CommandResult>` (matches agent's bridge contract). Agent can await if it needs confirmation:
```typescript
const { seq, status } = await bridge.openFile('/file.ts')
const panels = bridge.getOpenPanels()  // now includes the file
```
Fire-and-forget usage still works — just don't `await`.

### Risk 15: Dockview single-maintainer dependency (ninth-pass)

**Risk**: Dockview is maintained by one person (mathuo). The plan deeply couples to its API
(`toJSON`/`fromJSON`, `DockviewApi`, group locking, header hiding). If the project goes
unmaintained, there's no migration path.

**Mitigation**: Accepted. DockviewShell encapsulates all dockview interaction — no pane imports
from `dockview-react` directly. All pane interaction goes through `useDockviewApi()` (our
abstraction). If dockview dies, only DockviewShell internals (~500 LOC) need rewriting. No
additional adapter layer (YAGNI — dockview is actively maintained, 3K+ GitHub stars).

### Risk 16: Two editor stacks = duplicate maintenance (ninth-pass)

**Risk**: Tiptap (markdown) + CodeMirror (code) both need dirty tracking, auto-save, external
file change detection, theme wiring. Maintaining the same lifecycle logic in two places.

**Mitigation**: Shared `useEditorLifecycle()` hook (~100 LOC) extracted in Phase 2.4a. Both
editors provide an adapter interface: `{ isDirty, save, getContent }`. Hook handles dirty state,
debounced auto-save, external change detection, and bridge `markDirty`/`markClean` calls.

---

## Implementation Reference (added in sixth-pass audit)

Everything below was derived from a line-by-line audit of v1 code against the v2 plan.
An implementing agent should be able to start coding from this section alone.

### A. Public API — exact `index.ts` exports

```typescript
// v2/packages/workspace/src/index.ts

// Layout shells
export { IdeLayout } from './layouts/IdeLayout'
export { ChatLayout } from './layouts/ChatLayout'
export { DockviewShell } from './layouts/DockviewShell'

// Standalone components (usable WITHOUT WorkspaceProvider or dockview)
export { FileTree } from './components/FileTree'
export { CodeEditor } from './components/CodeEditor'
export { MarkdownEditor } from './components/MarkdownEditor'
export { DataCatalog } from './components/DataCatalog'

// Dockview pane wrappers (require WorkspaceProvider context)
export { FileTreePane } from './panes/FileTreePane'
export { CodeEditorPane } from './panes/CodeEditorPane'
export { MarkdownEditorPane } from './panes/MarkdownEditorPane'
export { DataCatalogPane } from './panes/DataCatalogPane'
export { EmptyPane } from './panes/EmptyPane'

// Registry & panel management
export { PanelRegistry } from './registry/PanelRegistry'
export { CommandRegistry, useCommandRegistry } from './registry/CommandRegistry'
export { RegistryProvider, useRegistry } from './registry/RegistryProvider'

// Bridge (agent-facing API)
export { useWorkspaceBridge } from './bridge/useWorkspaceBridge'

// Persistence
export { useLayoutPersistence } from './persistence/useLayoutPersistence'

// Runtime layout API (panels are dynamic)
export { useDockviewApi } from './layouts/DockviewShell'

// Hooks
export { usePanelActions } from './hooks/usePanelActions'

// Provider (wraps layout + registry + bridge + theme + data)
export { WorkspaceProvider } from './WorkspaceProvider'

// Data hooks
export { DataProvider, useFileData, useFileContent, useFileList, useFileWrite } from './providers/DataProvider'

// Theme
export { ThemeProvider, useTheme } from './theme/ThemeProvider'

// Utilities
export { getFileIcon } from './utils/fileIcons'

// Atomic selector hooks (useWorkspaceStore is NOT exported — only these hooks)
export { useActiveFile, useActivePanel, useSidebarState, useOpenPanels, useDirtyFiles } from './store/selectors'

// Layout config (the composability primitive)
export type { LayoutConfig, GroupConfig } from './layouts/types'

// Types
export type { WorkspaceBridge, PanelState, CommandResult, BridgeEventMap } from './bridge/types'
export type { PanelConfig, PaneProps, PanelRegistryType, CommandConfig } from './registry/types'
export type { PanelLifecycleApi } from './registry/types'
export type { DockviewShellApi } from './layouts/DockviewShell'
// NOTE: WorkspaceStoreState is NOT exported — store is internal. Use atomic hooks.
export type { WorkspaceProviderProps } from './WorkspaceProvider'
export type { IdeLayoutProps, ChatLayoutProps, DockviewShellProps } from './layouts/types'
```

**Test harness exports** (`@boring/workspace/testing` — separate entry point, tree-shaken from production):
```typescript
export { TestWorkspaceProvider } from './testing/TestWorkspaceProvider'
export { createMockBridge } from './testing/createMockBridge'
export { createMockRegistry } from './testing/createMockRegistry'
export { renderPane } from './testing/renderPane'
```

**Server exports**: None. Workspace v2 is frontend-only. The ~52 route registrars, service
interfaces, and adapter types from v1 now live in `@boring/agent`.

**Minimum viable for `minimal` / `custom-layout` apps:**
```
FileTree, CodeEditor, MarkdownEditor (standalone components)
DataProvider, useFileData, useFileContent (React Query hooks)
// Plus @boring/core/ui: Button, Tabs, Input, Badge, Separator
```

### B. WorkspaceProvider — full props specification

```typescript
interface WorkspaceProviderProps {
  children: React.ReactNode

  // --- Registry ---
  panels?: PanelConfig[]              // Additional panels beyond built-ins (e.g., ChatPanel)
                                       // Built-ins (filetree, editor, empty) auto-registered

  // --- Capabilities (for panel registry filtering) ---
  capabilities?: Record<string, boolean>  // e.g. { 'agent.chat': true, 'workspace.files': true }

  // --- Data layer ---
  apiBaseUrl?: string                 // Base URL for HTTP data provider. Default: '' (same origin)
  authHeaders?: Record<string, string> // Injected into every HTTP request (e.g., { Authorization: 'Bearer ...' })

  // --- Theme ---
  defaultTheme?: 'light' | 'dark'    // Initial theme. Default: 'light'
  onThemeChange?: (theme: 'light' | 'dark') => void

  // --- Persistence ---
  workspaceId?: string                // Scopes persistence key: 'boring-ui-v2:layout:{workspaceId}'
                                       // Omit for single-workspace apps (falls back to 'boring-ui-v2:layout')
  storageKey?: string                 // Full override for persistence key (takes precedence over workspaceId)
  persistenceEnabled?: boolean        // Default: true. Set false for tests / ephemeral mode

  // --- Layout version migration (tenth pass) ---
  onLayoutVersionMismatch?: (persisted: string, current: string, layout: unknown) => SerializedLayout | null
                                       // Called when persisted layout version !== LayoutConfig.version
                                       // Return migrated layout or null (= reset to defaults)
                                       // Default: () => null (reset)

  // --- Bridge (Phase 3) ---
  bridgeEndpoint?: string             // SSE endpoint for agent→workspace commands. Default: '/api/v1/ui/commands/next'
                                       // Set null to disable bridge (standalone mode)

  // --- Error callbacks ---
  onLayoutError?: (error: Error) => void  // Invalid/corrupted layout detected
  onAuthError?: (statusCode: number) => void  // 401/403 from data provider
}
```

**Contexts provided (each accessible via hook):**

| Context | Hook | What it provides |
|---------|------|-----------------|
| `WorkspaceStoreContext` | `useWorkspaceStore()` | Zustand store — layout state, active panel, sidebar, file tree |
| `WorkspaceBridgeContext` | `useWorkspaceBridge()` | Imperative commands — `openFile()`, `openPanel()`, etc. |
| `RegistryContext` | `useRegistry()` | Panel registry — `get()`, `list()`, `has()`, `getComponents()` |
| `ThemeContext` | `useTheme()` | Theme state — `{ theme, setTheme }` |
| `DataProviderContext` | `useFileData()` | React Query hooks — `useFileContent()`, `useFileList()`, `useFileWrite()` |

**Usage patterns (three tiers of composability):**

```tsx
// TIER 1: Preset layout with slot overrides
import { WorkspaceProvider, IdeLayout } from '@boring/workspace'
import { ChatPanel } from '@boring/agent'
import { MyCustomTree } from './MyCustomTree'

function App() {
  return (
    <WorkspaceProvider
      panels={[
        { id: 'agent', component: ChatPanel, placement: 'right', hideHeader: true },
        { id: 'my-tree', component: MyCustomTree, title: 'Explorer' },
      ]}
      capabilities={{ 'workspace.files': true, 'agent.chat': true }}
      onAuthError={(code) => redirectToLogin()}
    >
      <IdeLayout sidebar="my-tree" right="agent" />
    </WorkspaceProvider>
  )
}
```

```tsx
// TIER 2: Custom layout via DockviewShell
import { WorkspaceProvider, DockviewShell } from '@boring/workspace'

function App() {
  return (
    <WorkspaceProvider panels={[...]} capabilities={...}>
      <DockviewShell layout={{
        groups: [
          { id: 'nav', position: 'left', panel: 'filetree', locked: true,
            collapsible: true, collapsedWidth: 0, constraints: { minWidth: 200, maxWidth: 350 } },
          { id: 'main', position: 'center', panel: 'empty',
            dynamic: true, placeholder: 'empty' },
          { id: 'console', position: 'bottom', panel: 'terminal',
            dynamic: true, constraints: { maxHeight: 300 } },
          { id: 'ai', position: 'right', panel: 'agent', hideHeader: true },
        ]
      }} />
    </WorkspaceProvider>
  )
}
```

```tsx
// TIER 3: Standalone components (no dockview, no WorkspaceProvider, no context)
// All data via props — zero context dependency (tenth pass)
import { FileTree, CodeEditor } from '@boring/workspace'

function App() {
  const [content, setContent] = useState('')
  return (
    <div className="flex h-screen">
      <FileTree files={files} onSelect={setPath} />
      <CodeEditor content={content} onChange={setContent} language="typescript" />
    </div>
  )
}
// Note: DataProvider is only needed by pane wrappers (FileTreePane, CodeEditorPane).
// Standalone components accept all data via props.
```

### C. @boring/core dependency contract

Every import workspace v2 makes from `@boring/core`. No new dependencies added beyond v1's.

**HTTP transport (`@boring/core/front`):**
- `apiFetchJson(url, opts)` — fetch wrapper with auth header injection
- `buildApiUrl(path)` — resolve relative paths to absolute API URLs
- `getHttpErrorDetail(error)` — parse HTTP error payloads
- `routes` — constant map of API endpoint paths

**UI utilities (`@boring/core/front`):**
- `cn()` — tailwind class merger (clsx + twMerge)
- `copyTextToClipboard(text)` — clipboard API wrapper
- `formatShortcut(shortcut)` — platform-aware shortcut notation (Cmd vs Ctrl)
- `useViewportBreakpoint()` — responsive breakpoint hook

**Keyboard shortcuts (`@boring/core/front`):**
- `useKeyboardShortcuts(shortcuts)` — global shortcut registration hook
- `DEFAULT_SHORTCUTS` — predefined Cmd+P, Cmd+S, etc.

**Accessibility (`@boring/core/front`):**
- `announceToScreenReader(message)` — ARIA live region
- `trapFocus(containerEl)` — focus trap for modals
- `useReducedMotion()` — respect prefers-reduced-motion

**Theme (`@boring/core/front`):**
- `useTheme()` — get/set light/dark mode
- `ThemeToggle` — toggle button component

**Configuration (`@boring/core/front`):**
- `useConfig()` — read app config (storage prefix, feature flags)
- `useCapabilities()` — read server capabilities

**Design tokens (`@boring/core/front`):**
- `ICON_SIZE_INLINE`, `ICON_SIZE_TOOLBAR`, `ICON_SIZE_ACTIVITY`

**UI components (`@boring/core/ui` — shadcn, 13 vendored):**
- `Button`, `Input`, `Badge`, `Separator`, `Tabs`, `Tooltip`, `DropdownMenu`
- `Select`, `Dialog`, `Avatar`, `Switch`, `Label`, `Textarea`
- **v2 imports these, does NOT re-vendor** — apps import from core directly

**Server (`@boring/core/server`):**
- `createAuthHook` — auth middleware factory
- `ServerConfig` type

**Shared (`@boring/core/shared`):**
- `CapabilitiesResponse` type
- Git types (`GitStatus`, `GitChange`, etc.)

### D. Bridge protocol specification

**v1 status**: HTTP polling only (750ms interval). No WebSocket.

**v2 transport**: **SSE + POST** — matches the existing chat stream pattern. No WebSocket.

**State scope**: Bridge sends `openPanels`, `activePanel`, `activeFile`, `visibleFiles` (paths
shown in file tree), and `dirtyFiles`. NO full file tree state — agent queries files via its own
tools. This eliminates the bandwidth problem of broadcasting 10K+ entries on every panel change.

#### Endpoints

```
GET  /api/v1/ui/commands/next  — SSE stream (agent → workspace commands)
POST /api/v1/ui/commands        — agent sends commands
PUT  /api/v1/ui/state           — workspace publishes UI state (workspace → agent)
GET  /api/v1/ui/state/latest    — one-shot full state snapshot (for reconnection or polling)
```

#### Data flow (tenth pass — command-based, workspace-authoritative)

```
Agent POST {kind:'openFile', params:{path:'/foo.ts'}}
  → agent server validates (Zod per-kind schema)
  → agent server queues command
  → SSE delivers: event: command  data: {v:1, kind:'openFile', params:{...}}
  → workspace executes locally (Zustand store update)
  → workspace PUT /api/v1/ui/state with {v:1, causedBy:'agent', ...}
  → agent reads state via get_ui_state tool

User clicks file in tree:
  → workspace executes locally (Zustand store update)
  → workspace PUT /api/v1/ui/state with {v:1, causedBy:'user', ...}
  → agent reads state via get_ui_state tool
```

**Authority**: Workspace Zustand store is the source of truth. Agent server is a relay for commands and a cache for state that agents can query. The server NEVER modifies UI state — it only validates and forwards commands.

#### SSE command stream (`GET /api/v1/ui/commands/next`)

```
event: command
data: {"v":1,"kind":"openFile","params":{"path":"/src/main.ts","mode":"edit"}}

event: command
data: {"v":1,"kind":"showNotification","params":{"msg":"File saved","level":"info"}}

event: error
data: {"v":1,"code":"invalid_command","message":"Unknown panel ID"}

event: heartbeat
data: {}
```

- On connect: server sends `event: init` with full state snapshot (for reconciliation).
- Subsequent events are `event: command` — individual commands the workspace executes.
- Browser `EventSource` auto-reconnects on disconnect (built-in).
- Server sends `event: heartbeat` every 30s to keep the connection alive through proxies.
- All events carry `v:1` protocol version. On version mismatch, workspace shows warning banner.
- ~20 LOC server — same pattern as `GET /api/v1/agent/chat/:sessionId/:turnId`.

#### State publishing (`PUT /api/v1/ui/state`)

Workspace pushes its current UI state to the agent server after every meaningful state change.
Agent reads this state via the `get_ui_state` tool (from the agent's own cached copy).

```typescript
// PUT body:
interface UIStatePut {
  v: 1                                    // protocol version
  causedBy: 'user' | 'agent' | 'restore' // prevents agent echo loops
  openPanels: PanelState[]
  activePanel: string | null
  activeFile: string | null
  visibleFiles: string[]                  // file paths shown in tree
  dirtyFiles: string[]                    // files with unsaved changes
}
```

- Debounced client-side (100ms) to coalesce rapid UI changes (e.g., clicking through files).
- `causedBy` allows agents to distinguish user actions from their own command results.
- 204 No Content response. No validation beyond JSON parsing — workspace is the authority.

#### Command format (`POST /api/v1/ui/commands`)

```typescript
interface BridgeCommand {
  kind: 'openFile' | 'openPanel' | 'closePanel' | 'showNotification'
      | 'navigateToLine' | 'expandToFile'
  params: Record<string, unknown>
}

// Response:
interface CommandResult {
  seq: number
  status: 'ok' | 'error'
  error?: { code: string, message: string }
}
```

#### Bridge command validation (SECURITY-CRITICAL)

Every bridge command passes through a per-kind Zod validator before execution.
Unknown kinds are rejected. Per-kind param schemas enforced server-side:

| Kind | Params | Constraints |
|------|--------|-------------|
| `openFile` | `path: string, mode?: 'view'\|'edit'\|'diff'` | path max 1024 chars, validated by `paths.ts` |
| `openPanel` | `id: string, component: string, params?: Record<string, JsonSerializable>` | id alphanum+dash max 64, component must exist in registry, params max 16KB |
| `closePanel` | `id: string` | must be open, must not be essential |
| `showNotification` | `msg: string, level?: 'info'\|'warn'\|'error'` | msg max 500 chars, plain text only (NO HTML) |
| `navigateToLine` | `file: string, line: number` | file validated by `paths.ts`, line positive integer |
| `expandToFile` | `path: string` | validated by `paths.ts` |

**Rate limiting**: Deferred to post-launch. Bridge commands are infrequent (~1 per agent turn).
Max 50 open panels per workspace enforced (hard cap, not rate).

**Path parameters** (`openFile`, `navigateToLine`, `expandToFile`): MUST go through same
`validatePath()` + `assertRealPathWithinWorkspace()` as `fileRoutes.ts`. Bridge MUST NOT
shortcircuit to direct file reads.

**Text parameters** (`showNotification` msg, panel titles): rendered as React text nodes
(`{msg}`), NEVER via `dangerouslySetInnerHTML`. Truncated to max length server-side.

#### Authentication

Standard HTTP auth on both endpoints:
- SSE stream: `Authorization: Bearer <token>` header (or session cookie)
- POST commands: same `Authorization: Bearer <token>` header
- No special ticket/upgrade mechanism needed (SSE is standard HTTP, not WebSocket)
- 401/403 → SSE stream closes, client shows reconnection banner

#### Reconnection

SSE `EventSource` auto-reconnects with browser-default retry interval (~3s).
On reconnect, server sends `event: init` with cached state snapshot for reconciliation.
Workspace compares with its Zustand store and resolves any conflicts (workspace wins — it's the authority).

**Consistency guarantees:**
- **At-most-once command delivery**: Commands are fire-and-forget during disconnect. Agent
  re-evaluates state and re-issues if needed.
- **Server restart**: All bridge state is in-memory. Restart = clean slate. On reconnect,
  workspace re-PUTs its current state to the server.
- **Idempotency**: `openPanel` with duplicate ID activates the existing panel (default
  `prefer_existing: true`). Makes accidental double-sends harmless.

#### Short-poll fallback (for environments where SSE is unavailable)

- `GET /api/v1/ui/state/latest` — poll every 2s for cached state (for reconciliation)
- `POST /api/v1/ui/commands` — enqueue command (same endpoint as SSE mode)
- `PUT /api/v1/ui/state` — workspace pushes state (same endpoint as SSE mode)
- Workspace polls `GET /api/v1/ui/commands/next?poll=true` for pending commands (returns batch, not SSE)
- Same JSON format, just over standard request/response

#### v1 REST bridge endpoints — DROPPED

v2 is a hard cut. No v1 bridge consumers. The v1 REST endpoints (`GET /ui/state`, `POST /ui/commands`,
etc.) are not carried forward. SSE + POST is the only transport.

### E. DockviewShell — configuration specification

Two responsibilities:

1. **Initial layout from LayoutConfig** — groups are fixed, declarative
2. **Runtime panel manipulation via `useDockviewApi()`** — panels are dynamic, imperative

DockviewShell auto-manages: placeholder lifecycle for dynamic groups, sidebar collapse/expand,
and group constraint enforcement. Preset layouts (`IdeLayout`, `ChatLayout`) are thin wrappers
that build a `LayoutConfig`. Supports nesting (a pane can render its own DockviewShell).

Derived from v1 `IdeLayout.jsx` lines 1–500, 697–712 and dockview 4.13.1 API.

```typescript
interface DockviewShellProps {
  // Layout configuration (groups are fixed, declarative)
  layout: LayoutConfig

  // Custom tab appearance (shadcn-styled)
  tabComponent?: React.ComponentType<DockviewDefaultTabProps>
  rightHeaderActions?: React.ComponentType<any>

  // Persisted state override (takes precedence over layout config on restore)
  persistedLayout?: SerializedDockviewLayout

  // Lifecycle
  onReady?: (api: DockviewApi) => void
  onLayoutChange?: (layout: SerializedDockviewLayout) => void
  onDidDrop?: (event: DockviewDropEvent) => void

  // Persistence key (for nested dockview — each instance gets its own)
  storageKey?: string                        // default: uses WorkspaceProvider's key

  // Panel guard for nested shells (tenth pass)
  allowedPanels?: string[]                   // filter registry to only these panel IDs
                                              // undefined = full registry access (default for root shell)

  // Options
  className?: string
}
```

**Runtime API exposed via hook (panels are dynamic, imperative):**

See §Architecture > Runtime API (`useDockviewApi()`) for the full `DockviewShellApi` type
(8 methods: `addPanel`, `removePanel`, `activatePanel`, `updatePanelParams`, `movePanel`,
`batch`, `getGroup`, `getActivePanel`, `setGroupCollapsed`). Defined once there — not
duplicated here to avoid spec drift.

**DockviewShell internals:**
```tsx
function DockviewShell({ layout, persistedLayout, storageKey, ...props }: DockviewShellProps) {
  const registry = useRegistry()
  const hydrationComplete = useWorkspaceStore(s => s.hydrationComplete)
  const apiRef = useRef<DockviewApi | null>(null)

  const components = useMemo(() => registry.getComponents(), [registry])
  const shellApi = useMemo(() => createShellApi(apiRef), [])

  return (
    <DockviewApiContext.Provider value={shellApi}>
      <DockviewReact
        className={props.className}
        components={components}
        defaultTabComponent={props.tabComponent ?? ShadcnDockTab}
        rightHeaderActionsComponent={props.rightHeaderActions}
        onReady={(event) => {
          if (!hydrationComplete) {
            pendingOnReady.current = event
            return
          }
          handleReady(event, layout, persistedLayout)
        }}
        onDidDrop={props.onDidDrop}
      />
    </DockviewApiContext.Provider>
  )
}
```

**`onReady` callback — builds groups, applies constraints, wires lifecycle:**
```typescript
function handleReady(event, layout, persistedLayout?) {
  const api = event.api

  // 1. Restore: persisted layout wins, else build from LayoutConfig
  if (persistedLayout) {
    api.fromJSON(persistedLayout)
  } else {
    for (const group of layout.groups) {
      if (group.panel) {
        api.addPanel({
          id: group.panel, component: group.panel,
          position: { direction: positionToDirection(group.position) },
        })
      }
    }
  }

  // 2. Apply group properties (groups are fixed, config is authoritative)
  for (const group of layout.groups) {
    const panel = api.getPanel(group.panel ?? group.id)
    if (!panel?.group) continue
    if (group.locked) panel.group.locked = true
    if (group.hideHeader) panel.group.header.hidden = true
    if (group.constraints) {
      panel.group.api.setConstraints({
        minimumWidth: group.constraints.minWidth,
        maximumWidth: group.constraints.maxWidth,
      })
    }
  }

  // 3. Wire placeholder lifecycle for dynamic groups
  for (const group of layout.groups) {
    if (group.dynamic && group.placeholder) {
      wireGroupPlaceholder(api, group.id, group.placeholder)
    }
  }

  // 4. Wire collapsible sidebar behavior
  for (const group of layout.groups) {
    if (group.collapsible) {
      wireCollapsible(api, group.id, group.collapsedWidth ?? 0, group.constraints)
    }
  }

  // 5. Wire layout change listener for persistence (DEBOUNCED)
  // onDidLayoutChange fires on every pixel of sash drag — dozens/sec.
  // toJSON() serializes 5-15KB. Debounce to 300ms to avoid hammering localStorage.
  const debouncedPersist = debounce(() => {
    props.onLayoutChange?.(api.toJSON())
  }, 300)
  api.onDidLayoutChange(debouncedPersist)
  window.addEventListener('beforeunload', () => debouncedPersist.flush())

  // 6. Store API ref
  apiRef.current = api
}
```

**How presets use DockviewShell:**
```typescript
// layouts/IdeLayout.tsx — ~30 lines
export function IdeLayout({ sidebar = 'filetree', center = 'empty', right }: IdeLayoutProps) {
  return <DockviewShell layout={{
    groups: [
      { id: 'sidebar', position: 'left', panel: sidebar, locked: true,
        collapsible: true, collapsedWidth: 0,
        constraints: { minWidth: 200, maxWidth: 400 } },
      { id: 'center', position: 'center', panel: center,
        dynamic: true, placeholder: 'empty' },
      ...(right ? [{ id: 'right', position: 'right' as const, panel: right,
        hideHeader: true, constraints: { minWidth: 300 } }] : []),
    ]
  }} />
}

// layouts/ChatLayout.tsx — ~30 lines
export function ChatLayout({ nav = 'session-list', center = 'chat', surface, sidebar }: ChatLayoutProps) {
  return <DockviewShell layout={{
    groups: [
      { id: 'nav', position: 'left', panel: nav, locked: true, hideHeader: true,
        constraints: { minWidth: 60, maxWidth: 60 } },
      { id: 'center', position: 'center', panel: center },
      ...(sidebar ? [{ id: 'sidebar', position: 'left' as const, panel: sidebar,
        collapsible: true, collapsedWidth: 0, constraints: { minWidth: 200, maxWidth: 350 } }] : []),
      ...(surface ? [{ id: 'surface', position: 'right' as const, panel: surface,
        dynamic: true, placeholder: 'empty' }] : []),
    ]
  }} />
}
// NOTE: ChatLayout supports an optional file tree sidebar (sidebar='filetree')
```

**Nested DockviewShell (ChatLayout artifact surface):**
```typescript
// panes/ArtifactSurfacePane.tsx — renders inside ChatLayout's surface group
function ArtifactSurfacePane({ artifacts, onSelectArtifact, onCloseArtifact }) {
  return (
    <DockviewShell
      layout={{
        groups: [{ id: 'artifacts', position: 'center', dynamic: true, placeholder: 'empty' }]
      }}
      storageKey="boring-ui-v2:surface"    // own persistence, independent of outer shell
      allowedPanels={['code-editor', 'markdown-editor', 'csv-viewer', 'empty']}  // tenth pass: guard against outer-shell panels
    />
  )
}
// Filters outer panel registry to allowed IDs. Has own API, own state, own lifecycle.
// v1 pattern: SurfaceDockview uses syncingRef to prevent feedback loops.
```

**Nested shell — minimal isolation (ninth pass simplification):**

Nesting works naturally because dockview instances are independent. No formal isolation
protocol needed for v2 — only one consumer (ChatLayout artifact surface) exists.

1. **Persistence**: Each DockviewShell with a unique `storageKey` creates its own Zustand
   persist partition. Root uses `boring-ui-v2:layout`, nested surface uses `boring-ui-v2:surface`.

2. **API scoping**: `useDockviewApi()` returns the API for the nearest ancestor DockviewShell,
   so panes inside the nested shell automatically interact with the correct instance.

3. **No panel ID namespacing** — panel IDs are plain strings. If two shells happen to have
   panels with the same ID, they are independent (different dockview instances).

4. **No bridge routing** — bridge commands always target the root shell. Nested shell panels
   are managed directly by the component that renders the nested DockviewShell.

If multi-shell routing is needed post-launch (e.g., agent opening artifacts in the surface
from outside), add `shell` parameter to bridge commands at that point.

### F. shadcn component inventory — all phases

| Component | Phase | Used by |
|-----------|-------|---------|
| `Button` | 1 | Everywhere (toolbar, dialogs, actions) |
| `Tabs` | 1 | TabBar (dockview tab chrome) |
| `Tooltip` | 1 | Icon buttons, toolbar items |
| `DropdownMenu` | 1 | Context menus, panel menu |
| `Sheet` | 1 | Mobile sidebar overlay |
| `ScrollArea` | 1 | File tree scroll container |
| `Input` | 1 | File tree search, rename input |
| `Badge` | 1 | Tab dirty indicator, panel labels |
| `Separator` | 1 | Toolbar dividers, panel borders |
| `Dialog` | 1 | Confirm actions, modals |
| `Card` | 2 | Data catalog entries |
| `Checkbox` | 2 | Task list items (tiptap markdown) |
| `AlertDialog` | 2 | Confirm file delete |
| `Command` / `CommandDialog` | 4 | Cmd+P file quick-open |
| `Popover` | 4 | Inline context actions |
| `Select` | 4 | Language selector (code editor) |
| `Label` | 4 | Form labels |

**Total: 17 shadcn components** across all phases.

**Not vendored by workspace** (available from `@boring/core/ui`):
`Avatar`, `Switch`, `Textarea` — only needed by app shells, not workspace itself.

### G. Phase dependency DAG & parallelization

```
Phase 1 (Foundation) — Critical path: ~14 days (1 agent), ~11 days (2 agents)
═══════════════════════════════════════════════════════════════════════════════

  1.1 Scaffold ─────┬──→ 1.2 Vendor shadcn ──→ 1.3 Dockview wrappers ──┐
    (2-3d)          │         (1-2d)                  (3-4d)             │
                    │                                                    │
                    ├──→ 1.4 Persistence (Zustand) ─────────────────────┤
                    │         (2-3d, parallel with 1.3)                  │
                    │                                                    │
                    └──→ 1.5 Panel registry ──────────────────────────→ │
                              (2d, parallel, doesn't block)              │
                                                                         ↓
                                                    1.6 Shared hooks ──→ 1.7 Layout shells
                                                          (2-3d)              (3-4d)


Phase 2 (Panes) — after Phase 1 complete. ~16-22 days (1 agent), ~7 days (3 agents)
═══════════════════════════════════════════════════════════════════════════════════════

  ┌── 2.6 HTTP data provider (2-3d) ───────────────────┐
  │                                                      │
  ├── 2.1 File tree pane (3-5d) ───────────────────────→ │ (all parallel)
  ├── 2.2 Markdown editor pane (4-6d, port from v1) ──→ │
  ├── 2.4 Code editor pane (6-8d, FULL REWRITE) ──────→ │
  ├── 2.3 Data catalog pane (1-2d) ────────────────────→ │
  └── 2.5 Empty pane (0.5d) ───────────────────────────→ │

  Longest task: 2.4 CodeMirror 6 integration (6-8 days)


Phase 3a (Agent integration) — after Phase 1+2. ~9-13 days (1 agent), ~6 days (2 agents)
═════════════════════════════════════════════════════════════════════════════════════════════

  3a.1 Agent pane slot (0.5d) ──┐
                                 │
  3a.2 Bridge state store (2-3d)─┤──→ 3a.3 Bridge server endpoint (3-4d) ──→ 3a.4 Chat layout (4-5d)
                                 │
                                 └──→ (parallel)


Phase 4 (Polish) — all tasks independent, can overlap with Phase 3a
════════════════════════════════════════════════════════════════════

  4.1 Theme (2d) │ 4.2 Shortcuts (2d) │ 4.3 Responsive (2d) │ 4.4 Error handling (2d)
  4.5 Testing CI (3d) │ 4.6 Accessibility (2d) │ 4.7 Perf budgets (1d) │ 4.8 i18n (deferred)


TOTAL ESTIMATES:
  1 agent, sequential:    ~6-8 weeks
  2 agents, coordinated:  ~4-5 weeks
  3 agents, parallel:     ~3-4 weeks

KEY BLOCKERS:
  1. Phase 1 must complete before Phase 2/3a start
  2. CodeMirror 6 (2.4) is the longest single task (6-8 days)
  3. Dockview wrappers (1.3) are second longest (3-4 days)
  4. Bridge SSE+POST (3a.3) is NEW code (no v1 reference) — higher risk
```

### H. Risk mitigation — implementation patterns

#### Risk 7: Zustand hydration race (pseudo-code)

```typescript
// store/index.ts — single store, partitioned persist (tenth pass)
export const useWorkspaceStore = create<WorkspaceStoreState>()(
  persist(
    (set, get) => ({
      hydrationComplete: false,
      layout: null,
      // ... other state
    }),
    {
      name: 'boring-ui-v2:layout',
      onRehydrateStorage: () => (state) => {
        // Fires AFTER hydration completes
        state?.setHydrationComplete(true)
      },
    }
  )
)

// layouts/DockviewShell.tsx
function DockviewShell(props: DockviewShellProps) {
  const hydrationComplete = useWorkspaceStore(s => s.hydrationComplete)
  const pendingOnReady = useRef<DockviewReadyEvent | null>(null)

  const handleReady = useCallback((event: DockviewReadyEvent) => {
    if (!hydrationComplete) {
      pendingOnReady.current = event
      return
    }
    initializeDockview(event)
  }, [hydrationComplete])

  // Execute queued onReady when hydration completes
  useEffect(() => {
    if (hydrationComplete && pendingOnReady.current) {
      initializeDockview(pendingOnReady.current)
      pendingOnReady.current = null
    }
  }, [hydrationComplete])

  if (!hydrationComplete) return <LoadingSkeleton />

  return <DockviewReact onReady={handleReady} ... />
}
```

#### Risk 8: Editor keybinding isolation

```typescript
// hooks/useEditorFocusManagement.ts
function useEditorFocusManagement(api: DockviewApi) {
  useEffect(() => {
    const disposable = api.onDidActivePanelChange((event) => {
      const prevPanel = event.previous
      const nextPanel = event.panel

      // Deactivate previous editor
      if (prevPanel?.params?.editorRef) {
        const editor = prevPanel.params.editorRef
        if (editor.type === 'tiptap') editor.setEditable(false)
        if (editor.type === 'codemirror') {
          editor.dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(true)) })
        }
      }

      // Activate new editor
      if (nextPanel?.params?.editorRef) {
        const editor = nextPanel.params.editorRef
        if (editor.type === 'tiptap') editor.setEditable(true)
        if (editor.type === 'codemirror') {
          editor.dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(false)) })
          editor.focus()
        }
      }
    })
    return () => disposable.dispose()
  }, [api])
}
```

#### Risk 9: FileTree standalone vs connected

```typescript
// components/FileTree.tsx — STANDALONE (props-based, zero context dependency)
interface FileTreeProps {
  files: FileEntry[]
  selectedPath?: string
  expandedDirs?: string[]
  searchQuery?: string
  onSelect?: (path: string) => void
  onExpand?: (dir: string) => void
  onCollapse?: (dir: string) => void
  onContextMenu?: (path: string, action: string) => void
  onDragDrop?: (source: string, target: string) => void
}

export function FileTree(props: FileTreeProps) { /* pure render */ }

// panes/FileTreePane.tsx — the pane wrapper IS the connected variant (no separate ConnectedFileTree)
export function FileTreePane({ params, bridge }: PaneProps) {
  const { files, expandedDirs } = useFileData(params.dir as string)
  return (
    <FileTree
      files={files}
      expandedDirs={expandedDirs}
      onSelect={(path) => bridge.openFile(path)}
      onExpand={(dir) => bridge.expandToFile(dir)}
    />
  )
}
```

---

## Appendix I: Dynamic Panes — Agent-Generated UI at Runtime

**Status: POST-LAUNCH** — Not part of the v2 workspace delivery.
Prerequisite: v2 Phases 1-3a must ship first (layouts, panes, bridge). Dynamic panes build
on top of the bridge infrastructure. No current app uses this feature — it will be validated
against real agent workflows before committing to build.

This covers how agents write React components that the workspace hot-loads as panels.

### Model

Agents write JSX files. Workspace hot-loads them. Error boundary provides the feedback loop.

```
Agent writes .jsx  →  Workspace hot-loads  →  Renders in panel
                                                   ↓ (crash?)
                                           Error boundary catches
                                                   ↓
                                           Error piped to agent via bridge
                                                   ↓
                                           Agent fixes file
                                                   ↓
                                           Workspace reloads automatically
```

### File location

Agent-generated panes live at `/workspace/panes/` — visible in the workspace root.
Users can inspect and edit them.

### Loading mechanism

1. Agent writes file via its file tools (or bridge)
2. Agent calls `bridge.openPanel({ id: 'chart-viz', source: '/workspace/panes/chart-visualization.jsx' })`
3. Workspace calls `dynamic import(source)` wrapped in `React.lazy()`
4. Component renders inside error boundary + Suspense wrapper
5. Pane receives full props: `{ theme, data, panelId, bridge }`

### Props contract

```typescript
interface DynamicPaneProps {
  theme: 'light' | 'dark'
  data: unknown                    // passed by agent when opening the panel
  panelId: string
  bridge: WorkspaceBridge          // full workspace API
}
```

Full bridge access — agent-generated panes can read workspace state, open files,
open other panels, show notifications, navigate. Same power as built-in panes.

### Component kit (`@boring/workspace/blocks`)

A convenience library of pre-themed shadcn building blocks. Not a constraint —
agents can use raw HTML/divs if they want, but the kit is faster and consistent.

**Blocks:**
- **Layout**: `Card`, `Grid`, `Tabs`, `Accordion`, `ScrollArea`, `Separator`
- **Data display**: `DataTable`, `KeyValue`, `Metric`, `CodeBlock`, `MarkdownView`, `JsonViewer`
- **Charts**: `BarChart`, `LineChart`, `PieChart`, `ScatterChart` (thin wrappers over recharts)
- **Forms**: `Form`, `Input`, `Select`, `Checkbox`, `Slider`, `Button`
- **Feedback**: `Badge`, `Alert`, `Spinner`, `EmptyState`

All blocks inherit shadcn CSS variables, are tree-shakeable, have zero business logic,
and accept standard React props + `className` for tailwind overrides.

### Runtime boundary

- Dynamic panes run in **main thread** (not iframe) for full React context access
- **Error boundary** catches crashes — panel shows error + stack trace, doesn't kill workspace
- **Hot-reload**: workspace watches `/workspace/panes/` for file changes (via polling or
  bridge notification), invalidates module cache, re-renders

### Transform approach: server-side esbuild (DECIDED)

**Problem**: In production, there's no Vite dev server. The browser receives raw `.jsx` it can't execute.

**Decision**: Agent-generated JSX goes through a server transform endpoint before the browser
ever sees it. Two-layer validation catches errors before they reach the UI.

```
Agent writes .jsx to /workspace/panes/chart.jsx
  ↓
Server: GET /api/v1/ui/pane?source=/workspace/panes/chart.jsx
  ↓
Layer 1 — Prevalidation (esbuild transform):
  ✅ JSX syntax valid?
  ✅ Imports resolve? (@boring/workspace/blocks → bundled module URL)
  ✅ No dangerous patterns? (optional AST check)
  ↓ fails → 400 response with error details → agent fixes without UI disruption
  ↓ passes → returns transformed JS (browser-ready ESM)
  ↓
Browser: dynamic import(transformed_url)
  ↓
Layer 2 — Runtime validation (error boundary):
  ↓ render crash → error boundary catches → pipes error to agent → agent fixes → auto-reload
  ↓ renders OK → panel visible to user
```

**Why server-side esbuild**: Works identically in dev and prod, resolves bare specifiers
at transform time (no import maps needed), prevalidation is free, ~10ms per file, no
runtime dependency added to client bundle.

**Import resolution**: esbuild rewrites bare specifiers to URLs pointing at bundled modules
using the Vite build manifest (`@boring/workspace/blocks` → `/assets/workspace-blocks-[hash].js`).

**Caching**: Transformed JS cached by content hash. Same source → same hash → browser cache hit.

### Bridge safety layer (for dynamic panes)

- **Rate limiter**: max 10 bridge mutations per second per pane. Excess dropped + logged.
- **Command validation**: bridge actions go through validator (e.g., can't close essential panels).
- **Undo stack**: bridge records last N state snapshots. `bridge.undo()` available for recovery.
- **Kill switch**: if a dynamic pane triggers > 50 errors in 10 seconds, workspace auto-closes it.

### Implementation phases (Phase 3b)

| Task | Description |
|------|-------------|
| 3b.1 | Server-side esbuild transform endpoint (~100 LOC) |
| 3b.2 | Dynamic pane loader (`registry/dynamicLoader.ts`) |
| 3b.3 | Component kit (`blocks/`) — vendored shadcn + data blocks |
| 3b.4 | File watcher + hot-reload |
| 3b.5 | Error feedback loop (error → agent → fix → reload) |
| 3b.6 | Bridge safety layer (rate limiter, validator, kill switch) |

### v1 references for dynamic panes

| v2 target | v1 reference | Notes |
|-----------|-------------|-------|
| Dynamic loader | No direct v1 equivalent | New. Reference Vite's `import.meta.glob()` pattern. |
| Error boundary | `PanelErrorBoundary.jsx` (58 lines) | Port and extend with error-to-agent piping. |
| Component kit | `core/design-system/ui/*.jsx` | Already vendored shadcn. Move relevant to blocks export. |
| File watching | `providers/data/queries.js` — polling pattern | React Query polling. Adapt for pane directory. |
| Bridge error events | `server/services/uiStateImpl.ts` | v1 queues commands. v2 uses reactive events. |

---

## Appendix J: Gap Analysis — v1 Features vs v2 Plan

What breaks, what's dropped intentionally, what needs rethinking. All drop/keep decisions
are already reflected in the Decisions table and Phase tasks above — this appendix provides
the detailed rationale and per-app compatibility analysis.

### Per-app v2 compatibility

| App | v2 compatibility | Key gaps |
|-----|-----------------|----------|
| **minimal** | ~95% | FileTree needs prop-based variant (solved by Tier 3 standalone) |
| **custom-layout** | ~90% | Same as minimal — 3-column CSS grid + standalone components |
| **chat** | ~20% (by design) | 80% is agent-package code. Workspace provides layout shell + artifact surface. |
| **agent-backend** | ~15% (by design) | Layout toggle dropped (app implements). Capability fetching is app shell's job. |
| **ide** | ~5% (by design) | 95% is app-shell code. Auth, routing, cloud features are not workspace's concern. |
| **agent-frontend** | DROPPED (permanent) | Offline mode (LightningFS, isomorphic-git, Pyodide) permanently dropped. No DataProvider abstraction — HTTP-only is the final architecture. |

Low compatibility percentages are expected and correct — they reflect the boundary shift
where auth, routing, cloud, and agent logic move to their proper owners (app shell, `@boring/agent`, `@boring/cloud`).

**Ninth-pass gap notes:**
- **Terminal/PTY**: No longer used in any app. Dead code in v1 — not a migration concern.
- **Git sidebar**: Dropped entirely. Agent owns all git UI. File tree is files-only.
- **Tool-to-artifact bridge**: Agent must explicitly call `bridge.openPanel()` — workspace
  no longer infers panel type from tool results. Requires agent-side update.
- **Layout toggle (IDE ↔ Chat)**: App implements conditional rendering. No workspace support.
- **Offline/local-first**: Permanently gone. No path to re-add without DataProvider abstraction.

### Custom events inventory (v1 → v2 replacement)

v1 uses `window.dispatchEvent(new CustomEvent(...))` for loose coupling. v2's bridge replaces most:

| Event | v2 replacement |
|-------|----------------|
| `boring-ui:user-settings-open` | App shell responsibility |
| `boring-ui:sync-interval-changed` | Dropped (agent owns sync) |
| `boring-ui:agent-prompt` | `bridge.sendMessage()` |
| `boring-ui:shell-state` | `store.subscribe()` |
| `theme-toggle-request` | `useTheme()` hook |
| `bui:openFile` | `bridge.openFile()` |
| PI session events (4) | Agent package responsibility |

### localStorage key inventory (namespace collision avoidance)

v1 scatters state across 12+ keys. v2 consolidates to `boring-ui-v2:layout` + `boring-ui-v2:preferences`.
Know v1 patterns to avoid collisions during coexistence:

| v1 key pattern | v2 status |
|----------------|-----------|
| `boring-ui:{prefix}:{projectRoot}:layout` | → `boring-ui-v2:layout` |
| `boring-ui:{prefix}:{projectRoot}:tabs` | Dropped (derived from layout) |
| `boring-ui:{prefix}:{projectRoot}:lastKnownGoodLayout` | Dropped |
| `boring-ui-theme` / `kurt-web-theme` | → `boring-ui-v2:preferences` |
| `boring-ui:chat-sessions:v1` | Agent package responsibility |
| `boring-ui:terminal-*` | Dropped (terminal → agent) |

### IDE boot flow boundary (app shell vs workspace)

```
main.jsx → App.jsx → useCapabilities → useWorkspaceAuth → useWorkspaceRouter
  → useDataProviderScope → useResolvedCapabilities → PageRouter
  → IdeLayout OR ChatCenteredWorkspace
```

| Step | v2 owner |
|------|----------|
| Capabilities fetch | App shell |
| Auth flow (OIDC, session) | App shell |
| Workspace routing | App shell |
| Data provider scope | Workspace (`WorkspaceProvider`) |
| Resolved capabilities | Workspace (registry filters) |
| Layout selection | App shell |
| Layout rendering | Workspace |

### CSS audit: v1 breakpoints to parameterize

v1's `base.css` has hardcoded pixel breakpoints. v2 parameterizes all via tailwind config:

| Breakpoint | v1 purpose | v2 approach |
|------------|-----------|-------------|
| `56px` | Sidebar collapse width | `collapsedWidth` in GroupConfig |
| `420px` | Surface min-width | `constraints.minWidth` in GroupConfig |
| `1180px` | Compact layout trigger | tailwind `lg` breakpoint |
| `960px` | Mobile layout trigger | tailwind `md` breakpoint |

### Tiptap extension inventory (detailed)

| Extension | Package | v2 status |
|-----------|---------|-----------|
| StarterKit | `@tiptap/starter-kit` | **KEEP** |
| Underline | `@tiptap/extension-underline` | **KEEP** |
| Link | `@tiptap/extension-link` | **KEEP** |
| Placeholder | `@tiptap/extension-placeholder` | **KEEP** |
| TaskList + TaskItem | `@tiptap/extension-task-list`, `-task-item` | **KEEP** |
| TextAlign | `@tiptap/extension-text-align` | **KEEP** |
| Highlight | `@tiptap/extension-highlight` | **KEEP** |
| Image | `@tiptap/extension-image` | **REPLACE** (official, no resize handles) |
| CodeBlockLowlight | `@tiptap/extension-code-block-lowlight` | **KEEP** |
| Markdown | `@tiptap/markdown` | **KEEP** |
| Custom DiffExtension | Inline in Editor.jsx | **DEFER** (tenth pass: dropped with diff mode. Returns when git diff viewing ships.) |
| ~~Table suite~~ | `@tiptap/extension-table*` (4 packages) | **DROP** |
| ~~ImageResize~~ | `tiptap-extension-resize-image` | **DROP** |

**Result: 10 extensions (down from 16). Dropped 6 packages (including DiffExtension — deferred with diff mode).**

### Deep import anti-pattern (v1 → v2 fix)

v1 apps use 11+ deep imports bypassing the public API. v2's `index.ts` exports everything
apps need — zero deep imports required (see §A. Public API).

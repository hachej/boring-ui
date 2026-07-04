# Declarative layout migration — retire ChatCenteredShell, adopt ChatLayout / IdeLayout

> **⚠ SUPERSEDED 2026-04-29 — content merged into [PLUGIN_MODEL.md](./PLUGIN_MODEL.md) §"Phase 1.5: Consumer migration".**
>
> Per user decision (v7.4 merger): the two plans had substantial scope overlap (macro migration, ChatCenteredShell removal, plugin extraction). Folded into one mega-plan + one epic (boring-ui-v2-j9p7) with a single acceptance gate. Phase 1.5 in PLUGIN_MODEL.md is the canonical reference; phase tasks are j9p7.24-29 + j9p7.18-20 (the latter reframed under Phase E).
>
> Epic boring-ui-v2-zrby closed as merged.
>
> The original content below is preserved as a historical record.
> ─────────────────────────────────────────────────────────────────

**Status:** SUPERSEDED — see PLUGIN_MODEL.md v7.4
**Owners:** workspace
**Last updated:** 2026-04-29
**Preconditions:** plugin model (epic boring-ui-v2-j9p7) — closed
**Tracked by:** ~~epic boring-ui-v2-zrby~~ → epic boring-ui-v2-j9p7 (Phase 1.5)

## Problem

`@boring/workspace` ships two parallel layout systems:

1. **Imperative shell.** `ChatCenteredShell` (29KB) + `SurfaceShell` (23KB) + `ChatTopBar` + `SessionBrowser` + `WorkbenchLeftPane` + `ChatStagePlaceholder`, all living under `src/components/chat/`. Hardcodes the chat panel from `@boring/agent`, the top-bar slots, the session drawer, and the artifact dockview. Apps pass props in; they cannot restructure.

2. **Declarative layouts.** `ChatLayout` + `IdeLayout` + `ResponsiveDockviewShell` in `src/layouts/`. Compose panels by id (e.g. `<ChatLayout nav="session-list" center="chat" surface="artifact-surface" />`). Plugins register panels into the panel registry; the layout config resolves ids → components via dockview.

Today every consuming app (`apps/workspace-playground`, `apps/full-app`, `apps/boring-macro-v2`) uses **only the imperative shell**. The declarative layouts have **zero app consumers** — they're tested and exported but never reached.

Symptoms:

- Two layout systems = drift. New features land in `ChatCenteredShell` because that's what apps use, while `ChatLayout` falls behind and gets stale.
- Apps cannot extend the layout shape. Adding a fourth pane on the right, splitting the center, or rearranging anything requires forking `ChatCenteredShell`.
- Plugins (per `PLUGIN_MODEL.md`) are designed to contribute panels by id — but with `ChatCenteredShell` as the entry point, the layout doesn't read panels from the registry; it imports them statically. The plugin model's panel-registration story is blunted.
- Boring-macro's chart canvas, slide deck, and series-explorer panels currently bolt into `ChatCenteredShell` via custom props and ad-hoc state. They should be a `macroPlugin`.

## Goal

Single layout system. The declarative pattern (`ChatLayout` / `IdeLayout` + `ResponsiveDockviewShell` + `TopBar` + `WorkspaceProvider` registering core panels + plugin model wiring) is the canonical entry. The imperative `ChatCenteredShell` is deleted once all consumers migrate. Apps consume one of three tiers, all public:

### Tier 1 — declarative pre-shaped layouts

For apps that want a stock chat- or IDE-shaped surface. ~80% of apps.

```tsx
import { WorkspaceProvider, ChatLayout, TopBar } from "@boring/workspace"
import { macroPlugin } from "./macro-plugin"

<WorkspaceProvider plugins={[macroPlugin]}>
  <TopBar appTitle="Macro" right={<UserMenu />} />
  <ChatLayout
    nav="session-list"
    center="chat"
    sidebar="charts"
    surface="artifact-surface"
  />
</WorkspaceProvider>
```

Apps swap panels by changing the `nav` / `center` / `sidebar` / `surface` ids. Plugins register the implementations.

### Tier 2 — custom LayoutConfig with stock chrome

For apps that need a non-stock layout shape (split center, multiple right surfaces, custom group constraints) but still want responsive sidebar collapse, dockview integration, and the same `<TopBar>` chrome.

```tsx
import { WorkspaceProvider, ResponsiveDockviewShell, TopBar, type LayoutConfig } from "@boring/workspace"

const myLayout: LayoutConfig = {
  version: "2.0",
  groups: [
    { id: "rail",     position: "left",   panel: "session-list", locked: true, hideHeader: true },
    { id: "tree",     position: "left",   panel: "filetree",      collapsible: true },
    { id: "center",   position: "center", panel: "chat" },
    { id: "split-a",  position: "right",  panel: "code-editor" },
    { id: "split-b",  position: "right",  panel: "live-preview" },
  ],
}

<WorkspaceProvider plugins={[chatExperiencePlugin, livePreviewPlugin]}>
  <TopBar appTitle="..." />
  <ResponsiveDockviewShell layout={myLayout} />
</WorkspaceProvider>
```

### Tier 3 — full custom

Raw primitives. For apps with bespoke chrome (non-rectangular layout, multiple dockview instances, embedded workspace inside a larger non-workspace shell). Rare.

```tsx
import {
  WorkspaceProvider,
  DockviewShell,
  useViewportBreakpoint,
  useResponsiveSidebarCollapse,
  useTopBarSlot,
} from "@boring/workspace"

function MyShell() {
  // App fully composes chrome + dockview structure
}
```

All three tiers share the SAME core panel registrations (chat, session-list, workbench-left, artifact-surface). The only thing that changes between tiers is how the app shapes the layout around them.

## Substrate vs plugin (architectural commitment)

The migration is a chance to clarify what's substrate and what's plugin:

- **Substrate** = constitutive workspace panels. Without them, `@boring/workspace` is an empty dockview. Apps cannot opt out — these ARE what the package is. Today: `chat`, `session-list`, `workbench-left`, `artifact-surface`.
- **Default plugins** = optional capabilities apps can disable via `excludeDefaults: ['filesystem']`. Today: just `filesystemPlugin` (file tree + code editor + markdown editor + filesCatalog).
- **App plugins** = host-specific contributions. Apps register via `<WorkspaceProvider plugins={[macroPlugin, ...]}>`. Examples: `macroPlugin` (charts + slides + series), future `analyticsPlugin`, etc.

There is **no `chatExperiencePlugin`**. Chat is core, not a plugin. The earlier sketch of a "chat experience plugin" bundling these panels was wrong — it conflates substrate with extension.

`WorkspaceProvider` registers core panels at mount, before running the plugin bootstrap:

```ts
function WorkspaceProvider({ plugins, excludeDefaults, children }) {
  const panelRegistry = new PanelRegistry()
  panelRegistry.registerAll(coreWorkspacePanels)   // ← substrate, always
  bootstrap({ plugins, defaults: filteredDefaults, registries }) // ← optional + app
  ...
}
```

## File-tree consequences

After migration:

```
src/panes/                              ← all registered panels live here
├── chat/                               ← core
│   ├── ChatPanel.tsx                   thin wrapper around @boring/agent's ChatPanel
│   │                                   + workspace integrations (auto-open hooks,
│   │                                     command-stream consumption, suggestions)
│   └── definition.ts                   `definePanel({ id: "chat", ... })`
├── session-list/                       ← core (was components/chat/SessionBrowser)
├── workbench-left/                     ← core (was components/chat/WorkbenchLeftPane)
├── artifact-surface/                   ← core (was components/chat/SurfaceShell)
├── code-editor/                        existing (filesystem plugin)
├── markdown-editor/                    existing (filesystem plugin)
├── file-tree/                          existing (filesystem plugin)
├── data-catalog/                       existing
├── ArtifactSurfacePane.tsx             stays — referenced by SurfaceShell impl
├── EmptyPane.tsx                       stays
└── defaultEditorPanels.ts              stays

src/layouts/                            ← declarative composition + chrome
├── ChatLayout.tsx                      KEEP
├── IdeLayout.tsx                       KEEP
├── ResponsiveDockviewShell.tsx         KEEP — exported as Tier 2 entry
├── TopBar.tsx                          NEW — was components/chat/ChatTopBar
└── index.ts

src/registry/coreRegistrations.ts       NEW — exports `coreWorkspacePanels: PanelConfig[]`
                                         imported and applied by WorkspaceProvider

src/plugin/                             unchanged — plugin model machinery
└── defaults/
    └── filesystemPlugin.ts             unchanged — still the only default plugin

src/components/                         shrinks to genuinely cross-cutting UI
├── chat/                               GONE — contents moved to panes/, layouts/, bridge/
├── ui/                                 stays (shadcn primitives)
├── DataExplorer/                       stays (generic data subsystem)
├── CommandPalette.tsx                  stays
├── PanelErrorBoundary.tsx              stays
└── SessionList.tsx                     stays — data-list helper, distinct from
                                         the SessionBrowser panel that wraps it

src/bridge/ (or src/ui-bridge/)         absorbs the bridge infrastructure
├── (existing bridge code)
├── uiCommandStream.ts                  was components/chat/uiCommandStream.ts
└── uiCommandDispatcher.ts              was components/chat/uiCommandDispatcher.ts
```

What disappears:

- `src/components/chat/` (whole folder)
- `ChatCenteredShell.tsx` + `ChatShellContext` (`context.ts`)
- The old `presets.test.tsx` (it tests the layouts in isolation; superseded by the migrated apps' e2e + new layout tests)
- `src/index.ts` exports for `ChatCenteredShell`, `useChatShell`, `useChatSurface`, `ChatStagePlaceholder` (those are imperative-shell internals)

What stays exported (Tier 1 / Tier 2 / Tier 3 surface):

```ts
// Tier 1
export { ChatLayout, IdeLayout, buildChatLayout, buildIdeLayout } from "./layouts"
export type { ChatLayoutProps, IdeLayoutProps } from "./layouts"
export { TopBar } from "./layouts/TopBar"

// Tier 2
export { ResponsiveDockviewShell } from "./layouts/ResponsiveDockviewShell"

// Tier 3 (raw primitives)
export { DockviewShell } from "./dock"  // already exported
export type { LayoutConfig, GroupConfig } from "./dock"
export { useViewportBreakpoint, useResponsiveSidebarCollapse } from "./hooks"
export { useTopBarSlot } from "./components/TopBarSlot"

// WorkspaceProvider + plugin model (unchanged)
export { WorkspaceProvider } from "./WorkspaceProvider"
export { definePlugin, definePanel, PluginError, ... } from "./plugin"
export { CatalogRegistry, useCommands, useActivePanels, useCatalogs, ... } from "./plugin"
```

## Phase breakdown — 7 child tasks

A. **Decompose chat shells into per-pane folders + bridge/**
   - `git mv` `components/chat/{SessionBrowser, ChatStagePlaceholder, SurfaceShell, WorkbenchLeftPane}.tsx` into per-pane folders under `panes/`. Each pane gains a `definition.ts` exporting a `PanelConfig`.
   - Create `panes/chat/ChatPanel.tsx` (thin wrapper around `@boring/agent`'s ChatPanel + workspace integrations) + `definition.ts`.
   - `git mv` `components/chat/{uiCommandStream, uiCommandDispatcher}.ts` → `bridge/`.
   - Update internal imports.
   - **Don't touch `ChatCenteredShell.tsx` or `ChatTopBar.tsx` yet** — they stay in `components/chat/` until later tasks.

B. **Wire core panel registrations in WorkspaceProvider**
   - Create `registry/coreRegistrations.ts` exporting `coreWorkspacePanels: PanelConfig[]` aggregating the 4 core panel defs.
   - `WorkspaceProvider` imports and registers them at mount, BEFORE `bootstrap()` runs.
   - Test: render `WorkspaceProvider` with no plugins; assert the panel registry has the 4 core ids.

C. **Lift TopBar chrome + expose ResponsiveDockviewShell**
   - `git mv` `components/chat/ChatTopBar.tsx` → `layouts/TopBar.tsx`. Rename type `ChatTopBarProps` → `TopBarProps`. Update barrel.
   - Export `ResponsiveDockviewShell` from package barrel with jsdoc explaining Tier 2.
   - Add a section to `packages/workspace/README.md` (or `docs/`) documenting the three-tier API.

D. **Migrate workspace-playground to ChatLayout (Tier 1, canary)**
   - Rewrite `apps/workspace-playground/src/App.tsx` to use `<WorkspaceProvider>` + `<TopBar>` + `<ChatLayout>`.
   - Confirm e2e tests (`apps/workspace-playground/e2e/*.spec.ts`) still pass.
   - Document any gotchas for the next two app migrations.

E. **Migrate boring-macro-v2: ChatLayout + extract macroPlugin**
   - Create `apps/boring-macro-v2/src/macroPlugin.ts` defining the macro-specific panels (chart canvas, slide deck, series explorer) + commands (open_series) + agent tools (execute_sql, macro_search, get_series_data, persist_derived_series).
   - Rewrite `apps/boring-macro-v2/src/front/App.tsx` to use `<ChatLayout>` + `<WorkspaceProvider plugins={[macroPlugin]}>`.
   - Confirm boring-macro e2e tests pass.

F. **Migrate full-app to ChatLayout (or IdeLayout if appropriate)**
   - Rewrite `apps/full-app/src/front/main.tsx` to use the appropriate declarative layout.
   - Confirm e2e tests pass.

G. **Delete ChatCenteredShell + ChatShellContext + finalize**
   - Once D, E, F are merged: delete `components/chat/ChatCenteredShell.tsx` and `components/chat/context.ts`.
   - Drop the related exports from `src/index.ts`.
   - The `components/chat/` folder is now empty; remove it.
   - Update `WORKSPACE_V2_PLAN.md` and any other doc that references `ChatCenteredShell`.

A and B can run in parallel. C depends on A. D, E, F can run in parallel after A+B+C. G depends on D+E+F.

## Test plan

- **Per-pane reorg (Phase A):** existing tests follow the moved files; vi.mock paths get updated. No new tests required — the moves are mechanical.
- **Core panel registration (Phase B):** new test in `WorkspaceProvider.test.tsx` asserting the 4 core panel ids are registered post-mount.
- **TopBar (Phase C):** existing `ChatTopBar.test.tsx` follows the rename. New test confirming `useTopBarSlot()` integration if not already covered.
- **App migrations (D/E/F):** existing e2e suites must pass with no expected-snapshot changes (visuals shouldn't shift). If layout pixels shift slightly, regenerate snapshots in the same commit and document.
- **Tier 2 / Tier 3 public API:** add a jsdoc-extracted snippet test or a small integration test that constructs a custom `LayoutConfig` and renders it through `<ResponsiveDockviewShell>` to prove the export wiring works.
- **`ChatCenteredShell` removal (Phase G):** the `__tests__` folder for the imperative shell goes with it. Public API test asserts the symbol is gone.

## Risks

- **Pixel drift on canary migration.** Tier 1's `<ChatLayout>` may render at slightly different pixel offsets than `<ChatCenteredShell>` (different padding stack, different transition timing on the sidebar). Plan: regenerate visual snapshots when migrating workspace-playground; eyeball the diff for genuine regressions vs cosmetic shifts.
- **Plugin id collisions.** boring-macro's existing panels might collide with workspace's core panel ids if any name overlaps. Plan: audit during Phase E; rename macro panels to be namespaced (`macro:charts`, `macro:slides`).
- **boring-macro custom shell logic.** boring-macro's current App.tsx has more glue than the playground (custom session handling, custom topbar variants). Phase E may surface that some of this glue should live in `macroPlugin` (commands), and some should stay app-level (the actual host wiring + auth). Will need careful split.
- **`uiCommandStream` / `uiCommandDispatcher` re-homing.** These are the workspace's bridge consumers. Today they live in `components/chat/`; they need to move to `bridge/`. They're currently called from inside `ChatCenteredShell`. After A's move + WorkspaceProvider's mount-time wiring, they should be invoked from a `useEffect` inside `WorkspaceProvider` (or a dedicated hook). Confirm the lifecycle is right — the stream must start before the chat panel mounts.

## Out of scope

- Adding new panel types beyond the existing core + filesystem + macro sets.
- Changing the dockview library.
- Changing `@boring/agent`'s ChatPanel API. Workspace's chat panel is a thin wrapper, not a fork.
- Changing the plugin model itself (closed under `boring-ui-v2-j9p7`).
- Tier 2 / Tier 3 reference apps. The escape hatches stay public; we don't ship a demo app that uses them in this epic.

## Ship criteria

- All 7 phase tasks closed.
- Three apps run on declarative layouts in production.
- `ChatCenteredShell` and `ChatShellContext` deleted from the tree.
- Public API exposes Tier 1 / Tier 2 / Tier 3 entries with jsdoc.
- A README section in `packages/workspace/` describing the three-tier model with one snippet per tier.

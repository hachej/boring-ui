# Configurable Default Layout for boring-ui Instances

Status: ready
Owner: human
Last updated: 2026-02-20
Requested by: boring-macro (002-boring-ui-instance.md)
Reviewed by: codex (2026-02-20)

## Goal

Allow boring-ui instances to define their own initial Dockview layout via a `defaultLayout` config key in `app.config.js`. Today, `App.jsx`'s `ensureCorePanels()` function (line 1059 on `control-plan-decoupling`) hardcodes the default layout as:

```
[ filetree | [empty-center / shell] | terminal/companion (right rail) ]
```

This means any instance that registers custom panels via `registerPane()` gets them capability-gated and available in the component map, but they **never appear in the initial layout**. Users must manually drag panels into position — a broken first-run experience for any non-default instance.

boring-macro needs `data-catalog` (left), `chart-canvas` (center), and companion (right) as its initial layout. Other future instances (boring-podcast, boring-bi) will need similar customization.

## Non-goals

- Changing the default layout for the stock boring-ui instance (filetree/editor/shell/terminal/companion stays as-is when no `defaultLayout` config is provided)
- Runtime layout switching (this is about initial/first-run layout only — subsequent loads use the saved layout from localStorage as today)
- Modifying the PaneRegistry API or CapabilityGate behavior
- Layout presets or templates system (out of scope — just one config key)

## Assumptions

- boring-ui is the only codebase being modified (this is an upstream contribution, not a fork)
- Base branch: `control-plan-decoupling` (not yet merged to main — canonical `/api/v1/` routes, service decoupling complete)
- The `app.config.js` schema is already extensible — `branding`, `storage`, `panels`, `features`, `styles` sections exist
- Dockview's `addPanel` API supports `position` with `direction` and `referencePanel`/`referenceGroup` for deterministic layout construction
- The existing `ensureCorePanels()` logic in `App.jsx` is the sole owner of initial layout creation

## Design

### Config shape

Add a `defaultLayout` key to `app.config.js`:

```js
export default {
  branding: { /* ... */ },
  storage: { /* ... */ },
  panels: {
    // Existing sizing config — instances extend with their custom panel IDs.
    defaults: {
      filetree: 280,           // width (px) — stock panels
      terminal: 400,
      companion: 400,
      shell: 250,              // height (px)
      'data-catalog': 280,     // custom panels add entries here
      'chart-canvas': 0,       // 0 or absent = DockView flex (fill remaining space)
    },
    min: {
      filetree: 180,
      'data-catalog': 180,
      companion: 250,
      shell: 100,
      center: 200,
    },
    collapsed: { /* ... */ },
  },
  features: { /* ... */ },

  // NEW: Define the initial Dockview layout for first-run (no saved layout in localStorage).
  // If omitted, the built-in ensureCorePanels() layout is used (backward compatible).
  defaultLayout: {
    // Panels are created in order. Each entry specifies a Dockview position
    // relative to a previously-created panel.
    //
    // Position types:
    //   'left'/'right'/'above'/'below' — split relative to a reference panel
    //   'tab'                          — add as tab in same group as reference panel
    //   (first panel needs no position — it becomes the root)
    panels: [
      // First panel: no position needed, becomes root
      { id: 'data-catalog' },

      // FileTree below data-catalog — left column is vsplit: catalog top, filetree bottom
      { id: 'filetree', position: 'below', ref: 'data-catalog' },

      // Split right of data-catalog — creates center column
      { id: 'chart-canvas', position: 'right', ref: 'data-catalog' },

      // Split right of chart-canvas — creates right rail
      { id: 'companion', position: 'right', ref: 'chart-canvas' },

      // Split below chart-canvas — shell at bottom of center
      { id: 'shell', position: 'below', ref: 'chart-canvas' },
    ],
  },
}
```

The position types map directly to Dockview's layout primitives:

| Position | Dockview API | Effect |
|----------|-------------|--------|
| `'left'` | `{ direction: 'left', referencePanel: ref }` | H-split: new panel to the left of ref |
| `'right'` | `{ direction: 'right', referencePanel: ref }` | H-split: new panel to the right of ref |
| `'above'` | `{ direction: 'above', referenceGroup: refPanel.group }` | V-split: new panel above ref's group |
| `'below'` | `{ direction: 'below', referenceGroup: refPanel.group }` | V-split: new panel below ref's group |
| `'tab'` | `{ referencePanel: ref }` (no direction) | Tab: new panel in same group as ref |
| _(none)_ | _(no position arg)_ | Root: first panel, fills entire viewport |

**`referencePanel` vs `referenceGroup` decision:** Horizontal splits (`left`/`right`) use `referencePanel`. Vertical splits (`above`/`below`) use `referenceGroup` (resolved from `api.getPanel(ref).group`) to match the existing `ensureCorePanels()` behavior where shell is created with `referenceGroup: emptyPanel.group` (line 1159). In bd-28ui.2.2 DockView probes, `referenceGroup` and `referencePanel` produced the same center-column split in the tested tabbed-center scenario; we still standardize on `referenceGroup` for vertical splits for consistency with runtime code.

This is a thin wrapper over Dockview — no new abstractions, just a declarative config for what `ensureCorePanels()` does imperatively today.

### How it works

#### Integration point in `onReady`

The layout builder slots into the existing decision flow in `App.jsx`'s `onReady` callback:

1. `onReady` fires (line 1005)
2. Check localStorage for a saved layout (lines 1190-1235) — **unchanged**
3. If no saved layout:
   - If `config.defaultLayout` is defined → call `buildLayoutFromConfig()`
   - Else → call `ensureCorePanels()` (existing behavior)
4. Store the chosen builder in `ensureCorePanelsRef.current` (line 1242) — this ref is always set regardless of whether a saved layout was found, because the layout restoration `useEffect` at line 1506/1515 calls it as a fallback.
5. If a saved layout exists in localStorage → skip both paths (existing behavior preserved).

#### Layout builder: `buildLayoutFromConfig(api, config, registry, capabilities)`

For each entry in `config.defaultLayout.panels`, in order:

1. **Validate registration:** Look up `id` in PaneRegistry. If not registered, log `console.warn('[Layout] Panel "${id}" not registered in PaneRegistry, skipping')` and continue.
2. **Validate capabilities:** Check the registry entry's `requiresFeatures`, `requiresAnyFeatures`, and `requiresRouters` against the current `capabilities` object (same logic `getGatedComponents()` uses). If the panel's requirements aren't met, **skip it** — this prevents creating panels whose backends are unavailable. Log `console.warn('[Layout] Panel "${id}" skipped — required capabilities not available')`.
3. **Validate ref:** If `ref` is specified but that panel wasn't created (typo, skipped due to capabilities, or not yet processed), log `console.warn('[Layout] Panel "${id}" references unknown ref "${ref}", skipping')` and continue.
4. **Create panel:** Call `api.addPanel({ id, component, title, tabComponent, position, params })` where:
   - `component`: from PaneRegistry (defaults to `id`)
   - `title`: from PaneRegistry
   - `tabComponent`: from PaneRegistry (new field, see Phase 0)
   - `position`: mapped from config using the `referencePanel`/`referenceGroup` rules above
   - `params`: from `getDefaultParams(id)` (see below)
5. **Track:** Store the created panel in a lookup map so subsequent entries can reference it via `ref`.

After all panels are created:

6. **Set `centerGroupRef`:** Find the first created panel whose PaneRegistry entry has `placement: 'center'`. If none, find the first panel that is not in a group that is `locked: true` in the registry (i.e., not a sidebar/rail). Set `centerGroupRef.current = thatPanel.group`. If no center panel exists at all, `centerGroupRef` stays null — the `onDidRemovePanel` empty-center recreation logic (line 1284) will use its shell/right-rail fallback chain.
7. **Create `empty-center` if needed:** If any panel in the layout has `placement: 'center'` in the registry, create `empty-center` as a tab in that group (hidden placeholder for when editors are closed). If no center panel exists, skip `empty-center` creation.
8. **Apply constraints:** Call `applyPanelConstraints(api, registry, capabilityFlags, panelMinRef)`.
9. **Apply sizing:** Call `applyInitialSizes(api, panelSizesRef, panelMinRef, panelCollapsedRef, collapsedState, registry)` inside a `requestAnimationFrame`.

**If all entries fail validation** (all skipped), fall through to `ensureCorePanels()` as a safety net.

### Sizing: `applyInitialSizes()`

`defaultLayout` controls panel positions only. Initial panel **sizes** are controlled by the existing `panels.defaults`, `panels.min`, and `panels.collapsed` config sections.

Today, the sizing code in `onReady` (lines 1249-1268) and the layout restoration `useEffect` (lines 1518-1576) are both hardcoded to four panel IDs. The refactored `applyInitialSizes()` iterates all panels generically:

```js
function applyInitialSizes(api, panelSizesRef, panelMinRef, panelCollapsedRef, collapsedState, registry) {
  requestAnimationFrame(() => {
    const seen = new Set()  // track groups to avoid sizing the same group twice (tabbed panels)
    for (const panel of api.panels) {
      const group = panel.group
      if (!group) continue
      if (seen.has(group.id)) continue  // skip — group already sized by an earlier tab
      seen.add(group.id)
      const groupApi = api.getGroup(group.id)?.api
      if (!groupApi) continue

      const paneConfig = registry.get(panel.id)
      // Axis detection: panels with placement 'bottom' use height, all others use width.
      // Custom panels that use position: 'below' in defaultLayout MUST set placement: 'bottom'
      // in their PaneRegistry registration for correct sizing.
      const isVertical = paneConfig?.placement === 'bottom'
      const isCollapsed = collapsedState[panel.id]

      if (isCollapsed) {
        // Pin to collapsed size (both min and max set to collapsed value)
        const collapsedSize = panelCollapsedRef.current[panel.id]
        if (collapsedSize) {
          if (isVertical) {
            groupApi.setConstraints({ minimumHeight: collapsedSize, maximumHeight: collapsedSize })
            groupApi.setSize({ height: collapsedSize })
          } else {
            groupApi.setConstraints({ minimumWidth: collapsedSize, maximumWidth: collapsedSize })
            groupApi.setSize({ width: collapsedSize })
          }
        }
      } else {
        // Apply normal size from panels.defaults, respecting minimum from panels.min
        const size = panelSizesRef.current[panel.id]
        if (!size) continue  // no default = DockView flex
        if (isVertical) {
          const minH = panelMinRef.current[panel.id] || 0
          groupApi.setConstraints({ minimumHeight: minH, maximumHeight: Number.MAX_SAFE_INTEGER })
          groupApi.setSize({ height: Math.max(size, minH) })
        } else {
          const minW = panelMinRef.current[panel.id] || 0
          groupApi.setConstraints({ minimumWidth: minW, maximumWidth: Number.MAX_SAFE_INTEGER })
          groupApi.setSize({ width: size })
        }
      }
    }
  })
}
```

**Axis detection constraint:** The function determines whether to use `height` or `width` from the panel's PaneRegistry `placement` field. Panels registered with `placement: 'bottom'` use height; all others use width. Custom panels that appear in a `position: 'below'` split in `defaultLayout` **must** set `placement: 'bottom'` in their `registerPane()` call for correct sizing. This is a convention — the config's `position` (layout placement) and the registry's `placement` (sizing axis hint) are independent but must be consistent for vertical panels.

**Tab-group deduplication:** When multiple panels share a group (via `position: 'tab'`), only the first panel's sizing is applied. Panels in a tab group should share a single `panels.defaults` entry (or only one should have an entry).

Instances define sizes for their custom panels via the existing config keys:

```js
panels: {
  defaults:   { 'data-catalog': 280, companion: 400, shell: 250 },
  min:        { 'data-catalog': 180, companion: 250, shell: 100 },
  collapsed:  { 'data-catalog': 48 },
}
```

A `panels.defaults` value of `0` or absent means "no explicit size — let DockView flex."

**Both code paths** use `applyInitialSizes()`: `ensureCorePanels()` calls it at the end, and so does `buildLayoutFromConfig()`. The hardcoded `requestAnimationFrame` sizing blocks at line 1249 and inside the layout restoration `useEffect` at line 1518 are replaced by calls to this function.

**Note on the `onReady` sizing block at line 1249:** Today this block runs unconditionally (outside the `if (!hasSavedLayout)` guard). However, when a saved layout exists, no panels are created in `onReady` — the block's `api.getPanel('filetree')` etc. all return null, making it a no-op. The actual sizing for restored layouts happens in the layout restoration `useEffect` (line 1518+). So moving sizing inside the builder (which only runs for fresh layouts) is a safe change — the no-op case just becomes dead code removal.

**`ensureCorePanelsRef.current` wrapping:** Today (line 1242-1244) the ref wraps `ensureCorePanels()` with an extra `applyLockedPanels()` call. After this refactor, both `ensureCorePanels()` and `buildLayoutFromConfig()` call `applyPanelConstraints()` and `applyInitialSizes()` internally. The ref stores the raw function — no wrapper needed. The current wrapper at line 1242-1244 is simplified to `ensureCorePanelsRef.current = <chosen builder>`.

### Runtime params: `getDefaultParams(panelId)`

`ensureCorePanels()` passes runtime callbacks and state as `params` to specific panels. These are React-land values (functions, refs) that can't live in config. The layout builder uses a `getDefaultParams(id)` lookup:

| Panel ID | Params injected |
|----------|----------------|
| `filetree` | `onOpenFile`, `onOpenFileToSide`, `onOpenDiff`, `projectRoot`, `activeFile`, `activeDiffFile`, `collapsed`, `onToggleCollapse`, `userEmail`, `userMenuStatusMessage`, `userMenuStatusTone`, `onUserMenuRetry`, `userMenuDisabledActions`, `workspaceName`, `workspaceId`, `onSwitchWorkspace`, `onCreateWorkspace`, `onOpenUserSettings`, `onLogout` |
| `shell` | `collapsed`, `onToggleCollapse` |
| `companion` | `collapsed`, `onToggleCollapse`, `provider: 'companion'`, `lockProvider: true` |
| _(any other)_ | `{}` — custom panels manage their own state via hooks/context |

`getDefaultParams` is defined inside the `onReady` closure (same scope as `ensureCorePanels()`) so it has access to the same callbacks and state. **`ensureCorePanels()` itself should also call `getDefaultParams()`** to eliminate the duplication — today it has the params inline; after the refactor it calls the shared function. This prevents the drift risk where a new param is added to one path but not the other.

Custom panels listed in `defaultLayout` that need App-level data should use React context or Zustand stores (the existing pattern for most non-core panels). The `params` mechanism is reserved for core panels that predate the context pattern.

### Panel constraints: `applyPanelConstraints(api, registry, capabilityFlags)`

Today's `applyLockedPanels()` (lines 1009-1057) hardcodes locking, header hiding, and constraints for four panel IDs. It also has **conditional logic** based on capability flags:

| Panel | Registry metadata | Runtime behavior in `applyLockedPanels()` |
|-------|-------------------|-------------------------------------------|
| `filetree` | `locked: true, hideHeader: true` | Always locked + hidden header |
| `terminal` | `locked: true, hideHeader: true` | Locked **only if `nativeAgentEnabled`** |
| `companion` | `locked: false, hideHeader: true` | Locked **only if `companionAgentEnabled`** (runtime override) |
| `shell` | `locked: true, hideHeader: false` | Constraints only — `locked` and `header.hidden=false` set in `ensureCorePanels()` post-creation (line 1168-1170) |

The registry metadata alone is **not sufficient** — companion's `locked: false` in the registry is overridden at runtime to `locked: true` when the companion feature is enabled. Terminal locking is conditional on `nativeAgentEnabled`.

**Solution: Two-layer approach.**

1. The refactored `applyPanelConstraints()` reads from the registry as a baseline (handles custom panels generically).
2. For panels where runtime behavior differs from registry metadata, the function accepts a `capabilityFlags` parameter (`{ nativeAgentEnabled, companionAgentEnabled }`) and applies runtime overrides:

```js
function applyPanelConstraints(api, registry, capabilityFlags, panelMinRef) {
  for (const panel of api.panels) {
    const config = registry.get(panel.id)
    if (!config) continue
    const group = panel.group
    if (!group) continue

    // Baseline from registry
    let shouldLock = config.locked ?? false
    let shouldHideHeader = config.hideHeader ?? false

    // Runtime overrides for capability-dependent panels
    if (panel.id === 'terminal' && !capabilityFlags.nativeAgentEnabled) {
      shouldLock = false
      shouldHideHeader = false
    }
    if (panel.id === 'companion' && capabilityFlags.companionAgentEnabled) {
      shouldLock = true  // override registry's locked:false
    }

    if (shouldLock)       group.locked = true
    if (shouldHideHeader) group.header.hidden = true
    // Explicitly reset header visibility when hideHeader is false
    // (prevents stale state from saved layouts where header was hidden)
    if (!shouldHideHeader && config.hideHeader === false) group.header.hidden = false

    // Read minimum sizes from panelMinRef (populated from panels.min config),
    // falling back to registry constraints for panels not in panelMinRef.
    // panelMinRef is the current source of truth — registry constraints are informational.
    const constraints = {}
    const isVertical = config.placement === 'bottom'
    if (isVertical) {
      const minH = panelMinRef.current[panel.id] ?? config.constraints?.minHeight
      if (minH) {
        constraints.minimumHeight = minH
        constraints.maximumHeight = Number.MAX_SAFE_INTEGER
      }
    } else {
      const minW = panelMinRef.current[panel.id] ?? config.constraints?.minWidth
      if (minW) {
        constraints.minimumWidth = minW
        constraints.maximumWidth = Number.MAX_SAFE_INTEGER
      }
    }

    if (Object.keys(constraints).length > 0) {
      group.api.setConstraints(constraints)
    }
  }
}
```

The runtime overrides are an explicit allowlist — only `terminal` and `companion` have capability-conditional behavior. All other panels (including custom ones) use pure registry metadata. This keeps the overrides visible and auditable while making the system data-driven for new panels.

**Both code paths use this function:** `ensureCorePanels()` calls `applyPanelConstraints(api, registry, capabilityFlags, panelMinRef)` at the end (replacing the current `applyLockedPanels()`), and the custom layout builder calls it after creating all panels. The `panelMinRef` parameter ensures minimum sizes come from the `panels.min` config (the current source of truth in `applyLockedPanels()`), with the registry `constraints` as a fallback for panels not in `panels.min`.

### `empty-center` panel lifecycle

The `onDidRemovePanel` handler (lines 1284-1345) recreates `empty-center` when all editors/reviews are closed. Its fallback positioning chain references `centerGroupRef`, then `shellPanel.group`, then `terminal || companion`, then `filetree`. This chain **already handles missing panels gracefully** — each step checks existence before using a reference. In a custom layout without `terminal`, the chain skips to `companion` or `filetree`. No change needed to this handler.

However, the layout builder must correctly set `centerGroupRef` (see step 6 above) so the primary path (`groupStillExists && centerGroup.panels?.length > 0`) works for custom layouts. If the custom layout has no center-placement panel, `centerGroupRef` will be null, and the handler falls back to positioning relative to shell or right-rail panels — which is acceptable.

### Deferred companion/pi-agent creation

The capabilities `useEffect` (lines 2096-2161) creates companion and pi-agent panels **after** capabilities load, if they don't already exist. This code checks `dockApi.getPanel('companion')` and `dockApi.getPanel('pi-agent')` before creating. If the custom layout already created these panels, the check returns truthy and the deferred creation is skipped. **No change needed** — the existing guard prevents duplication.

### Layout restoration `useEffect` (line 1494)

This effect has three paths:

1. **`!nativeAgentEnabled`** (line 1500): Calls `ensureCorePanelsRef.current()` — after this plan, that ref points to the custom layout builder. Works correctly.

2. **No saved layout** (line 1514): Calls `ensureCorePanelsRef.current()` then a hardcoded `requestAnimationFrame` sizing block (lines 1518-1576). After this plan, the ref points to the custom layout builder which calls `applyInitialSizes()` internally. **The hardcoded sizing block at line 1518 must be replaced** with a call to `applyInitialSizes()` to avoid doubling sizing calls and to handle custom panel IDs.

3. **Saved layout restored via `fromJSON`** (line 1580): After restoring, applies hardcoded locking/constraints/params for filetree, terminal, shell, companion, pi-agent (lines 1589-1693). **This path is NOT refactored in this plan** — it deals with layout *restoration* (deserializing a saved JSON layout), not fresh panel creation. The saved layout already has panels in the right positions; it only needs to re-apply runtime state (callbacks, locking). The panel IDs it references (`filetree`, `terminal`, `shell`, `companion`, `pi-agent`) are the same IDs that would be saved in localStorage from any custom layout that includes them. Custom-only panels (like `data-catalog`) don't need post-restore locking/params because they manage state via hooks/context. If a future custom panel needs post-restore params, `getDefaultParams()` can be extended and the restoration loop can iterate all panels — but that's a separate concern.

**Scope of this plan for the restoration `useEffect`:**
- Replace the hardcoded `requestAnimationFrame` sizing block (lines 1518-1576) with `applyInitialSizes()`.
- Leave the `fromJSON` restoration path (lines 1580-1693) unchanged — it handles a different concern (re-hydrating runtime state onto an existing layout).

### Error handling

| Error condition | Behavior |
|-----------------|----------|
| Panel `id` not registered in PaneRegistry | `console.warn`, skip entry, continue |
| Panel `id` registered but capabilities not met | `console.warn`, skip entry, continue |
| `ref` points to a panel ID that wasn't created | `console.warn`, skip entry, continue |
| `defaultLayout.panels` is empty array or all entries fail | Fall through to `ensureCorePanels()` |
| `defaultLayout` present but `panels` is not an array | `console.error`, fall through to `ensureCorePanels()` |
| `defaultLayout.panels` entry missing `id` field | `console.warn`, skip entry, continue |
| Single panel (no splits) | Valid — fills viewport |
| Two panels in same group with conflicting registry metadata | Last-write-wins on group properties (locked, hideHeader). Document: when using `position: 'tab'`, all panels in the group should have compatible registry metadata. |

The builder never throws. A partial layout (some panels skipped) is valid — better to show something than nothing.

### Examples

**boring-macro** (left sidebar vsplit + center + right rail + bottom shell):
```
┌──────────────┬────────────────────┬──────────────┐
│ DataCatalog   │ ChartCanvas        │ Companion    │
│ (top-left)   │ (center, tabs)     │ (right)      │
├──────────────┤                    │              │
│ FileTree      ├────────────────────┤              │
│ (bottom-left)│ Shell (bottom-ctr) │              │
└──────────────┴────────────────────┴──────────────┘
```
```js
// app.config.js
export default {
  panels: {
    defaults:  { 'data-catalog': 280, companion: 400, shell: 250 },
    min:       { 'data-catalog': 180, filetree: 180, companion: 250, shell: 100 },
    collapsed: { 'data-catalog': 48 },
  },
  defaultLayout: {
    panels: [
      { id: 'data-catalog' },
      { id: 'chart-canvas', position: 'right', ref: 'data-catalog' },
      { id: 'filetree', position: 'below', ref: 'data-catalog' },
      { id: 'companion', position: 'right', ref: 'chart-canvas' },
      { id: 'shell', position: 'below', ref: 'chart-canvas' },
    ],
  },
}
```

**boring-bi** (file tree + data catalog as tabs, center editor, right companion):
```js
defaultLayout: {
  panels: [
    { id: 'filetree' },
    { id: 'data-catalog', position: 'tab', ref: 'filetree' },
    { id: 'editor', position: 'right', ref: 'filetree' },
    { id: 'companion', position: 'right', ref: 'editor' },
  ],
}
```

**Minimal** (just file tree + editor):
```js
defaultLayout: {
  panels: [
    { id: 'filetree' },
    { id: 'editor', position: 'right', ref: 'filetree' },
  ],
}
```

### Backward compatibility

- When `defaultLayout` is absent: `ensureCorePanels()` runs exactly as before.
- `ensureCorePanels()` itself calls the refactored `applyPanelConstraints()` and `applyInitialSizes()` — behavior is identical because the functions read the same metadata and apply the same runtime overrides.
- The `panels.defaults`, `panels.min`, `panels.collapsed` config sections continue to work for sizing.
- `getKnownComponents()` and `getGatedComponents()` continue to work — `defaultLayout` only controls which panels are created initially, not which components are available.
- The layout restoration `useEffect` uses `ensureCorePanelsRef.current` for its fallback, which points to the custom layout builder when `defaultLayout` is configured. The `fromJSON` restoration path is unchanged.
- Panel save/restore via localStorage works unchanged — once a layout is saved, `defaultLayout` is ignored on subsequent loads.
- The `onDidRemovePanel` empty-center recreation handler works with custom layouts because its fallback chain already handles missing panels.
- Deferred companion/pi-agent creation (capabilities `useEffect`) is unaffected — it checks for existing panels before creating.

## Phases + Gates

### Phase 0: Make panel setup data-driven (refactor, no behavior change)

**What**: Refactor three hardcoded areas into generic, data-driven functions. This is a pure refactor — the stock boring-ui layout is identical before and after.

**Changes**:

1. **Add `tabComponent` field to PaneRegistry schema** (`src/front/registry/panes.js`):
   - Add `tabComponent: 'noClose'` to the `shell` registration (line 344-357). Currently `tabComponent` is only passed in `ensureCorePanels()` at line 1157 — move it to the registry so the layout builder can read it.
   - No other panels use `tabComponent` today.

2. **Extract `applyPanelConstraints(api, registry, capabilityFlags)`** (`src/front/App.jsx`):
   - Replace `applyLockedPanels()` with the data-driven version described above.
   - Reads `locked`, `hideHeader`, `constraints` from PaneRegistry with runtime overrides for terminal and companion.
   - `ensureCorePanels()` calls this at the end (same call site as current `applyLockedPanels()`).

3. **Extract `applyInitialSizes(api, ...refs, registry)`** (`src/front/App.jsx`):
   - Replace the hardcoded `requestAnimationFrame` sizing in `onReady` (lines 1249-1268).
   - Replace the hardcoded sizing in the layout restoration `useEffect` (lines 1518-1576).
   - Both now call the generic function that iterates all panels and handles collapsed state.

4. **Extract `getDefaultParams(panelId)`** (`src/front/App.jsx`):
   - Defined inside `onReady` closure.
   - `ensureCorePanels()` calls it instead of inlining the params for filetree, shell, and companion.

**Files**:
- `src/front/registry/panes.js` — add `tabComponent` to shell registration
- `src/front/App.jsx` — extract three functions, update call sites

**Gate**:
```bash
# Stock boring-ui works identically — visual inspection checklist:
# - filetree: locked group, hidden header, ~280px wide
# - terminal: locked group, hidden header (when nativeAgentEnabled)
# - companion: locked group, hidden header (when companionAgentEnabled)
# - shell: shown header, locked group, ~250px tall, min-height constraint
# - center: hidden header, min-height constraint
# - collapsed states pin to correct collapsed sizes
npm run dev &
sleep 3
curl -sf http://localhost:5173 > /dev/null && echo "stock layout OK"
kill %1

npm run test:run
```

### Phase 1: Implement `defaultLayout` config reader + layout builder

**What**: Read `config.defaultLayout` in `App.jsx`. If present and no saved layout, build the layout from the config instead of calling `ensureCorePanels()`. If absent, fall back to existing behavior. Includes capability gating, `centerGroupRef` assignment, `empty-center` creation, and error handling.

**Changes**:
- `src/front/App.jsx`:
  - Add `buildLayoutFromConfig(api, config, registry, capabilities)` inside `onReady` closure.
  - Wire into decision at line 1239: `if (config.defaultLayout?.panels?.length > 0) buildLayoutFromConfig(...) else ensureCorePanels()`.
  - Both paths store their builder in `ensureCorePanelsRef.current`.
  - Both paths call `applyPanelConstraints()` and `applyInitialSizes()` (from Phase 0).
- `src/front/config/appConfig.js` — add `defaultLayout: null` to `DEFAULT_CONFIG`.
- Add unit tests.

**Test scenarios** (tests requiring custom panels like `data-catalog`, `chart-canvas` must register mock panes in PaneRegistry before running):
1. No `defaultLayout` → `ensureCorePanels()` runs, stock layout created, all constraints/sizing correct.
2. `defaultLayout` with 5 panels (boring-macro config) → all panels created in correct positions with correct constraints and sizing.
3. `defaultLayout` with `position: 'below'` → uses `referenceGroup` for vertical split (verify shell-below-center works).
4. `defaultLayout` with `position: 'tab'` → panels share a group correctly.
5. `defaultLayout` with invalid `ref` → panel skipped, warning logged, remaining panels created.
6. `defaultLayout` with unregistered panel ID → panel skipped, warning logged.
7. `defaultLayout` with panel whose capabilities aren't met → panel skipped, warning logged.
8. `defaultLayout` panels receive correct runtime params (filetree gets workspace props, shell gets collapse state, companion gets provider/lockProvider).
9. After custom layout, `panels.defaults` sizing is applied correctly for custom panel IDs.
10. localStorage saved layout takes priority over `defaultLayout` on second load.
11. `centerGroupRef` is set correctly for custom layouts — editors opened later land in the center group.
12. `empty-center` is recreated correctly when all editors are closed in a custom layout.
13. DockView creation order (verified in bd-28ui.2.2): after `data-catalog` is vsplit (`filetree` below), `{ position: 'right', ref: 'data-catalog' }` splits only the `data-catalog` cell, not the full left column. Authoring rule: create horizontal sibling columns before vertical splits within those columns when you need a full-height center column.

**Files**:
- `src/front/App.jsx` — layout builder + integration
- `src/front/config/appConfig.js` — schema documentation
- `src/front/__tests__/configLayout.test.js` — unit tests

**Gate**:
```bash
# Stock boring-ui (no defaultLayout) still works identically
npm run dev &
sleep 3
curl -sf http://localhost:5173 > /dev/null && echo "stock layout OK"
kill %1

# All tests pass including new configLayout tests
npm run test:run

# Verify with boring-bi example config
# Manually: set defaultLayout in examples/boring-bi/app.config.js,
# verify 4-panel layout with correct positions and sizing
```

### Phase 2: Validate with boring-macro instance

**What**: In the boring-macro repo, set `defaultLayout` in `app.config.js` with data-catalog, chart-canvas, companion, shell. Extend `panels.defaults` and `panels.min` with custom panel sizes. Verify the initial layout matches the spec.

**Gate**:
```bash
# boring-macro instance boots with custom layout
cd /path/to/boring-macro/src/web
bun run build
# Manual verification:
#   - data-catalog is top-left (width ~280px)
#   - filetree is bottom-left
#   - chart-canvas fills center
#   - companion is right rail (width ~400px)
#   - shell is bottom-center (height ~250px)
#   - filetree has locked group, hidden header
#   - shell has min-height constraint
#   - clearing localStorage and refreshing recreates the custom layout
#   - saving layout to localStorage and refreshing restores correctly
#   - opening an editor lands in the center group (chart-canvas area)
#   - closing all editors shows empty-center placeholder
```

## Risk register

- **Risk (confirmed in bd-28ui.2.2):** DockView panel creation order affects layout tree structure. After `filetree` splits below `data-catalog` (vsplit), `{ position: 'right', ref: 'data-catalog' }` splits only the data-catalog cell (not the entire left column).
  - **Impact:** Center column appears between data-catalog and filetree instead of to the right of the full left column.
  - **Mitigation:** Keep config guidance aligned with verified behavior: create `chart-canvas` right of `data-catalog` first, then `filetree` below `data-catalog` when a full-height center column is required.

- **Risk:** `applyPanelConstraints()` refactor introduces regressions in stock layout.
  - **Impact:** Panels lose locking, headers become visible, sizing constraints break.
  - **Mitigation:** Phase 0 is a standalone refactor with its own gate. The function reads from PaneRegistry (which already declares the correct values) plus explicit runtime overrides for terminal and companion conditional locking. Verify pixel-identical behavior.

- **Risk:** `getDefaultParams()` drifts out of sync with params added in future.
  - **Impact:** filetree/shell/companion in custom layouts miss new params.
  - **Mitigation:** `ensureCorePanels()` also calls `getDefaultParams()` (single source of truth). Any param added to `getDefaultParams()` automatically flows to both code paths.

- **Risk:** Workspace-specific params not available for custom layouts in hosted mode.
  - **Impact:** filetree panel doesn't show user menu or workspace switcher.
  - **Mitigation:** `getDefaultParams('filetree')` always includes workspace params (same closure variables). These come from App component state — available regardless of which layout path runs.

- **Risk:** Two panels using `position: 'tab'` in the same group have conflicting registry metadata (one `locked: true`, other `locked: false`).
  - **Impact:** Unpredictable group behavior — last panel's constraints win.
  - **Mitigation:** Document as a config authoring guideline: panels in the same group (using `position: 'tab'`) should have compatible registry metadata. The builder applies constraints per-group, last-write-wins. This matches DockView's own behavior.

- **Risk:** `fromJSON` layout restoration path (lines 1580-1693) still has hardcoded panel IDs for post-restore locking and param injection.
  - **Impact:** Custom-only panels in a restored layout don't get post-restore runtime state.
  - **Mitigation:** This is acceptable for v1 — custom panels should use hooks/context for runtime state, not `params`. The `fromJSON` path correctly handles all stock panels that need `params` (filetree, companion). If a future custom panel needs post-restore params, `getDefaultParams()` can be extended and the restoration loop generalized — tracked as a follow-up, not blocking.

## Out-of-scope follow-ups

These are identified but explicitly not part of this plan:

1. **Generalize `fromJSON` restoration loop** — make the post-restore locking/params loop in the layout restoration `useEffect` (lines 1589-1693) iterate all panels and use `applyPanelConstraints()` + `getDefaultParams()`. Currently it's hardcoded but functional.
2. **`pi-agent` panel** — the deferred pi-agent creation (line 2134-2158) is unaffected by this plan (checks for existing panels before creating). If a custom layout wants to include `pi-agent`, it would work with the existing deferred creation flow — but explicit `defaultLayout` support for `pi-agent` is not tested or documented.
3. **Layout validation CLI** — a build-time check that validates `defaultLayout` config against registered pane IDs and capability requirements. Nice-to-have for catching config typos early.

## Evidence

Evidence lives in `.agent-evidence/` (not committed).

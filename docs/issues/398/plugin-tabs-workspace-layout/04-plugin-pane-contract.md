# 04 — Plugin Pane Contract

Defines how plugins participate in the plugin-tabs layout and current workspace plugin-page mode.

## Current workspace plugin page interface

Phase 1 should expose a plugin page API using a clearer public placement name: `workspace-page`.

Important simplification: a plugin page is just a regular React/web page inside the workspace content slot. Plugins should build normal shadcn/ui-kit/Tailwind layouts. The framework should not impose a special plugin layout system.

### Registration

Use the existing panel API. A plugin content page is just a panel with `placement: "workspace-page"`. In phase 1 it can be implemented as a shared Dockview panel that auto-collapses the current workspace left pane.

```ts
export default definePlugin({
  id: "github-pr-tracker",
  label: "GitHub PR Tracker",
  panels: [
    {
      id: "github-pr-tracker.page",
      label: "PR Tracker",
      placement: "workspace-page",
      icon: GitPullRequestIcon,
      component: GithubPrTrackerPage,
    },
  ],
})
```

Do **not** add `registerPluginPage` in phase 1. The simplification is one panel API:

```txt
panel placement decides where it appears
```

Drop `leftTabs` / `registerLeftTab` from public plugin guidance/API. New docs and new plugins should use:

```txt
panels[] + placement: "workspace-page"
```

Implementation can internally map `workspace-page` onto today's shared Dockview host and auto-collapse the current workspace left pane on open/activation. The public name should not expose `left` or `tab`.

### Page props

Use current `PaneProps<LeftTabParams>`.

```ts
function GithubPrTrackerPage(props: PaneProps<LeftTabParams>) {
  const { params, api, containerApi, className } = props
  // regular page
}
```

If a plugin needs to open another panel, use today's `containerApi.addPanel` path. Do not introduce a new `WorkspaceContainerApi` wrapper unless repeated usage proves it is needed.

### Layout guidance

Do not create a mandatory plugin-specific shell.

Plugins should normally render regular page layout:

```tsx
function GithubPrTrackerPage({ className }: PaneProps<LeftTabParams>) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col p-4", className)}>
      <header className="flex items-start justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-lg font-semibold">GitHub PR Tracker</h1>
          <p className="text-sm text-muted-foreground">Track pull requests and review state.</p>
        </div>
        <Button>Refresh</Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto py-4">
        {/* plugin content */}
      </div>
    </div>
  )
}
```

Rules:

```txt
- Plugin pages are ordinary React pages.
- Use existing shadcn/ui-kit/Tailwind primitives.
- Framework does not impose a special layout shell.
- If plugin needs internal side navigation, plugin renders it itself.
- If plugin needs Data Catalog, depend on the first-party data-catalog capability instead of asking shell for a custom side pane.
- If plugin needs file open/reveal behavior, use existing workspace/file commands for now; Filetree is not extracted as plugin dependency in this phase.
```

Optional tiny helpers may be added later only if repeated code justifies them, e.g. `PluginEmptyState` or `PluginErrorState`. Do not start with a broad `PluginPageShell` API.

## Capability ownership

Plugin-level metadata is canonical. Panel-level metadata may be an internal projection/cache for lookup. Panels do not independently decide single-pane vs multi-pane.

```ts
export interface PluginWorkspaceCapability {
  enabled: boolean
  paneMode: "single-pane" | "multi-pane"
  /** Only multi-pane plugins appear in the + picker. */
  pickerTitle?: string
  /** Component/pane opened when user chooses this plugin from +. */
  defaultPaneComponent?: string
  defaultTitle?: string
  defaultParams?: Record<string, unknown>
  icon?: string
}

export interface PluginFrontRegistration {
  id: string
  title: string
  workspaceTab?: PluginWorkspaceCapability
}
```

Panel registry may project capability for fast lookup:

```ts
export interface PanelConfig {
  id: string
  title: string
  component: ComponentType<PaneProps>
  placement?: "left" | "center" | "right"
  workspaceTab?: PluginWorkspaceCapability // projection only
}
```

## Single-pane plugins

```txt
- not listed in + picker
- if opened by command/deep-link, reuse one existing pane
- openPanel with params updates/activates existing pane
```

## Multi-pane plugins

```txt
- listed in + picker
- + opens plugin default pane as new tab instance
- plugin declares defaultPaneComponent/defaultParams/defaultTitle
- if plugin has internal pane/view types, plugin handles that navigation inside its own UI
```

Plugin internal navigation rule:

```txt
shell owns top-level tab/page slot
plugin owns internal side pane/nav/details when it needs them
```

Filetree remains current/built-in behavior for now; do not model it as a plugin dependency in this phase.

## Pane API

Do not fake `DockviewPanelApi` inside plugin-tabs. Use layout-neutral API.

```ts
export interface WorkspacePaneApi {
  id: string
  updateParameters(next: Record<string, unknown>): void
  onDidParametersChange(listener: (event: { params: Record<string, unknown> }) => void): Disposable
  setTitle(title: string): void
  close(): void
  activate(): void
}
```

Adapters:

```txt
classic layout:
  DockviewPanelApi -> WorkspacePaneApi adapter

plugin-tabs layout:
  WorkspaceTabsController -> WorkspacePaneApi adapter
```

Compatibility adapter, if needed, must live in one explicit file:

```txt
legacyDockviewPaneApiAdapter.ts
```

No inline `as unknown as DockviewPanelApi`.

## `openPanel` behavior

```txt
openPanel(existing tab id):
  update params
  activate existing tab

openPanel(single-pane):
  update/activate existing single-pane tab

openPanel(multi-pane):
  if existing tab id supplied, update/activate
  otherwise create new multi-pane instance
```

## Acceptance

```txt
[ ] Plugin-level workspace capability is canonical
[ ] Panel-level workspace capability is projection only
[ ] Single-pane plugins absent from + picker
[ ] Multi-pane plugins appear in + picker
[ ] Multi-pane + entry opens default pane
[ ] Plugin owns internal navigation/side pane
[ ] WorkspacePaneApi is layout-neutral
[ ] No fake Dockview API cast in plugin-tabs code
```

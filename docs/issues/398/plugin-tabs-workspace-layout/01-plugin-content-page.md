# 01 — Plugin Content Page Inside Current Workspace

This is the default plugin page model.

No special "mode" is needed.

Mental model:

```txt
workspace gives plugin a tab/page slot
plugin owns everything inside that slot
```

Current phase-1 workspace shape:

```txt
CURRENT WORKSPACE
┌──────────────────────── shared Dockview / workbench content ────────────────┐
│                                                                              │
│  plugin renders normal React page here                                       │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

A full-page plugin is simply:

```txt
A regular React page rendered as a shared Dockview panel that auto-collapses
the current workspace left pane when opened/activated.
```

It does not need a new page host yet.

It is not:

```txt
- a special framework mode
- an installed plugins catalog
- a marketplace
- a replacement for the whole chat app
- the future app left pane
- the future top-level workspace-tabs system
```

---

## API simplification

Use the existing panel registration path.

New docs should teach this:

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

Do **not** add a separate `registerPluginPage` API for this.

Drop `leftTabs` / `registerLeftTab`. New guidance and implementation should use only:

```txt
panels[] + placement: "workspace-page"
```

This makes the model one thing:

```txt
panel placement decides where it appears
```

`workspace-page` means: show this panel as a full workspace page. In phase 1 implementation, this can be a shared Dockview panel with the current workspace left pane auto-collapsed on open/activation. The public API should not say `left` or `tab`.

---

## Plugin ownership

The plugin owns the page layout.

```tsx
function GithubPrTrackerPage({ className, containerApi }: PaneProps<LeftTabParams>) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col p-4", className)}>
      <header className="flex items-start justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-lg font-semibold">GitHub PR Tracker</h1>
          <p className="text-sm text-muted-foreground">Track pull requests and review state.</p>
        </div>
        <Button>Refresh</Button>
      </header>

      <main className="min-h-0 flex-1 overflow-auto py-4">
        {/* plugin content */}
      </main>
    </div>
  )
}
```

Rules:

```txt
- Plugin page is ordinary React.
- Use existing shadcn/ui-kit/Tailwind.
- Plugin owns internal layout/navigation.
- Shell only provides the full workspace page slot.
- In phase 1, opening/activating this page auto-collapses the current workspace left pane.
- No mandatory PluginPageShell.
- No generic plugin left-pane framework.
```

---

## Agent-openable UI capability

This is part of phase 1.

A plugin content page should be openable/drivable by the agent through a stable UI capability. Use the existing `openSurface` flow: the plugin registers a surface resolver, and the agent calls `exec_ui openSurface` with a domain target.

Mental model:

```txt
plugin page = React UI slot
surface resolver = agent-addressable way to open/focus/select inside that UI
```

Example: Data Catalog owns a page and lets the agent open a series.

```ts
export default definePlugin({
  id: "data-catalog",
  label: "Data Catalog",
  panels: [
    {
      id: "data-catalog.page",
      label: "Data Catalog",
      placement: "workspace-page",
      component: DataCatalogPage,
    },
  ],
  surfaceResolvers: [
    {
      id: "data-catalog.open-entry",
      kind: "data-catalog.entry",
      title: "Open data catalog entry",
      description: "Open the Data Catalog page and select a dataset, table, series, or catalog entry.",
      targetHint: "entry id, e.g. series:GDPC1 or table:orders_daily",
      examples: [{ target: "series:GDPC1", label: "Open GDP series" }],
      resolve(request) {
        return {
          id: "data-catalog.page",
          component: "data-catalog.page",
          title: "Data Catalog",
          params: {
            selectedEntryId: request.target,
            view: typeof request.meta?.view === "string" ? request.meta.view : "detail",
          },
        }
      },
    },
  ],
})
```

Agent call:

```json
{
  "kind": "openSurface",
  "params": {
    "kind": "data-catalog.entry",
    "target": "series:GDPC1",
    "meta": { "view": "detail" }
  }
}
```

The page must handle param updates:

```ts
api.onDidParametersChange((event) => {
  setSelectedEntryId(event.params.selectedEntryId as string | undefined)
})
```

Phase-1 requirement:

```txt
- plugin page can be opened by user command/current workspace affordance
- opening/focusing it auto-collapses the current workspace left pane
- same page can be opened/focused by agent through openSurface
- page can update selection/state from params changes
```

Detailed agent capability rules live in `07-agent-ui-capabilities.md`.

## Opening other panels

If plugin needs to open another workspace panel, use the existing container API path.

```ts
containerApi.addPanel?.({
  id: "github-pr-tracker.detail.123",
  component: "github-pr-tracker.detail",
  title: "PR #123",
  params: { prNumber: 123 },
})
```

Future wrappers can make this nicer, but phase 1 should not invent a new abstraction.

---

## Data Catalog and Filetree

```txt
Data Catalog:
  can become first-party plugin/capability dependency.

Filetree:
  stays current/built-in behavior for now.
  do not extract as plugin dependency yet.
```

---

## Acceptance

```txt
[ ] Plugin page can be registered through panels[] with placement: "workspace-page"
[ ] Opening the plugin page renders it as a full workspace page in the current shared Dockview/workbench content
[ ] Opening/activating the plugin page auto-collapses the current workspace left pane
[ ] Workspace content slot renders the plugin component
[ ] Plugin owns its page layout
[ ] Plugin can register an agent-openable surface resolver for its page
[ ] Agent can call exec_ui openSurface to open/focus/select inside plugin page
[ ] Plugin page handles params changes via api.onDidParametersChange
[ ] No registerPluginPage API is added for phase 1
[ ] No installed plugins catalog/list is introduced in phase 1
[ ] No special plugin page mode/mainMode is introduced in phase 1
[ ] leftTabs/registerLeftTab is removed from public plugin guidance/API
```

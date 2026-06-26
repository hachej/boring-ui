# Pattern: choosing a navigation surface & file visualizers

## Choose how the plugin opens

Plugins have three different navigation surfaces. Pick the one that matches the
user intent; do not register all of them by default.

**Left pane vs main pane rule:** if a plugin has a persistent `leftTabs` entry
and a main workbench panel, create **two separate components**:

- `LeftPane` / sidebar component: compact navigator, filters, summaries, recent
  items, buttons, and quick actions. It lives in the narrow left workbench.
- `MainPane` / center component: full detail view with tables, charts, editors,
  previews, and multi-step workflows.

Do **not** register the same full `MainPane` component as both `panels[].component`
and `leftTabs[].panelId`. That duplicates the center UI in the narrow sidebar and
makes plugins feel broken. Left-pane buttons can open the center pane with
`PaneProps.containerApi.addPanel({ id, component: "<plugin>.panel", title, params })`.

| User intent | Use | Why |
|---|---|---|
| "Give me a command/button to open this tool" | `commands: [{ panelId }]` | Command opens the panel on demand; no permanent sidebar slot. |
| "Add a persistent left-sidebar category/tab" | `leftTabs: [{ panelId }]` | Left tab is always visible navigation for catalogs, dashboards, or always-on tools. It renders the referenced panel. |
| "When I open files matching X, show them in my custom pane" | `surfaceResolvers` with `WORKSPACE_OPEN_PATH_SURFACE_KIND` | File-open routing chooses the right panel by file/path pattern. No sidebar tab needed. |

Rules:

- Do **not** add `leftTabs` just because a plugin has a panel. A left tab is
  permanent sidebar navigation.
- Use `leftTabs` for categories like Data, Charts, Search, Docs, or other
  always-on workspace tools.
- Use a file-pattern `surfaceResolver` for file visualizers/readers/editors
  (`*.csv`, `*.deck.md`, `*.json`, etc.).
- A plugin may have both only when it truly has both jobs: e.g. a Charts sidebar
  dashboard **and** a resolver that opens `*.chart.json` files in a chart pane.

## File visualizer (opens files in your panel)

Use `WORKSPACE_OPEN_PATH_SURFACE_KIND` so the workspace routes file-open
requests through your resolver:

```tsx
import React, { useState, useEffect } from "react"
import { definePlugin, WORKSPACE_OPEN_PATH_SURFACE_KIND, type PaneProps } from "@hachej/boring-workspace/plugin"
import { useApiBaseUrl, useWorkspaceRequestId } from "@hachej/boring-workspace"

function CsvPane({ params }: PaneProps<{ path: string }>) {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceRequestId = useWorkspaceRequestId()
  const [text, setText] = useState("")
  useEffect(() => {
    const base = apiBaseUrl.replace(/\/$/, "")
    const headers: Record<string, string> = {}
    if (workspaceRequestId) headers["x-boring-workspace-id"] = workspaceRequestId
    fetch(`${base}/api/v1/files/raw?path=${encodeURIComponent(params.path)}`, {
      credentials: "include",
      headers,
    })
      .then((r) => r.text())
      .then(setText)
  }, [apiBaseUrl, params.path, workspaceRequestId])
  return <pre>{text}</pre>
}

export default definePlugin({
  id: "csv-viz",
  label: "CSV Viewer",
  panels: [
    { id: "csv-viz.panel", label: "CSV", component: CsvPane },
  ],
  surfaceResolvers: [
    {
      id: "csv-viz.surface",
      kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
      resolve(request) {
        if (!request.target.toLowerCase().endsWith(".csv")) return undefined
        return {
          id: `csv-viz:${request.target}`,
          component: "csv-viz.panel",
          title: request.target.split("/").pop() ?? request.target,
          params: { path: request.target },
          score: 100,
        }
      },
    },
  ],
})
```

Read raw file bytes from `/api/v1/files/raw?path=<workspace-relative-path>`.
Inside panels, build the URL with `useApiBaseUrl()` and pass
`x-boring-workspace-id` from `useWorkspaceRequestId()` when present; CLI
workspaces mode requires that workspace scope. Use the imported
`WORKSPACE_OPEN_PATH_SURFACE_KIND` constant as the resolver `kind` (not the
string `"WORKSPACE_OPEN_PATH_SURFACE_KIND"`), and read the path from
`request.target` (not `request.path`). Do not use `/workspace/read`.
For charts, use plain SVG (`<rect>`, `<line>`, `<polyline>`) — do not add
recharts / chart.js dependencies.

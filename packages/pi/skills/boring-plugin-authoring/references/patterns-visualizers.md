# Pattern: choosing a navigation surface & file visualizers

## Choose how the plugin opens

Plugins have three different navigation surfaces. Pick the one that matches the
user intent; do not register all of them by default.

**Workspace-page vs shared-dockview rule:** if a plugin needs a home/control
surface, register one `workspace-page` and render any navigation/facets/lists
inside that page as normal React. If the plugin produces an artifact/detail/result,
register a separate `shared-dockview` panel for that artifact.

Do **not** ask the shell for a plugin left tab. Plugin-owned side navigation lives
inside the plugin page.

| User intent | Use | Why |
|---|---|---|
| "Give me a full tool/dashboard/browser" | `panels: [{ placement: "workspace-page" }]` | Full plugin page; plugin owns internal layout/navigation. |
| "Open a generated chart/detail/result" | `panels: [{ placement: "shared-dockview" }]` | Shared Dockview artifact/detail panel. |
| "When I open files matching X, show them in my custom pane" | `surfaceResolvers` with `WORKSPACE_OPEN_PATH_SURFACE_KIND` | File-open routing chooses the right panel by file/path pattern. No page required. |

Rules:

- Do **not** add shell left tabs. They are not public plugin API.
- Use `workspace-page` for categories like Data, Charts, Search, Docs, or other
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
    { id: "csv-viz.panel", label: "CSV", placement: "shared-dockview", component: CsvPane },
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

# Pattern: workspace links (open files, surfaces, and panels without routes)

Use `WorkspaceLink` when rows/cards should open workspace targets. It renders an
anchor for normal link affordance, but unmodified left-click dispatches through
`postUiCommand` on the existing frontend command bus. Do **not** add backend
routes or set `window.location` for in-workspace navigation.

```tsx
import React from "react"
import { WorkspaceLink } from "@hachej/boring-workspace"

function Row() {
  return (
    <div>
      <WorkspaceLink to={{ kind: "openFile", path: "README.md" }}>
        Open README
      </WorkspaceLink>

      <WorkspaceLink
        to={{ kind: "openSurface", surfaceKind: "niche", target: "climate-tools" }}
      >
        Open niche detail
      </WorkspaceLink>
    </div>
  )
}
```

Supported targets:

```ts
{ kind: "openFile", path: "README.md" }
{ kind: "openSurface", surfaceKind: "my-surface", target: "record-id", meta?: {...} }
{ kind: "openPanel", id: "my-panel:record-id", component: "my-plugin.panel", title?: "Title", params?: {...} }
{ kind: "expandToFile", path: "src/index.ts" }
```

Important details:

- Prefer `openSurface` for domain records. Register a `surfaceResolver` for the
  same `surfaceKind`; let the resolver choose the panel id/component/params.
- Use `openPanel` only when you already know the registered panel component id.
  It needs both `id` (panel instance id) and `component` (registered panel id).
- Do **not** use `navigateToLine` yet. The current workspace dispatcher accepts
  that command as a no-op, so a helper exposing it would be a false promise.
- `WorkspaceLink` does not replace file visualizers. File visualizers still use
  `surfaceResolvers`; links are just the clickable way to request opens.

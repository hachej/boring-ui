// CANONICAL front/index.tsx for a boring-ui plugin.
// Copy this shape — replace <kebab-name> and <Label> with your values.
// IMPORTANT: the second arg to definePlugin is an IMPERATIVE FACTORY
// `(api) => void`, NOT a declarative object like `{ panels: [...] }`.

import React from "react"
import { definePlugin } from "@hachej/boring-workspace/plugin"

function MyPane() {
  return <div style={{ padding: 16 }}>Hello from &lt;kebab-name&gt;</div>
}

export default definePlugin(
  "<kebab-name>", // MUST match package.json#name (no @scope)
  (api) => {
    api.registerPanel({
      id: "<kebab-name>.panel",
      label: "<Label>",
      component: MyPane,
    })
    api.registerPanelCommand({
      id: "<kebab-name>.open",
      title: "Open <Label>",
      panelId: "<kebab-name>.panel",
    })
    api.registerLeftTab({
      id: "<kebab-name>.tab",
      title: "<Label>",
      panelId: "<kebab-name>.panel",
    })
  },
  { label: "<Label>" },
)

// The ONLY `api` methods that exist:
//   api.registerPanel({ id, label, component })
//   api.registerPanelCommand({ id, title, panelId })
//   api.registerLeftTab({ id, title, panelId })
//   api.registerSurfaceResolver({ id, kind, resolve })
//
// Forbidden — these DO NOT EXIST:
//   api.registerComponent / api.addPanel / api.registerTab
//   createPlugin({...})    — use definePlugin(id, factory, opts)
//   defineFrontPlugin      — removed
//   import from "@hachej/boring-pi"  — that's the skills package, not an import
//   returning { panels: [...] } from the factory

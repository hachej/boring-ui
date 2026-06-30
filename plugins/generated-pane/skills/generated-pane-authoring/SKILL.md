---
name: generated-pane-authoring
description: Create and edit boring.generated-pane JSON specs from predefined safe component catalogs.
---

# Generated Pane Authoring

Use when the user asks for a custom pane, dashboard, report, workflow UI, status view, or other workspace UI composed from predefined components.

Write JSON specs to `panes/*.pane.json` unless a profile/plugin says otherwise.

Required root shape:

```json
{
  "kind": "boring.generated-pane",
  "version": 1,
  "profile": "base",
  "title": "Short title",
  "root": "main",
  "elements": {
    "main": { "type": "Card", "props": { "title": "Overview" }, "children": [] }
  }
}
```

Rules:

- Do not generate React, JavaScript, functions, or inline event handlers.
- Use only components documented by the active profile/catalog.
- Use only props documented for each component.
- Keep element ids stable and descriptive.
- Prefer a simple tree: one root layout, then cards/sections/widgets.
- Actions must reference catalog-approved actions only.

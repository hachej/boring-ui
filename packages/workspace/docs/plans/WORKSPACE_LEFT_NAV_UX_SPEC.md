# Workspace Left Navigation UX Spec

Status: draft from POC.

## Goal

Workspace left navigation is only for workspace/plugin categories. File tree is one category.

```text
┌ rail ┬ content pane ┐
│ ☰    │ Files     🔍 │
│      │              │
│ ▣    │ deck/        │
│ ◇    │ README.md    │
│      │ data.csv     │
└──────┴──────────────┘
```

## Category model

- Each plugin can register workspace categories through left-tab outputs.
- Built-in file tree is just the `Files` category.
- Agent settings, sessions, memory, and tools do not appear here.

```text
workspace categories = files + data + deck + app plugin tabs
agent categories     = chat + sessions + memory + tools + settings
```

## Active state

Active category should visually connect to the content pane as one calm grey surface.

```text
Good:
┌──────┬──────────────┐
│      │              │
│ [▣───┼ Files        │  continuous grey bridge
│      │              │
└──────┴──────────────┘

Bad:
┌──────│──────────────┐
│ [▣] │ Files         │  vertical seam / accent stripe
└──────│──────────────┘
```

Rules:
- No orange/accent marker for active workspace category.
- No side stripe.
- Active icon background and pane background must match.
- Header may repeat the active icon, but in neutral foreground.

## Collapse behavior

Collapsed means the workspace left pane and rail are absent.

```text
Open:
┌ rail ┬ files ┬ editor ┐
│ ☰    │ ...   │ ...    │
└──────┴───────┴────────┘

Collapsed:
┌☰──── editor/workbench ┐
│                       │
└───────────────────────┘
```

- Reopen via stable menu icon near the top-left of the workbench surface.
- Use the same menu icon for collapse and uncollapse unless a later design pass standardizes sidebar arrows.
- Do not keep a thin category rail visible in collapsed mode.

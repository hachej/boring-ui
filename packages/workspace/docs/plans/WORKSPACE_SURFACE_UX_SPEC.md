# Workspace Surface UX Spec

Status: draft from POC.

## Goal

The right workspace surface is where files, artifacts, decks, and plugin panels open. It is separate from agent-side controls.

```text
┌ chat stage ┬ workspace surface ┐
│            │ ┌ left nav ┬ pane │
│            │ │ Files    │ ...  │
│            │ └──────────┴──────┘
└────────────┴───────────────────┘
```

## Open / collapsed states

```text
Surface open, left pane open
┌────────────────────────────────────┐
│ ☰ Files                     search │
│ deck/                              │
│ README.md                          │
├────────────────────────────────────┤
│ editor / artifact / empty state    │
└────────────────────────────────────┘

Surface open, left pane collapsed
┌☰───────────────────────────────────┐
│ editor / artifact / empty state    │
└────────────────────────────────────┘
```

## Empty state

- Empty state should teach the surface without duplicating controls.
- Do not show a second “show workspace menu” CTA when the stable menu icon exists.
- Empty labels use neutral border/foreground, not accent line.

```text
Workbench
Nothing open yet
Open a source item, or let the agent produce an artifact here.
```

## DockView chrome

- Workspace DockView tabs use neutral active state.
- Remove accent pseudo-elements from active tabs.
- Drag/drop/resize hover may use subtle neutral feedback; avoid orange unless the action is truly semantic.

## Surface resolver flow

```text
agent emits UI command
  → workspace bridge
  → surface resolver
  → open panel/editor in workspace surface
```

## Success criteria

- Workspace surface never feels like agent settings.
- Collapsed left pane leaves a clean work area and one obvious reopen control.
- Active workspace category and content pane read as connected.

# Runtime Plugin Workspace Link Plan

## Problem

Runtime plugin rows/cards need to open workspace files, panels, or surfaces without registering
routes or doing browser navigation.

## Goal

Provide a tiny front helper that renders like a link but dispatches through existing workspace UI
effects.

## Non-goals

- No backend routes.
- No deep-link persistence work.
- No data access work.

## Contract

```ts
type NavEffect =
  | { kind: "openFile"; path: string }
  | { kind: "openSurface"; surface: string; target: string; meta?: Record<string, unknown> }
  | { kind: "openPanel"; panelId: string; params?: Record<string, unknown> }
  | { kind: "navigateToLine"; path: string; line: number }

declare function WorkspaceLink(props: {
  to: NavEffect
  children: React.ReactNode
  className?: string
}): JSX.Element
```

Behavior:

- Renders an `<a>` so hover/copy feel normal.
- Left click prevents default and dispatches through existing `emitUiEffect` / `postUiCommand`.
- Copy link should produce a stable workspace URL or encoded command URL if existing helpers allow it.
- No route is registered by the plugin.

## Tasks

- **L1.** Add `WorkspaceLink` in the workspace front package.
- **L2.** Add tests for each effect kind.
- **L3.** Use it in `niche-explorer` rows/detail links.

## Acceptance

- Open-file link opens/focuses a file.
- Open-surface link resolves through registered surface resolvers.
- Open-panel link opens/focuses a panel.
- Navigate-to-line link opens file at line.
- No plugin backend route is added.
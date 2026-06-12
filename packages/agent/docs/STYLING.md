# STYLING

Styling contract for `@hachej/boring-agent` frontend surfaces.

## Package CSS

Consumers import the precompiled package stylesheet once, after host/workspace
base CSS and before app overrides:

```ts
import "@hachej/boring-workspace/globals.css"
import "@hachej/boring-agent/front/styles.css"
import "./app.css"
```

The published `@hachej/boring-agent/front/styles.css` is consumer-safe: it contains no
Tailwind `@source`, no Tailwind imports, and no repo-relative source paths.

## Public selectors

Agent surfaces expose a package namespace root and stable part attributes:

```css
[data-boring-agent] {}
[data-boring-agent-part="chat"] {}
[data-boring-agent-part="composer"] {}
[data-boring-agent-part="tool-card"] {}
[data-boring-agent-message-role="assistant"] {}
[data-boring-state="selected"] {}
```

`data-boring-agent-*` is the public selector namespace for agent UI. Workspace
uses `data-boring-workspace-*`; do not style agent internals through workspace
selectors.

## Token contract

Workspace owns the public visual tokens (`--boring-*`). Agent consumes those
host tokens and provides standalone fallbacks under `[data-boring-agent]`.

Common tokens:

- `--boring-background`
- `--boring-foreground`
- `--boring-card`
- `--boring-muted`
- `--boring-muted-foreground`
- `--boring-accent`
- `--boring-border`
- `--boring-radius`
- `--boring-font-sans`
- `--boring-font-mono`

Example app override:

```css
[data-boring-agent-part="composer"] {
  --boring-accent: oklch(0.64 0.18 250);
}

[data-boring-agent-message-role="assistant"] {
  --boring-card: oklch(0.98 0.01 250);
}
```

## Invariants

- Keep reusable primitives driven by semantic CSS variables and public data
  attributes, not package-internal DOM structure.
- Keep styling decisions out of `src/shared/**` and server runtime modules.
- Published package CSS must remain precompiled and consumer-safe.

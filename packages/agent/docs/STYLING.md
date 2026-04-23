# STYLING

Styling contract for `@boring/agent` frontend surfaces.

## Current Status

Default token values live in `src/front/styles/theme.css` and are scoped to
`[data-boring-chat]` so each `ChatPanel` instance can be themed independently.
Package consumers should import the bundled stylesheet once:

```ts
import '@boring/agent/theme.css'
```

## Invariants Enforced Today

The invariant checker (`scripts/check-invariants.sh`) enforces:

- No hard-coded Tailwind color utilities under `src/front/primitives/**`.
- Frontend code cannot import server runtime internals.

This keeps frontend primitives re-themeable and transport-agnostic.

## CSS Variable Theme Contract

Use CSS custom properties for semantic colors in primitives. Example pattern:

```tsx
<div className="bg-[var(--boring-chat-bg)] text-[var(--boring-chat-fg)]" />
```

Recommended variable names:

- `--boring-chat-bg`
- `--boring-chat-fg`
- `--boring-chat-muted`
- `--boring-chat-accent`
- `--boring-chat-border`

The complete token reference lives in `src/front/styles/theme.css`.

## Scoped Theming

Use parent-specific selectors that target each panel root:

```css
.panelA [data-boring-chat] {
  --boring-chat-tool-border: #ff007a;
  --boring-chat-tool-running: #ff007a;
}

.panelB [data-boring-chat] {
  --boring-chat-tool-border: #00c2ff;
  --boring-chat-tool-running: #00c2ff;
}
```

## Guidance

- Keep reusable primitives driven by semantic CSS vars, not concrete palette
  tokens.
- Keep styling decisions out of `src/shared/**` and server runtime modules.
- Treat this file as the normative theme contract for embedding apps.

# STYLING

Styling contract for `@boring/agent` frontend surfaces.

## Current Status

The full chat primitive system is still in progress. This file defines the
intended contract and the guardrails already enforced in CI.

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

As the primitive set lands, this list will be expanded into the full reference
table from the M3/M5 styling beads.

## Scoped Theming

Theme variables should be overridable at any parent boundary so app shells can
scope themes per panel:

```tsx
<section
  style={
    {
      '--boring-chat-bg': '#0b1220',
      '--boring-chat-fg': '#e5e7eb',
      '--boring-chat-accent': '#22d3ee',
    } as React.CSSProperties
  }
>
  {/* ChatPanel subtree */}
</section>
```

## Guidance

- Keep reusable primitives driven by semantic CSS vars, not concrete palette
  tokens.
- Keep styling decisions out of `src/shared/**` and server runtime modules.
- Treat this file as the normative theme contract for embedding apps.

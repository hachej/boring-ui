# Tailwind v4 Style Isolation: @boring/agent vs @boring/workspace

Research for boring-ui-v2-qs8. Investigates whether Tailwind v4 usage in
`@boring/agent/ui-shadcn` conflicts with `@boring/workspace` styles when both
are loaded in the same consumer app.

## Summary

**Three conflicts exist; two are contained by current architecture, one requires
a documented constraint.**

| # | Conflict | Severity | Current status |
|---|----------|----------|----------------|
| 1 | CSS variable collision at `:root` | HIGH | Mitigated by separate CSS entry points |
| 2 | Double `@layer base` reset | MEDIUM | Mitigated: agent globals.css has no `@layer base` |
| 3 | Utility class identity collision | LOW | Same Tailwind v4; no prefix divergence |

## Conflict 1: CSS Variable Collision at `:root`

Both packages define the same 24 shadcn token names (`--background`, `--primary`,
`--border`, etc.) at `:root` scope but with **incompatible value formats**:

- **workspace** (`globals.css`): oklch values, e.g. `--background: oklch(1 0 0);`
- **agent/ui-shadcn** (`styles.css`): raw HSL values, e.g. `--background: 0 0% 100%;`

If a consumer imports both files, the last `:root` block wins. Utilities like
`bg-background` resolve to the wrong format in whichever package loaded first.

### Why it doesn't bite us today

The two CSS files serve different roles:

- `@boring/workspace/globals.css` is a full Tailwind entry point (`@import "tailwindcss"` + `@theme inline` + `@layer base`). It defines the workspace's design tokens.
- `@boring/agent/ui-shadcn/styles.css` is a **standalone CSS variable sheet** with no Tailwind directives. Consumers import it *instead of* the workspace globals when building a standalone chat app.

The workspace-playground app imports only workspace globals; it does not import
agent/ui-shadcn/styles.css. The agent's bare primitives (`@boring/agent/theme.css`)
use `[data-boring-chat]`-scoped variables (`--boring-chat-*`) that never collide.

### Constraint

> **Do not import both `@boring/workspace/globals.css` and
> `@boring/agent/ui-shadcn/styles.css` in the same document.**
> They define the same CSS custom properties with incompatible value formats.
> Choose one as the design-token source; the other package's components will
> inherit from it.

## Conflict 2: Double Preflight / `@layer base`

Workspace globals.css declares:

```css
@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground; }
}
```

Agent's ui-shadcn/styles.css has **no** `@layer base` and **no** `@import "tailwindcss"`.
The agent's bare theme.css is scoped to `[data-boring-chat]` and doesn't use
`@layer` at all.

**Result:** No double-reset today. If a future change adds `@import "tailwindcss"`
to the agent's CSS, this becomes a problem (two preflight injections).

### Constraint

> **Only one package should `@import "tailwindcss"` per document.** The agent
> package must never add its own `@import "tailwindcss"` to shipped CSS; it
> relies on the consumer's Tailwind setup.

## Conflict 3: Utility Class Identity

Both packages use the same Tailwind v4 utility classes (`bg-background`,
`text-foreground`, `border-border`, etc.). Since both consume the same Tailwind
version and neither applies a prefix, class names are identical.

**This is safe** when Conflict 1 is avoided (single set of `:root` variables).
Identical class names resolving against a single variable source produce
consistent styles.

If prefixing is ever needed (e.g., embedding agent UI in a non-Tailwind host),
the agent's `[data-boring-chat]` scoped primitives are already prefix-free.
The shadcn components would need a Tailwind `prefix` config.

## Architecture: Two Isolation Tiers

### Tier 1 — Bare primitives (`@boring/agent` default export)

- Styles in `theme.css`, all scoped to `[data-boring-chat]` attribute selector
- Variables namespaced: `--boring-chat-bg`, `--boring-chat-fg`, etc.
- **Zero collision risk** with any host framework

### Tier 2 — shadcn components (`@boring/agent/ui-shadcn`)

- Relies on standard shadcn CSS variables (`--background`, `--primary`, etc.)
- Designed for apps that already use shadcn/ui or Tailwind v4
- **Shares variable namespace** with workspace package by design
- Requires the "one globals.css" constraint above

## Test Coverage

`packages/agent/src/__tests__/tailwind-style-conflict.test.ts` verifies:
- The 24 overlapping variable names are documented
- Value format mismatch (oklch vs HSL) is detected
- Agent's bare theme.css uses only `--boring-chat-*` (no collisions)
- Agent's ui-shadcn/styles.css contains no `@import "tailwindcss"`

## Recommendations

1. **No action needed for current architecture.** The separation between
   workspace globals and agent ui-shadcn styles is clean.

2. **Guard the constraint** via the test file. If someone adds
   `@import "tailwindcss"` to the agent's shipped CSS, the test fails.

3. **Future consideration:** If we need both packages' globals in the same
   document, migrate agent/ui-shadcn to oklch format to match workspace.
   This is a one-time mechanical change (~24 values).

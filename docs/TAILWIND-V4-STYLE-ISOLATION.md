# Tailwind v4 Style Isolation: @hachej/boring-agent vs @hachej/boring-workspace

How Tailwind v4 styling is shared between `@hachej/boring-agent` and
`@hachej/boring-workspace` when both load in the same consumer app.

> **History:** This doc began as research for `boring-ui-v2-qs8`, which found a
> potential `:root` token collision (workspace used oklch, agent shipped raw HSL
> at `:root`, and importing both was unsafe). That collision has since been
> **resolved** by moving to the token-bridge model described below. The current
> contract is enforced by `packages/agent/src/__tests__/tailwind-style-conflict.test.ts`.

## Current model: workspace owns tokens, agent inherits them

The two packages are now **designed to be imported together**, in order:

```css
@import "@hachej/boring-workspace/globals.css";
@import "@hachej/boring-agent/front/styles.css";
@import "./app.css"; /* optional app overrides */
```

### Workspace owns the public token set at `:root`

`packages/workspace/src/globals.css` is the single Tailwind entry point. It:

- `@import "tailwindcss"` (with `source(none)`) and `@import "@hachej/boring-ui-kit/styles.css"`
- defines the public `--boring-*` design tokens at `:root` (and `.dark`), in **oklch**, e.g. `--boring-background: oklch(0.995 0.0015 72);`
- bridges those public tokens to the internal shadcn aliases, e.g. `--background: var(--boring-background);`
- owns the `@layer base` reset (`* { border-border }`, `body { bg-background text-foreground }`)

### Agent consumes host tokens, scoped to `[data-boring-agent]`

`packages/agent/src/front/styles/globals.css`:

- defines **no** `:root` tokens (verified by test)
- under `[data-boring-agent]`, re-binds shadcn aliases to the host's public tokens with package-default fallbacks, e.g. `--background: var(--boring-background, oklch(0.995 0.0015 72));`
- defines its own component-level tokens namespaced `--boring-agent-*` (font, spacing, message/tool styling), each with a package default
- contains **no** `@import "tailwindcss"`, no `tailwindcss/preflight.css`, and **no** `@layer base` — it relies on the consumer's Tailwind setup and the workspace reset
- handles dark mode via `.dark [data-boring-agent]`, inheriting workspace's `.dark` token values

The net effect: the agent pane and the shell it embeds into share one visual
language. The agent can still render standalone (its fallbacks apply when no host
`--boring-*` tokens are present).

## Why there is no longer a collision

- **One `:root` owner.** Only workspace defines `--boring-*` at `:root`; the agent
  never writes `:root`, so there is no last-writer-wins conflict.
- **One token format.** Both packages use oklch. The old oklch-vs-HSL mismatch is gone.
- **One Tailwind entry / one preflight.** Only workspace imports Tailwind and owns
  `@layer base`. The agent must never add its own `@import "tailwindcss"` to shipped CSS.
- **Scoped component tokens.** `--boring-agent-*` are namespaced and never collide.

## Invariants (enforced by the test)

`packages/agent/src/__tests__/tailwind-style-conflict.test.ts` asserts:

- workspace owns the public `--boring-*` base tokens at `:root` and bridges them to shadcn aliases
- agent consumes host `--boring-*` tokens under `[data-boring-agent]` and defines no `:root` tokens
- agent source CSS omits Tailwind preflight / `@layer base` / `@import "tailwindcss"`
- workspace keeps reset/base-layer ownership
- dark mode is tokenized by workspace and inherited by agent (`.dark [data-boring-agent]`)
- every `--boring-agent-*` token consumed in agent source has a package default
- child apps do not `@source` package `src/` CSS (no scanning `packages/{agent,workspace}/src`)

## Debug checklist

If styles look wrong or tokens leak:

1. Check import order first: workspace globals → agent styles → app overrides.
2. Inspect `packages/workspace/src/globals.css`: workspace should be the only `:root` owner of public `--boring-*` tokens and Tailwind base reset.
3. Inspect `packages/agent/src/front/styles/globals.css`: agent should scope token bindings under `[data-boring-agent]`, define no `:root`, and import no Tailwind/preflight/base layer.
4. Apply app overrides through public `--boring-*` or `--boring-agent-*` tokens, not package-internal DOM selectors.
5. If this regresses, check `packages/agent/src/__tests__/tailwind-style-conflict.test.ts`.

## Constraints to keep

> **The agent package must never `@import "tailwindcss"` (or a preflight) in shipped CSS.**
> It relies on the consumer's Tailwind setup and the workspace base layer.

> **Do not move public token ownership out of workspace.** The `--boring-*` set is
> defined once, at `:root`, in `@hachej/boring-workspace/globals.css`. Other packages
> consume it; they do not redefine it.

> **Override theme by setting `--boring-*` (and `--boring-agent-*`) tokens**, not by
> editing package source CSS.

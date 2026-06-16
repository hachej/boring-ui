# Plan: ship the chat-first public-shell styling from `packages/core`

## Problem
`packages/core`'s `ChatFirstPublicShell` renders the public no-auth shell — the
teaching arrows, the bottom-left sign-in `<aside>`, the empty-state hero, the
suggestion grid, and the composer — but ships **no CSS** for any of it. All the
polish lives in `apps/full-app/src/front/app.css`. Any other consumer (e.g. a
`boring macro` child app from `boring-app-setup`) mounting the same shell gets an
**unstyled** landing and would have to copy-paste that CSS.

## Goal
Move the generic, brand-agnostic public-shell rules into a core stylesheet that
ships with the shell, so every consumer inherits a styled landing. Apps customize
only via design tokens (`--accent`, …) and the existing `chatFirstPublicShell`
props (copy, `models`, suggestions). No behavior/visual change for full-app.

## Mechanism
Core aggregates CSS in `packages/core/src/app/front/styles.css` (the Tailwind-v4
entry every app imports via `@hachej/boring-core/app/front/styles.css`). It
`@import`s `theme.css` + workspace/agent globals; the build `cp`s those into
`dist`; the **consumer's** Vite/Tailwind processes them. We add a co-located
shell stylesheet and `@import` it from `styles.css` — so it flows through the
exact path apps already consume, with no new import line in any app.

## Changes
1. **New** `packages/core/src/app/front/chatFirst/chatFirstPublicShell.css` —
   the generic rules (currently `apps/full-app/src/front/app.css` lines 9–268):
   - `.public-chat-first-shell` radial hero glow
   - `.public-arrow*` (positioning, paw-stroke, labels, `@media (max-width:1100px)`
     hide, and the `:has(model-picker-menu) → hide arrow + aside` rule)
   - `.public-chat-first-shell > aside` responsive hide
   - `.dv-chat-stage .dv-tabs-and-actions-container { display:none }`
   - `[data-boring-workspace-part="workbench"] { z-index }`
   - hero/empty-state: `[data-boring-agent-part="empty-state"]` h3/p sizing,
     accent closing-period, top-bias padding, suggestion-grid ordering + card
     styling, accent send button, the `.public-hero-foot/providers/dot/github/
     trust` footer layout
2. **`packages/core/src/app/front/styles.css`** — append
   `@import "./chatFirst/chatFirstPublicShell.css";` **at the end** (after
   `@import "tailwindcss"`) so plain rules keep winning over Tailwind utilities
   (same cascade position they hold today as app.css-loaded-last).
3. **`packages/core` build script** — copy the new file into `dist` so the
   consumer's `@import` resolves:
   `mkdir -p dist/app/front/chatFirst && cp src/app/front/chatFirst/chatFirstPublicShell.css dist/app/front/chatFirst/`
4. **`apps/full-app/src/front/app.css`** — delete lines 9–268. Keep the
   `html,body,#root` reset (1–7) and the Seneca-specific PublicLaunchPages tab
   styling (`.public-pages-pane`, `.artifact-*`, `.calendly-*`,
   `.public-html-preview`, `.public-workspace-tab`, lines 270–549).

## Stays in the app
Content via `chatFirstPublicShell` props (copy, `models`, suggestions), the
`--accent` token value, logo/favicon, `PublicLaunchPages` + its tab CSS, credits
wiring.

## Verification
1. `pnpm --filter @hachej/boring-core build` → assert
   `dist/app/front/chatFirst/chatFirstPublicShell.css` exists.
2. Build/run full-app; Playwright before/after screenshots of the landing
   (menu closed + open; 1280×800 and <1100px) — must be visually identical
   (pure relocation, no behavior change).
3. Grep: no `.public-arrow` / `.public-hero` / `.public-chat-first-shell` rules
   remain in `apps/full-app/app.css`.

## Risks & mitigations
- **Cascade order** → `@import` at the end of `styles.css` (matches today).
- **Missing build copy** → the screenshot diff + an existence assert catch it.
- **Opinionated defaults** (cards-above-composer order, one-line footer) ship as
  overridable core defaults.

## PR
Single PR `refactor(core): ship chat-first public-shell styling from core`,
branch off `main`. Pure relocation, verified by identical screenshots.

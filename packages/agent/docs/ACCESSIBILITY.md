# Accessibility Audit

This document tracks accessibility status for `@boring/agent` UI surfaces.

## Scope (boring-ui-v2-cop)

- `packages/agent/src/front/ChatPanel.tsx`
- `packages/agent/src/front-shadcn/ChatPanel.tsx`
- `packages/agent/src/front-shadcn/primitives/*` (chat primitives)
- CI browser check for the default agent app (`packages/agent/app`)

## Current Coverage

### Landmarks and live regions

- ChatPanel roots now expose `role="region"` with
  `aria-label="Agent assistant"` in both front variants.
- Message streams expose `role="log"` and `aria-live="polite"` as
  `aria-label="Agent conversation"`.
- Error states are announced with `role="alert"` in both variants.

### Interactive control names

- Icon-only conversation controls expose explicit names:
  - `Scroll to latest message`
  - `Download conversation`

### Automated checks

- Unit checks:
  - `src/front/__tests__/ChatPanel.test.tsx`
  - `src/front-shadcn/__tests__/ChatPanel.test.tsx`
- Browser axe check:
  - `packages/agent/e2e/a11y.spec.ts`
  - Fails on any **serious** or **critical** violation inside
    `[data-boring-chat]`.

This runs in CI automatically through the existing `pnpm e2e` job.

## Known Gaps

1. Storybook a11y pipeline is not present yet.
   There is no `.storybook` config, no `@storybook/addon-a11y`, and no
   story-level axe scan.
2. Current automated axe gate targets the shipped chat surface only.
   Workspace pane-level a11y checks (file tree, editor panes, dock tabs) are
   outside this package and need dedicated coverage in `@boring/workspace`.
3. Manual screen-reader validation (VoiceOver/NVDA) is still pending.

## Next Increment

1. Stand up Storybook for `@boring/agent` primitives.
2. Enable addon-a11y and add story-level CI checks.
3. Extend browser axe checks to `workspace-playground` once pane a11y owners
   land stable selectors/landmarks.

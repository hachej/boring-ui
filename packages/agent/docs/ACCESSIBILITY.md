# Accessibility Audit

This document tracks accessibility status for `@hachej/boring-agent` UI surfaces.

## Scope

- `packages/agent/src/front/chat/PiChatPanel.tsx` (the `ChatPanel` export)
- `packages/agent/src/front/primitives/*` (chat primitives)
- CI browser check via the `apps/agent-playground` dev frontend

## Current Coverage

### Landmarks and live regions

- The ChatPanel root exposes `role="region"` with
  `aria-label="Agent assistant"`.
- Message streams expose `role="log"` and `aria-live="polite"` as
  `aria-label="Agent conversation"`.
- Error states are announced with `role="alert"`.

### Interactive control names

- Icon-only conversation controls expose explicit names:
  - `Scroll to latest message`
  - `Download conversation`

### Automated checks

- Unit checks:
  - `src/front/chat/__tests__/PiChatPanel.test.tsx`
- Browser axe check:
  - `packages/agent/e2e/a11y.spec.ts`
  - Fails on any **serious** or **critical** violation inside
    `[data-boring-agent]`.

This runs in CI automatically through the existing `pnpm e2e` job.

## Known Gaps

1. A registered agent-component UI-review spec is not present yet, so there is
   no fixture-level axe scan for agent primitives.
2. Current automated axe gate targets the shipped chat surface only.
   Workspace pane-level a11y checks (file tree, editor panes, dock tabs) are
   outside this package and need dedicated coverage in `@hachej/boring-workspace`.
3. Manual screen-reader validation (VoiceOver/NVDA) is still pending.

## Next Increment

1. Register deterministic agent-primitive checkpoints in `tools/ui-review`.
2. Add fixture-level axe hard gates to that registered spec.
3. Extend browser axe checks to `workspace-playground` once pane a11y owners
   land stable selectors/landmarks.

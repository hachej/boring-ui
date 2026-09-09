---
github: https://github.com/hachej/boring-ui/issues/1234
issue: 1234
state: ready-for-human
updated: 2026-08-12
flag: not-needed
track: owner
---

# gh-1234 ChatLayout drawer modal accessibility

## Problem

The issue reports that the `packages/workspace` ChatLayout session and workbench-left drawers are visually overlaid but do not reliably provide the modal-dialog contract keyboard and screen-reader users need. Without that contract, focus can escape into obscured content, Escape may not dismiss the active drawer, focus may be lost after dismissal, and the page can scroll behind the overlay.

### Today

Current `main` has moved since the issue observation: `ChatLayout.tsx` already contains dialog attributes, a local focus-trap hook, Escape shortcut wiring, focus restoration, body scroll locking, and one shallow semantics test, apparently introduced by PR #1173. The present proof does **not** explicitly cover the complete user contract for both drawers. In particular, it does not demonstrate initial focus, forward/reverse focus wrapping, per-drawer Escape closure, restoration to the invoking control, or body overflow restoration.

### Delta

Treat gh-1234 as a focused reconciliation and regression-hardening fix, not a visual redesign: verify the existing behavior against the complete acceptance contract, correct only deficiencies found in the two scoped ChatLayout files, and add focused tests that prevent each accessibility behavior from regressing.

## Solution

Keep the existing persistently mounted drawer structure and lightweight, Radix-free behavior. For each open drawer:

1. expose a stable accessible name with `role="dialog"` and `aria-modal="true"`;
2. move focus to the first usable control (or the drawer fallback) on open;
3. wrap Tab and Shift+Tab within the active drawer;
4. close the active drawer on Escape through the existing host callbacks;
5. restore focus to the element that invoked the drawer when it closes; and
6. lock `document.body` scrolling while either modal drawer is open, restoring the prior overflow value only after no drawer remains open.

The worker must first reconcile these requirements with current `main`; existing correct code stays intact.

## Decisions

- **Retain the local ChatLayout behavior instead of introducing a dialog dependency.** The drawers are persistently mounted and width-animated; the existing local hook is the narrowest seam.
- **Test at the public `ChatLayout` seam.** User-observable DOM, keyboard, callbacks, focus, and body styles are the contract; private hooks are implementation detail.
- **Cover both drawers.** Session and workbench-left drawers have separate callbacks and can diverge despite sharing mechanics.
- **No visual changes.** This issue is semantic and behavioral only.
- **Reconcile rather than duplicate.** Current `main` already contains a partial implementation from PR #1173; the slice closes verified gaps and strengthens proof.

## Flag / Abstraction

- Needed?: No. This restores expected accessibility behavior in an existing component without a rollout or data transition.
- Path: Direct correction in `ChatLayout` and focused public-seam tests.
- Rollback: Revert the single implementation commit/PR; no persisted data or API migration is involved.

## Test Seams

- Highest public seam: Render `ChatLayout` with registered session/workbench panels and host open/close callbacks, then drive controls and keyboard events through Testing Library.
- Existing prior art: `packages/workspace/src/front/layout/__tests__/presets.test.tsx`, including the existing dialog-semantics assertion and ChatLayout keyboard tests; `ChatLayout.tsx` already has `useDrawerFocusTrap` and `useBodyScrollLock`.
- Avoid testing: Private hook internals, Tailwind class strings, transition timing, browser paint, and implementation-specific listener counts.

## Acceptance

- When the session drawer is open, it has a stable accessible name, `role="dialog"`, and `aria-modal="true"`; equivalent behavior holds for the workbench-left drawer.
- Opening either drawer moves focus inside it.
- Tab from the last focusable element wraps to the first, and Shift+Tab from the first wraps to the last, without focus entering obscured content.
- Escape closes the active session drawer through `navParams.onClose`; Escape closes the active workbench-left drawer through `sidebarParams.onClose`.
- Closing either drawer restores focus to the still-connected element that opened it.
- While either drawer is open, `document.body.style.overflow` is `hidden`; the previous value is restored only after all modal drawers are closed/unmounted.
- Existing drawer sizing, animation, scrims, host callbacks, and visuals remain unchanged.
- Focused tests and package typechecking pass.

## Proof

- Exact command: `pnpm --filter @hachej/boring-workspace test -- src/front/layout/__tests__/presets.test.tsx`
- Exact command: `pnpm --filter @hachej/boring-workspace typecheck`
- Tests that prove it: focused cases in `packages/workspace/src/front/layout/__tests__/presets.test.tsx` must assert dialog name/modal state, initial focus, Tab and Shift+Tab wrapping, Escape callback behavior for each drawer, focus restoration, and body overflow lock/restoration.
- Screenshot/demo: Not required for this non-visual behavior; automated DOM/focus/keyboard assertions are stronger evidence.
- Manual steps: In a ChatLayout host, open Sessions and then Workbench left panel using their visible controls; confirm focus enters each drawer, repeated Tab/Shift+Tab cannot leave it, Escape closes it and returns focus to its opener, and the background does not scroll while open.
- Waiver if proof is not possible: None.

## Slices

### Slice: Reconcile and prove ChatLayout drawer modal behavior

**Bead:** wt-391-forward-ktwq  
**Delivers:** Complete, regression-tested modal semantics and keyboard/focus/scroll behavior for both ChatLayout drawers, preserving current visuals and existing correct behavior.  
**Blocked by:** None.  
**Proof:** `pnpm --filter @hachej/boring-workspace test -- src/front/layout/__tests__/presets.test.tsx` and `pnpm --filter @hachej/boring-workspace typecheck`; focused assertions enumerate every acceptance behavior above.  
**Review budget:** Inside — one component and one existing test file, no API or visual redesign, fits one worker session.

## Out of Scope

- Workbench surface/activity-rail behavior outside the workbench-left drawer.
- A new shared dialog primitive or third-party dialog/focus-management dependency.
- Visual styling, drawer dimensions, animations, or responsive redesign.
- Inerting or restructuring unrelated page content beyond what is necessary to satisfy the specified modal focus contract.
- Accessibility changes outside `packages/workspace` ChatLayout drawers.

## Adversarial Review

- Reviewer: Gemini 2.5 Pro (cross-model review; Anthropic/Opus was unavailable because the provider had no API key).
- Target: 2026-08-12 draft of this plan and bead `wt-391-forward-ktwq`.
- Verdict: revise.
- Disposition: The useful concern—existing proof is incomplete—is already made explicit in Today/Delta, Acceptance, Proof, and the bead. The review's two claimed blockers were not accepted: `git status --short` shows only this new issue-plan directory, not 1,000 unrelated changes, and the accessibility code identified by the reviewer is committed current-main history from PR #1173 rather than implementation performed during this planning stage. No implementation was started here.
- Graph checks: `br dep cycles --json` reports zero cycles; `bv --robot-insights` recognizes the bead as an independent zero-core-number node with no dependency intervention needed.

## Open Questions

- None for owner intent. The issue defines the required behavior and current-main reconciliation is bounded by the acceptance tests.

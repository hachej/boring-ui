# Issue #473 thermo review — plan

Date: 2026-07-01
Target: `docs/issues/473/plan.md`
Reviewer: Pi self-review after process correction

## Status

Initial plan: **changes required**.
Amended plan: **approved for implementation** after the required fixes below were folded into `docs/issues/473/plan.md`.

## Required findings

1. **Public API boundary was too vague.**
   The first plan said to export the hook/types from `packages/workspace/src/index.ts` but did not pin the public naming, minimum contract, or what must remain internal. For a public composition seam, that is not enough: implementers could leak `WorkbenchLeftPane` internals, private store state, or cast-heavy shapes.

2. **The host-integration story was under-specified.**
   The issue asks to integrate the left-pane buttons into an existing host explorer. A hook that only helps `WorkbenchLeftPane` re-render itself is not sufficient if the host still has to mount a duplicate full left pane. The plan needs an explicit acceptance test where the full default rail is not rendered and the host owns the button placement.

3. **Search/content/chrome-actions ownership needed a sharper boundary.**
   The first plan said search and `chromeActionsElement` stay in the full pane, but it did not state that the hook must avoid exposing those internals. This could produce a bloated controller hook that becomes a dumping ground for layout state.

4. **Regression and file-size guardrails were missing.**
   Reworking `WorkbenchLeftPane.tsx` can easily become spaghetti if the hook is added without deleting logic from the component. The plan needs explicit constraints: the default component should get smaller or stay comparable, the model must live in a focused module, and no broad provider/store export is allowed.

## Approval bar for implementation

Implementation may proceed only if it follows the amended plan:

- public seam is hook-first and named around workspace left-pane actions, not generic private workbench internals;
- default pane composes the hook and preserves existing behavior;
- host explorer test renders the action buttons without rendering the full `WorkbenchLeftPane` rail;
- no `useWorkspaceStore` export, no shared package node imports, no public exposure of `chromeActionsElement`/search internals;
- proof includes focused tests and typecheck.

## Follow-up verification loop

A second strict review pass was run after amendment.

Result: **CLEAN**

No remaining blocking feedback on plan quality/process readiness. The amended plan now satisfies:

- narrow public API seam;
- host integration proof without duplicate chrome;
- private search/chrome/layout state excluded from hook scope;
- focused module and no parallel state machine/sprawl guardrails;
- focused tests plus typecheck proof path.

# 03c — Multi-Project Auth/Error Transitions

## Purpose

Make failed target workspace transitions behave like content-pane errors while preserving the persistent project nav and current cached workspace state.

Depends on:

- 03a persistent shell;
- 03b cache if cache is enabled.

## Review budget

Target non-test/non-doc added LOC: **< 1,500**.
Hard cap for PR review: **< 15,000** non-test/non-doc added LOC.

## Scope

- Handle target route statuses:
  - `not-found`
  - `forbidden`
  - `switch-failed`
  - `mismatched`
  - `loading`
- Keep nav mounted for all multi-project transition states.
- Do not evict current visible workspace just because a different target failed.
- Show target error as a content-pane/route error state that can be dismissed or corrected by choosing another project.

## Non-scope

- Generic auth redesign.
- Cross-project skills/plugins auth.
- Runtime preboot errors (04c/04d).

## Tests / acceptance

With A visible/cached:

- navigate/open B and simulate `forbidden`:
  - nav remains mounted;
  - A remains in cache;
  - visible content policy is deterministic (A remains visible with an error banner, or content pane shows B error while nav remains — choose and test one);
  - B is not cached as a successful mounted workspace.
- Repeat for `not-found` and `switch-failed`.
- For `loading`: nav remains mounted, A remains cached, and pending content policy is shown without page takeover.
- For `mismatched`: nav remains mounted, A remains cached, and route-faithful pending/error policy is shown until matched or failed.
- B is cached only after a successful matched route, never from failed/pending states.
- Back/choose A returns cleanly without full reload.

## Chosen error behavior

Use route-faithful content-pane errors while keeping the persistent shell/nav mounted. If project B fails with `forbidden`, `not-found`, or `switch-failed`, the content area shows B's error state, but the multi-project nav remains available and the last successful cached workspace is not evicted.

Do not use transient toast-only errors for route failures in this sub-plan.

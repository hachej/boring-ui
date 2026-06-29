# Multi-Project Left Bar — Split Implementation Plan

This folder decomposes `../multi-project-left-bar.md` into subagent-sized implementation plans for #385 / #377.

## Review budget

Per PR / sub-plan:

- Hard review cap: **~15,000 added non-test/non-doc LOC**.
- Target: much smaller. Most sub-plans aim for **1,500–2,500** non-test/non-doc LOC.
- Tests and docs do not count toward the 15k code review budget, but still need to be readable.
- If implementation exceeds the target materially, stop and split again.

## Goal

Ship multi-project project/session navigation without reload-feeling transitions:

- browse projects and sessions without booting runtimes;
- click a session in another project and see the chat/app as soon as identity + transcript are ready;
- start runtime/sandbox preboot after explicit open intent, but do not block chat render on it;
- keep recent workspace UIs mounted in a bounded cache;
- keep split panes within one workspace;
- avoid hidden workspaces owning global side effects.

## Sub-plans and order

### Foundation

1. [`01-no-boot-session-list-and-lazy-fetch.md`](01-no-boot-session-list-and-lazy-fetch.md)
   - no-boot session-list pagination;
   - no-provision tests;
   - lazy expanded-project session fetching;
   - session snapshot LRU cap.

2. [`02-provider-scoped-workspace-store.md`](02-provider-scoped-workspace-store.md)
   - provider-scoped store/selectors;
   - multi-provider isolation tests;
   - public API compatibility.

### Persistent shell / cache

3. [`03a-persistent-shell-no-takeover.md`](03a-persistent-shell-no-takeover.md)
   - persistent multi-project shell seam;
   - previous workspace remains visible during target route loading;
   - no full-page/full-content takeover.

4. [`03b-mounted-workspace-lru-cache.md`](03b-mounted-workspace-lru-cache.md)
   - mounted workspace cache max 3;
   - LRU eviction;
   - cached return without remount.

5. [`03c-auth-error-transitions.md`](03c-auth-error-transitions.md)
   - forbidden/not-found/switch-failed handling without nav teardown;
   - target errors do not evict current visible workspace.

### Open/session/runtime behavior

6. [`04a-typed-open-session-event.md`](04a-typed-open-session-event.md)
   - typed `workspaceEvents.openSession`;
   - cached-target live session handoff.

7. [`04b-no-boot-transcript-state.md`](04b-no-boot-transcript-state.md)
   - no-boot session transcript/state read;
   - render existing chat before runtime readiness.

8. [`04c-runtime-preboot-endpoint.md`](04c-runtime-preboot-endpoint.md)
   - idempotent runtime/sandbox preboot endpoint;
   - trigger after explicit open intent only.

9. [`04d-first-tool-inline-wait.md`](04d-first-tool-inline-wait.md)
   - pending first tool/file/runtime command waits inline;
   - no optimistic message rollback/loss.

### Inactive workspace safety

10. [`05a-visibility-prop-shortcuts-title-theme.md`](05a-visibility-prop-shortcuts-title-theme.md)
    - visible signal;
    - shortcuts/title/theme/focus gating.

11. [`05b-ui-command-targeting.md`](05b-ui-command-targeting.md)
    - UI command target schema;
    - dispatch filtering.

12. [`05c-chatpanelhost-and-stream-gating.md`](05c-chatpanelhost-and-stream-gating.md)
    - ChatPanelHost/UI command stream gating;
    - bridge/plugin/file/chat stream audit.

13. [`05d-overlays-toasts-dragdrop.md`](05d-overlays-toasts-dragdrop.md)
    - overlays/toasts/command palette/drag-drop gating.

## Why this split

The monolithic #385 plan mixed too many load-bearing changes:

- no-boot route correctness;
- router/shell ownership;
- multi-mounted React providers;
- store isolation;
- event targeting;
- no-boot transcript hydration;
- runtime preboot lifecycle;
- global side-effect gating.

These are separable. Each sub-plan was thermo reviewed and then split/fixed until no plan blockers remained.

## Non-negotiable invariants

- No runtime/sandbox boot from merely expanding/browsing a project.
- Runtime/sandbox preboot starts after explicit open intent, but chat render does not wait for it.
- No page-level or content-level takeover when opening a cross-project session.
- `WorkspaceProvider`/workspace store must be multi-provider safe before any multi-mount cache ships.
- Hidden workspace UIs must be inert with respect to focus, shortcuts, overlays, document title/theme, UI commands, drag/drop, and expensive foreground streams.
- Split/open-in-new-pane affordances are same-project only.
- Single-project mode remains unchanged and does not instantiate the multi-workspace cache.

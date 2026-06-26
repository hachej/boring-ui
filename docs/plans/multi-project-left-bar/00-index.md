# Multi-Project Left Bar — Split Implementation Plan

This folder decomposes `../multi-project-left-bar.md` into smaller reviewable implementation plans for #385 / #377.

## Goal

Ship multi-project project/session navigation without reload-feeling transitions:

- browse projects and sessions without booting runtimes;
- click a session in another project and see the chat/app as soon as identity + transcript are ready;
- start runtime/sandbox preboot after explicit open intent, but do not block chat render on it;
- keep recent workspace UIs mounted in a bounded cache;
- keep split panes within one workspace;
- avoid hidden workspaces owning global side effects.

## Sub-plans and order

1. [`01-no-boot-session-list-and-lazy-fetch.md`](01-no-boot-session-list-and-lazy-fetch.md)
   - Hardens the no-boot session-list route with pagination and tests.
   - Changes the front-end from eager all-workspace session fetching to lazy expanded-project fetching.
   - Safe first step; no multi-mount yet.

2. [`02-provider-scoped-workspace-store.md`](02-provider-scoped-workspace-store.md)
   - Makes workspace store/selectors multi-provider safe.
   - Required before mounting multiple `WorkspaceProvider`s concurrently.

3. [`03-persistent-shell-mounted-cache.md`](03-persistent-shell-mounted-cache.md)
   - Introduces persistent multi-project shell and bounded mounted workspace cache.
   - Depends on 01 + 02.

4. [`04-open-session-and-runtime-preboot.md`](04-open-session-and-runtime-preboot.md)
   - Adds typed `workspaceEvents.openSession` live handoff.
   - Adds honest runtime/sandbox preboot after explicit open intent.
   - Depends on 03 for cached-target behavior.

5. [`05-inactive-workspace-side-effects.md`](05-inactive-workspace-side-effects.md)
   - Audits/gates shortcuts, UI command handling, document title/theme, overlays/toasts, focus/drag/drop, bridge/plugin/event streams for inactive cached workspaces.
   - Depends on 03; some hooks may be introduced in 02/03 and finished here.

## Why this split

The previous monolithic #385 plan mixed too many load-bearing changes:

- router/shell ownership;
- multi-mounted React providers;
- store isolation;
- event targeting;
- runtime preboot lifecycle;
- global side-effect gating;
- session-list pagination/laziness.

These are separable. Each sub-plan must pass thermo review before implementation.

## Non-negotiable invariants

- No runtime/sandbox boot from merely expanding/browsing a project.
- No page-level or content-level takeover when opening a cross-project session.
- `WorkspaceProvider`/workspace store must be multi-provider safe before any multi-mount cache ships.
- Hidden workspace UIs must be inert with respect to focus, shortcuts, overlays, document title/theme, UI commands, drag/drop, and expensive streams.
- Split/open-in-new-pane affordances are same-project only.
- Single-project mode remains unchanged and does not instantiate the multi-workspace cache.

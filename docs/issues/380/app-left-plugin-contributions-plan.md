# #380 app-left plugin contributions plan

## Status

Revised after GPT-5.5 thermo review. The first plan was rejected because it accepted a second plugin-capture path in `WorkspaceAgentFront`. This version makes that a blocker and narrows the slice.

## Problem

Inbox is implemented as first-party plugin UI, but its app-left entry is currently wired by app-shell-specific Inbox glue:

- `packages/workspace/src/app/front/WorkspaceInboxHost.tsx`
- `packages/workspace/src/app/front/useWorkspaceInboxShellController.ts`

That is the wrong ownership precedent: future plugins cannot add app-left/explorer actions without editing `WorkspaceAgentFront`, and Inbox is not fully plugin-owned.

## Goal

Add the smallest safe app-left plugin contribution point and move Inbox's app-left action/overlay registration into `inboxPlugin`, **without running plugin factories twice** and without adding Inbox-specific branches to `WorkspaceAgentFront`.

## Non-goals

- No generic navigation/menu framework.
- No persistent Inbox DB/API.
- No migration of host-owned Skills/Plugins overlays in this slice.
- No dynamic provider/binding tree support for hot-loaded runtime plugins.
- No second plugin bootstrap/capture path.

## Required architecture

### 1. Single plugin capture/bootstrap source

Plugin factories must be captured exactly once for a `WorkspaceAgentFront` render path.

Acceptable implementation:

- Extract a reusable bootstrap helper that returns one captured/static plugin model plus the registries needed by `WorkspaceProvider`.
- Or extend `WorkspaceProvider` with an internal/shared pre-captured bootstrap input so `WorkspaceAgentFront` can use the same captured model for app-left chrome and pass it down to provider registration.

Unacceptable implementation:

- `WorkspaceAgentFront` calls `captureFrontPlugin()` for app-left actions while `WorkspaceProvider` separately calls `bootstrap(plugins)` for panels/providers/etc.
- Any plan that says double capture is okay because factories “should be pure”.

### 2. App-left action is a real plugin output kind

`appLeftActions` must follow plugin output rules:

- Intra-plugin duplicate ids rejected during capture.
- Cross-plugin collisions rejected or deterministically namespaced with `pluginId`; choose one explicit rule.
- Output carries plugin ownership.
- Stable ordering: `order`, then plugin label/id, then action label/id.
- Static app/internal plugins supported now.
- Runtime hot-loaded plugin support is explicitly **not** included unless replace-by-plugin-id semantics are implemented for this output kind.

For this PR, support **static app-left actions only**. Runtime/hot-loaded plugins that register app-left actions must warn that those outputs are skipped until the runtime plugin loader has app-left replace-by-plugin-id semantics.

### 3. Overlay topology

Plugin overlay content must render inside the same workspace provider tree and after plugin providers are mounted, so it can use:

- `useWorkspaceAttention()`
- plugin provider contexts
- shell capability context (for Inbox: open artifact/surface, detached chat, dock chat)

Do not render plugin overlays outside `WorkspaceProvider`.

### 4. Overlay props stay content-level

Do not leak layout/chrome details into plugin overlay props.

Plugin overlay props should be minimal:

```ts
interface AppLeftOverlayProps {
  onClose: () => void
}
```

The shell owns app-left chrome state. First-party internals may read shell chrome via non-public context, but the public plugin overlay API must not pass header inset/layout props.

If a plugin needs workspace-specific persistence keys, provide them through a shell/plugin context rather than passing ad-hoc layout props.

### 5. Host capability boundary

Keep host-only operations in a small shell capability context/hook, not in Inbox UI:

- open a workbench surface/panel
- open detached chat
- dock/open an existing chat pane

For Inbox specifically, `WorkspaceInboxShellProvider` may remain as the domain-specific capability context, but it must be mounted by generic shell chrome, not by Inbox-specific branches in `WorkspaceAgentFront`.

### 6. Keep `WorkspaceAgentFront` thin

Add a focused module, e.g.:

- `PluginAppLeftHost`
- `usePluginAppLeftActions`
- `WorkspaceShellCapabilitiesProvider`

`WorkspaceAgentFront` may pass state/callbacks/capabilities into that module, but should not contain per-plugin overlay branching or app-left registration capture logic inline.

## Minimal implementation slice

1. Refactor plugin bootstrap/capture so app-left action outputs come from the same captured plugin model used by `WorkspaceProvider`.
2. Add `appLeftActions` as a static front plugin output kind.
3. Add a focused app-left plugin host module outside `WorkspaceAgentFront`.
4. Move Inbox app-left action/overlay registration into `inboxPlugin`.
5. Reduce `WorkspaceInboxHost` to shell capabilities/detached-chat controller, or split it into clearer focused modules.
6. Add/update tests:
   - app-left action capture duplicate/collision behavior;
   - `WorkspaceAgentFront` renders Inbox from plugin output, not hardcoded Inbox primary action;
   - existing Inbox/ask_user Playwright tests stay green.

## Defer if any of these are not true

- No double capture.
- No public API without output ownership semantics.
- No overlay outside provider/plugin-provider topology.
- No new Inbox-specific branches in `WorkspaceAgentFront`.
- No vague “future cleanup” around the bootstrap model.

## Acceptance

- Inbox app-left entry is registered by `inboxPlugin`.
- `WorkspaceAgentFront` does not hardcode Inbox as a primary action/overlay.
- Plugin app-left outputs are captured/owned through the same plugin bootstrap model as other outputs.
- Existing UX is unchanged.
- Relevant unit tests, typechecks, builds, and Playwright tests pass.

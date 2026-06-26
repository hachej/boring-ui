# 05 — Inactive Workspace Side-Effect Gating

## Purpose

Make mounted-but-hidden workspace UIs safe.

A bounded mounted workspace cache means multiple workspace UIs can exist at once. Hidden workspaces may keep local React state, but they must not behave like foreground workspaces.

Depends on:

- 02 — provider-scoped workspace store;
- 03 — persistent shell + mounted cache passes `visible` / active signal.

## Current risks

Hidden workspace providers/components may still:

- listen to global keyboard shortcuts;
- subscribe to singleton UI command bus;
- open overlays/toasts/command palettes;
- set document title/theme;
- own focus;
- accept drag/drop;
- connect bridge clients / event streams;
- hot-load plugins;
- subscribe to file/session streams;
- process browser UI commands meant for the visible workspace.

This would make multi-mount buggy even if the UI is visually hidden.

## Desired contract

Each workspace content host receives:

```ts
type WorkspaceVisibility = {
  visible: boolean
  workspaceId: string
}
```

Rules:

- Only `visible === true` workspace owns global shortcuts.
- Only visible workspace owns command palette / overlays / toasters.
- Only visible workspace mutates document title/theme.
- Only visible workspace receives untargeted UI commands.
- Targeted UI commands must include workspace id and be ignored by non-matching workspaces.
- Hidden workspace DOM is `hidden`/`display:none` and cannot own focus.
- Hidden workspace drag/drop targets are disabled.
- Expensive streams are paused/disconnected unless explicitly justified.

## Audit checklist

### WorkspaceProvider

Files:

- `packages/workspace/src/front/provider/WorkspaceProvider.tsx`

Audit:

- `WorkspaceShortcuts`
- bridge client connect/disconnect
- document title management
- theme/document mutations
- command palette rendering
- toaster rendering
- plugin hot reload bridge
- open-file binding
- workspace catalog/command bindings

Required changes:

- Add a `visible?: boolean` prop or context value.
- Gate global side effects on visible.
- Avoid rendering duplicate global UI surfaces for hidden providers.

### ChatLayout / UI command bus

Files:

- `packages/workspace/src/front/layout/ChatLayout.tsx`
- `packages/workspace/src/front/bridge/uiCommandBus.ts`
- `packages/workspace/src/front/bridge/uiCommandDispatcher.ts`

Audit:

- shortcuts;
- `postUiCommand` subscribers;
- open panel/file/surface commands;
- browser-originated command dispatch.

Required changes:

- Prefer workspace-targeted commands where possible.
- If command bus remains singleton, subscribers must ignore commands when not visible or when target workspace id does not match.
- Keep `UiBridge.postCommand` as single UI dispatch source; do not introduce competing ad hoc buses.

### App-left / drag/drop / panes

Files:

- `packages/workspace/src/app/front/WorkspaceAgentFront.tsx`
- `packages/workspace/src/front/layout/ChatPaneStageDock.tsx`
- `packages/workspace/src/front/layout/plugin-tabs/AppLeftPane*.tsx`

Audit:

- drag session to split pane;
- open in new pane;
- focus sync;
- overlay state;
- active pane state.

Required changes:

- Hidden workspaces should not expose active drop targets.
- Cross-project session rows switch workspace/project; they never join visible workspace split stage unless same project.

### Streams / network

Audit known streams:

- file event streams;
- bridge/event clients;
- plugin hot reload;
- chat/session polling;
- any SSE/EventSource.

Policy:

- Visible workspace: normal behavior.
- Hidden cached workspace: pause/disconnect if expensive or foreground-only.
- Runtime preboot/warm state can continue under cache policy, but UI foreground streams should not spam.

## Tests / acceptance

Mount two cached workspaces A and B, A visible, B hidden.

Assert:

- keyboard shortcut only affects A;
- UI command posted without B target does not affect B;
- targeted command for B is ignored while hidden unless command type is explicitly allowed for background;
- B does not set document title/theme;
- B command palette/toaster/overlay is not present or not active;
- B drag/drop target is disabled;
- switching visibility to B transfers ownership cleanly;
- unmount/eviction disconnects B foreground streams.

## Out of scope

- Implementing mounted cache itself (plan 03).
- Runtime preboot endpoint (plan 04), except ensuring preboot is not confused with foreground streams.

## Risks

- Over-gating can break background state retention. Keep local React/layout state alive; gate only global/foreground effects.
- Some effects may be intentionally global user preferences (e.g. theme). Decide whether they are truly workspace-scoped before testing isolation.
- If too much of `WorkspaceProvider` assumes one provider per page, this may reveal another prerequisite refactor. Stop and split rather than patching around hidden side effects ad hoc.


## Thermo review fixes

### UI command addressing schema

Define command targeting centrally. Current `UiCommand` lacks a workspace target and `postUiCommand` broadcasts through both in-process and DOM/global channels. Add a plan requirement such as:

```ts
type UiCommandTarget = { workspaceId?: string }
type UiCommand = { ..., target?: UiCommandTarget }
```

Every ingress (server bridge, browser event, local `postUiCommand`) must preserve target metadata. Dispatchers must filter by `visibleWorkspaceId` / matching target before calling `dispatchUiCommand`. Define an explicit allow-background policy for any command that may run against hidden workspaces.

### ChatPanelHost stream gating

Add `ChatPanelHost` to the required gating inventory. It starts `/api/v1/ui/commands/next` streams/polls from center params today. Hidden cached workspaces should disconnect or use `bridgeEndpoint: null` unless a specific background command stream is allowed and workspace-targeted.

### Dispatch ingress inventory

Name every `dispatchUiCommand` ingress in the implementation checklist, including:

- `WorkspaceAgentFront` global `UI_COMMAND_EVENT` listener;
- `ChatLayout` `workspaceEvents.uiCommand` listener;
- bridge/UI command stream consumers;
- direct `postUiCommand` users.

The same visible/target filter wrapper must apply consistently. Gating only one listener is not enough because `postUiCommand` emits to multiple channels.

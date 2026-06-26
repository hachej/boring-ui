# 05c — ChatPanelHost / Stream Gating

## Purpose

Prevent hidden cached workspaces from keeping foreground command streams and expensive subscriptions alive.

Depends on:

- 05a visibility signal;
- 05b UI command targeting if command streams carry UI commands.

## Review budget

Target non-test/non-doc added LOC: **< 2,000**.
Hard cap for PR review: **< 15,000** non-test/non-doc added LOC.

## Scope

- Gate `ChatPanelHost` UI command stream by visibility.
- Audit bridge client connections, plugin hot reload, file events, chat/session polling, EventSource/SSE streams.
- Hidden cached workspaces disconnect/pause foreground streams unless explicitly allowed.
- Runtime preboot/warm state is treated separately from foreground UI streams.

## Required audit targets

- `ChatPanelHost` and `/api/v1/ui/commands/next` stream/polling.
- `WorkspaceProvider` bridge client connect/disconnect.
- `AgentPluginHotReloadBridge`.
- file event streams.
- chat/session hooks polling or streaming.

## Implementation checklist

| Target | Hidden behavior | Required test |
| --- | --- | --- |
| `ChatPanelHost` `/api/v1/ui/commands/next` stream | disconnect or do not start while hidden | hidden B has no UI command stream; visible B starts on switch |
| `WorkspaceProvider` bridge client | disconnect/pause unless explicitly required | hidden B bridge client not connected or documented safe |
| `AgentPluginHotReloadBridge` | disabled while hidden unless dev-only rationale says otherwise | hidden B does not hot-reload/listen |
| file event streams | paused/disconnected while hidden | hidden B has no file EventSource/subscription |
| chat/session polling/streaming | no foreground polling/stream side effects while hidden; runtime preboot is separate | hidden B does not process visible chat stream updates |

Allowed hidden exceptions must be named in code comments/tests with rationale. Default is foreground streams stop when hidden.

## Tests / acceptance

With A visible and B hidden:

- A starts/keeps UI command stream.
- B does not start UI command stream, or disconnects when hidden.
- Switching visibility to B starts B foreground streams and stops/pauses A foreground streams according to the checklist above.
- Hidden workspace does not receive foreground UI stream commands.
- Each audit target in the checklist has an explicit pass/fail test or a documented allowed-hidden exception with no visible side effects.
- Eviction disconnects foreground streams.

## Risks

- Some subscriptions may be cheap/correct to keep alive. If so, document why and test they cannot produce visible side effects while hidden.
- Do not conflate runtime preboot with UI streams: preboot can continue after explicit intent under cache policy.

# Pane to Agent Chat Actions Spec

Last updated: 2026-05-08

## Summary

Add a first-class way for Workspace panes/plugins to send a message into the
active visible agent chat without bypassing `ChatPanel` and `useAgentChat()`.

This is separate from the `ask_user` Questions submit path. `ask_user` answers
resolve a blocked tool through the Questions browser -> server command channel.
Pane-to-agent chat actions are for user-triggered conversational messages such
as "Analyze this chart", "Explain this result", or "Ask the agent about this
pane".

## Problem

Today panes cannot cleanly send a message into the active agent session.

Current flow:

- `ChatPanel` owns `sendMessage` privately through `useAgentChat()`.
- `useAgentChat()` wraps AI SDK `useChat()` and posts to
  `POST /api/v1/agent/chat` with `{ sessionId, message, model, thinkingLevel,
  attachments }`.
- `ChatPanel.handleSubmit()` delegates to AI SDK `sendMessage()` and does not
  expose that foreground-chat path to panes.
- While chat is submitted/streaming, the current composer behavior is owned by
  `ChatPanel`; this plan does not invent a separate follow-up endpoint.
- `WorkspaceAgentFront` / `ChatPanelHost` wrap chat for stream data events,
  artifact opening, and agent -> UI commands.
- Existing Workspace UI bridge is agent/server -> pane commands. It is not a
  pane -> active chat message API.

A pane can technically call `/api/v1/agent/chat` directly, but that is the wrong
integration for foreground chat UX because it bypasses:

- visible user bubble state
- AI SDK `useChat()` state
- current session selection
- model/thinking-level selection
- request headers
- attachment handling and composer validation
- streaming/busy state
- history/persistence expectations

Direct HTTP is acceptable only for intentionally headless/background agent jobs,
not for "send this as a message in the current chat".

## Goals

- Let panes/plugins send a message into the active visible agent chat.
- Preserve `ChatPanel` as the owner of foreground chat send behavior.
- Preserve current session, model, thinking level, request headers, attachments,
  visible bubbles, busy-state behavior, and persistence behavior.
- Expose a stable Workspace-facing hook/helper for panes.
- Support plugin/module-graph boundaries with an event fallback.
- Keep Workspace base front/shared code package-neutral where required; app/front
  composition may import documented `@boring/agent/front` APIs.

## Non-goals

- Replacing `useAgentChat()` or changing the agent chat transport.
- Making panes call `/api/v1/agent/chat` directly for foreground chat.
- Implementing a new follow-up queue or `/followup` route in v1.
- Using this path for `ask_user` form submission.
- Background/headless agent jobs.
- Multi-agent routing or sending to arbitrary non-active sessions in v1.

## Architecture

Use both an imperative controller and a browser event helper:

1. `ChatPanel` exposes an `AgentChatController` that wraps its existing visible
   composer send path.
2. Workspace app/front composition stores the active controller near
   `WorkspaceAgentFront`.
3. Panes call a stable hook/helper such as `useAgentActions().sendMessage(...)`.
4. Plugins that cannot reliably share React context may call
   `postAgentMessage(...)`, which dispatches a browser event caught by the same
   Workspace app/front bridge and forwarded to the active controller.

## Export/API placement

- `AgentChatController`, `AgentChatControllerRegistration`, and
  `AgentChatMessageInput` should be exported as **types** from
  `@boring/agent/front`.
- `useAgentActions()`, `AgentActionsProvider`, and `postAgentMessage()` should be
  exported from `@boring/workspace/app/front` because they are part of the
  Workspace + Agent composition layer.
- Base Workspace front/shared code must not value-import `@boring/agent`.
- If a package-neutral Workspace type is needed, keep it structurally typed and
  free of agent value imports.

Intended imports:

```ts
import type { AgentChatMessageInput } from "@boring/agent/front"
import { useAgentActions, postAgentMessage } from "@boring/workspace/app/front"
```

## Contracts

### Agent chat controller

```ts
export interface AgentChatAttachmentInput {
  filename?: string
  mediaType: string
  url: string
}

export interface AgentChatMessageInput {
  text: string
  files?: AgentChatAttachmentInput[]
  metadata?: Record<string, unknown>
  allowSlashCommands?: boolean
}

export interface AgentChatControllerRegistration {
  controllerId: string
  sessionId: string
  controller: AgentChatController
}

export interface AgentChatController {
  sendAgentMessage(input: AgentChatMessageInput): Promise<void>
  canSendAgentMessage(): boolean
}
```

`ChatPanel` owns the implementation. It should expose the controller through a
prop such as:

```ts
interface ChatPanelProps {
  onControllerReady?: (registration: AgentChatControllerRegistration | null) => void
}
```

Lifecycle rules:

- `ChatPanel` calls `onControllerReady(registration)` when mounted and ready.
- `ChatPanel` calls `onControllerReady(null)` on unmount or when the active
  controller becomes invalid.
- Workspace stores the active controller by `controllerId` and `sessionId`.
- Unregister clears the active controller only when `controllerId` matches the
  currently registered controller. An old unmount must not clear a newer active
  controller.
- `ChatPanel` re-registers when `sessionId`, request headers, model,
  thinking-level, or the underlying send callback changes.
- The controller method delegates to the same path as user composer submit.
- If chat is submitted/streaming, default v1 behavior rejects with
  `AGENT_CHAT_BUSY` and `canSendAgentMessage()` returns false. Runtimes with an
  explicit native follow-up capability may route busy-time user messages through
  their documented follow-up path instead of rejecting.
- Workspace attention blockers override native follow-up. If a pending
  `ask_user`/Questions blocker exists for the active session,
  `canSendAgentMessage()` returns false and `sendAgentMessage()` rejects/blocks;
  the message must not be converted into a hidden follow-up because the active
  tool expects a structured form answer.
- It must not create a separate hidden chat stream.

### Promise semantics

`sendAgentMessage()` / `sendMessage()` promises resolve when the message is
accepted into the visible ChatPanel send path and local user-message handling has
completed. They do **not** wait for the assistant response stream to finish.

Promise rejection is for immediate failures only:

- invalid input
- no active controller
- stale controller
- chat busy/submitted/streaming
- synchronous failure while enqueueing/sending

Async model/network failures after the message is accepted surface through the
existing chat error UI and optional notifications. They are not guaranteed to
reject the original pane promise.

### Workspace agent actions

Workspace app/front exposes a provider/hook for panes:

```ts
export interface AgentActions {
  sendMessage(input: AgentChatMessageInput): Promise<void>
  canSendMessage(): boolean
}

export function useAgentActions(): AgentActions
```

Behavior:

- If no active controller exists, `sendMessage` rejects with
  `AGENT_CHAT_CONTROLLER_UNAVAILABLE` and may show a workspace notification.
- If the active controller changes between call start and dispatch,
  `sendMessage` rejects with `AGENT_CHAT_CONTROLLER_STALE`.
- If chat is busy/submitted/streaming, `sendMessage` rejects with
  `AGENT_CHAT_BUSY`.
- `canSendMessage()` returns false when no active chat controller is registered
  or when the active controller reports busy/unavailable.
- The hook sends to the active visible chat session only.

### Event fallback

For plugin/module graph safety, expose a same-window browser event helper:

```ts
export const AGENT_MESSAGE_EVENT = "boring:agent-message"

export interface PostAgentMessageInput {
  workspaceId?: string
  text: string
  metadata?: Record<string, unknown>
  allowSlashCommands?: boolean
}

export function postAgentMessage(input: PostAgentMessageInput): boolean {
  return globalThis.dispatchEvent(new CustomEvent(AGENT_MESSAGE_EVENT, { detail: input }))
}
```

Event fallback is fire-and-forget. The boolean only means the browser event was
dispatched to at least one same-window listener; it is not delivery confirmation.
Use `useAgentActions()` when the caller needs promise feedback.

Workspace app/front listens for `AGENT_MESSAGE_EVENT`, validates the payload, and
forwards it to the active `AgentChatController`.

Event rules:

- Event fallback v1 is text + metadata only. Attachments are allowed through the
  hook/controller path, not global events.
- The event is for trusted same-origin plugin code only. It is not a security
  boundary.
- The event is same-window only and does not cross tabs by default.
- `workspaceId` routes events when multiple Workspace shells are mounted in one
  window. If omitted and more than one active controller exists, Workspace
  rejects/ignores the event as ambiguous and may show a notification.
- Invalid payloads are ignored with a developer-facing warning.
- If no controller is active, Workspace shows a non-fatal notification such as
  "No active agent chat is available."
- Event sends are subject to the same busy-state rejection and debounce/rate
  limiting as hook sends.

## Pane usage

Preferred React usage:

```tsx
function ChartPane({ chartId }: { chartId: string }) {
  const agent = useAgentActions()

  return (
    <Button
      disabled={!agent.canSendMessage()}
      onClick={() =>
        agent.sendMessage({
          text: `Analyze this chart: ${chartId}`,
          metadata: { source: "chart-pane", chartId },
        })
      }
    >
      Ask agent
    </Button>
  )
}
```

Event fallback:

```ts
postAgentMessage({
  text: "Explain the selected result",
  metadata: { source: "results-pane" },
})
```

Do not call `/api/v1/agent/chat` directly from panes for visible chat UX. Use the
hook or event helper so the visible chat owner remains `ChatPanel`.

## Error handling

Add or reuse stable Workspace/app-front error codes for:

- `AGENT_CHAT_CONTROLLER_UNAVAILABLE`
- `AGENT_CHAT_CONTROLLER_STALE`
- `AGENT_CHAT_BUSY`
- `AGENT_CHAT_MESSAGE_INVALID`
- `AGENT_CHAT_SEND_FAILED`
- `AGENT_CHAT_AMBIGUOUS_WORKSPACE`

Errors should be surfaced as non-fatal UI notifications and promise rejections
from `sendMessage()` when the caller uses the hook/controller path. Event path
errors are notification/log only.

## Security and validation

- Panes can only send to the active visible chat session in v1.
- The server remains responsible for authorization on chat requests; this plan
  does not weaken existing auth.
- Client-side validation should use exported constants shared with the composer
  where possible.
- Suggested v1 limits:
  - `text.trim().length >= 1` unless files are present
  - max message length matches server/chat composer limits
  - max attachments: 20
  - max attachment size: 5 MiB when size is knowable
  - allowed attachment URL schemes: `blob:`, `data:`, or same-origin URLs only
  - max attachment URL/string byte length to prevent giant data-url bypasses
  - metadata is JSON-serializable, max depth 4, max serialized bytes 4096
- `metadata` is client-side advisory only in v1. It is not sent to the server or
  agent unless the caller explicitly includes it in `text`.
- Event helper payloads must be runtime-validated before forwarding.
- Pane-originated messages bypass slash-command parsing by default. Set
  `allowSlashCommands: true` only when the caller intentionally wants composer
  slash-command behavior.

## Relationship to `ask_user`

This plan does not change `ask_user` answer submission.

- `ask_user` answer path:
  `Questions pane -> Questions browser/server command -> AskUserCoordinator`
- pane-to-agent chat action path:
  `pane -> AgentChatController -> ChatPanel/useAgentChat -> visible chat`

Do not use pane-to-agent chat actions to submit generated form answers. Use it
only when the user intentionally wants to send a conversational message to the
agent.

## Acceptance criteria

- `ChatPanel` exposes an `AgentChatController` lifecycle callback or equivalent
  controller ref.
- Workspace app/front stores the active controller by `controllerId`/`sessionId`
  and exposes `useAgentActions()`.
- `postAgentMessage()` event helper forwards text-only messages to the active
  controller when unambiguous.
- Pane calls produce visible user messages in the active chat.
- Pane calls reject/disable while chat is submitted/streaming with
  `AGENT_CHAT_BUSY` in v1.
- Pane calls preserve model/thinking-level/session/request-header behavior by
  delegating to `ChatPanel` internals.
- Calling from a pane when no active controller exists fails gracefully with a
  stable error/notification.
- Plugin author docs/templates mention: foreground chat uses
  `useAgentActions()` / `postAgentMessage()`; direct HTTP is only for
  background/headless jobs.
- Tests cover:
  - controller registration/unregistration
  - old unregister cannot clear newer controller
  - session switch re-registers and stale controller rejects
  - hook-based send
  - event-based send
  - busy/submitted/streaming rejection
  - promise resolves on local accept/enqueue, not assistant completion
  - unavailable controller path
  - invalid event payload rejection
  - multiple Workspace shells / ambiguous event routing
  - attachment count/URL/size validation on hook path
  - metadata size/depth validation
  - slash-command bypass by default and opt-in behavior

# Ask User Questions Plugin Spec

Status: implemented in `packages/workspace/src/plugins/askUserPlugin`.

## Goal

Provide a Workspace-owned `ask_user` agent tool that asks the user a blocking,
structured question in a **Questions** workbench pane and returns the browser
answer to the waiting agent tool call.

The ask-user domain stays inside the plugin:

- shared constants, types, schemas, and error codes
- server runtime, store, routes, state publisher, and tool wrapper
- front provider, Questions pane, client, form primitives, and surface resolver

Generic Workspace and Agent layers know only generic concepts:

- Workspace attention blockers
- generic blocker labels/actions
- generic `openSurface` dispatch from Workspace chrome
- generic tool execution context with the active agent `sessionId`

## Non-goals

- No progressive/draft form streaming in this PR.
- No JSON-Schema `properties` compatibility layer.
- No heuristic A/B fallback when schema is omitted.
- No chat-inline form UI; chat only shows generic blocker/status affordances.
- No ask-user-specific strings or events in `@hachej/boring-agent`.

Agents must provide the final form schema up front.

## Tool contract

Tool name: `ask_user`

Input:

```ts
type AskUserToolInput = {
  title: string
  context?: string
  schema: AskUserFormSchema
  timeoutMs?: number
}

type AskUserFormSchema = {
  wireVersion: 1
  fields: AskUserField[]
  submitLabel?: string
}
```

Supported field types:

- `text`
- `textarea`
- `select`
- `radio`
- `multiselect`
- `checkbox`
- `number`

The tool prompt explicitly instructs the model to emit this schema shape and not
JSON Schema `properties`.

Output:

```ts
type AskUserToolResult =
  | { status: "answered"; answer: AskUserAnswer }
  | { status: "cancelled"; questionId: string; sessionId: string; reason: AskUserCancelReason }
```

Tool errors are returned as normal tool errors when input validation fails,
runtime limits reject the request, timeout/abort occurs, or the user cancels.

## Runtime flow

1. Agent calls `ask_user` with complete schema.
2. Tool execution context provides active chat/session id when available.
3. `AskUserRuntime.ask()` validates schema and creates one ready pending question.
4. Store persists the question and transcript events.
5. State publisher writes `questions.pending` into Workspace UI state.
6. Runtime best-effort posts `openSurface { kind: "questions" }`.
7. Questions pane renders the form from command metadata or persisted UI state.
8. User submits/cancels through `/api/v1/questions/commands`.
9. Server validates session/principal/token/schema and resolves the in-process waiter.
10. Agent receives answered/cancelled result.

Missed UI open acks or failed `openSurface` dispatch do not cancel the pending
question. The persisted state lets browser refresh/reconnect recover.

## Store contract

`AskUserStore` owns persisted pending questions, answers, and transcript events.
The file-backed default store is suitable for standalone/dev use and can be
replaced by app/core/cloud storage later.

Important invariants:

- one pending ready question per session
- terminal states are guarded (`answered`, `cancelled`, `abandoned`)
- writes are serialized
- listener failures do not roll back mutations
- transcript events never contain browser-supplied schema

## Browser command security

Browser commands include the question id, session id, and answer token. The
bridge validates:

- command payload shape
- stored question exists
- session id matches
- auth context/principal matches when configured
- answer token matches using constant-time comparison
- answer values match the server-stored schema

Duplicate submit after answered is idempotent. Submit after cancel is rejected.
If the runtime waiter is gone, submit abandons and returns conflict instead of
falsely reporting answered.

## UI state and recovery

The plugin owns `ASK_USER_UI_STATE_SLOTS.PENDING` (`questions.pending`). Server
plugins declare preserved UI state keys so generic Workspace routes do not import
ask-user constants.

Pending state shape:

```ts
type AskUserPendingState = {
  question: AskUserQuestion | null
}
```

The front provider refreshes pending state on mount, window focus, visibility
restore, and UI-command events. It does not poll continuously.

## Composer blocking

Pending ready questions add a `WorkspaceAttentionBlocker` with generic actions:

```ts
{
  reason: "waiting_for_user_input",
  label: "Answer the question in Questions to continue",
  actions: [{ id: "open", label: "Open Questions" }]
}
```

`@hachej/boring-agent` receives only generic blocker shape/actions. Workspace
chrome handles action ids against its richer workspace blocker metadata.

Policy:

- normal busy chat blocks send unless native follow-up is supported
- pending ask-user always blocks composer, even with native follow-up support
- Stop remains clickable while blocked
- Stop cancels the pending question for that session and closes Questions pane

## Default app wiring

`createWorkspaceAgentServer()` includes the ask-user server plugin by default.
`WorkspaceAgentFront()` includes the ask-user front plugin by default. Both honor
`excludeDefaults: ["ask-user"]` so consumers can opt out symmetrically.

Ask-user server plugin contributes:

- `ask_user` agent tool
- Questions routes
- system prompt snippet
- preserved UI state key

The state publisher is started only when the default plugin is actually created
and is disposed on Fastify close.

## Tests to keep

- schema validation limits and command payloads
- store persistence and terminal guards
- runtime answer/cancel/timeout/abort/orphan behavior
- bridge auth/session/token/answer validation
- front Questions pane submit/cancel/stop behavior
- generic ChatPanelHost blocker action behavior
- default app server/front symmetry and opt-out

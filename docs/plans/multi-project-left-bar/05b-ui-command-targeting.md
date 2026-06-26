# 05b — UI Command Targeting + Dispatch Filtering

## Purpose

Make `UiBridge.postCommand` / UI command dispatch safe with multiple mounted workspaces.

Depends on:

- 05a visibility signal.

## Review budget

Target non-test/non-doc added LOC: **< 2,000**.
Hard cap for PR review: **< 15,000** non-test/non-doc added LOC.

## Scope

- Add central UI command addressing schema.
- Preserve `UiBridge.postCommand` as the single server-side dispatch source.
- Ensure every UI command ingress preserves target metadata.
- Filter dispatch by target workspace and visibility.

## Schema sketch

```ts
type UiCommandTarget = {
  workspaceId?: string
}

type UiCommand = {
  v: number
  seq: number
  kind: string
  params?: unknown
  target?: UiCommandTarget
}
```

## Dispatch rules

- If command has `target.workspaceId`, only matching workspace may dispatch it.
- If command has no target, only visible workspace may dispatch it unless command kind is explicitly background-allowed.
- Background-allowed command kinds must be enumerated; default deny.

## Ingress inventory

Implementation must audit/filter:

- `WorkspaceAgentFront` global `UI_COMMAND_EVENT` listener;
- `ChatLayout` `workspaceEvents.uiCommand` listener;
- bridge/UI command stream consumers;
- direct `postUiCommand` users;
- DOM/global custom event path;
- in-process event bus path.

## Tests / acceptance

- A visible, B hidden.
- Untargeted command affects A only.
- Targeted B command is ignored while B hidden unless kind is background-allowed.
- After B visible, targeted B command affects B.
- No duplicate dispatch through both DOM and in-process path.
- Targeted command posted through server bridge (`/api/v1/ui/commands` or `UiBridge.postCommand`) reaches the frontend stream with `target.workspaceId` intact.
- Existing single-workspace UI command tests still pass.
- Background-allowed contract is tested both ways: an explicitly enumerated background-allowed kind may dispatch while hidden; an unknown/non-enumerated kind with the same hidden target is denied by default.

## Risks

- Schema changes can affect server/client compatibility. Keep optional `target` backward-compatible.
- Do not introduce a second dispatch source competing with `UiBridge.postCommand`.

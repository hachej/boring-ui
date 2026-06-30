# #380 Follow-up: generic human-action target actions

## Goal

Let an agent ask a human to review or decide on an existing workspace target — HTML artifact, markdown file, image, PDF, deck, data visualization, or any future surface — without Inbox owning that target's renderer.

The Inbox row is only a routing/reminder surface. The actual review controls appear in the target header while a human-action is active.

## Non-goals

- Do not add an HTML renderer to Inbox.
- Do not store raw artifact/file content in blockers, Inbox rows, UI state, transcripts, or logs.
- Do not let the agent forge a human decision.
- Do not implement inline annotations in this PR. That is the next follow-up.

## User flow

1. Agent creates or opens a workspace target.
2. Agent requests human action against that target.
3. Inbox shows a row with safe metadata and a pointer to the target.
4. Clicking the row opens the existing workspace target renderer.
5. The target header shows agent-declared buttons, for example `Accept`, `Reject`, `Request changes`.
6. Human clicks one button, optionally adds a comment if the action requires it.
7. The human-action plugin resolves the waiting agent call with a signed/validated result.

## Data model sketch

```ts
export type HumanActionTargetRef =
  | { type: "surface"; surfaceKind: string; target: string; meta?: Record<string, unknown> }
  | { type: "panel"; component: string; params?: Record<string, unknown> }
  | { type: "file"; workspaceId?: string; path: string; line?: number; column?: number }

export interface HumanActionButton {
  id: string
  label: string
  tone?: "default" | "positive" | "warning" | "danger"
  comment?: "none" | "optional" | "required"
}

export interface HumanReviewAction {
  id: string
  kind: "review" | "approval" | "acknowledgement" | "choice"
  title: string
  body?: string
  target: HumanActionTargetRef
  actions: HumanActionButton[]
}
```

## Architecture

### Ask-user / human-action plugin

- Owns active human-action runtime.
- Projects active actions into attention blockers and Inbox rows.
- Exposes a provider/hook for actions by target reference.
- Validates and submits human decisions back through the existing ask-user bridge/result path.

### Workspace

- Provides generic registry/slot only.
- Does not import `@hachej/boring-ask-user` from `packages/workspace/src/**`.
- Adds a target-action header slot contract that surfaces can render.
- Keeps existing surface/panel/file renderers as the source of truth.

### Target renderers

- Artifact, file, markdown, image, PDF, HTML, and custom plugin surfaces can ask:

```ts
const actions = useHumanActionsForTarget(targetRef)
```

- If actions exist, render buttons in the existing header/chrome.

## Safety rules

- Target refs are pointers only.
- No raw HTML, markdown, PDF bytes, image data, or file content in Inbox/blocker/UI-state projections.
- Decision result includes action id and optional user text, not hidden target contents.
- Buttons declared by the agent are rendered for the human; the agent cannot click them.
- Stable IDs and server-side answer tokens remain required.

## Acceptance tests

1. Unit: target refs serialize/redact safely.
2. Unit: blockers/Inbox rows contain target pointer metadata and no raw content.
3. Front test: active human-action for a target produces header buttons.
4. E2E: Inbox row opens existing target renderer and header buttons are visible.
5. E2E: clicking `Accept` resolves with `{ actionId: "accept" }`.
6. E2E: action with `comment: "required"` blocks submission until comment is entered.

## PR scope

This follow-up should implement the generic target-action contracts and the first working header-button flow for existing surfaces. Annotation payloads are explicitly left to the next PR.

# Chat-first auth and workspace boot

Status: implemented v1 contract.

This document is the product-level contract for the composed core + workspace + agent app shell. Runtime package reconciliation details live in the runtime provisioning plan; this doc only describes what the app shell shows and which stable readiness signals it consumes.

## Gates

The app has three separate gates:

1. **Auth/draft gate** — in `chat-first` entry, public users can type in the product shell. The first Send opens auth. The pre-auth draft is child-app owned sessionStorage state, restored after auth, and never auto-sent.
2. **Workspace identity gate** — after auth, `/workspace/:id` blocks only until the target workspace identity is known and matches the authenticated user. This prevents workspace A files/sessions/panels from appearing under workspace B.
3. **Workbench/agent readiness gate** — once identity matches, chat renders immediately. Files, sessions, sandbox execution, and UI bridge readiness warm in the background and are shown locally in the workbench/tool UI.

## Child-app entry modes

Child apps choose one of two policies:

- `auth-first` — auth is a route/page before the app shell.
- `chat-first` — auth is an overlay opened by first Send. The overlay defaults to signin; signup is a secondary link/mode.

There is no unauthenticated model call in `chat-first` v1. Pre-auth chat is local-only draft UI.

## Pre-auth shell restrictions

Before auth, the public shell must not expose private workspace metadata or make private backend calls:

- no workspace dropdown/list/switcher/settings/members UI
- no `/api/v1/workspaces`, `/api/v1/workspaces/:id`, `/api/v1/agent/*`, `/api/v1/tree`, or `/api/v1/ui/*` calls
- `/workspace/:id` must not reveal whether the workspace exists

Auth/session checks and public config are allowed.

## Post-auth return

After signin/signup:

- the same product shell remains mounted where possible
- Sign in becomes avatar/account menu
- the draft is restored and focused
- no auto-send and no queued send; the user clicks Send again
- if pending draft state is missing/expired, the app falls back to the default workspace without error
- attachment data URLs are not persisted/restored in the pending draft flow

Every authenticated user gets a default workspace record automatically. A new user should never hit an empty workspace picker dead end.

## Authenticated workspace boot

The default composed route mounts `WorkspaceAgentFront` as soon as `currentWorkspace.id` matches the route target. It does **not** wrap the shell in blocking `WorkspaceBootGate`.

`WorkspaceBootGate` remains available for callers that explicitly want blocking preload behavior, but it is not used by the default core workspace route.

`WorkspaceBackgroundBoot` warms the workspace after identity match:

- always preloads `/api/v1/tree?path=.`
- preloads `/api/v1/agent/sessions` and observes `/api/v1/ready-status` only when `provisionWorkspace !== false`
- keys work by `workspace.id` and aborts/ignores stale responses on switch
- seeds the file tree preload cache on successful tree responses
- treats retryable workspace/runtime preparing envelopes as preparing, not fatal

## Workbench-local readiness

Chat stays visible while workspace surfaces are preparing. File tree/editor/plugin/left-tab surfaces do not mount until the current workspace workbench is ready.

Workbench copy mapping when the server includes a readiness requirement:

| Requirement | Workbench copy |
|---|---|
| `workspace-fs` | Preparing files… |
| `sandbox-exec` | Waking sandbox… |
| `ui-bridge` | Connecting workspace UI… |
| generic workspace warmup | Preparing workspace… |
| generic agent warmup | Preparing agent… |

Failures are shown as workbench-local retry/reload states, not full-app top banners.

## Stable readiness errors

`WORKSPACE_NOT_READY` is reserved for workspace substrate readiness only:

- `workspace-fs`
- `sandbox-exec`
- `ui-bridge`

Tool results use this shape:

```json
{
  "code": "WORKSPACE_NOT_READY",
  "retryable": true,
  "requirement": "workspace-fs"
}
```

Friendly chat/tool copy:

| Requirement | Chat/tool copy |
|---|---|
| `workspace-fs` | Files are still loading. |
| `sandbox-exec` | Sandbox is still waking. |
| `ui-bridge` | Workspace UI is still connecting. |

Agent runtime/provisioning readiness is separate and must not be labeled `WORKSPACE_NOT_READY`. Runtime preparation uses `AGENT_RUNTIME_NOT_READY`; provisioning failures use `RUNTIME_PROVISIONING_FAILED` or `RUNTIME_PROVISIONING_LOCKED`.

## Runtime provisioning boundary

The browser does not implement package-manager or `.boring-agent` reconciliation logic and does not assume an async package update/status endpoint. Runtime provisioning is server-side and synchronous before declaring the agent runtime ready. Product UI only treats the agent runtime as preparing, ready, or failed.

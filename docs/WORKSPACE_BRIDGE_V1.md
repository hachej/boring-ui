# WorkspaceBridge v1

WorkspaceBridge v1 lets sandboxed runtimes call host-owned workspace operations without guessing localhost URLs or receiving a global reusable backend token.

It adds a bounded RPC lane next to the existing UI bridge lane:

- **UI lane:** `postCommand(...)` remains the canonical UI command dispatch API. `emitUiEffect(...)` is kept as a compatibility alias where older bridge callers use that name.
- **RPC lane:** `call(op, input, options)` / registered handlers provide request-response host capability RPC.

The RPC lane is not a generic HTTP proxy. Handlers must be explicitly registered with an operation definition, allowed caller classes, capability requirements, size limits, timeout, and idempotency policy.

## Handler registration

Apps can register bridge handlers directly:

```ts
createWorkspaceAgentServer({
  workspaceBridge: {
    runtimeTokenSecret: process.env.BORING_WORKSPACE_BRIDGE_TOKEN_SECRET,
    runtimeEnv: {
      bridgeUrl: "https://app.example.com", // or full /api/v1/workspace-bridge/call URL
      capabilities: ["example:read", "example:write"],
    },
    handlers: [{ definition, handler }],
  },
})
```

`createCoreWorkspaceAgentServer(...)` accepts the same `workspaceBridge` shape.

Trusted boot-time server plugins can also contribute handlers:

```ts
defineServerPlugin({
  id: "example-internal-plugin",
  workspaceBridgeHandlers: [{ definition, handler }],
})
```

`workspaceBridgeHandlers` is for app/internal server plugins only. Pre-built plugin objects supplied by host code are trusted. Directory-source server plugins must be installed by the host with `trust: "internal"` before they may contribute bridge handlers; unmarked directory plugins that declare handlers are rejected. User hot-reload/runtime plugins should not self-register host bridge operations; they should call operations exposed by the app or trusted internal plugins.

Product-specific operation names and validation belong to the product/plugin that owns the domain. `@hachej/boring-workspace` only provides the generic bridge registry, auth, token, idempotency, and transport machinery.

## Session-gated UI surfaces and attention

Plugins that need a human to act should combine domain-specific bridge ops with
the generic workspace attention/surface mechanics:

1. Publish or discover plugin-owned pending state through plugin-owned bridge
   operations, e.g. `human-input.v1.pending` or `pr-review.v1.pending`.
2. Add a `WorkspaceAttentionBlocker` with the plugin's own `reason` namespace
   and a `sessionBadge` so the session list can mark the affected session.
3. Use `openSurface` with `meta.sessionId` and
   `meta.openOnlyWhenSessionOpen: true` when the UI should open only if that
   chat session is already visible.

Example:

```ts
await uiBridge.postCommand({
  kind: "openSurface",
  params: {
    kind: "pr-review",
    target: "review-123",
    meta: { sessionId, openOnlyWhenSessionOpen: true },
  },
})
```

If the target session is closed/background, workspace drops the surface open and
emits `WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT`. The owning plugin can listen for
that event and refresh its pending hints; the session list badge remains the
non-stealing notification path. Workspace does not know whether the attention is
a question, PR review, approval gate, or some other domain-specific workflow.

## Ask-user human input

`@hachej/boring-ask-user/server` owns the `human-input.v1.*` operation family. Normal ask-user setup contributes those handlers through `workspaceBridgeHandlers` instead of registering a plugin-owned `/api/v1/questions/commands` route.

Registered operations:

- `human-input.v1.request` — runtime/server asks a blocking structured question.
- `human-input.v1.pending` — browser/server reads the pending question for a session.
- `human-input.v1.answer` — browser/server submits answers with the question answer token and idempotency key.
- `human-input.v1.cancel` — browser/server cancels a pending question with the question answer token and idempotency key.
- `human-input.v1.transcript` — server-only transcript read.

The plugin owns question validation, storage, answer-token checks, UI-state publishing, and pending-question coordination. The workspace package remains domain-neutral: it hosts only the generic RPC core, the trusted handler contribution seam, and generic session attention/surface dispatch.

For normal setup, browser reads/mutations are scoped by the verified bridge session (`x-boring-session-id` or app-auth equivalent), not by body-only session values. Runtime requests must be made with a session-scoped bridge token when a session id is present. UI effects and UI state may carry question/session hints for navigation and badges, but answer tokens and full answerable question payloads stay behind the `human-input.v1.pending` RPC read.

## Runtime bridge env

When enabled and valid, agent/runtime executions receive:

- `BORING_WORKSPACE_BRIDGE_URL`
- `BORING_WORKSPACE_BRIDGE_TOKEN`
- `BORING_WORKSPACE_ID`
- `BORING_AGENT_SESSION_ID`

Remote runtimes, such as `vercel-sandbox`, require an HTTPS non-localhost bridge URL. If the bridge cannot be enabled safely, the runtime receives `BORING_WORKSPACE_BRIDGE_DISABLED=<reason>` instead of a URL/token.

## Runtime client

TypeScript runtime code should use the package client:

```ts
import { WorkspaceBridgeClient } from "@hachej/boring-workspace/bridge-client"

const bridge = WorkspaceBridgeClient.fromEnv()
await bridge.call("example.v1.write", {
  id: "output-1",
  title: "Generated output",
}, { idempotencyKey: "example-write:output-1" })
```

Non-TypeScript runtimes can call the HTTP transport directly:

```py
import os, requests

resp = requests.post(
    os.environ["BORING_WORKSPACE_BRIDGE_URL"],
    headers={"authorization": f"Bearer {os.environ['BORING_WORKSPACE_BRIDGE_TOKEN']}"},
    json={
        "op": "example.v1.write",
        "idempotencyKey": "example-write:output-1",
        "input": {"id": "output-1", "title": "Generated output"},
    },
    timeout=30,
)
resp.raise_for_status()
```

## Auth and safety model

Bridge calls are authorized by caller class plus capabilities:

- `browser` calls use app/browser auth policy.
- `runtime` calls use scoped bearer tokens minted from the runtime bridge secret.
- `server` calls use trusted in-process context.

Runtime tokens are scoped to the workspace/session/runtime/capability set and expiry. They protect the host and other workspaces from the sandbox; they are not secret from code already running inside that sandbox.

Never log tokens, Authorization headers, full payloads, host paths, user answers, or sensitive SQL. Mutating/retryable operations should require an idempotency key.

## Why this matters

The bridge fixes remote-sandbox tools that previously assumed the app was reachable at `127.0.0.1`. Downstream apps can register their own domain operations and let sandboxed tools call the real app backend through scoped bridge env instead of exposing a global backend token.

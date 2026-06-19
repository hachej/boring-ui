# WorkspaceBridge v1

WorkspaceBridge v1 lets sandboxed runtimes call host-owned workspace operations without guessing localhost URLs or receiving a global reusable backend token.

It adds a bounded RPC lane next to the existing UI bridge lane:

- **UI lane:** `postCommand(...)` remains the canonical UI command dispatch API. `emitUiEffect(...)` is kept as a compatibility alias where older bridge callers use that name.
- **RPC lane:** `call(op, input, options)` / `registerHandler(...)` is request-response host capability RPC.

The RPC lane is not a generic HTTP proxy. Handlers must be explicitly registered by the host with an operation definition, allowed caller classes, capability requirements, size limits, timeout, and idempotency policy.

## Runtime bridge env

A bridge-capable app opts in through `workspaceBridge` server options:

```ts
createWorkspaceAgentServer({
  workspaceBridge: {
    runtimeTokenSecret: process.env.BORING_WORKSPACE_BRIDGE_TOKEN_SECRET,
    runtimeEnv: {
      bridgeUrl: "https://app.example.com", // or full /api/v1/workspace-bridge/call URL
      capabilities: ["macro:series.read", "macro:transform.persist"],
    },
    handlers: [{ definition, handler }],
  },
})
```

`createCoreWorkspaceAgentServer(...)` accepts the same `workspaceBridge` shape.

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
await bridge.call("macro.v1.transform.persist", {
  output_id: "GDP_YOY",
  title: "GDP YoY",
}, { idempotencyKey: "macro-transform:GDP_YOY" })
```

Non-TypeScript runtimes can call the HTTP transport directly:

```py
import os, requests

resp = requests.post(
    os.environ["BORING_WORKSPACE_BRIDGE_URL"],
    headers={"authorization": f"Bearer {os.environ['BORING_WORKSPACE_BRIDGE_TOKEN']}"},
    json={
        "op": "macro.v1.transform.persist",
        "idempotencyKey": "macro-transform:GDP_YOY",
        "input": {"output_id": "GDP_YOY", "title": "GDP YoY"},
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

The bridge fixes remote-sandbox tools that previously assumed the app was reachable at `127.0.0.1`. For example, MacroAnalyst `bm` transforms can use the injected bridge URL/token to call the real app backend instead of a sandbox-local port, without exposing a global backend token.

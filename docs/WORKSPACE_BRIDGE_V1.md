# WorkspaceBridge v1

WorkspaceBridge is the host capability boundary for browser, runtime, and trusted server code. It has two intentionally separate lanes:

- `WorkspaceBridge.emitUiEffect(effect)` is UI side-effect only. Use it to open/focus panes or show display hints.
- `WorkspaceBridge.call(op, input, options)` and host `registerHandler(...)` are bounded request/response RPC for domain operations.

There is no `postCommand` or `postUiCommand` public alias in v1. The HTTP endpoint `/api/v1/workspace-bridge/call` is transport only; it is not a generic API proxy.

## Caller class, actor attribution, and auth

`callerClass` is the transport boundary: `browser`, `runtime`, or `server`. Actor attribution is audit/debug context only: `actorKind` (`human`, `agent`, `system`, `service`), redacted `performedBy`, and optional redacted `onBehalfOf`.

Request bodies cannot spoof caller/actor fields. Browser auth derives human attribution from the app/CSRF/origin policy. Runtime calls use scoped short-lived bearer tokens injected through runtime env. Trusted in-process server calls choose explicit system/service attribution.

Local CLI/no-auth mode remains trusted-local in v1; it does not get a separate local development token.

Logs and tests must redact bearer tokens, one-shot nonces, user answers, file contents, host paths, full payloads, and sensitive SQL text.

## Ask-user hard cutover

Supported setup:

```ts
import { askUserPlugin } from "@hachej/boring-ask-user/front"
import { createAskUserPiExtensionFactory } from "@hachej/boring-ask-user/agent"
```

The agent extension receives an explicit in-process WorkspaceBridge context and calls `human-input.v1.request`. The browser Questions UI answers and cancels through `human-input.v1.answer` and `human-input.v1.cancel`. Opening the Questions pane is only an `emitUiEffect` hint.

Old `@hachej/boring-ask-user/server` route/tool setup is historical and unsupported. There is no ask-user compatibility window: do not add plugin-owned answer/cancel routes, duplicate stores, or old server agent tools.

`human-input.v1.transcript` is super-admin/debug only; runtime tokens and normal browser users cannot read it.

## Macro bridge ops

Macro browser UI and runtime SDKs use WorkspaceBridge for data/domain operations so plugin-owned `/api/macro/*` data routes are not required for bridge-capable hosts.

Required v1 ops:

- `macro.v1.catalog.search`
- `macro.v1.facets.list`
- `macro.v1.series.metadata`
- `macro.v1.series.data`
- `macro.v1.series.lineage`
- `macro.v1.sql.query`
- `macro.v1.transform.persist`

Not bridged in v1: deck routes, `/api/macro/ch-query`, generic `workspace-files.v1.*`, `artifact.v1.*`, or workspace-bridge artifact routes.

`macro.v1.sql.query` is guarded: read-only single statements only, bounded timeout/rows/bytes, `macro:sql.query` capability required, and SQL/payloads redacted in audit logs.

Large Macro outputs return file-asset pointers produced through existing upload/raw-file infrastructure such as `/api/v1/files/raw?path=...`; v1 does not add an artifact/cache service.

### Browser example

```ts
await bridge.call("macro.v1.catalog.search", {
  q: "gdp",
  frequency: ["Q"],
  limit: 25,
})
```

### Runtime TypeScript example

```ts
import { WorkspaceBridgeClient } from "@hachej/boring-workspace/bridge-client"

const bridge = WorkspaceBridgeClient.fromEnv()
await bridge.call("macro.v1.transform.persist", {
  output_id: "GDP_YOY",
  title: "GDP YoY",
  input_ids: ["GDP"],
  transform_name: "yoy",
  data: [["2024-01-01", 2.1]],
}, { idempotencyKey: "macro-transform:GDP_YOY" })
```

### Runtime Python example

```py
import os
import requests

url = os.environ["BORING_WORKSPACE_BRIDGE_URL"]
token = os.environ["BORING_WORKSPACE_BRIDGE_TOKEN"]
resp = requests.post(
    url,
    headers={"authorization": f"Bearer {token}"},
    json={
        "op": "macro.v1.transform.persist",
        "idempotencyKey": "macro-transform:GDP_YOY",
        "input": {
            "output_id": "GDP_YOY",
            "title": "GDP YoY",
            "input_ids": ["GDP"],
            "transform_name": "yoy",
            "data": [["2024-01-01", 2.1]],
        },
    },
    timeout=30,
)
resp.raise_for_status()
```

Runtime env is what makes direct/local/vercel work without localhost assumptions: bridge-capable SDKs read `BORING_WORKSPACE_BRIDGE_URL` and `BORING_WORKSPACE_BRIDGE_TOKEN` instead of guessing a host port.

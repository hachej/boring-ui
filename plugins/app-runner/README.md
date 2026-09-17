# @hachej/boring-app-runner

Publishes an app from the workspace (`app/` by default: `index.js` + `index.html`)
to a "celld" app runner service, and lets the team view/roll back it in a
workspace panel.

## What it ships

- Server plugin (`boring.server`):
  - `agentTools`: `publish_app`, `list_app_versions`, `rollback_app`,
    `activate_app_version`, `get_app_logs`, `get_app_usage`, and
    `call_app_tool` (dispatches to a tool declared in `app/tools.json`, see
    below).
  - HTTP routes under `/api/v1/plugins/app-runner/*` that call the app runner
    server-side (the front never sees `BORING_APP_RUNNER_TOKEN` or
    `BORING_APP_RUNNER_AUTH_SECRET`), plus `/api/v1/plugins/app-runner/open/{app}/*`
    and `/api/v1/plugins/app-runner/preview/{app}/{version}/*` proxy routes so
    the front can iframe a same-origin URL without setting auth headers.
  - a small JSON store (`.boring/app-runner.json` in the workspace) recording
    published apps and, when present, their `app/tools.json` manifest.
- Front plugin (`boring.front`): an "Apps" panel listing published apps, an
  iframe of the selected app/version (via the proxy routes above), a version
  switcher, rollback/activate buttons. Registers an `app-runner` surface
  resolver so an agent can call `exec_ui({ kind: 'openSurface', params: {
  kind: 'app-runner', target: '<appName>' } })` after publishing.

## Configuration

- `BORING_APP_RUNNER_URL` — base URL of the app runner service (default
  `http://127.0.0.1:9877`).
- `BORING_APP_RUNNER_TOKEN` — bearer token for authenticated runner calls.
- `BORING_APP_RUNNER_AUTH_SECRET` — optional dev-mode shared secret sent as
  `X-Boring-Auth-Secret`, standing in for the production Caddy forward-auth
  layer (see APP-RUNNER-SPEC.md). Every authenticated runner call also sends
  `X-Boring-User` (JSON `{id, name, email}`, best-effort from the acting
  agent-tool/HTTP-request context) and `X-Boring-Workspace`. None of these are
  finalized upstream — this plugin's header names are its own choice pending
  the runner's actual contract.

## App contract

An app is a folder (default `app/`) containing an `index.js` ES module
(Cloudflare-Worker-style, exporting a `fetch(request, env, ctx)` handler —
`env.APPDATA` is an RPC-based data store, `env.IDENTITY` is the current user)
and `index.html`, plus any other static assets it needs. `publish_app`
enforces the runner's own limits client-side before uploading: 200 files max,
2 MiB per file, 10 MiB total.

An app may also ship `app/tools.json`:

```json
{
  "tools": [{ "name": "count_entries", "description": "...", "input": {}, "route": "/api/tools/count_entries" }],
  "bindings": ["workspace-files:ro"]
}
```

After a successful `publish_app` (and refreshed on `rollback_app` /
`activate_app_version`), declared tools become callable via the single
`call_app_tool({ appName, tool, input })` agent tool. This plugin system only
supports boot-time-static `agentTools` (see
`packages/workspace/docs/PLUGIN_SYSTEM.md` §4.5) — there's no supported way
to register a brand-new tool name per app/tool pair at publish time — so
`call_app_tool` is a deliberate, documented substitute for the literal
"one agent tool named `app_{app}_{tool}` per manifest entry" ask.

## Browser isolation

Published pages are rendered in an iframe with `sandbox="allow-scripts allow-forms"` and deliberately without `allow-same-origin`. Per the iframe sandbox model, this gives the document a unique opaque origin even though the byte proxy is a host route: its scripts cannot read the parent document, host storage/cookies, or same-origin host APIs. Navigation, popups, downloads and top-level navigation are also not granted. The host proxy sends identity routing headers only; platform bearer and development-secret credentials are never put on an app-serving request.

## Installation

```ts
// server
defaultPluginPackages: ["@hachej/boring-app-runner"]

// front
import { createAppRunnerPlugin } from "@hachej/boring-app-runner/front"
const appRunnerPlugin = createAppRunnerPlugin()
```

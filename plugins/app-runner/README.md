# @hachej/boring-app-runner

Publishes an app from the workspace (`app/` by default: `index.js` + `index.html`)
to a "celld" app runner service, and lets the team view/roll back it in a
workspace panel.

## What it ships

- Server plugin (`boring.server`):
  - `agentTools`: `publish_app`, `list_app_versions`, `rollback_app`, `activate_app_version`.
  - HTTP routes under `/api/v1/plugins/app-runner/*` that call the app runner
    server-side (the front never sees `BORING_APP_RUNNER_TOKEN`).
  - a small JSON store (`.boring/app-runner.json` in the workspace) recording
    published apps.
- Front plugin (`boring.front`): an "Apps" panel listing published apps, an
  iframe of the selected app/version, a version switcher, and
  rollback/activate buttons. Registers an `app-runner` surface resolver so an
  agent can call `exec_ui({ kind: 'openSurface', params: { kind: 'app-runner',
  target: '<appName>' } })` after publishing.

## Configuration

- `BORING_APP_RUNNER_URL` — base URL of the app runner service (default
  `http://127.0.0.1:9877`).
- `BORING_APP_RUNNER_TOKEN` — bearer token for authenticated runner calls
  (publish/rollback/activate). Never exposed to the front.

## App contract

An app is a folder (default `app/`) containing an `index.js` ES module
(Cloudflare-Worker-style, exporting a `fetch(request, env, ctx)` handler —
`env.APPDATA` is an RPC-based data store at runtime) and `index.html`, plus
any other static assets it needs. `publish_app` enforces the runner's own
limits client-side before uploading: 200 files max, 2 MiB per file, 10 MiB
total.

## Installation

```ts
// server
defaultPluginPackages: ["@hachej/boring-app-runner"]

// front
import { createAppRunnerPlugin } from "@hachej/boring-app-runner/front"
const appRunnerPlugin = createAppRunnerPlugin()
```

# @hachej/boring-app-runner

Publishes versioned workspace apps and per-user profiles to the boring-hub app runner, mounts tools from the current published manifests, and provides an Apps panel for preview, history, activate, rollback, logs, and usage.

## Workspace layout

```text
apps/<name>/
  index.js
  index.html             # optional front end
  tools.json             # optional native-tool manifest
  data/migrations/*.sql  # optional activation migrations
profile/
  instructions.md
  index.js
  tools.json
  mcp.json
  data/migrations/*.sql
```

Apps receive `fetch(request, env)`, SQLite-compatible `env.db`, and the current user in the `x-app-user` request header. Profiles use a separate runner cell per authenticated user. Published manifests are the only source of native tools; editing a draft `tools.json` does not change the agent until publish.

On each publish the plugin creates or updates a host-owned private Git repository outside the workspace, commits the publishable files, and uploads the exact bytes from that commit. Configure its durable location with `BORING_APP_RUNNER_GIT_ROOT`; otherwise it uses the durable agent-session volume when configured, or a temporary host directory. Dotfiles, app-authored Git metadata, ignored files, oversized files, traversal, escaping symlinks, unsafe Git configuration, and nested repositories are rejected or excluded.

## Configuration

- `BORING_APP_RUNNER_URL` — runner base URL (default `http://127.0.0.1:9877`).
- `BORING_APP_RUNNER_TOKEN` — bearer token for runner control-plane and tool calls.
- `BORING_APP_RUNNER_AUTH_SECRET` — optional development forward-auth secret sent as `X-App-Runner-Auth` on control-plane and tool calls.

The front end never receives these credentials. The host asks the authenticated API to mint a three-minute HMAC-signed URL on an origin unique to that app. Authorization is the `/t/<token>/` path prefix, so relative assets and API requests inherit it inside the sandboxed iframe without cookies. Development uses `<app-id>.apps.localhost:9878`; production needs wildcard DNS and TLS for `<app-id>.apps.<domain>`. The serving boundary validates the Host against the token before deriving `x-app-user`. No host cookie, bearer token, development secret, or client identity header is sent to that origin.

## Browser isolation

Published pages are served from an origin distinct from the host/API and rendered in an iframe with `sandbox="allow-scripts allow-forms"`, deliberately without `allow-same-origin`. The origin boundary prevents a directly opened app from reading host APIs; the sandbox remains defence in depth for embedded pages.

## Dynamic-tool provenance

Published app/profile tools are the ratified isolated-composition tier. Every mounted tool is bound to and carries its kind, workspace/address, version, and Git SHA. Calls log that provenance; the Apps panel displays it. Tools without a SHA are not mounted, stale versions are rejected, names are platform-namespaced, and workspace/profile ownership is checked again at execution.

## Installation

```ts
// server
// Add "@hachej/boring-app-runner" to defaultPluginPackages.

// front
import { createAppRunnerPlugin } from "@hachej/boring-app-runner/front"
const appRunnerPlugin = createAppRunnerPlugin()
```

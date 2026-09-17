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

On each publish the plugin creates or updates the app folder's private Git repository, commits the publishable files, and uploads bytes from that commit. Dotfiles, Git metadata, ignored files, oversized files, traversal, escaping symlinks, unsafe Git configuration, and nested repositories are rejected or excluded.

## Configuration

- `BORING_APP_RUNNER_URL` — runner base URL (default `http://127.0.0.1:9877`).
- `BORING_APP_RUNNER_TOKEN` — bearer token for runner control-plane and tool calls.
- `BORING_APP_RUNNER_AUTH_SECRET` — optional development forward-auth secret sent as `X-App-Runner-Auth` on control-plane and tool calls.

The front end never receives these credentials. App-serving proxy requests never carry the bearer token. In development they carry `X-App-Runner-Auth` only as far as the trusted hub authentication boundary; the hub strips that secret and the raw identity routing headers before dispatching to app code, then injects only the app-facing `x-app-user` header.

## Browser isolation

Published pages are rendered in an iframe with `sandbox="allow-scripts allow-forms"` and deliberately without `allow-same-origin`. The document therefore receives a unique opaque origin even though the byte proxy is a host route: its scripts cannot read the parent document, host storage/cookies, or same-origin host APIs. Navigation, popups, downloads, and top-level navigation are not granted.

## Installation

```ts
// server
// Add "@hachej/boring-app-runner" to defaultPluginPackages.

// front
import { createAppRunnerPlugin } from "@hachej/boring-app-runner/front"
const appRunnerPlugin = createAppRunnerPlugin()
```

# Runtime Plugin Health + Self-Test Plan

## Problem

Runtime plugin errors currently require a human to open the browser and report what happened.
That made `niche-explorer` take many reload cycles.

## Goal

The agent can reload a plugin, open its pane headlessly, and get one machine-readable verdict.

## Current plugin-system fit

This V1 should align with the plugin system that already exists:

- Runtime/generated plugins live under `.pi/extensions/<id>/`.
- `/api/v1/agent/reload` triggers the existing plugin asset scan before the Pi/session reload.
- The CLI app already exposes runtime-plugin diagnostics at `/api/v1/runtime-plugin-diagnostics`.
- Front plugin load is browser-owned today:
  - browser subscribes to `/api/v1/agent-plugins/events`
  - `useAgentPluginHotReload` imports the runtime front module
  - captured outputs are committed into `PanelRegistry`, `CommandRegistry`, `CatalogRegistry`, and `SurfaceResolverRegistry`
- Pane rendering is already host-wrapped in `PanelRegistry.getWrappedComponent(...)` with `PluginErrorBoundary` and `Suspense`.
- The UI bridge already supports opening panes through `/api/v1/ui/commands` with `kind: "openPanel"`.

Therefore V1 should **not** add a new “open plugin route”. Use the existing UI bridge command path.

## Key simplification

Make V1 **headless-runner-owned**, not host-health-store-owned.

Do not build a browser-to-server health reporting system yet. The self-test runner already owns the
browser, so it can directly collect browser errors, network failures, and DOM state through
Playwright. The host only needs to provide deterministic test hooks that match the existing plugin
system.

This avoids:

- browser → server reporting routes
- per-plugin health stores
- global `window.onerror` attribution
- stale revision cleanup
- polling APIs
- cross-session event replay

## Non-goals

- No data access work.
- No dependency-resolution work.
- No hosted/remote self-test.
- No new plugin backend route for browser health events.
- No persistent health store.
- No new route just to open plugin panes; use the existing UI bridge.

## Result contract

```ts
interface SelfTestResult {
  ok: boolean
  workspaceId?: string
  pluginId: string
  revision?: number
  reloadErrors: SelfTestEvent[]
  pageErrors: SelfTestEvent[]
  consoleErrors: SelfTestEvent[]
  failedRequests: { status?: number; url: string }[] // redacted URL
  pane: {
    found: boolean
    state: "ready" | "error" | "timeout"
    selector: string
    panelId?: string              // registered panel/component id, e.g. "niche-explorer.panel"
    panelInstanceId?: string      // Dockview panel instance id opened by the test
  }
}

interface SelfTestEvent {
  code: string
  message: string // redacted
}
```

`ok` is true only when:

- reload diagnostics have no errors
- no page errors were captured
- no console errors were captured
- no failed requests were captured
- pane state is `ready`

## Design

### Layer 1 — reload/load diagnostics

Use the existing reload and diagnostics path instead of inventing a new health store.

Primary path for the CLI runner:

1. `POST /api/v1/agent/reload`
  - folder mode: no workspace header required
  - workspaces mode: pass `x-boring-workspace-id` or `?workspaceId=<id>`
2. `GET /api/v1/runtime-plugin-diagnostics`
  - same workspace scoping rule
3. Optionally, when available, use `POST /api/boring.reload` as the stricter diagnostics endpoint because it returns `422` for scan/rebuild failures. Do not require this for workspaces mode because the CLI app already exposes the compatible `/api/v1/agent/reload` + diagnostics flow.

Fold these into `reloadErrors`:

- `/api/v1/agent/reload` non-2xx
- `diagnostics[]` from `/api/v1/agent/reload`
- plugin `serverError` from `/api/v1/runtime-plugin-diagnostics`
- plugin `host.lastErrorCode` / `host.lastErrorMessage`
- plugin browser front registration errors seen through the existing `boring-ui:agent-plugins-reloaded` event before the pane opens

Catches:

- invalid manifest
- missing front file
- syntax/transform error
- import rejected by runtime
- front factory registration failure
- unsupported dynamic provider/binding registration

### Layer 2 — deterministic pane selector

Add the marker in the **host wrapper**, not in plugin code.

Current best insertion point:

- `packages/workspace/src/front/registry/PanelRegistry.ts`
- specifically inside `PanelRegistry.getWrappedComponent(...)`, around the existing `PluginErrorBoundary` + `Suspense` wrapper.

The marker should use current plugin-system identities:

```html
<div
  data-boring-plugin-id="niche-explorer"
  data-boring-panel-component-id="niche-explorer.panel"
  data-boring-panel-instance-id="self-test:niche-explorer:niche-explorer.panel"
  data-boring-plugin-revision="12"
>
```

Notes:

- `data-boring-plugin-id` comes from `PanelConfig.pluginId`.
- `data-boring-panel-component-id` is the registered panel id / component id, e.g. `niche-explorer.panel`.
- `data-boring-panel-instance-id` is the Dockview panel instance id, available from pane props (`props.api.id`) when rendered inside Dockview.
- `data-boring-plugin-revision` is optional for static plugins, but should be added for hot-loaded runtime plugins by carrying the SSE revision into the registered `PanelConfig`.

Minimal code-shape:

```tsx
const pluginId = current?.pluginId ?? current?.id ?? panelId
const pluginRevision = current?.pluginRevision
const panelInstanceId = typeof props?.api?.id === "string" ? props.api.id : undefined

return createElement(
  "div",
  {
    className: "h-full min-h-0",
    "data-boring-plugin-id": pluginId,
    "data-boring-panel-component-id": panelId,
    ...(panelInstanceId ? { "data-boring-panel-instance-id": panelInstanceId } : {}),
    ...(pluginRevision !== undefined ? { "data-boring-plugin-revision": String(pluginRevision) } : {}),
  },
  createElement(PluginErrorBoundary, ...),
)
```

Also add a stable error-boundary marker. Current render-crash output goes through
`PluginErrorBoundary` → `ErrorChip`, so avoid text scraping by marking the error fallback:

```html
<div
  data-boring-plugin-error-boundary="true"
  data-boring-plugin-id="niche-explorer"
  data-boring-contribution-kind="panel"
  data-boring-contribution-id="niche-explorer.panel"
>
```

V1 readiness rule:

- pane wrapper found and no captured errors and no error-boundary marker inside it → `ready`
- pane wrapper found but error-boundary marker exists, or front load/register failed → `error`
- pane wrapper not found before timeout → `timeout`

Do **not** add global `window.onerror` or `unhandledrejection` handlers in the app for V1.
Playwright owns browser-error capture during self-test.

If blank-but-mounted panes become a recurring false-pass, add an explicit opt-in marker later:

```html
data-boring-self-test-ready="true"
```

Do not require that marker in V1.

### Layer 3 — CLI-owned headless runner

`boring-ui test-plugin <name>` lives in the CLI and uses Playwright internally.

Command shape:

```txt
boring-ui test-plugin <name> \
  --url <local-server-url> \
  [--workspace <id>] \
  [--panel-id <registered-panel-id>] \
  [--timeout-ms <ms>] \
  [--json]
```

For V1, `--url` should be required. Starting an in-process server can be a later milestone.

Panel target rule:

- If `--panel-id` is provided, use it.
- Otherwise default to `<pluginId>.panel`, matching the scaffolded runtime-plugin convention.
- Plugins that only expose `surfaceResolvers`, `leftTabs`, or multiple custom panels need an explicit target flag in V1. Later we can add `--surface-kind/--surface-target` or browser-side panel discovery.

Runner flow:

1. Build workspace-scoped headers/query:
  - folder mode: plain `/`
  - workspaces mode: navigate to `/workspace/<id>` and pass `x-boring-workspace-id`
2. Attach Playwright collectors before navigation:
  - `pageerror`
  - `console.error`
  - failed requests
  - 4xx/5xx responses
  - existing `boring-ui:agent-plugins-reloaded` events for this plugin
3. Call `POST /api/v1/agent/reload`.
4. Read `/api/v1/runtime-plugin-diagnostics` and record Layer 1 errors.
5. Open the existing CLI UI route in Playwright:
  - folder mode: `<url>/`
  - workspaces mode: `<url>/workspace/<workspaceId>`
6. Wait for the plugin front registration event:
  - success: `detail.type === "boring.plugin.load"` for the target plugin/revision
  - failure: `detail.type === "boring.plugin.front-error"` for the target plugin/revision
7. Open the pane using the existing UI bridge, not a new route:

```http
POST /api/v1/ui/commands
Content-Type: application/json
x-boring-workspace-id: <workspaceId if workspaces mode>

{
  "kind": "openPanel",
  "params": {
    "id": "self-test:niche-explorer:niche-explorer.panel",
    "component": "niche-explorer.panel",
    "title": "Self-test: niche-explorer"
  }
}
```

8. Wait for the deterministic Layer 2 selector:

```css
[data-boring-plugin-id="niche-explorer"]
[data-boring-panel-component-id="niche-explorer.panel"]
[data-boring-panel-instance-id="self-test:niche-explorer:niche-explorer.panel"]
```

9. If found, check for a descendant:

```css
[data-boring-plugin-error-boundary="true"]
```

10. Return `SelfTestResult` as JSON and exit non-zero on failure.

Important sequencing detail:

- Do **not** post `openPanel` immediately after navigation.
- First wait until the browser has registered the plugin front. Otherwise `openPanel` can race the registry and produce an unknown-component warning, then the command is lost.

## Command contract

```txt
boring-ui test-plugin <name> [--workspace <id>] --url <local-server-url> [--panel-id <id>] [--timeout-ms <ms>] [--json]
```

Open implementation choice:

- V1 requires `--url` / an already-running local server.
- V2 may start a temporary in-process CLI server.

## Tasks

- **H1.** Normalize reload/load diagnostics for the runner:
  - call `/api/v1/agent/reload`
  - read `/api/v1/runtime-plugin-diagnostics`
  - optionally use `/api/boring.reload` when present
- **H2.** Add deterministic pane DOM attributes in `PanelRegistry`'s host wrapper.
- **H3.** Carry runtime plugin revision into hot-loaded `PanelConfig` where available.
- **H4.** Add stable error-boundary marker to `PluginErrorBoundary` fallback.
- **H5.** Add `boring-ui test-plugin` runner that captures Playwright errors/network/DOM state and uses the existing `/api/v1/ui/commands` `openPanel` path.
- **H6.** Keep `--url` required for the first milestone; document browser dependency strategy.

## Acceptance

- Seeded invalid manifest / missing front file is visible without manually opening a browser.
- Seeded front import/register failure is reported from existing diagnostics or plugin front events.
- Seeded render crash is reported by Playwright console/page capture or by the stable error-boundary marker.
- Seeded failed request is reported.
- Missing pane selector times out instead of false-passing.
- Runner opens panes through the existing UI bridge route; no new open-plugin route is added.
- Existing runtime plugins still render normally.
- No browser-to-server health event route or persistent health store is added in V1.
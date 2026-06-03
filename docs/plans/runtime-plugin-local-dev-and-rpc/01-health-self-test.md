# Runtime Plugin Health + Self-Test Plan

## Problem

Runtime plugin errors currently require a human to open the browser, click around,
and report what happened. That made `niche-explorer` take many reload cycles.

The first implementation attempt used Playwright as the default oracle. That
proved the wrong default for local plugin DX:

- it tested browser install and host networking more than plugin rendering;
- Vite playground and CLI runtime hosts do not expose the same diagnostics routes;
- unrelated page-level console errors from other plugins could fail the target plugin;
- a runner-owned browser could pass against a fake/synthetic host while the real open workspace still failed.

## Goal

The agent can reload a plugin, ask the already-open workspace UI to open a pane,
and get one machine-readable verdict for that pane:

```txt
ready | loading | error | missing | timeout | no-browser-connected
```

Default `boring-ui test-plugin <name>` should use the **live workspace browser as
the render oracle**, not Playwright.

## Current plugin-system fit

This V1 should align with the plugin system that already exists:

- Runtime/generated plugins live under `.pi/extensions/<id>/`.
- `/api/v1/agent/reload` triggers the existing plugin asset scan before the Pi/session reload.
- Front plugin load is browser-owned today:
  - browser subscribes to `/api/v1/agent-plugins/events`
  - `useAgentPluginHotReload` imports the runtime front module
  - captured outputs are committed into `PanelRegistry`, `CommandRegistry`, `CatalogRegistry`, and `SurfaceResolverRegistry`
- Pane rendering is already host-wrapped in `PanelRegistry.getWrappedComponent(...)` with `PluginErrorBoundary` and `Suspense`.
- The UI bridge already supports opening panes through `/api/v1/ui/commands` with `kind: "openPanel"`.
- The workspace UI already pushes UI state and consumes UI commands through `/api/v1/ui/*`; this plan adds a narrow UI-owned panel-status channel alongside that layer.

Therefore V1 should **not** add a new “open plugin route” or a plugin-specific health route. Use the existing UI bridge command path and add only the missing render-status reporting under the UI state/control boundary.

## Key simplification

Make V1 **live-browser-status-owned**, not Playwright-owned.

The browser is the only process that truly knows whether a React pane rendered,
is still suspended, or hit an error boundary. Let the browser report that narrow
fact to the server, then let the CLI/agent read it.

This avoids:

- launching a second browser for normal DX;
- Playwright browser install/download problems;
- localhost/public URL guessing in remote or proxied setups;
- broad page-console attribution;
- fake-host success that does not reflect the real workspace UI.

Playwright may remain a later CI/headless mode, but it must not be the default
self-test path.

## Non-goals

- No data access work.
- No dependency-resolution work.
- No hosted/remote headless self-test.
- No generic browser-health event bus.
- No global `window.onerror` attribution system.
- No new route just to open plugin panes; use the existing UI bridge.
- No dependency on WorkspaceBridge RPC PR71 for this V1. The status channel should be easy to migrate to WorkspaceBridge later.

## Result contract

```ts
interface SelfTestResult {
  ok: boolean
  workspaceId?: string
  pluginId: string
  revision?: number
  reloadErrors: SelfTestEvent[]
  pane: {
    found: boolean
    state: "ready" | "loading" | "error" | "missing" | "timeout" | "no-browser-connected"
    selector?: string
    panelId: string              // registered panel/component id, e.g. "niche-explorer.panel"
    panelInstanceId: string      // Dockview panel instance id opened by the test
    error?: SelfTestEvent
    lastReportedAt?: string
  }
}

interface SelfTestEvent {
  code: string
  message: string // redacted
}
```

`ok` is true only when:

- reload diagnostics for the target plugin have no errors;
- a browser connected and reported the target pane;
- pane state is `ready` for the requested `pluginId + panelId + panelInstanceId`.

Unrelated console errors from other plugins must not fail this result.

## Design

### Layer 1 — reload/load diagnostics

Use existing reload and plugin asset diagnostics where available, but do not make
CLI-only diagnostics routes mandatory for workspace playground hosts.

Runner flow should tolerate both host shapes:

1. `POST /api/v1/agent/reload`
   - folder mode: no workspace header required
   - workspaces mode: pass `x-boring-workspace-id` or `?workspaceId=<id>`
2. If available, read plugin diagnostics:
   - CLI host: `GET /api/v1/runtime-plugin-diagnostics`
   - workspace host: existing `/api/v1/agent-plugins` and reload response diagnostics are enough for V1
3. Fold only target-plugin diagnostics into `reloadErrors`.

Catches:

- invalid manifest;
- missing front file;
- syntax/transform error surfaced by reload diagnostics;
- import rejected by runtime;
- front factory registration failure;
- unsupported dynamic provider/binding registration for the target plugin.

Missing optional diagnostics endpoints should be recorded as `diagnosticsUnavailable`
for debugging if useful, but must not hard-fail when the live pane status can give
a definitive target-plugin verdict.

### Layer 2 — deterministic pane wrapper + render status reporter

Add the marker and reporter in a dedicated host component, not in plugin code and not as scattered branches across `PanelRegistry`.

Implementation shape:

- `packages/workspace/src/front/registry/PanelRenderStatusBoundary.tsx`
  - owns the marker attributes;
  - owns Suspense fallback status;
  - owns error-boundary status;
  - owns the final ready report.
- `PanelRegistry.getWrappedComponent(...)` should only wrap each plugin panel with this component and pass identity props.
- `PluginErrorBoundary` should expose an explicit callback or render-prop signal so `error` overrides `ready` instead of relying on DOM/text scraping.

The wrapper should expose stable identities:

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
- `data-boring-panel-instance-id` is the Dockview panel instance id from pane props (`props.api.id`).
- `data-boring-plugin-revision` is optional for static plugins, but should be added for hot-loaded runtime plugins by carrying the SSE revision into the registered `PanelConfig`.

The wrapper should report status transitions to the backend:

```ts
type PaneRenderState = "loading" | "ready" | "error" | "missing"

interface PaneRenderStatusReport {
  workspaceId?: string
  pluginId: string
  panelId: string
  panelInstanceId: string
  revision?: number
  state: PaneRenderState
  error?: { code: string; message: string }
  reportedAt: string
}
```

Reporting rules:

- wrapper mount: report `loading`;
- Suspense fallback visible: report `loading`;
- `PluginErrorBoundary` fallback: report `error` with redacted message;
- report `ready` only from the non-fallback child path after commit;
- `error` has precedence over `ready` for the same `panelInstanceId` and revision;
- wrapper unmount: optionally report `missing` for that instance.

Avoid the false-pass shape where an outer wrapper `useEffect` reports `ready` while an inner error boundary has rendered an error fallback.

Do not ask plugin authors to add readiness markers for V1. If blank-but-mounted
panes become a recurring false-pass, add an explicit opt-in marker later:

```html
data-boring-self-test-ready="true"
```

### Layer 3 — UI-owned panel status store

Add a small, workspace-scoped, in-memory status store owned by the workspace UI state/control layer.

Minimal HTTP shape for V1:

```http
PUT /api/v1/ui/panels/status
GET /api/v1/ui/panels/status?panelInstanceId=...
```

This is panel render status, not `test-plugin` state. `test-plugin` is only one consumer. Keep the route narrow, UI-owned, and mechanically migratable to WorkspaceBridge later.

Preferred file shape:

- `packages/workspace/src/server/ui-control/panelStatus/paneRenderStatusStore.ts`
- `packages/workspace/src/server/ui-control/http/paneRenderStatusRoutes.ts`
- focused tests beside the route/store

Store key:

```txt
workspaceId + pluginId + panelId + panelInstanceId
```

Store behavior:

- keep only the latest status per key;
- TTL old entries so closed/stale panes do not accumulate forever;
- redact error messages;
- never store file contents, request payloads, tokens, or stack traces;
- return `no-browser-connected` if no recent UI contact has been seen for the workspace.

Browser liveness should reuse the UI control layer, not invent a separate heartbeat. Update a workspace-scoped `lastUiContactAt` from existing UI touch points:

- `GET /api/v1/ui/commands/next` poll/SSE connections and heartbeats;
- `PUT /api/v1/ui/state`;
- `PUT /api/v1/ui/panels/status`.

This lets the runner distinguish:

- no browser connected (`no-browser-connected`);
- browser connected but panel not yet reported (`timeout`);
- panel reported error (`error`).

Later migration target, after WorkspaceBridge RPC lands:

```txt
ui-panel.v1.status.report   browser -> server
ui-panel.v1.status.get      runtime/agent -> server
```

Do not block this V1 on PR71. Keep the status model close enough that migration is mechanical.

### Layer 4 — CLI default runner over live UI

`boring-ui test-plugin <name>` lives in the CLI but does not launch Playwright by default.

Command shape:

```txt
boring-ui test-plugin <name> \
  [--url <local-server-url>] \
  [--workspace <id>] \
  [--panel-id <registered-panel-id>] \
  [--timeout-ms <ms>] \
  [--json]
```

URL inference should stay friendly:

1. `--url`
2. `BORING_UI_SELF_TEST_URL`
3. `BORING_UI_URL`
4. `BORING_WORKSPACE_URL`
5. `PORT` → `http://127.0.0.1:<PORT>`
6. fallback `http://127.0.0.1:5200`

Workspace inference:

1. `--workspace`
2. `BORING_UI_WORKSPACE_ID`
3. `BORING_WORKSPACE_ID`
4. `BORING_AGENT_WORKSPACE_ID`

Panel target rule:

- If `--panel-id` is provided, use it.
- Otherwise default to `<pluginId>.panel`, matching the scaffolded runtime-plugin convention.
- Plugins that only expose `surfaceResolvers`, `leftTabs`, or multiple custom panels need an explicit target flag in V1.

Runner flow:

1. Build workspace-scoped headers/query.
2. Call `POST /api/v1/agent/reload`.
3. Read available target-plugin diagnostics.
   - Prefer `/api/v1/runtime-plugin-diagnostics` when present.
   - Otherwise use `/api/v1/agent/reload` diagnostics and `/api/v1/agent-plugins/:id/error` when available.
   - Treat `404` from optional diagnostics routes as `diagnosticsUnavailable`, not as failure, when pane status can still decide the target result.
4. Wait until the target panel is registered when the host can expose that signal; otherwise retry `openPanel` until pane status appears or timeout. Do not post exactly once and then wait forever, because browser plugin registration can still be in flight after reload.
5. Open the pane through existing UI bridge command:

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

6. Poll pane status:

```http
GET /api/v1/ui/panels/status?panelInstanceId=self-test:niche-explorer:niche-explorer.panel
```

7. Return `SelfTestResult` and exit non-zero unless `ok === true`.

Important sequencing detail:

- If the status endpoint reports no browser connected, stop quickly with a clear error:

```txt
NO_BROWSER_CONNECTED: open the workspace UI, then rerun boring-ui test-plugin niche-explorer
```

- Do not silently start a nested `boring-ui` server from inside the agent runtime.

### Optional later mode — Playwright/CI

A later `--headless` or `--playwright` mode may launch a browser for CI, but it
must be opt-in and must reuse the same status contract. It should not be the
main implementation path.

If retained later, it should:

- ignore unrelated console errors by default;
- fail only target-plugin diagnostics, target pane error boundary, and target pane network failures when attributable;
- support both CLI and playground host route shapes;
- never be needed for the normal agent-authored plugin loop.

## Command contract

```txt
boring-ui test-plugin <name> [--workspace <id>] [--url <local-server-url>] [--panel-id <id>] [--timeout-ms <ms>] [--json]
```

Default mode requires an already-running workspace UI with at least one browser tab connected.

## Tasks

- **H1.** Replace default self-test design with live UI pane-status reporting; do not make Playwright the default.
- **H2.** Add deterministic pane DOM attributes in `PanelRegistry`'s host wrapper.
- **H3.** Carry runtime plugin revision into hot-loaded `PanelConfig` where available.
- **H4.** Add stable error-boundary marker/status callback to `PluginErrorBoundary` fallback; ensure error suppresses/overrides ready.
- **H5.** Add UI-owned in-memory pane-status store + `/api/v1/ui/panels/status` routes.
- **H6.** Add browser liveness via existing UI control touch points; return `NO_BROWSER_CONNECTED` clearly when no live workspace browser can report status.
- **H7.** Add `boring-ui test-plugin` runner that uses reload + existing `/api/v1/ui/commands` `openPanel` + pane-status polling/retry.
- **H8.** Keep Playwright as deferred/optional CI mode only; remove it from default acceptance.

## Acceptance

- Seeded invalid manifest / missing front file is visible without a human explaining the browser.
- Seeded front import/register failure for the target plugin is reported from reload diagnostics or target plugin status.
- Seeded render crash is reported through target pane `error` status.
- Fixed pane reports `ready` through the live browser without launching Playwright.
- Missing pane status times out instead of false-passing.
- If no browser is connected, the runner returns `NO_BROWSER_CONNECTED` with a clear instruction.
- Runner opens panes through the existing UI bridge route; no new open-plugin route is added.
- Existing runtime plugins still render normally.
- Unrelated console errors from other plugins do not fail the target plugin self-test.
- The status store is UI-owned, narrow, in-memory, TTL-bounded, and redacts errors.
- The runner does not lose the command if plugin panel registration is still in flight; it waits/retries until status or timeout.
- The plan remains mechanically migratable to WorkspaceBridge RPC (`ui-panel.v1.status.report/get`) after PR71 or its successor lands.

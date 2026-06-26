---
github: https://github.com/hachej/boring-ui/issues/258
issue: 258
state: blocked
phase: plan
track: owner
flag: not-needed
updated: 2026-06-26
---

# Browser Use Plugin Spec

Status: draft spec only — no implementation in this PR.

## Goal

Move server-browser automation out of the default workspace package into an optional trusted plugin. The default workspace should keep user-facing screenshots available without Playwright, while browser automation for agents lives behind an explicit `browser-use` plugin boundary.

## Non-goals

- Do not add Playwright to the default workspace runtime.
- Do not expose browser automation tools unless the plugin is enabled.
- Do not implement the plugin in this spec PR.

## Package shape

Use the trusted app/internal plugin shape from `packages/workspace/docs/PLUGIN_STRUCTURE.md`:

```txt
plugins/browser-use/
  package.json
  src/front/index.ts
  src/front/BrowserUsePane.tsx
  src/server/index.ts
  src/server/browserSession.ts
  src/server/tools.ts
  src/shared/types.ts
  tsup.config.ts
  vitest.config.ts
```

The plugin may be published later, but it starts as a repository plugin because it needs trusted server-side capabilities.

## Dependency boundary

`plugins/browser-use` is the only workspace-side package that should import or dynamically import Playwright.

Default workspace behavior:

- HTML preview screenshot button stays available by default using browser-native capture/copy.
- No agent screenshot/browser tool is registered by core workspace.
- No Playwright dependency is required for normal users.

Browser-use plugin behavior:

- If Playwright is installed and the plugin is enabled, register browser agent tools.
- If Playwright is missing, do not register the tools, and surface a clear plugin status in the pane.

## Agent tools

Start with one consolidated tool to keep the agent mental model simple:

```ts
type BrowserUseAction =
  | { action: "open"; url: string }
  | { action: "screenshot"; outputPath?: string; panelInstanceId?: string; panelId?: string }
  | { action: "click"; selector: string }
  | { action: "type"; selector: string; text: string }
  | { action: "waitFor"; selector?: string; ms?: number }
```

Tool name: `browser_use`.

Required properties:

- All file outputs are server-chosen by default under `/tmp/boring-browser-use/`.
- Optional `outputPath` is agent-only and must be contained to an allowlisted directory if exposed.
- `screenshot` returns `{ path, selector?, url }` rather than image bytes.
- The tool must never be exposed through an unauthenticated HTTP route.

Future split, if needed:

- `browser_open`
- `browser_click`
- `browser_type`
- `browser_screenshot`

## Dedicated pane

Register a `browser-use` panel with placement `right` or `bottom`.

Initial pane responsibilities:

- Show plugin availability: Playwright installed/missing.
- Show current browser session URL.
- Show last screenshot path or preview.
- Provide user controls for `Open URL`, `Reload`, and `Take screenshot`.

The pane is observability/control surface only. Agent tools remain the primary automation API.

## Security rules

- Browser automation is opt-in via plugin registration.
- HTTP routes, if any, must be same-origin and authenticated by the host app.
- Do not allow arbitrary localhost/metadata navigation from a generic HTTP request.
- Agent-originated navigation is allowed only because the agent already has trusted workspace tool access.
- Escape all CSS selector interpolation or use Playwright locator APIs that avoid selector string construction.
- Default screenshot output paths are server-generated.
- Clean up browser sessions on workspace/server shutdown.

## Implementation phases

### Phase 1 — plugin scaffold

- Add `plugins/browser-use` package.
- Register front plugin and empty pane.
- Register server plugin that reports Playwright availability.
- No browser automation yet.

### Phase 2 — screenshot-only agent tool

- Move shared screenshot helper into the plugin server code.
- Register `browser_use({ action: "screenshot" })` only when Playwright is available.
- Save screenshots to files and return paths.
- Add focused tests for missing Playwright and output path containment.

### Phase 3 — browser control

- Add persistent browser session manager.
- Add `open`, `click`, `type`, and `waitFor` actions.
- Stream session status to the pane.
- Add tests for session cleanup and selector handling.

## Open questions

- Should the plugin own one browser session per workspace, per agent session, or per pane instance?
- Should browser state be isolated with a temporary user data dir per session?
- Should screenshots be written under `/tmp` only, or into the workspace when the agent asks for durable artifacts?

# Slice 2 real browser/server proof

Runs a real prefixed `createWorkspaceAgentServer` and a Chromium browser. The app plugin registers a pane and `owner.runtime` resolver. The server plugin receives an authenticated proof request and uses its injected, instance-bound bridge via `createWorkspaceUiCommands(ctx.bridge).openSurface`.

```sh
pnpm exec playwright test --config docs/issues/owner-runtime-identity-prefix/browser-proof/playwright.config.ts
```

The test asserts authenticated header polling, token-free URLs, prefixed-only transport, exactly one pane mount, safe unknown/ungranted resolution, and no ChatPanelHost duplicate command drain. Trace, video, screenshot, and JSON output are written to `results/`.

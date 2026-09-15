# Slice 2 proof — real plugin pane over the owner bridge

Bead: `factory-plugin-owner-runtime-identity-prefix-8pdn.2`

## Result

A real Chromium page rendered `WorkspaceAgentFront` against a real listening `createWorkspaceAgentServer` at `/owners/alice/workspace`. The app/runtime plugin registered `owner-runtime-pane` and an `owner.runtime` surface resolver. A server plugin route used its injected instance bridge through `createWorkspaceUiCommands(ctx.bridge).openSurface`, whose sole dispatch is `UiBridge.postCommand`.

The browser used authenticated `fetch` polling because an Authorization header was configured. Every observed command request carried `Bearer pane-proof`, used the prefixed URL, and had no token query parameter. The granted command mounted the pane once. Unknown and ungranted surfaces logged safe resolver misses and did not create another pane. `WorkspaceAgentFront` remained the only drain owner; its ChatPanelHost receives `bridgeEndpoint=null`, preventing duplicate chat-host dispatch.

## Evidence

- `browser-proof/results/plugin-pane-open.png` — final granted pane.
- `browser-proof/results/owner-plugin-pane-*/trace.zip` — Playwright trace with request and assertion timeline.
- `browser-proof/results/owner-plugin-pane-*/video.webm` — browser recording.
- Playwright result: `1 passed (32.3s)` under a bounded 90-second shell timeout.

## Commands

- `timeout 90s pnpm exec playwright test --config docs/issues/owner-runtime-identity-prefix/browser-proof/playwright.config.ts` — PASS, 1/1.
- `pnpm --filter @hachej/boring-workspace typecheck` — PASS.
- `pnpm --filter @hachej/boring-ask-user test -- --runInBand` — PASS, 21 files / 193 tests; one existing skipped test.
- `pnpm --filter workspace-playground exec tsx scripts/bridge-e2e.ts` — PASS, 11/11 checks.
- `pnpm --filter workspace-playground smoke:bridge` — bounded command timed out during dependency declaration builds before smoke execution; the exact smoke script was then run directly after built artifacts were available and passed 11/11.

No production defect was observed, so this slice changes proof infrastructure and evidence only. Runtime/identity slices were not started.

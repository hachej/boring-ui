# Slice 2 real browser/server proof

Runs a real prefixed `createWorkspaceAgentServer` and Chromium browser. The command builds the required package dependency graph first, so it works from a clean checkout.

```sh
timeout 420s docs/issues/owner-runtime-identity-prefix/browser-proof/run-proof.sh
```

The test asserts authenticated, prefixed, token-free polling; records server transport drains and browser-delivered command sequence IDs; and requires the granted command to be delivered exactly once. It also emits a command-shaped chat display event and behaviorally verifies that it cannot dispatch. Unknown/ungranted resolution remains safe. Generated trace, video, screenshot, and JSON are isolated under ignored `.artifacts/`; running proof does not modify tracked evidence. The outer proof harness owns and removes the exact run-scoped workspace after Playwright exits (including failure or signals); server teardown remains defense-in-depth.

The bounded cleanup regression covers normal completion, command failure, and forced SIGTERM without running the browser:

```sh
timeout 30s docs/issues/owner-runtime-identity-prefix/browser-proof/test-workspace-cleanup.sh
```

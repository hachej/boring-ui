# Slice 2 real browser/server proof

Runs a real prefixed `createWorkspaceAgentServer` and Chromium browser. The command builds the required package dependency graph first, so it works from a clean checkout.

```sh
timeout 420s docs/issues/owner-runtime-identity-prefix/browser-proof/run-proof.sh
```

The test asserts authenticated, prefixed, token-free polling; records server transport drains and browser-delivered command sequence IDs; and requires the granted command to be delivered exactly once. It also emits a command-shaped chat display event and behaviorally verifies that it cannot dispatch. Unknown/ungranted resolution remains safe. Generated trace, video, screenshot, and JSON are isolated under ignored `.artifacts/`; running proof does not modify tracked evidence. Server teardown removes its temporary workspace on normal closure, signals, and fatal failures.

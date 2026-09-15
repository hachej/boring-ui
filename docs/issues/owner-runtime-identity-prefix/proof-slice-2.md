# Slice 2 proof — real plugin pane over the owner bridge

Bead: `factory-plugin-owner-runtime-identity-prefix-8pdn.2`

## Result

A real Chromium page rendered `WorkspaceAgentFront` against a listening, prefixed `createWorkspaceAgentServer`. The proof records every server polling drain and every command sequence ID delivered in browser responses. The granted `owner.runtime` command's sequence ID was delivered exactly once and mounted exactly one pane; all delivered IDs were unique. Unknown and ungranted commands produced safe resolver misses without mounting panes.

The page also emitted a real workspace agent-data/chat-display event containing a command-shaped decoy. Browser instrumentation showed that it neither entered command transport nor opened a pane, behaviorally proving display events cannot dispatch commands.

Authenticated requests used only `/owners/alice/workspace`, carried `Bearer pane-proof`, and contained no query token. An outer harness now creates and owns the exact run-scoped workspace, terminates the Playwright process group with bounded TERM→KILL escalation, and removes the workspace after Playwright exits; server cleanup remains defense-in-depth.

## Reproduction

`timeout 420s docs/issues/owner-runtime-identity-prefix/browser-proof/run-proof.sh`

The wrapper builds the required workspace dependency graph from a clean checkout, then runs one bounded Playwright test. Generated JSON, trace, video, and screenshot files live only under ignored `browser-proof/.artifacts/`. No generated browser evidence is tracked.

## Validation

- Browser/server proof: 1/1 passed twice after package build (23.8s and 29.1s); the second exact workspace `/tmp/owner-pane-proof-run.9CzJpr` was absent afterward.
- Cleanup harness: normal completion, command failure, and forced SIGTERM passed; each exact run-scoped directory was absent and each recorded child PID was gone.
- ask-user: 21 files / 193 tests passed; one existing skipped test.
- bridge E2E: 11/11 checks passed.
- Focused proof TypeScript check: passed.
- Post-run: no proof server/browser processes, temporary `owner-pane-proof-*` directories, or generated tracked changes remained.

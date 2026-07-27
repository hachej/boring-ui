# PR #811 review fixes

Applied exactly the three requested review fixes:

- Replaced the global native-session-start count cap with retry-window TTL eviction, sweeping before idempotency lookup and using a dedicated idempotency key helper.
- Retained failed first-prompt receipts through the retry window, then lazily deleted expired native sessions only when a fresh load still showed no assistant reply.
- Centralized workspace session ID replacement and forgetting across pane, pinned, handoff, prompt, and hydrated-reply guard state; deletion now clears the hydrated-reply guard.

Verification:

- `cd packages/agent && npx vitest run src/server/pi-chat` — 11 files passed, 179 tests passed, no type errors.
- `pnpm --filter @hachej/boring-workspace exec vitest run src/app/front/__tests__/WorkspaceAgentFront.test.tsx` — 2 suites passed, 67 tests passed.

No commit was created; changes remain in the working tree.

# #775 proof of work — lean native Pi sessions

## Delivered seam

- Direct/local hosts opt in with `trustedDirectLocalNativeSessions`; without it,
  the native-first-prompt route is not registered and bare Pi transcripts remain
  unavailable.
- A browser-created `local-*` chat stays in memory. Its first prompt uses one
  idempotency key, creates Pi's timestamped JSONL transcript, adopts that native
  ID, and makes at most one same-key response-loss reconciliation attempt.
- The direct store lists and loads bare native transcripts only under that
  capability. Native rename appends Pi `session_info`, requires an assistant
  message, and restores the pre-rename mtime so renaming does not reorder chats.
- The compact App Left row retains Pin and Open controls and supplies Copy ID,
  assistant-gated Rename, and Delete from the ellipsis menu. Clipboard failures
  explain that HTTPS/clipboard access is required.

## Focused verification

Passed in this worktree (with the canonical dependency directory linked because
this isolated worktree has no local `node_modules`):

```text
packages/agent: vitest
  src/server/http/routes/__tests__/piChat.test.ts
  src/server/harness/pi-coding-agent/__tests__/createHarness.test.ts
  src/shared/__tests__/session.test.ts
  src/front/chat/pi/__tests__/remotePiSession.native.test.ts
  src/core/__tests__/piChatSessionService.test.ts
  src/server/pi-chat/__tests__/harnessPiChatService.test.ts
  src/front/chat/session/__tests__/usePiSessions.test.tsx
  → 141 passed

packages/workspace: vitest
  src/front/layout/plugin-tabs/__tests__/AppLeftPaneSessionRow.test.tsx
  → 3 passed
```

`pnpm --filter @hachej/boring-agent typecheck` reaches the changed code cleanly;
its remaining failure is the pre-existing installed dependency mismatch
(`clsx@1.1.1` has no named `clsx` export). Workspace typecheck likewise reaches
this slice cleanly and stops at that dependency mismatch plus an existing
`WorkspaceAgentFront.test.tsx` incompatible cast. `pnpm lint:invariants` passes
the agent scan, then is blocked building the UI package by the same `clsx`
dependency mismatch.

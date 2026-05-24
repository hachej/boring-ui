# Ask-user implementation audit

Bead: `boring-ui-v2-reorg-795d`
Date: 2026-05-24

## Verdict

Ask-user is self-contained on the new WorkspaceBridge path. The supported setup is:

- `@hachej/boring-ask-user/front` for the Questions UI.
- `@hachej/boring-ask-user/agent` for the Pi extension/tool.
- workspace-owned `human-input.v1.*` bridge handlers for request/answer/cancel/pending/transcript.

The old plugin-owned server surface is not public and fails fast if imported internally. No supported answer/cancel flow uses `/api/v1/questions/commands`.

## Audit findings

- Package boundaries: `plugins/ask-user/package.json` exports only `.`, `./front`, `./agent`, `./shared`, and `./package.json`; there is no `./server` export and no `boring.server` entry.
- Shared portability: `plugins/ask-user/src/shared/**` contains no `node:*` imports and no `Buffer` usage.
- Error codes: ask-user error codes are centralized in `plugins/ask-user/src/shared/error-codes.ts`; raw `ASK_USER_*` strings outside that file are test assertions or exported constant names.
- Runtime path: the agent Pi extension calls `human-input.v1.request` through the injected WorkspaceBridge context and reports `ASK_USER_RUNTIME_UNAVAILABLE` when no context exists.
- Frontend path: submit/cancel/pending use `human-input.v1.answer`, `human-input.v1.cancel`, and `human-input.v1.pending`; tests assert `/api/v1/questions/commands` is not called.
- State/race behavior: pending question runtime covers duplicate request replay, one pending per session, timeout, abort, cancel, explicit answer, tab races, transcript policy, and server-restart abandonment.
- Storage seams: ask-user still has a file store/injected store seam for historical internals; workspace-owned pending-question runtime is injected by `createWorkspaceAgentServer`.
- UX/accessibility: Questions pane has accessible form primitives, keyboard submit/cancel coverage, dirty cancel confirmation, close/unmount-without-cancel behavior, terminal statuses, and draft rehydration for close/reopen.
- Logging/security: integration tests assert actor/session/caller context is logged while answers/tokens are redacted.

## Noted non-blocking items

- `plugins/ask-user/src/server/questionsRoutes.ts` remains for historical/internal tests, but the package no longer exports `./server`, `createAskUserServerPlugin()` throws immediately, and supported front/agent paths do not call the route.
- React Testing Library emits existing `act(...)` warnings in a few frontend tests; assertions pass and the warnings are not caused by secret or bridge behavior.

## Commands run

```bash
pnpm --filter @hachej/boring-ask-user run test src/front/__tests__/askUserPlugin.test.tsx src/front/primitives/__tests__/QuestionForm.test.tsx
pnpm --filter @hachej/boring-ask-user run typecheck
pnpm --filter @hachej/boring-ask-user exec vitest run --maxWorkers=1
pnpm --filter @hachej/boring-workspace build
pnpm --filter workspace-playground run test
pnpm typecheck
pnpm lint:invariants
pnpm --filter @hachej/boring-workspace run test
pnpm --filter @hachej/boring-agent run test
pnpm lint
```

All listed commands passed. `workspace-playground` has no test script output and exits 0. The full ask-user suite is stable with `vitest --maxWorkers=1`; earlier default parallel attempts exposed pre-existing timing flakes in server tests that passed on focused rerun and with single-worker execution.

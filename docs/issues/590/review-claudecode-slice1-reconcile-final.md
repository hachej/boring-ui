# Issue #590 Slice 1 — Standards/Spec Review

## Verdict: **GREEN**

## Proof (all green)

```
pnpm --filter @hachej/boring-automation typecheck   ✅ clean
pnpm --filter @hachej/boring-automation test         ✅ 4 files, 15/15 passed
pnpm --filter @hachej/boring-automation build         ✅ ESM + DTS build succeeded
git diff --check -- plugins/boring-automation/        ✅ no whitespace/conflict-marker issues
```

## Checklist vs. `plan.md` / `todo.md`

| Requirement | Status | Evidence |
|---|---|---|
| Single-workspace store (no `ctx`/`workspaceId` threading) | ✅ | `fileStore.ts` — every `AutomationStore` method drops `ctx`; store rooted at one `rootDir` via constructor; `index.ts` derives root from `workspaceRoot` once. |
| Public run routes GET-only | ✅ | `routes.ts` registers only `GET .../runs`; no `POST`/`PATCH` run routes. `routes.test.ts` asserts both return 404 (route not found). |
| Prompt/model snapshots only (no cron/timezone snapshot) | ✅ | `types.ts` `AutomationRun` has `promptSnapshot`/`modelSnapshot` + `scheduledFor`; `cronSnapshot`/`timezoneSnapshot` removed from types, schema, and store; tests assert their absence. |
| Explicit nulls, storage-neutral patch semantics | ✅ | `AutomationRun` fields are `T \| null` (not optional); `applyRunPatch` only skips `undefined`, always writes explicit `null`; schema uses `.nullable().optional()` throughout. |
| Domain errors / HTTP mapping separation | ✅ | `AutomationStoreError` no longer carries an HTTP status; `routes.ts` maps codes → status via `httpStatusForStoreError`. |
| Canonical Markdown commit/recovery tests | ✅ | `fileStore.test.ts`: prompt-first/store.json-last commit order verified via injected-writer-failure test (orphan prompt survives, live cache stays unchanged, store.json absent); missing-prompt test verifies empty-load + repair-via-`updatePrompt`. |
| Route CRUD tests | ✅ | `routes.test.ts` exercises create/read/patch/list/delete for automations, prompt GET/PUT, and read-only run listing, plus 400/404 domain-error mapping. |
| Deleted `schedule.ts` placeholder | ✅ | File removed entirely (not left as an empty stub). |
| No scheduler/session/Postgres scope creep | ✅ | Grep for `setInterval`, `postgres`, cron-library, session-launch terms in `src/` returns nothing; no new dependencies in `package.json`; directory listing shows only shell/store/routes/schema files. |

Also spot-checked for orphaned references to removed exports (`AutomationStoreCtx`, `workspaceCtxFromRequest`, `BORING_AUTOMATION_WORKSPACE_HEADER/DEFAULT_WORKSPACE_ID`, `RunIdParamsSchema`) across the repo — none found outside this diff; `serverPlugin.test.ts` (untouched) still passes since it only exercises the plugin at the HTTP level.

## Blockers

None.

## Non-blockers (optional, don't gate merge)

1. `httpStatusForStoreError` (`routes.ts:124`) is an exhaustive `switch` with no `default`/`never`-check. It compiles today because all 3 current error codes are covered, but a future error code added to `BORING_AUTOMATION_ERROR_CODES` without updating this switch would silently return `undefined` (Fastify would then throw on `reply.status(undefined)`) instead of failing at compile time. Consider an exhaustiveness assertion for defense-in-depth.
2. `docs/issues/590/todo.md` checkboxes are all still unchecked even though this diff implements the Slice 1 items (ctx removal, run-route removal, storage-neutral nulls, Markdown recovery tests, `schedule.ts` deletion). Purely a docs-housekeeping gap, not a code defect.

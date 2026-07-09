Both fixes verified end-to-end. Here is the final re-review.

---

# Thermo-Nuclear Re-Review — PR #592 / Issue #590 Slice 1 (`boring-automation`)

## Verdict

**APPROVE — ship it.** The two required items from the prior audit (BF-1 fail-closed scoping, CJ-1 collapsed run-patch) are both fully resolved, correctly, with no scope creep. Proof reproduced locally: `typecheck` **clean**, `test` **4 files / 17 passed**. The uncommitted diff is surgically minimal — exactly **2 files, +20/−43** — touching only the store and its conformance suite. Nothing else in the plugin moved.

## Blockers

**None.** Both prior blockers verified resolved:

- **BF-1 — fail-closed workspace context ✅.** `matchesWorkspace` now requires a non-empty `ctx.workspaceId` and an exact match (`fileStore.ts:226-228`), so an empty `{}` ctx matches nothing. `createAutomation` no longer stores an unscoped row — `requireWorkspaceId` throws `INVALID_BODY/400` on a missing id (`fileStore.ts:56,230-233`). The conformance test was correctly **inverted**, not deleted: "fails closed when workspace context is missing" now asserts `getAutomation({})→null`, `listAutomations({})→[]`, `listRuns({})→AUTOMATION_NOT_FOUND`, `updateRun({})→RUN_NOT_FOUND` (`automationStoreConformance.ts:112-137`). The fail-open contract is gone at the exact moment there's one implementation — precisely the ask.
- **CJ-1 — collapsed run-patch logic ✅.** `setRunField` + `deleteNullableRunField` (~45 lines of triplicated switches) deleted; `applyRunPatch` is now one typed `Object.entries` loop (`fileStore.ts:235-243`). Slice 6's cost/token fields become a zero-site edit. This also kills prior **NBF-5** — the `String()`/`Number()` dead coercions are gone. The loop is safe against injected keys: `AutomationRunPatchSchema` is `.strict()` at the route and `AutomationRunPatch` constrains direct callers, and only nullable-optional fields can be `delete`d (the required `status` is never nullable, so it can't be dropped).

## No new structural issues

The fix introduces nothing new. One benign behavioral note, not a defect: legacy on-disk rows with `workspaceId: undefined` (none exist in Slice 1) would now become inaccessible under any ctx — that's the *safe* direction (fail-closed), consistent with intent.

## Residuals (all pre-existing, non-blocking, carry to later slices)

Unchanged from the prior audit — none were in scope for this fix, correctly left alone:

- **NBF-2** — run snapshots still client-authored (`routes.ts:109-121`); no server-side capture and no `// TODO(Slice 3)` breadcrumb was added. Cheapest lingering follow-up; add the TODO when Slice 3 lands.
- **NBF-3** — `mutate` mutates in-memory `state` before `writeAtomic` resolves; cache outlives a failed write (`fileStore.ts:188-195`).
- **NBF-4 / CJ-2** — `PATCH …/runs/:runId` still does `listRuns().find()` (O(runs) + N clones) to authorize before `updateRun` re-loads (`routes.ts:127-131`); a `getRun` seam would fold both into one.
- **NBF-6** — local `WorkspaceRequest` re-declaration persists (`routes.ts:25-27`); header branch goes dead once composed under agent middleware.
- **NBF-7 / NBF-8 / CJ-3 / CJ-4** — no cron/timezone semantic validation; shared fixed tmp path in `appWithStore` default (`routes.test.ts:10`); `promptRef` still persisted-and-re-derived; request→ctx resolver still duplicated vs `tasks`.

## Bar

| Gate | Status |
|---|---|
| Proof (`test`, `typecheck`) | ✅ 17/17, clean |
| BF-1 fail-closed | ✅ store + conformance inverted |
| CJ-1 patch collapse | ✅ ~45→~9 lines, coercions dropped |
| Scope discipline | ✅ 2 files, +20/−43, no drift |
| Plan fidelity (no execution/scheduler/session; `schedule.ts` stub) | ✅ intact |

Merge-ready. No further changes required for Slice 1.

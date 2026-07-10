All checks complete. No forbidden scope, clean error construction. Here is the final review.

---

# Thermo-nuclear implementation review — Issue #590 Slice 1

## Verdict: 🟢 GREEN

The unstaged `plugins/boring-automation/**` changes bring Slice 1 into full conformance with `docs/issues/590/plan.md`. Every Loop Exit blocker is resolved and all proof gates pass.

### Proof (verified locally, this diff)
| Gate | Result |
|---|---|
| `typecheck` (`tsc --noEmit`) | ✅ pass, no errors |
| `test` (`vitest run`) | ✅ **15 passed / 4 files** |
| `build` (`tsup`) | ✅ ESM + DTS success |
| `git diff --check` | ✅ clean (no whitespace errors) |
| `schedule.ts` deleted | ✅ `D` in git **and** absent on disk |
| Scope guard grep (timer/cron/pg/session-launch/`.listen`) | ✅ zero matches |

### Blocker resolution (from plan Loop Exit, line 291)
- **Public run mutation routes removed** — `POST …/runs` and `PATCH …/runs/:runId` deleted; only read-only `GET …/runs` remains. Matches Decision 6 + Slice 1 scope. ✅
- **Optional per-call workspace context removed** — `AutomationStoreCtx`, `workspaceId`, `x-boring-workspace-id` header, `defaultWorkspaceId`, and `workspaceCtxFromRequest` all gone; store methods no longer thread a ctx. Matches Decision 4. ✅
- **SQL-incompatible patch semantics fixed** — `applyRunPatch` now writes explicit `null` (`if (value !== undefined) …`) instead of the old JSON-only `delete` on `null`. Nullable fields are storage-neutral per plan line 117. ✅
- **Empty future scaffolding removed** — `schedule.ts` placeholder deleted; no `export {}` stub ships. ✅

### Structural / layering assessment (strict pass)
- **Ownership & type boundaries** — `AutomationStore` interface moved out of `shared/types.ts` into `server/store.ts` (a server-side DI seam); shared now holds only wire/data shapes. Correct altitude. ✅
- **Route/store error boundary** — `AutomationStoreError` no longer carries an HTTP `status`; routes map code→status via `httpStatusForStoreError`. Persistence throws domain errors only. Matches Known Seams (line 127). ✅
- **Atomicity/recovery genuinely improved** — `mutate` now `clone`s the loaded state before applying `fn`, writes, then commits `this.state` **only on success**. A failed metadata write leaves the in-memory cache uncorrupted (previously it mutated the cache in place before writing). Prompt-first / `store.json`-last commit ordering is preserved. Both partial-failure states (orphan prompt on commit failure; missing prompt loads empty and repairs) are explicitly tested. ✅
- **File size** — largest is `fileStore.ts` at 273 lines; nothing bloated. ✅

## Code-judo findings (all non-blocking, ranked)

1. **`AutomationRunCreateSchema` / `AutomationRunPatchSchema` are defined, exported, and unit-tested but referenced by no runtime path.** The run create/patch HTTP routes were removed and the store takes typed inputs without zod validation, so these validators are currently unexercised at any boundary. Defensible because "shared local schemas" is an explicit Slice 1 deliverable and the tests lock the storage-neutral null contract (and reject the old `cronSnapshot`), but a strict eye should note they're forward-looking for the executor slice, not wired now.

2. **`findRunningRun` has no Slice-1 consumer.** It's on the store seam, implemented, and tested, but its only purpose is the scheduler's "skip/conflict while already running" policy — explicitly out of scope for Slice 1. It's 2 lines derived from `listRuns` and part of the intended executor store seam (Decision 6), so acceptable, but it is the one method that anticipates deferred scheduler logic.

3. **`FileAutomationStoreOptions.writer` is a production surface that exists solely for one test** (injecting a failing writer to simulate metadata-commit failure). Justified by the plan's mandate that "both partial-failure states are tested," and it's a minimal, clean seam — flagging only for transparency that it's test-motivated.

## Residual risks (accept for Slice 1)
- **Metadata cache is load-once.** `this.state` refreshes only on `mutate`; a live instance won't observe external `store.json` edits. Canonical **prompts are always read fresh from disk**, so the user-editable contract holds. Correct for the single-workspace/single-writer design; revisit when a second writer or hosted topology lands.
- **No enforcement of the single-writer invariant** for `createRun`/`updateRun` yet — the store seam trusts that the future executor is the sole writer (Decision 6). Fine until the executor slice, but the invariant is currently by-convention only.
- **`promptPath` returns `automationNotFound` for an unsafe id** (semantically an invalid-id, not missing). Unreachable in practice (UUIDs pass the regex and `getAutomation` guards first) — cosmetic only.

## Scope confirmation
No scheduler, in-process timer, session launcher, Postgres store, distributed lock, or empty seam file ships. `schedule.ts` is deleted on disk and in the index. The plugin registers routes only; no lifecycle timer is hidden in `routes()`.

**Recommendation: merge.** The three judo notes are optional polish, not merge gates; item 1 (unused run schemas) is the only one worth a follow-up decision at the executor slice.

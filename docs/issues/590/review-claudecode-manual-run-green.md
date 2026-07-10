## Verdict: GREEN

**Crash-recovery reconciliation (the focus of this re-review):**

`reconcileOrphanedRuns` in `fileStore.ts:254-268` runs inside `beginRun`, scoped to the target `automationId`. It marks any non-terminal run not present in the *current process's* `activeRunIds` set as `failed` ("Automation host restarted before the run completed"), then the subsequent active-run check runs against the now-updated state.

- **New store instance (crash recovery):** `activeRunIds` starts empty, so any persisted `queued`/`running` run is orphaned and gets reconciled to `failed` before a replacement run is admitted. Covered by `automationStoreConformance.ts:65-95` (`"reconciles persisted active runs after host restart before admitting a new run"`), which asserts the orphan flips to `failed` with the correct `completedAt`/`durationMs`/`error`, and the new run is admitted as `queued`.
- **Same-process conflict:** a run this instance itself created is already tracked in its own `activeRunIds`, so reconciliation skips it and the following active-run check still throws `RUN_ALREADY_ACTIVE`. Covered by the concurrent `beginRun` test (`automationStoreConformance.ts:134-144`), which still expects exactly one fulfilled call and one `RUN_ALREADY_ACTIVE` rejection. This confirms the fix didn't loosen the same-process guard.

Ran the full automation suite: **56/56 passing**, including `fileStore.test.ts` and the new `manualRunExecutor.test.ts`.

**Blockers/high across the full diff:** none found.

- Route/schema/type renames (`AutomationRunCreate`→`AutomationRunBegin`, etc.) are consistent and the new `409`/`503`/`400` HTTP mappings match the new error codes.
- Trust plumbing added to `createWorkspaceAgentServer.ts`/`createCoreWorkspaceAgentServer.ts` correctly reuses the existing `entry.trust === "internal"` boundary (already used for bridge-handler trust) to gate the dispatcher/actor resolver — external/user plugin dirs never get `ctx.trusted`, verified by a dedicated test (`createWorkspaceAgentServer.test.ts` "trusted host capabilities are passed only to internal directory plugins") and end-to-end via `folderModeRuntimePlugins.test.ts`, which exercises the real automation route through the CLI wiring.
- I initially suspected `rebuildPlugins`/`rebuildServerPlugins` (hot-reload path) used a non-trusted `ctx`, but that path is explicitly diagnostic-only per its own doc comment — it never installs a new plugin graph, so the boot-time-registered manual-run route is unaffected.
- Ran the full `packages/workspace` suite (1692/1692 passing). `packages/core` has 18 pre-existing failing test files, all Postgres auth errors (`password authentication failed for user "ubuntu"`) in unrelated `db/stores` tests — an environment/credentials issue, not caused by this diff.

No edits made, per instructions.

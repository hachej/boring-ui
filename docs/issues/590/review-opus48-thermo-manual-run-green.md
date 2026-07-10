I've completed a thorough re-review of the manual-run execution path, focused on the two thermo concerns: (1) whether the prior restart wedge is fixed, and (2) whether the fix undermines atomic overlap protection.

## Verdict: ✅ GREEN

### Prior wedge — fixed
Before this slice, one-active-run-per-automation was enforced purely on persisted `queued`/`running` state. A host crash mid-run left the run persisted as `running` forever, permanently wedging the automation (every future `beginRun` threw `RUN_ALREADY_ACTIVE`).

`reconcileOrphanedRuns` (`fileStore.ts:254`) now fixes this: at `beginRun`, any non-terminal run for the target automation that is **not** in the process-owned `activeRunIds` set is marked `failed` ("Automation host restarted before the run completed") before the active-run check runs. On restart `activeRunIds` is empty, so a stale `running` run is reconciled and a new run is admitted. Directly covered by `fileStore.test.ts:65`.

### Atomic overlap — preserved, no hole introduced
The reconcile pass does **not** weaken the mutual-exclusion guarantee:

- **Serialization intact.** `beginRun`'s reconcile + active-scan + insert + `activeRunIds.add` all run synchronously inside a single `mutate` callback, and `mutate` is serialized through `writeChain` (`fileStore.ts:211`). Two concurrent `beginRun`s cannot both pass the active check — verified by the "admits one active run atomically" conformance test (`automationStoreConformance.ts:124`).
- **Reconcile can't clear a live run.** The predicate at `fileStore.ts:261` skips any run in `activeRunIds`. Every run created by this process is added to the set at `beginRun` and removed only on terminal status (`updateRunLifecycle`, `fileStore.ts:184`). So an in-flight run is always tracked, and reconcile only ever fails orphans from a *prior* process — never a concurrently-active run. Overlap remains blocked (the second `beginRun` still hits `RUN_ALREADY_ACTIVE` even when an orphan is present).

### Other checks (no blocker/high)
- **Trusted wiring** (`createCoreWorkspaceAgentServer.ts`, `createWorkspaceAgentServer.ts`): the `actorResolver`/dispatcher `trusted` context is gated to `entry.trust === 'internal'` dir plugins only — no actor-spoofing surface for external plugins. Dispatcher-not-ready is guarded by the proxy.
- **Failure-path cleanup**: executor's `try/catch` always calls `finalizeRun` → terminal status → removes from `activeRunIds`, so no in-process leak on dispatcher/stream errors. A rare `updateRunLifecycle` write failure leaves the run tracked+non-terminal (blocks that automation until restart), but restart reconciliation then clears it — no *permanent* wedge. Acceptable.

Minor observations (not blocking): a `store.json` write failure during `beginRun` leaves a phantom id in `activeRunIds` that references no persisted run (harmless — never matched by reconcile or the active scan); and a stream that ends with no `agent-end`/`error` event defaults to `succeeded`. Neither is a correctness blocker.

The wedge is resolved without regressing the atomic single-active-run invariant.

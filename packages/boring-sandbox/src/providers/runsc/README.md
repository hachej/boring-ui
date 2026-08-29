# Remote-worker multi-lease runsc mechanism

`runsc` is an implementation mechanism behind the `remote-worker` provider. It is not a `SandboxProviderV1` provider or a model-selectable mode.

This slice adds a dormant runtime mechanism for hosting several sandboxes under one authorized workspace. Create replay is keyed by `(workspaceId, clientLeaseId)`. Active operations and retirement are keyed by `(workspaceId, sandboxId)`. Each sandbox root is derived beneath the trusted host root and mounted at `/workspace`:

```text
<trusted sandbox root>/<workspaceId>/<sandboxId> -> /workspace
```

Workspace identity remains the authorization and aggregate-quota key. Sandbox identity only selects an isolated runtime beneath it. Legacy construction without the root lifecycle retains one active runtime per workspace. Owned and pending sessions are capped by the startup recovery ceiling; startup sweep is single-flight and runs only while the runtime owns no session or create reservation.

The runtime fails closed unless multi-root use is explicitly admitted by trusted composition. This slice does not add the authenticated remote-worker handler, protocol negotiation, provider wiring, or a worker capability advertisement.

## Reviewable split manifest

The readable source is partitioned without hidden dependencies:

- **A0 — root/quota/retirement lifecycle:** `runtime/dockerArgv.ts`,
  `runtime/quota.ts`, `runtime/sandboxRootLifecycle.ts`,
  `runtime/sessionRetirement.ts`, their focused tests, and only their related
  `runsc/index.ts` exports. A0 also carries the four exact Docker `ps` recovery
  mock hunks in `sessionRuntime.test.ts` (the removal-retry cases at the
  `removeAttempts >= 2 && removeAttempts <= 4`, `removeAttempts === 1`,
  failed-create `removeAttempts === 1`, and `failedRemovalPending` branches).
  Until A1 lands, A0 exports `CompositeRunscSessionRetirementV1` directly from
  `sessionRetirement.ts`.
- **A1 — composite session runtime/state:** `runtime/sessionState.ts`,
  `runtime/sessionRuntime.ts`, `runtime/sessionRecord.ts`,
  `runtime/sessionTypes.ts`, all A1-only session tests and integration scripts,
  the remaining documentation, and the remaining session exports in
  `runsc/index.ts`.

The later authenticated handler/protocol qualification is a separate A2. Its
adapter must not pass `workspaceMountSource` to composite create; A1 derives
that mount solely from the trusted root lifecycle. A0 must typecheck, build,
and test against the legacy base runtime; A1 stacked on A0 must reproduce this
full source tree.

## Evidence in this slice

Focused tests cover composite identity, per-sandbox root creation, independent retirement, cleanup retry, and workspace-aggregate quota addressing. The existing runsc integration exercises the runtime directly. It is non-admitting evidence and does not qualify or advertise remote-worker multi-lease support.

Run the local integration after building the package:

```bash
NODE_OPTIONS=--max-old-space-size=6144 pnpm -C packages/boring-sandbox build
RUN_RUNSC_INTEGRATION=1 pnpm -C packages/boring-sandbox test:runsc:integration
```

On the currently installed gVisor profile, `openat2` returns `ENOSYS`. The runtime rejects creation with `REMOTE_WORKER_PATH_PRIMITIVE_UNAVAILABLE` and removes the provisional container. A compatible profile or separately designed and security-reviewed containment primitive is still required before provider qualification.

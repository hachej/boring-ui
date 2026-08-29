# Remote-worker multi-lease runsc mechanism

`runsc` is an implementation mechanism behind the `remote-worker` provider. It is not a `SandboxProviderV1` provider or a model-selectable mode.

This slice adds a dormant runtime mechanism for hosting several sandboxes under one authorized workspace. Create replay is keyed by `(workspaceId, clientLeaseId)`. Active operations and retirement are keyed by `(workspaceId, sandboxId)`. Each sandbox root is derived beneath the trusted host root and mounted at `/workspace`:

```text
<trusted sandbox root>/<workspaceId>/<sandboxId> -> /workspace
```

Workspace identity remains the authorization and aggregate-quota key. Sandbox identity only selects an isolated runtime beneath it. Legacy construction without the root lifecycle retains one active runtime per workspace. Owned and pending sessions are capped by the startup recovery ceiling; startup sweep is single-flight and runs only while the runtime owns no session or create reservation.

The runtime fails closed unless multi-root use is explicitly admitted by trusted composition. This slice does not add the authenticated remote-worker handler, protocol negotiation, provider wiring, or a worker capability advertisement.

## Evidence in this slice

Focused tests cover composite identity, per-sandbox root creation, independent retirement, cleanup retry, and workspace-aggregate quota addressing. The existing runsc integration exercises the runtime directly. It is non-admitting evidence and does not qualify or advertise remote-worker multi-lease support.

Run the local integration after building the package:

```bash
NODE_OPTIONS=--max-old-space-size=6144 pnpm -C packages/boring-sandbox build
RUN_RUNSC_INTEGRATION=1 pnpm -C packages/boring-sandbox test:runsc:integration
```

On the currently installed gVisor profile, `openat2` returns `ENOSYS`. The runtime rejects creation with `REMOTE_WORKER_PATH_PRIMITIVE_UNAVAILABLE` and removes the provisional container. A compatible profile or separately designed and security-reviewed containment primitive is still required before provider qualification.

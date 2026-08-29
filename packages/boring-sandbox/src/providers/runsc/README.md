# Remote-worker multi-lease runsc mechanism

`runsc` is an implementation mechanism behind the `remote-worker` provider. It is not a `SandboxProviderV1` provider or a model-selectable mode.

The `multi-sandbox-roots-v1` health capability means one authorized workspace may own several isolated worker sandboxes. Create replay is keyed by `(workspaceId, clientLeaseId)`. Active operations and retirement are keyed by `(workspaceId, sandboxId)`. Each sandbox mounts exactly:

```text
<trusted sandbox root>/<workspaceId>/<sandboxId> -> /workspace
```

Workspace identity remains the authorization, placement, credential, and aggregate-quota key. Sandbox identity only selects one isolated runtime beneath it. Legacy workers without the capability retain one active runtime per workspace.

A worker must set `multiSandboxRootsQualified: true` only after its exact workload image and gVisor profile pass the containment-helper qualification. Merely configuring per-sandbox roots does not advertise the capability.

## Current qualification status

The source and mocked authenticated handler tests cover composite identity, two-root isolation, independent renewal/deletion, cleanup retry, and workspace-aggregate quota addressing. The local Docker+runsc proof also confirms two raw bind roots are isolated and independently deleted.

The installed gVisor profile returns `ENOSYS` for `openat2`. The production provider → authenticated handler → `RunscSessionRuntimeV1` path therefore rejects admission with `REMOTE_WORKER_PATH_PRIMITIVE_UNAVAILABLE`, removes the provisional container/root, and does not advertise `multi-sandbox-roots-v1`.

Status: **implemented but not qualified**. Qualification remains blocked until an owner-approved compatible gVisor profile is available or a separate containment primitive is designed and security-reviewed. Do not treat the raw mount proof as production admission evidence.

Run the bounded local proof after building the package:

```bash
NODE_OPTIONS=--max-old-space-size=6144 pnpm -C packages/boring-sandbox build
pnpm -C packages/boring-sandbox test:remote-worker:multi-lease
```

A successful command reports `passed: true` and `qualified: false`; this means the fail-closed and raw isolation proofs passed, not that the provider is qualified.

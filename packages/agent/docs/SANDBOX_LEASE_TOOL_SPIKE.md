# Leased temporary-sandbox tool spike

This is a deliberately small, server-only spike. It does **not** register a
normal Agent runtime tool or redirect the existing runtime filesystem/sandbox.
Instead, a host that has already authenticated a Worker constructs
`SandboxLeaseService` with its chosen `SandboxProviderV1`, host-owned workspace
root, and bounded TTL. The service creates a fresh
`WorkspaceSandboxPairV1` per lease and exposes only the pair through an opaque
handle.

## API sketch

```ts
const provider = createVercelSandboxProvider({ lifecycle: 'disposable' })
const service = new SandboxLeaseService({
  provider,                         // host-injected disposable SandboxProviderV1
  workspaceRoot: '/host/verification-sandboxes', // host-owned only
  ttlMs: 10 * 60_000,
})

const { handle } = await service.acquire(workerId)
await service.runSandbox({
  op: 'exec', ownerId: workerId, lease: handle, command: 'pnpm test',
})
await service.runSandbox({
  op: 'upload', ownerId: workerId, lease: handle,
  path: 'evidence/result.json', content: bytes, overwrite: false,
})
await service.runSandbox({ op: 'release', ownerId: workerId, lease: handle })
```

`runSandbox` supports `exec`, `read`, `write`, `list`, `stat`, `upload`, and
`release`. `exec` intentionally accepts neither `cwd` nor environment values.
All filesystem paths are validated POSIX-relative paths. `upload` accepts bytes
already held by the caller and writes them through `Workspace` binary methods;
it never accepts a host source path, URL, provider configuration, credentials,
or secrets. `ownerId` is host-authenticated identity, not an agent-supplied
claim. A mismatched owner receives the same unavailable-lease error as an
unknown handle.

## Reused abstractions

- `SandboxProviderV1.create()` creates the disposable target.
- `WorkspaceSandboxPairV1` preserves the paired workspace/sandbox invariant and
  supplies disposal.
- `Workspace` provides read/write/list/stat and binary upload operations.
- `Sandbox` provides lease-scoped command execution.

No Vercel command, Vercel/Vault configuration, or credential flow appears in
the lease service. A Vercel host must explicitly construct
`createVercelSandboxProvider({ lifecycle: 'disposable' })`; disposing that pair
deletes the remote sandbox and its cached handle. The provider's default remains
`persistent` for normal Agent runtimes.

## Future Agent Worker integration

The future Worker tool catalog should acquire a lease after host authorization,
retain the handle only for the verification subtask, dispatch catalog calls to
`runSandbox`, and release it in `finally`; the host scheduler should also call
`reapExpired()`. It should not add these methods to the Worker’s ordinary
runtime `Workspace`/`Sandbox`, and should not expose the provider or the
host-owned workspace root in tool parameters.

## Production gaps

- The embedding host still needs authenticated Worker identity, rate/concurrency
  limits, audit/telemetry, and a scheduler for `reapExpired()`.
- Provider-specific network/image/isolation policy and proof are outside this
  neutral contract; choose only a qualified disposable provider for production.
- A production host still needs retry/alerting for disposal failures. Failed
  cleanup retains the lease so release or expiry reaping can retry it.
- This in-memory lease registry is process-local and has no cross-process
  coordination or crash recovery.

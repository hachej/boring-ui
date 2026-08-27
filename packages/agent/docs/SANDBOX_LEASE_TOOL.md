# Leased verification sandboxes

`SandboxLeaseService` is a server-only foundation for temporary verification targets. It does not register an Agent tool and does not redirect an Agent's ordinary runtime `Workspace` or `Sandbox`.

A trusted host constructs the service with a qualified disposable provider, a host-owned workspace root, and a bounded TTL:

```ts
const provider = createVercelSandboxProvider({
  lifecycle: 'disposable',
  immutableCacheSource: hostResolvedCacheSource,
})
const service = new SandboxLeaseService({
  provider,
  workspaceRoot: '/host/verification-sandboxes',
  ttlMs: 10 * 60_000,
})
```

For Vercel, `immutableCacheSource` is a host-resolved opaque snapshot reference. The provider creates a new mutable sandbox from that immutable base. Disposing the pair deletes the remote fork, evicts its process cache, and deletes its persisted handle. Default Vercel provider behavior remains persistent unless `lifecycle: 'disposable'` is explicit.

## Operations and authority boundary

The service supports `exec`, `read`, `write`, `list`, `stat`, `upload`, and `release` against an opaque lease. Each call is also bound to host-authenticated owner identity. Another owner receives the same unavailable error as an unknown handle.

`ownerId` is an internal service binding, not a Worker claim. A future Worker tool adapter must inject authenticated owner identity and expose only the lease plus operation-specific fields. It must not expose:

- provider configuration or identity;
- snapshot/cache/image references;
- environment values or credentials;
- network/resource controls;
- host paths;
- cache publication or deletion operations.

`exec` intentionally accepts neither cwd nor environment overrides. Filesystem paths are validated POSIX-relative paths. Upload accepts bytes already held by the caller and never accepts a host source path or URL.

## Lifecycle

- `release` disposes the provider pair before removing the local lease.
- Failed provider cleanup retains the lease so release or expiry reaping can retry.
- `reapExpired()` is the host scheduler hook for TTL cleanup.
- `dispose()` releases all leases during orderly host shutdown.
- Hosts still need bounded concurrency, audit/telemetry, and crash reconciliation before broad production use.

Only trusted CI may publish immutable cache snapshots. This consumer surface cannot publish or mutate the base artifact; every fork is independently mutable and disposable.

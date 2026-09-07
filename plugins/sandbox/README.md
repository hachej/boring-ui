# Trusted disposable sandbox plugin

`@hachej/boring-sandbox-plugin` is a server-only, additive trusted plugin. It exposes exactly two model-visible tools to a selected, independently host-authorized Agent:

```text
sandbox({ op: "create" }) -> { sandbox, expiresAt }
sandbox({ op: "list" })
sandbox({ op: "status", sandbox })
sandbox({ op: "release", sandbox })

sandbox_bash({ sandbox, command, ...canonicalBashOptions })
```

It does not replace or wrap canonical `bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`, or `upload_file`. Those tools retain their normal names, descriptions, schemas, and primary-workspace behavior. The plugin exposes no named filesystem, runtime target, file-tree, provider, profile, credential, snapshot, TTL, quota, root, or owner inputs.

## Host authority

The app host must construct the plugin with two independent decisions:

```ts
createSandboxServerPlugin({
  workspaceScopeId: hostWorkspaceScopeId,
  authorizedAgentTypeIds: hostSandboxAgentAllowlist,
  pluginContentDigest: admittedSandboxPluginPackageDigest,
  authorityDigest: hostSandboxPolicyDigest,
  createLeaseService: ({ workspaceScopeId, agentTypeId }) =>
    new SandboxLeaseService({
      provider: hostResolvedDisposableProvider,
      workspaceRoot: hostSandboxLeaseRoot,
      providerWorkspaceId: workspaceScopeId,
      serviceDigest: hostSandboxPolicyDigest,
      ttlMs: hostTtlMs,
      reapIntervalMs: hostReapIntervalMs,
      drainTimeoutMs: hostDrainTimeoutMs,
      maxActiveLeasesPerOwner: hostOwnerQuota,
      maxActiveLeasesTotal: hostTotalQuota,
    }),
})
```

Agent-authored `plugins: [{ name: "sandbox" }]` selection is necessary but insufficient. Projection calls the trusted factory, which rejects Agents absent from the host-owned allowlist. The plugin has an empty authored config contract. Provider/profile/credentials/paths/quotas/TTL and `immutableSnapshotId` stay closed over the host factory and participate in the host-provided authority digest. Runtime identity hashes the independently admitted plugin package/executable digest and the authority digest as separate labeled inputs.

Ownership is derived from the host-captured workspace scope, selected Agent type, and exact execution session. A missing or mismatched session/workspace is rejected. Cross-owner handles are indistinguishable from unknown handles.

## Lifecycle and security properties

- Pending, active, draining, and cleanup-debt leases count against quotas.
- `sandbox_bash` pins the leased `Workspace + Sandbox` pair through `withPair`; it strips `sandbox` before delegating to the normal boring-bash implementation.
- Release, expiry, session deletion, and graceful host close enter drain before provider deletion.
- Drain timeouts and provider cleanup ambiguity remain visible and retryable; cleanup debt remains registered and quota-counted.
- Session deletion joins selected-plugin cleanup after backend deletion. Cleanup failure does not falsely return success.
- Fastify `onClose` stops service reapers, drains leases, and closes providers.
- Disposable Vercel creation uses deterministic correlation/reconciliation. Unpublished cleanup stays owned by the returned pair and does not enter the persistent resumable handle store.

The lease registry is process-local. SIGKILL loses local handles, quota records, and cleanup ownership. Provider retention/timeout and an operator sweep remain required after ungraceful host death; graceful cleanup must not be presented as SIGKILL-safe durability.

## Live Vercel smoke

The credential-gated smoke creates an immutable snapshot, forks isolated disposable leases, executes through `sandbox_bash`, proves canonical bash remains unchanged, verifies operation pinning and remote deletion, and checks the provider compute deadline:

```bash
RUN_VERCEL_SANDBOX_LEASE_SMOKE=1 \
  pnpm --filter @hachej/boring-sandbox-plugin run smoke:vercel
```

Credentials and policy are supplied only by the invoking host environment. The receipt is redacted.

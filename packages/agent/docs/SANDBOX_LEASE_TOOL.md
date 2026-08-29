# Native disposable sandbox tools

A trusted host may grant an Agent runtime a `ResolvedSandboxToolCapability`.
The capability adds one lifecycle tool and one optional argument to the existing
canonical coding tools:

```text
sandbox({ op: "create" }) → { sandbox, expiresAt }

bash({ command, sandbox? })
read/write/edit/find/grep/ls({ ..., sandbox? })
upload_file({ ..., sandbox? }) // only when upload_file is enabled

sandbox({ op: "release", sandbox })
```

Omitting `sandbox` preserves the primary user workspace exactly. Supplying an
opaque lease explicitly targets that disposable `Workspace + Sandbox` pair.
There is no mutable current-sandbox switch. One Agent session may create and
use several leases concurrently.

## Host authority

The embedding host constructs one shared `SandboxLeaseService` for an authorized
profile and passes it only after Agent authorization. Multi-provider hosts use a
versioned `SandboxLeaseProviderProfileV1`; its canonical digest binds workspace
scope, placement, physical provider workspace, lease root, provider/template
fingerprints, credential-version references, TTL, drain policy, and quotas.
Live clients and secret bytes are excluded from that identity. Scope and digest
validation run before environment, provider, or harness acquisition.

For simple Vercel-only composition:

```ts
const provider = createVercelSandboxProvider({
  lifecycle: 'disposable',
  immutableCacheSource: hostResolvedCacheSource,
})
const leases = new SandboxLeaseService({
  provider,
  workspaceRoot: '/host/verification-sandboxes',
  serviceDigest: hostPolicyDigest,
  ttlMs: 10 * 60_000,
  reapIntervalMs: 30_000,
  drainTimeoutMs: 30_000,
  maxActiveLeasesPerOwner: 3,
  maxActiveLeasesTotal: 12,
})

return {
  ...runtimeScope,
  sandboxTools: { digest: hostPolicyDigest, leases },
}
```

Multi-provider hosts should call `SandboxLeaseServiceFactoryRegistry.getOrCreate`
with the canonical profile digest and construct through
`createSandboxLeaseServiceFromProfileV1`. Concurrent bindings then share one
service/provider/timer; failed construction is retryable, while a conflicting
preconstructed service is rejected without disposing either candidate.

The model cannot supply provider, snapshot, image, repository, environment,
credentials, resources, network policy, TTL, quotas, host paths, or owner ID.
Ownership is derived by the host from workspace scope, Agent type, and exact
Agent session. `list` means list-own; another owner receives the same unavailable
response as an unknown handle.

The capability digest participates directly in runtime binding and reload
identity. A changed profile/cache/quota grant requires a new binding rather than
hot-mutable authority. Authored agents and plugins cannot self-grant this
capability or replace its reserved standard-tool names.

## Execution and source proof

Repository checkout is ordinary targeted bash, not a management input:

```text
bash({ sandbox, command: "git fetch origin <ref> && git checkout --detach <ref>" })
bash({ sandbox, command: "git rev-parse HEAD" })
```

The resolved HEAD is accepted proof; a branch label is not. The host still
controls which repository/profile and credentials exist in the base. Targeted
tools inherit neither the primary runtime environment, host storage root,
filesystem bindings, nor secrets. `sandbox` plus a named `filesystem` is
rejected; `filesystem: "user"` means the leased user workspace.

## Lifecycle and accepted work

`sandbox.create` and `sandbox.release` are external effects. They run through
the AgentHost accepted-work ledger introduced by prerequisite PR #1446.
Completed requests replay their receipts; outcome-unknown requests never
reinvoke the model-requested effect. `sandbox.list` and `sandbox.status` are
observations and execute without accepted-work provenance.

Operational tools pin the pair through `withPair`. Release, expiry, owner-end,
and host shutdown atomically enter draining, reject new pins, wait a bounded
time for existing operations, then delete. A pre-provider drain timeout has its
own safely retryable error; provider cleanup ambiguity remains
`cleanup-pending` and continues counting against quota. Session deletion joins
owner cleanup. Host shutdown uses one service-wide drain deadline, including
pending creations and provider close.

Lease composition rejects a normal `SandboxProviderV1`; providers must expose
the explicit `boring-sandbox.disposable-provider.v1` refinement. Supported
mechanical profiles are:

| provider | disposable behavior |
| --- | --- |
| direct | fresh exact child root; pair removes only that root |
| bwrap/local | fresh exact child root mounted at `/workspace`; pair removes only that root |
| Blaxel | fresh strict create, no Volume or handle store, correlated delete |
| Vercel Sandbox | fresh named fork, no resumable handle, correlated delete |
| remote-worker | requires qualified `multi-sandbox-roots-v1`; pair alone owns published delete |

Default construction remains persistent/unchanged. Direct and bwrap are not
hostile multi-tenant boundaries; managed and remote-worker profiles still
require separate D31 host qualification before a Worker grant.

Disposable Vercel forks never enter the persistent/resumable handle store. The
provider returns a cleanup-capable pair immediately after remote creation and
exposes initialization through pair readiness; if setup fails, lease acquisition
retains that unpublished pair as cleanup-pending until idempotent deletion
converges. Persistent non-disposable runtimes keep their existing resumable
handle lifecycle.

Remote deletion is separate registered host maintenance:

```text
operationId: sandbox.remote.dispose.v1
key: sha256(serviceDigest + ":" + opaqueLease)
```

The service-owned unref'ed timer reaps expired and cleanup-pending leases without
overlapping ticks. Session deletion settles before idempotent owner cleanup;
a cleanup failure cannot rewrite a completed deletion receipt and remains
retryable through the lease reaper. Every attempt is routed through the closed internal
registration and emits redacted append-only reconciliation telemetry containing
the registration-key digest, attempt count, reason, outcome, and stable failure
code. Retrying this qualified idempotent cleanup never rewrites an
outcome-unknown external-effect receipt. Host shutdown clears the timer and
awaits bounded service disposal. Creation rechecks cancellation and closure
after provider creation and health checks; failed unpublished-pair compensation
is retained as cleanup-pending maintenance.

## Current boundaries

- Only canonical `bash`, file tools, and enabled `upload_file` are targetable.
- Plugin, MCP, UI, custom tools, and `execute_isolated_code` cannot resolve leases.
- The registry is process-local. Broad multi-host automation still requires a
  durable lease registry and reconciler.
- Trusted main CI cache publication, cache registry/retention, affected-package
  planning, brokered credentials, and Seneca Worker-only policy remain separate
  slices.

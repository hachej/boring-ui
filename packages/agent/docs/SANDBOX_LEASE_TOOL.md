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
profile and passes it only after Agent authorization:

```ts
const provider = createVercelSandboxProvider({
  lifecycle: 'disposable',
  immutableCacheSource: hostResolvedCacheSource,
  telemetrySalt: hostTelemetrySalt,
})
const leases = new SandboxLeaseService({
  provider,
  workspaceRoot: '/host/verification-sandboxes',
  serviceDigest: hostPolicyDigest,
  providerWorkspaceId: authorizedWorkspaceId,
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

## Lifecycle and interim tool execution

All four operations use one ordinary `AgentTool`. `sandbox.create` and
`sandbox.release` call the lease service directly; `sandbox.list` and
`sandbox.status` are observations over that same service. This delivery does
not introduce a private nested-effect protocol ahead of the durable tool
execution work in `docs/plans/durable-streams-p1a-plan.md` P1-A3.

The current Agent recovery contract never automatically resumes an interrupted
model turn. Provider creation still uses a host-minted deterministic request ID
and reconciles ambiguous Vercel creation before separately keyed cleanup.
However, the process-local lease registry does not durably deduplicate a
manually repeated tool call after its result was lost. Repeating `create` is a
new request and may create another bounded lease; quotas, TTL, owner cleanup,
and provider cleanup remain the interim containment. While the process remains
alive, `sandbox.list` exposes successfully published owned leases.

Operational tools pin the pair through `withPair`. Release, expiry, owner-end,
and host shutdown atomically enter draining, reject new pins, wait a bounded
time for existing operations, then delete. A pre-provider drain timeout has its
own safely retryable error; provider cleanup ambiguity remains
`cleanup-pending` and continues counting against quota. Session deletion joins
owner cleanup. Host shutdown uses one service-wide drain deadline, including
pending creations and provider close.

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
overlapping ticks. Every attempt is routed through the closed internal
registration and emits redacted append-only reconciliation telemetry containing
the registration-key digest, attempt count, reason, outcome, and stable failure
code. Retrying this qualified idempotent cleanup does not replay a model-requested
lifecycle operation. Host shutdown clears the timer and awaits bounded service
disposal. Creation rechecks cancellation and closure
after provider creation and health checks; failed unpublished-pair compensation
is retained as cleanup-pending maintenance.

## Live smoke

With D31-qualified Vercel credentials supplied through the environment, the
credential-gated smoke creates one immutable snapshot, forks two disposable
leases, proves inherited and isolated bytes, executes inside a targeted lease,
proves release waits for an active pin, verifies remote deletion, and cleans the
snapshot plus every sandbox:

```bash
RUN_VERCEL_SANDBOX_LEASE_SMOKE=1 \
  pnpm --filter @hachej/boring-agent run smoke:vercel-sandbox-leases
```

The command emits only redacted digests and a bounded boolean/timing receipt.

## Current boundaries

- This delivery admits only Vercel disposable leases. Blaxel,
  remote-worker/runsc, direct, and bwrap disposable profiles are excluded.
- Only canonical `bash`, file tools, and enabled `upload_file` are targetable.
- Plugin, MCP, UI, custom tools, and `execute_isolated_code` cannot resolve leases.
- The registry is process-local. Tool-call receipts are not replayable across
  process restart, and a manually repeated `create` may allocate another lease.
  Durable nested tool-effect admission/settlement and a durable lease registry
  remain future work.
- Trusted main CI cache publication, cache registry/retention, affected-package
  planning, brokered credentials, and Seneca Worker-only policy remain separate
  slices.

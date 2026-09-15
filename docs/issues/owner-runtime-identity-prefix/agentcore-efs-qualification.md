# ECS-local / AgentCore shared-EFS qualification

Status: **deterministic host-contract coverage only; live AWS unverified**. No AWS credentials or disposable AgentCore/EFS infrastructure were available for this slice. The tests do not establish AWS service semantics, IAM, network isolation, encryption, or durability.

## Host fixture

`apps/factory-playground/src/server/agentcoreEfsRuntime.ts` defines two application-owned names (`factory:ecs-local-efs` and `factory:agentcore-remote-efs`) with `createProviderRuntimeModeAdapter`. They are deliberately absent from builtin IDs and auto detection. Factory's production composition root accepts a host-only `runtimeModeAdapter`; browser and Agent input cannot select it. The application must supply an authenticated `AgentCoreRuntimeClient` and a `PostgresFencedSandboxHandleStore`; the adapter has no AWS SDK dependency.

The EFS access point must expose `<accessPointRoot>/<tenantId>/<workspaceId>` to ECS. AgentCore must mount that exact namespace at `<runtimeRoot>/<tenantId>/<workspaceId>`. Before acquiring a remote lease, the adapter lexically canonicalizes the host and POSIX roots, performs `lstat` and `realpath` checks over the existing access-point/tenant/workspace components, rejects symlinks, and verifies the canonical workspace remains beneath the canonical access-point root. AgentCore-reported and per-exec cwd values must be canonical POSIX absolute paths contained by `posix.relative`.

These filesystem checks are intentionally fail-closed but inherently TOCTOU-prone: namespace entries can change after inspection. They are defense in depth, not production confinement. EFS access-point identity/root isolation and IAM are the production authority. The host must not expose a broader mount or rely on string/path preflight as a substitute.

The remote pair owns an `active → disposing → disposed` lifecycle. Fence renewals are serialized; resume/create is reverified by a current fenced mutation before publication; fence loss aborts in-flight work and blocks new calls; disposal aborts and drains calls before releasing its lease. Normal disposal releases ownership only—it never deletes the persisted AgentCore session or any EFS data. Provider deletion is reserved for a newly created but unpublished session (or retrying its recorded cleanup debt), and successful, failed, or ambiguous outcomes are written through the fenced store.

## Deterministic qualification

`apps/factory-playground/src/server/agentcoreEfsRuntime.test.ts` exercises both local and fake-remote adapters against the same host namespace and compares a real SHA-256, while explicitly remaining a fake-provider test. It also covers canonical cwd rejection, traversal and duplicate separators, pre-aborted execution, symlink preflight before acquisition, distinct workspace keys, restart/resume reconstruction, serialized renewal and fence loss, in-flight draining, retryable shared disposal, and unpublished-session cleanup outcomes. Core's `PostgresFencedSandboxHandleStore.test.ts` separately exercises the real Postgres implementation with reconstructed clients/stores, encrypted handle restart, independent discriminator keys, stale fences, renewal loss, and cleanup outcomes. Neither suite is a live AgentCore claim.

## Disposable live qualification (not yet run)

1. Provision a disposable encrypted EFS filesystem and one access point confined to the test tenant. Mount it in the ECS host at `ACCESS_POINT_ROOT`; mount the same access point in the disposable AgentCore runtime at `RUNTIME_ROOT`. Restrict IAM to that runtime/access point and enable CloudTrail/provider logs.
2. Apply Core migration `0029_fenced_sandbox_handles.sql`, construct `PostgresFencedSandboxHandleStore` with an application KMS-derived 32-byte cipher key, and inject it with an authenticated `AgentCoreRuntimeClient`. Never log the opaque handle or lease token.
3. Create the adapter with unique `hostScope`, tenant, workspace, and lease owner. Write random bytes through `bundle.workspace`; execute `sha256sum` remotely with no cwd override. Record matching SHA-256 values and both configured roots (not credentials/handles).
4. Dispose the pair, restart the ECS process, reconstruct the database/store/client/adapter, reacquire it, and prove the client resumes rather than creates. Run simultaneous claims for the same key (exactly one may acquire) and distinct workspace keys (both must acquire). After lease expiry, prove the old generation cannot renew, update, release, or delete.
5. Intentionally return a wrong AgentCore cwd. Verify pair creation fails, remote deletion runs, and the fenced row records successful cleanup. Simulate explicit delete failure and indeterminate transport timeout; verify failed/ambiguous cleanup remains visible and retryable until audited reconciliation.
6. Dispose during a long exec and verify cancellation reaches AgentCore. Explicitly delete the disposable runtime through current administrative authority, unmount/delete EFS resources, revoke IAM, and retain sanitized logs, database inspection, image/runtime identity, region, and timestamps.

Live qualification may be marked verified only when the above evidence names the infrastructure identity, region, runtime/image version, current git SHA, and successful teardown. Do not relabel deterministic fake-client or local Postgres evidence as AWS verification.

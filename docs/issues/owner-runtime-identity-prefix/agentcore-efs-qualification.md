# ECS-local / AgentCore shared-EFS qualification

Status: **local contract conformant; live AWS unverified**. No AWS credentials or disposable AgentCore/EFS infrastructure were available for this slice.

## Host fixture

`apps/factory-playground/src/server/agentcoreEfsRuntime.ts` registers two application-owned names (`factory:ecs-local-efs` and `factory:agentcore-remote-efs`) with `createProviderRuntimeModeAdapter`. They are deliberately absent from builtin IDs and auto detection. The application supplies an authenticated `AgentCoreRuntimeClient` and a `PostgresFencedSandboxHandleStore`; the adapter has no AWS SDK dependency.

The EFS access point must expose `<accessPointRoot>/<tenantId>/<workspaceId>` to ECS. AgentCore must mount that exact namespace at `<runtimeRoot>/<tenantId>/<workspaceId>`. The adapter rejects a different host path or AgentCore-reported cwd before publishing a pair, and deletes a newly created mismatched session.

## Disposable live qualification (not yet run)

1. Provision a disposable encrypted EFS filesystem and one access point confined to the test tenant. Mount it in the ECS host at `ACCESS_POINT_ROOT`; mount the same access point in the disposable AgentCore runtime at `RUNTIME_ROOT`. Restrict IAM to that runtime/access point and enable CloudTrail/provider logs.
2. Apply Core migration `0029_fenced_sandbox_handles.sql`, construct `PostgresFencedSandboxHandleStore` with an application KMS-derived 32-byte cipher key, and inject it with an authenticated `AgentCoreRuntimeClient`. Never log the opaque handle or lease token.
3. Create the adapter with unique `hostScope`, tenant, workspace, and lease owner. Write random bytes through `bundle.workspace`; execute `sha256sum` remotely with no cwd override. Record matching SHA-256 values and both configured roots (not credentials/handles).
4. Dispose the pair, restart the ECS process, reacquire it, and prove the client resumes rather than creates. Run two simultaneous process claims; exactly one may acquire. After lease expiry, prove the old generation cannot update/release/delete.
5. Intentionally return a wrong AgentCore cwd. Verify pair creation fails, remote deletion runs, and the fenced row records successful cleanup. Simulate create timeout and delete timeout; verify create ambiguity blocks reacquisition and failed/ambiguous cleanup remains operator-visible until audited reconciliation.
6. Dispose during a long exec and verify cancellation reaches AgentCore. Explicitly delete the disposable runtime through a current fence, unmount/delete EFS resources, revoke IAM, and retain sanitized logs, database inspection, image/runtime identity, region, and timestamps.

Live qualification may be marked verified only when the above evidence names the infrastructure identity, region, runtime/image version, current git SHA, and successful teardown. Local fake-provider tests are not AWS sovereignty, IAM, network, encryption, durability, or service-semantics evidence.

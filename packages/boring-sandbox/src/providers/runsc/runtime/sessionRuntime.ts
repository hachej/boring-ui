import { randomBytes } from "node:crypto";
import type {
  AuthorizedWorkspaceCredentialScopeV1,
  SandboxCredentialSecretPayloadLeaseV1,
} from "@hachej/boring-agent/shared";
import {
  REMOTE_WORKER_ERROR_CODES_V1,
  RemoteWorkerExecRequestSchemaV1,
  RemoteWorkerExecResponseSchemaV1,
  type RemoteWorkerExecRequestV1,
  type RemoteWorkerExecResponseV1,
  type RemoteWorkerWorkspaceOperationV1,
  type RemoteWorkerWorkspaceResultV1,
} from "../../../shared/remoteWorkerProtocolV1";
import { remoteWorkerRequestDigestV1 } from "../../remote-worker/requestDigest";
import {
  buildDockerOwnedContainerListArgv,
  buildDockerRemoveArgv,
  buildDockerRemoveOwnedIdArgv,
  buildDockerRunArgv,
  buildDockerExecArgv,
  type TrustedWorkspaceMountSource,
} from "./dockerArgv";
import type { DockerCommandResult } from "./dockerRunner";
import { runDockerChecked } from "./dockerRunner";
import { runscRuntimeError } from "./errors";
import { prepareInvocationEnvelopeV1 } from "./invocationEnvelope";
import type { ResolvedRunscInvocationCredentialsV1 } from "./invocationCredentials";
import { decodeBoundedJson } from "./jsonEnvelope";
import { RUNSC_RUNTIME_LIMITS_V1, boundedPositiveInteger } from "./limits";
import { validateQuotaWorkspaceId } from "./quota";
import {
  RunscSessionRetirementManagerV1,
  type RunscSessionRetirementReasonV1,
} from "./sessionRetirement";
import {
  isInvocationHelperResponseV1,
  type InvocationRecordV1,
  type SessionRecordV1,
} from "./sessionRecord";
import {
  RunscSessionStateV1,
  compositeSessionKey,
  safeOpaqueId,
  sessionStateError,
} from "./sessionState";
import type {
  CompositeRunscSessionLeaseV1,
  CreateCompositeRunscSessionInputV1,
  CreateRunscSessionInputV1,
  RunscSessionLeaseV1,
  RunscSessionRuntimeOptionsV1,
} from "./sessionTypes";
import { RunscWorkspaceHelperClientV1 } from "./workspaceHelperClient";
const MAX_INVOCATION_RECORDS = 256;
export type {
  CompositeRunscSessionRetirementV1,
  RunscSessionRetirementV1,
} from "./sessionRetirement";
export type {
  CompositeRunscSessionLeaseV1,
  CreateCompositeRunscSessionInputV1,
  CreateRunscSessionInputV1,
  RunscSessionLeaseV1,
  RunscSessionRuntimeOptionsV1,
} from "./sessionTypes";
type AnyCreateInputV1 =
  CreateRunscSessionInputV1 | CreateCompositeRunscSessionInputV1;
type AnySessionLeaseV1 = RunscSessionLeaseV1 | CompositeRunscSessionLeaseV1;
function runtimeId(): string {
  return randomBytes(16).toString("hex");
}
export class RunscSessionRuntimeV1 {
  private readonly state = new RunscSessionStateV1<SessionRecordV1>();
  private readonly pendingOperations = new Set<Promise<unknown>>();
  private readonly pendingCreates = new Set<Promise<unknown>>();
  private readonly workspace: RunscWorkspaceHelperClientV1;
  private readonly retirement: RunscSessionRetirementManagerV1<SessionRecordV1>;
  private readonly now: () => number;
  private readonly runtimeIdFactory: () => string;
  private readonly sandboxIdFactory: () => string;
  private readonly maxConcurrentCreates: number;
  private readonly maxConcurrentExecs: number;
  private activeExecs = 0;
  private closed = false;
  private shutdownComplete = false;
  private startupComplete = false;
  private startupCleanupPending = false;
  private shutdownOperation?: Promise<void>;
  private startupOperation?: Promise<void>;
  constructor(private readonly options: RunscSessionRuntimeOptionsV1) {
    this.workspace = new RunscWorkspaceHelperClientV1(options.runner);
    this.retirement = new RunscSessionRetirementManagerV1({
      runner: options.runner,
      detach: (record) => this.state.detach(record),
      onRetire: options.onRetire,
      onCompositeRetire: options.onCompositeRetire,
      disposeMountSource: async (source) => {
        await options.sandboxRoots?.dispose(source);
      },
    });
    this.now = options.now ?? Date.now;
    this.runtimeIdFactory = options.runtimeIdFactory ?? runtimeId;
    this.sandboxIdFactory = options.sandboxIdFactory ?? runtimeId;
    this.maxConcurrentCreates = boundedPositiveInteger(
      options.maxConcurrentCreates ?? 4,
      1_000,
      "create concurrency",
    );
    this.maxConcurrentExecs = boundedPositiveInteger(
      options.maxConcurrentExecs ?? 16,
      10_000,
      "exec concurrency",
    );
  }
  get supportsMultiSandboxRoots(): boolean {
    return Boolean(
      this.options.sandboxRoots &&
      this.options.multiSandboxRootsAdmitted === true,
    );
  }
  startupSweep(): Promise<void> {
    if (this.closed) this.unavailable();
    if (this.startupComplete) return Promise.resolve();
    if (this.startupOperation) return this.startupOperation;
    this.state.beginSweep();
    const operation = this.track(async () => {
      try {
        await this.startupSweepOnce();
        this.startupComplete = true;
        this.startupCleanupPending = false;
      } catch (error) {
        this.startupCleanupPending = true;
        throw error;
      } finally {
        this.startupOperation = undefined;
        this.state.endSweep();
      }
    });
    this.startupOperation = operation;
    return operation;
  }
  private async startupSweepOnce(): Promise<void> {
    const listed = await runDockerChecked(this.options.runner, {
      argv: buildDockerOwnedContainerListArgv(),
      timeoutMs: RUNSC_RUNTIME_LIMITS_V1.disposeTimeoutMs,
      maxOutputBytes: 128 * 1024,
    });
    const containerIds = new TextDecoder()
      .decode(listed.stdout)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (
      containerIds.length > RUNSC_RUNTIME_LIMITS_V1.maxStartupSweepContainers
    ) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        "remote-worker startup cleanup exceeds its bound",
      );
    }
    for (const containerId of containerIds) {
      await runDockerChecked(this.options.runner, {
        argv: buildDockerRemoveOwnedIdArgv(containerId),
        timeoutMs: RUNSC_RUNTIME_LIMITS_V1.disposeTimeoutMs,
        maxOutputBytes: 64 * 1024,
      });
    }
    await this.options.sandboxRoots?.startupSweep();
  }
  create(input: CreateRunscSessionInputV1): Promise<RunscSessionLeaseV1> {
    if (this.closed) this.unavailable();
    if (this.options.sandboxRoots) this.compositeAuthorityRequired();
    return this.createForMode(input, false) as Promise<RunscSessionLeaseV1>;
  }
  createComposite(
    input: CreateCompositeRunscSessionInputV1,
  ): Promise<CompositeRunscSessionLeaseV1> {
    if (this.closed) this.unavailable();
    if (!this.supportsMultiSandboxRoots) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.unqualified,
        "remote-worker multi-root runtime is not admitted",
      );
    }
    return this.createForMode(
      input,
      true,
    ) as Promise<CompositeRunscSessionLeaseV1>;
  }
  private createForMode(
    input: AnyCreateInputV1,
    multiRoot: boolean,
  ): Promise<AnySessionLeaseV1> {
    return this.state.create(
      input,
      multiRoot,
      this.maxConcurrentCreates,
      RUNSC_RUNTIME_LIMITS_V1.maxStartupSweepContainers,
      () => safeOpaqueId(this.sandboxIdFactory(), "sandbox id"),
      (normalized, digest) =>
        this.track(
          () => this.createNew(normalized, digest, multiRoot),
          this.pendingCreates,
        ),
    );
  }
  private async createNew(
    input: AnyCreateInputV1 & { readonly sandboxId: string },
    digest: `sha256:${string}`,
    multiRoot: boolean,
  ): Promise<AnySessionLeaseV1> {
    const sandboxId = input.sandboxId;
    const sessionKey = multiRoot
      ? compositeSessionKey(input.workspaceId, sandboxId)
      : sandboxId;
    if (this.state.sessions.has(sessionKey)) this.idempotencyConflict();
    const idleTtlMs = boundedPositiveInteger(
      input.idleTtlMs ?? RUNSC_RUNTIME_LIMITS_V1.idleTtlMs,
      RUNSC_RUNTIME_LIMITS_V1.idleTtlMs,
      "idle TTL",
    );
    const hardLifetimeMs = boundedPositiveInteger(
      input.hardLifetimeMs ?? RUNSC_RUNTIME_LIMITS_V1.hardLifetimeMs,
      RUNSC_RUNTIME_LIMITS_V1.hardLifetimeMs,
      "hard lifetime",
    );
    // All host-supplied identity factories run before a lease-owned root exists.
    const runtimeId = this.nextRuntimeId();
    const timer = setTimeout(() => undefined, 1);
    clearTimeout(timer);
    let workspaceMountSource: TrustedWorkspaceMountSource | undefined;
    if (this.options.sandboxRoots) {
      workspaceMountSource = await this.options.sandboxRoots.prepare(
        input.workspaceId,
        sandboxId,
        this.options.quota,
      );
    } else {
      await this.options.quota.apply(input.workspaceId);
      if (this.closed) this.unavailable();
      await this.options.quota.check(input.workspaceId);
      workspaceMountSource = (
        input as CreateRunscSessionInputV1
      ).workspaceMountSource;
    }
    if (!workspaceMountSource) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
        "remote-worker workspace mount source is unavailable",
      );
    }
    const record: SessionRecordV1 = {
      sandboxId,
      clientLeaseId: input.clientLeaseId,
      createDigest: digest,
      workspaceId: input.workspaceId,
      workspaceMountSource,
      ownsWorkspaceMountSource: this.options.sandboxRoots !== undefined,
      image: input.image,
      createdAtMs: 0,
      hardExpiresAtMs: 0,
      idleTtlMs,
      runtimeId,
      leaseExpiresAtMs: 0,
      timer,
      activeExec: false,
      activeFs: false,
      invocations: new Map(),
    };
    try {
      if (this.closed) this.unavailable();
      await this.startContainer(record);
      if (this.closed) this.unavailable();
      record.createdAtMs = this.now();
      record.hardExpiresAtMs = record.createdAtMs + hardLifetimeMs;
      record.leaseExpiresAtMs = Math.min(
        record.createdAtMs + idleTtlMs,
        record.hardExpiresAtMs,
      );
      this.state.bind(record);
      this.armTimer(record);
    } catch (error) {
      await this.retireFailedCreatePreservingError(record, error);
    }
    return this.state.lease(record, true);
  }
  exec(
    sandboxId: string,
    workspaceId: string,
    requestInput: RemoteWorkerExecRequestV1,
    signal?: AbortSignal,
    credentialScope?: AuthorizedWorkspaceCredentialScopeV1,
  ): Promise<RemoteWorkerExecResponseV1> {
    if (this.closed) this.unavailable();
    return this.track(() =>
      this.execOnce(
        sandboxId,
        workspaceId,
        requestInput,
        signal,
        credentialScope,
      ),
    );
  }
  private async execOnce(
    sandboxId: string,
    workspaceId: string,
    requestInput: RemoteWorkerExecRequestV1,
    signal?: AbortSignal,
    credentialScope?: AuthorizedWorkspaceCredentialScopeV1,
  ): Promise<RemoteWorkerExecResponseV1> {
    const record = await this.activeSession(sandboxId, workspaceId);
    const parsedRequest =
      RemoteWorkerExecRequestSchemaV1.safeParse(requestInput);
    if (!parsedRequest.success) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
        "remote-worker invocation failed strict validation",
      );
    }
    const request = parsedRequest.data;
    const digest = remoteWorkerRequestDigestV1(request);
    const prior = record.invocations.get(request.invocationId);
    if (prior) {
      if (prior.digest !== digest) this.idempotencyConflict();
      if (prior.state === "running") {
        throw runscRuntimeError(
          REMOTE_WORKER_ERROR_CODES_V1.execInProgress,
          "remote-worker invocation is already running",
        );
      }
      if (prior.state === "secret-terminal") {
        throw runscRuntimeError(
          REMOTE_WORKER_ERROR_CODES_V1.secretInvocationNotReplayable,
          "remote-worker secret-bearing invocation is not replayable",
        );
      }
      return prior.result as RemoteWorkerExecResponseV1;
    }
    if (
      record.activeExec ||
      record.activeFs ||
      this.activeExecs >= this.maxConcurrentExecs
    ) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.execConcurrencyExhausted,
        "remote-worker exec concurrency is exhausted",
      );
    }
    if (record.invocations.size >= MAX_INVOCATION_RECORDS) {
      await this.requireInvocationCapacity(record);
    }
    const invocation: InvocationRecordV1 = { digest, state: "running" };
    record.invocations.set(request.invocationId, invocation);
    record.activeExec = true;
    this.activeExecs += 1;
    this.touch(record);
    return await this.executeInvocation(
      record,
      request.invocationId,
      invocation,
      request,
      signal,
      credentialScope,
    );
  }
  private async executeInvocation(
    record: SessionRecordV1,
    invocationId: string,
    invocation: InvocationRecordV1,
    request: RemoteWorkerExecRequestV1,
    signal?: AbortSignal,
    credentialScope?: AuthorizedWorkspaceCredentialScopeV1,
  ): Promise<RemoteWorkerExecResponseV1> {
    let secretExecutionStarted = false;
    let envelope: ReturnType<typeof prepareInvocationEnvelopeV1> | undefined;
    let credentialLeases: readonly SandboxCredentialSecretPayloadLeaseV1[] = [];
    try {
      const resolved =
        request.credentialRefs && request.credentialRefs.length > 0
          ? await this.resolveInvocationCredentials(
              record,
              request,
              credentialScope,
            )
          : { fields: [], leases: [] };
      credentialLeases = resolved.leases;
      secretExecutionStarted = resolved.leases.length > 0;
      envelope = prepareInvocationEnvelopeV1({
        workspaceId: record.workspaceId,
        request,
        resolvedCredentialFields: resolved.fields,
      });
      if (envelope.secretBearing) await this.replaceContainer(record, true);
      const result = await this.runInvocation(record, envelope, signal);
      if (envelope.secretBearing) {
        await this.replaceContainer(record, false);
        invocation.state = "secret-terminal";
      } else {
        invocation.state = "complete";
        invocation.result = result;
      }
      return result;
    } catch (error) {
      await this.recoverInvocationFailure(
        record,
        invocationId,
        invocation,
        secretExecutionStarted,
        signal?.aborted === true,
      );
      if (signal?.aborted) {
        throw runscRuntimeError(
          REMOTE_WORKER_ERROR_CODES_V1.execAborted,
          "remote-worker invocation was aborted",
        );
      }
      throw error;
    } finally {
      envelope?.bytes.fill(0);
      for (const lease of credentialLeases) {
        try {
          lease.dispose();
        } catch {
          // Lease disposal is best effort and must never expose credential data.
        }
      }
      record.activeExec = false;
      this.activeExecs -= 1;
      await this.settleOperationExpiry(record);
    }
  }
  private async resolveInvocationCredentials(
    record: SessionRecordV1,
    request: RemoteWorkerExecRequestV1,
    credentialScope?: AuthorizedWorkspaceCredentialScopeV1,
  ): Promise<ResolvedRunscInvocationCredentialsV1> {
    const references = request.credentialRefs ?? [];
    if (references.length === 0) return { fields: [], leases: [] };
    const resolver = this.options.invocationCredentials;
    if (!credentialScope || !resolver) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
        "remote-worker credential delivery is unavailable",
      );
    }
    return await resolver.resolve({
      workspaceId: record.workspaceId,
      sandboxId: record.sandboxId,
      invocationId: request.invocationId,
      references,
      credentialScope,
      nowMs: this.now(),
    });
  }
  private async recoverInvocationFailure(
    record: SessionRecordV1,
    invocationId: string,
    invocation: InvocationRecordV1,
    secretExecutionStarted: boolean,
    aborted: boolean,
  ): Promise<void> {
    if (secretExecutionStarted) {
      invocation.state = "secret-terminal";
      if (this.state.sessions.get(this.state.sessionKey(record)) === record) {
        const cleaned = await this.replaceAfterUnprovenExecution(record);
        if (!cleaned) {
          try {
            await this.retire(record, "cleanup");
          } catch {
            // retire() retains ownership and schedules a bounded retry.
          }
          this.incompleteCleanup();
        }
      }
      return;
    }
    if (invocation.state === "running") {
      record.invocations.delete(invocationId);
    }
    if (aborted) {
      const cleaned = await this.replaceAfterUnprovenExecution(record);
      if (!cleaned) this.incompleteCleanup();
    }
  }
  async fs(
    sandboxId: string,
    operation: RemoteWorkerWorkspaceOperationV1,
  ): Promise<RemoteWorkerWorkspaceResultV1>;
  async fs(
    sandboxId: string,
    workspaceId: string,
    operation: RemoteWorkerWorkspaceOperationV1,
  ): Promise<RemoteWorkerWorkspaceResultV1>;
  fs(
    sandboxId: string,
    workspaceOrOperation: string | RemoteWorkerWorkspaceOperationV1,
    operation?: RemoteWorkerWorkspaceOperationV1,
  ): Promise<RemoteWorkerWorkspaceResultV1> {
    if (this.closed) this.unavailable();
    return this.track(() =>
      this.fsOnce(sandboxId, workspaceOrOperation, operation),
    );
  }
  private async fsOnce(
    sandboxId: string,
    workspaceOrOperation: string | RemoteWorkerWorkspaceOperationV1,
    operation?: RemoteWorkerWorkspaceOperationV1,
  ): Promise<RemoteWorkerWorkspaceResultV1> {
    const record = operation
      ? await this.activeSession(sandboxId, workspaceOrOperation as string)
      : await this.activeLegacySession(sandboxId);
    const request =
      operation ?? (workspaceOrOperation as RemoteWorkerWorkspaceOperationV1);
    if (record.activeExec || record.activeFs) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.execInProgress,
        "remote-worker session operation is already running",
      );
    }
    record.activeFs = true;
    try {
      const result = await this.workspace.execute(record.runtimeId, request);
      this.touch(record);
      return result;
    } finally {
      record.activeFs = false;
      await this.settleOperationExpiry(record);
    }
  }
  async renew(
    sandboxId: string,
    idleTtlMs: number,
  ): Promise<RunscSessionLeaseV1>;
  async renew(
    sandboxId: string,
    workspaceId: string,
    idleTtlMs: number,
  ): Promise<RunscSessionLeaseV1>;
  async renew(
    sandboxId: string,
    workspaceOrIdleTtlMs: string | number,
    idleTtlMs?: number,
  ): Promise<RunscSessionLeaseV1> {
    const record =
      typeof workspaceOrIdleTtlMs === "string"
        ? await this.activeSession(sandboxId, workspaceOrIdleTtlMs)
        : await this.activeLegacySession(sandboxId);
    const bounded = boundedPositiveInteger(
      idleTtlMs ?? (workspaceOrIdleTtlMs as number),
      RUNSC_RUNTIME_LIMITS_V1.idleTtlMs,
      "idle TTL",
    );
    record.leaseExpiresAtMs = Math.min(
      this.now() + bounded,
      record.hardExpiresAtMs,
    );
    this.armTimer(record);
    return this.state.lease(record, false);
  }
  async dispose(sandboxId: string): Promise<void>;
  async dispose(sandboxId: string, workspaceId: string): Promise<void>;
  async dispose(sandboxId: string, workspaceId?: string): Promise<void> {
    const record =
      workspaceId === undefined
        ? this.findLegacySession(sandboxId)
        : this.state.findSession(
            sandboxId,
            workspaceId,
            this.options.sandboxRoots !== undefined,
          );
    if (!record) return;
    await this.retire(record, "cleanup", false);
  }
  async shutdown(): Promise<void> {
    if (this.shutdownComplete) return;
    this.closed = true;
    const existing = this.shutdownOperation;
    if (existing) return await existing;
    const operation = this.shutdownOnce();
    this.shutdownOperation = operation;
    try {
      await operation;
      this.shutdownComplete = true;
    } finally {
      this.shutdownOperation = undefined;
    }
  }
  private async shutdownOnce(): Promise<void> {
    for (const record of this.state.sessions.values())
      clearTimeout(record.timer);
    await Promise.allSettled([...this.pendingCreates]);
    await Promise.allSettled([...this.pendingOperations]);
    const cleanup = await Promise.allSettled(
      [...this.state.sessions.values()].map(
        async (record) => await this.retire(record, "shutdown"),
      ),
    );
    let rootFailure: unknown;
    if (this.startupCleanupPending) {
      try {
        await this.startupSweepOnce();
        this.startupCleanupPending = false;
        this.startupComplete = true;
      } catch (error) {
        rootFailure = error;
      }
    }
    try {
      await this.options.sandboxRoots?.close();
    } catch (error) {
      rootFailure ??= error;
    }
    const failure = cleanup.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
    if (rootFailure) throw rootFailure;
  }
  private async runInvocation(
    record: SessionRecordV1,
    envelope: ReturnType<typeof prepareInvocationEnvelopeV1>,
    signal?: AbortSignal,
  ): Promise<RemoteWorkerExecResponseV1> {
    let dockerResult: DockerCommandResult;
    try {
      dockerResult = await this.options.runner.run({
        argv: buildDockerExecArgv(record.runtimeId, "invoke"),
        stdin: envelope.bytes,
        timeoutMs:
          envelope.timeoutMs +
          RUNSC_RUNTIME_LIMITS_V1.processGroupGraceMs +
          30_000,
        maxOutputBytes:
          Math.ceil((envelope.maxOutputBytes * 4) / 3) + 128 * 1024,
        signal,
      });
    } catch (error) {
      await this.resetOrRetireAfterUnknown(record);
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        "remote-worker invocation cleanup could not be proven",
        error,
      );
    }
    if (
      dockerResult.timedOut ||
      dockerResult.aborted ||
      dockerResult.exitCode !== 0 ||
      dockerResult.truncated
    ) {
      await this.resetOrRetireAfterUnknown(record);
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        "remote-worker invocation cleanup could not be proven",
      );
    }
    const parsed = decodeBoundedJson(dockerResult.stdout, 8 * 1024 * 1024);
    if (!isInvocationHelperResponseV1(parsed) || !parsed.cleanupProven) {
      await this.resetOrRetireAfterUnknown(record);
      this.incompleteCleanup();
    }
    let response: RemoteWorkerExecResponseV1;
    try {
      response = RemoteWorkerExecResponseSchemaV1.parse({
        stdoutBase64: parsed.stdoutBase64,
        stderrBase64: parsed.stderrBase64,
        exitCode: parsed.exitCode,
        durationMs: parsed.durationMs,
        truncated: parsed.truncated,
      });
      const outputBytes =
        Buffer.from(response.stdoutBase64, "base64").byteLength +
        Buffer.from(response.stderrBase64, "base64").byteLength;
      if (outputBytes > envelope.maxOutputBytes)
        throw new Error("output bound");
    } catch (error) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.responseInvalid,
        "remote-worker invocation wrapper returned an invalid result",
        error,
      );
    }
    if (parsed.timedOut) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.timeout,
        "remote-worker invocation timed out",
      );
    }
    return response;
  }
  private async startContainer(
    record: SessionRecordV1,
    workspaceReadOnly = false,
  ): Promise<void> {
    await runDockerChecked(this.options.runner, {
      argv: buildDockerRunArgv({
        runtimeId: record.runtimeId,
        workspaceMountSource: record.workspaceMountSource,
        workspaceReadOnly,
        image: record.image,
      }),
      timeoutMs: RUNSC_RUNTIME_LIMITS_V1.createTimeoutMs,
      maxOutputBytes: 64 * 1024,
    });
    await this.workspace.probe(record.runtimeId);
  }
  private async replaceContainer(
    record: SessionRecordV1,
    workspaceReadOnly = false,
  ): Promise<void> {
    await runDockerChecked(this.options.runner, {
      argv: buildDockerRemoveArgv(record.runtimeId),
      timeoutMs: RUNSC_RUNTIME_LIMITS_V1.disposeTimeoutMs,
      maxOutputBytes: 64 * 1024,
    });
    record.runtimeId = this.nextRuntimeId();
    try {
      await this.startContainer(record, workspaceReadOnly);
    } catch (error) {
      await this.retire(record, "cleanup");
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        "remote-worker clean container replacement failed",
        error,
      );
    }
  }
  private async replaceAfterUnprovenExecution(
    record: SessionRecordV1,
  ): Promise<boolean> {
    try {
      await this.replaceContainer(record);
      return true;
    } catch {
      return false;
    }
  }
  private async resetOrRetireAfterUnknown(
    record: SessionRecordV1,
  ): Promise<void> {
    if (!(await this.replaceAfterUnprovenExecution(record))) {
      await this.retire(record, "cleanup");
    }
  }
  private async activeSession(
    sandboxId: string,
    workspaceId: string,
  ): Promise<SessionRecordV1> {
    if (this.closed) this.unavailable();
    if (!this.options.sandboxRoots) {
      const canonicalWorkspaceId = validateQuotaWorkspaceId(workspaceId);
      const legacy = this.findLegacySession(sandboxId);
      if (!legacy) {
        await this.retirement.notifyMissing(sandboxId);
        this.sandboxNotFound();
      }
      if (legacy.workspaceId !== canonicalWorkspaceId) this.workspaceMismatch();
      return await this.requireActive(legacy);
    }
    const record = this.state.findSession(sandboxId, workspaceId, true);
    if (!record) {
      await this.notifyMissing(workspaceId, sandboxId);
      this.sandboxNotFound();
    }
    return await this.requireActive(record);
  }
  private async activeLegacySession(
    sandboxId: string,
  ): Promise<SessionRecordV1> {
    if (this.closed) this.unavailable();
    const record = this.findLegacySession(sandboxId);
    if (!record) {
      await this.retirement.notifyMissing(sandboxId);
      this.sandboxNotFound();
    }
    return await this.requireActive(record);
  }
  private async requireActive(
    record: SessionRecordV1,
  ): Promise<SessionRecordV1> {
    if (record.retirement) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.sandboxDisposed,
        "remote-worker sandbox retirement is in progress",
      );
    }
    const nowMs = this.now();
    if (record.hardExpiresAtMs <= nowMs || record.leaseExpiresAtMs <= nowMs) {
      const reason: "idle" | "hard-expiry" =
        record.hardExpiresAtMs <= nowMs ? "hard-expiry" : "idle";
      if (record.activeExec || record.activeFs) {
        record.expiryPending = reason;
      } else {
        await this.retire(record, reason);
        throw runscRuntimeError(
          REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
          "remote-worker sandbox expired",
        );
      }
    }
    return record;
  }
  private armTimer(record: SessionRecordV1): void {
    clearTimeout(record.timer);
    if (record.retirement) return;
    const deadline = Math.min(record.leaseExpiresAtMs, record.hardExpiresAtMs);
    record.timer = setTimeout(
      () => {
        const reason: "idle" | "hard-expiry" =
          record.hardExpiresAtMs <= this.now() ? "hard-expiry" : "idle";
        if (record.activeExec || record.activeFs) {
          record.expiryPending = reason;
          return;
        }
        void this.retire(record, reason).catch(() => undefined);
      },
      Math.max(0, deadline - this.now()),
    );
  }
  private touch(record: SessionRecordV1): void {
    if (record.retirement) return;
    record.expiryPending = undefined;
    record.leaseExpiresAtMs = Math.min(
      this.now() + record.idleTtlMs,
      record.hardExpiresAtMs,
    );
    this.armTimer(record);
  }
  private async settleOperationExpiry(record: SessionRecordV1): Promise<void> {
    if (this.state.sessions.get(this.state.sessionKey(record)) !== record) return;
    if (record.retirement) return;
    if (
      record.expiryPending === "hard-expiry" ||
      record.hardExpiresAtMs <= this.now()
    ) {
      await this.retire(record, "hard-expiry");
      return;
    }
    this.touch(record);
  }

  private nextRuntimeId(): string {
    const value = this.runtimeIdFactory();
    if (!/^[a-f0-9]{32}$/.test(value)) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
        "remote-worker runtime id factory is invalid",
      );
    }
    return value;
  }
  private async requireInvocationCapacity(
    record: SessionRecordV1,
  ): Promise<void> {
    if (record.invocations.size < MAX_INVOCATION_RECORDS) return;
    await this.retire(record, "history");
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
      "remote-worker sandbox invocation history is exhausted",
    );
  }
  private findLegacySession(sandboxId: string): SessionRecordV1 | undefined {
    if (this.options.sandboxRoots) this.compositeAuthorityRequired();
    safeOpaqueId(sandboxId, "sandbox id");
    return this.state.findLegacySession(sandboxId);
  }
  private async retireFailedCreate(record: SessionRecordV1): Promise<void> {
    this.state.bind(record);
    await this.retire(record, "cleanup", false);
  }
  private async retireFailedCreatePreservingError(
    record: SessionRecordV1,
    originalError: unknown,
  ): Promise<never> {
    try {
      await this.retireFailedCreate(record);
    } catch {
      // Retirement retains the bound record and schedules retry-safe cleanup.
    }
    throw originalError;
  }
  private async retire(
    record: SessionRecordV1,
    reason: RunscSessionRetirementReasonV1,
    notify = true,
  ): Promise<void> {
    await this.retirement.retire(record, reason, notify);
  }
  private async notifyMissing(
    workspaceId: string,
    sandboxId: string,
  ): Promise<void> {
    safeOpaqueId(sandboxId, "sandbox id");
    await this.retirement.notifyMissingComposite(workspaceId, sandboxId);
  }
  private track<T>(
    start: () => Promise<T>,
    operations = this.pendingOperations,
  ): Promise<T> {
    const operation = Promise.resolve().then(start);
    operations.add(operation);
    const cleanup = (): void => {
      operations.delete(operation);
    };
    void operation.then(cleanup, cleanup);
    return operation;
  }
  private unavailable(): never {
    return sessionStateError("unavailable");
  }
  private compositeAuthorityRequired(): never {
    return sessionStateError("composite-authority");
  }
  private sandboxNotFound(): never {
    return sessionStateError("not-found");
  }
  private workspaceMismatch(): never {
    return sessionStateError("workspace-mismatch");
  }
  private idempotencyConflict(): never {
    return sessionStateError("conflict");
  }
  private incompleteCleanup(): never {
    return sessionStateError("incomplete-cleanup");
  }
}

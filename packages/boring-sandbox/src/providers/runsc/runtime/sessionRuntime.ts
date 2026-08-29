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
import type { DockerCommandResult, DockerCommandRunner } from "./dockerRunner";
import { runDockerChecked } from "./dockerRunner";
import { runscRuntimeError } from "./errors";
import { prepareInvocationEnvelopeV1 } from "./invocationEnvelope";
import type {
  ResolvedRunscInvocationCredentialsV1,
  RunscInvocationCredentialResolverV1,
} from "./invocationCredentials";
import { decodeBoundedJson } from "./jsonEnvelope";
import { RUNSC_RUNTIME_LIMITS_V1, boundedPositiveInteger } from "./limits";
import {
  validateQuotaWorkspaceId,
  type FixedProjectQuotaManagerV1,
} from "./quota";
import {
  RunscSessionRetirementManagerV1,
  type CompositeRunscSessionRetirementV1,
  type RunscSessionRetirementReasonV1,
  type RunscSessionRetirementV1,
} from "./sessionRetirement";
import type { RunscSandboxRootLifecycleV1 } from "./sandboxRootLifecycle";
import {
  RunscSessionStateV1,
  compositeSessionKey,
  safeOpaqueId,
  sessionStateError,
} from "./sessionState";
import { RunscWorkspaceHelperClientV1 } from "./workspaceHelperClient";
const MAX_INVOCATION_RECORDS = 256;
export type {
  CompositeRunscSessionRetirementV1,
  RunscSessionRetirementV1,
} from "./sessionRetirement";
export interface RunscSessionRuntimeOptionsV1 {
  readonly runner: DockerCommandRunner;
  readonly quota: Pick<FixedProjectQuotaManagerV1, "apply" | "check"> & {
    readonly workspaceRoot?: string;
  };
  readonly maxConcurrentCreates?: number; readonly maxConcurrentExecs?: number;
  readonly now?: () => number;
  readonly runtimeIdFactory?: () => string;
  readonly sandboxIdFactory?: () => string;
  readonly sandboxRoots?: RunscSandboxRootLifecycleV1;
  /** Set only after the worker profile has passed multi-root qualification. */
  readonly multiSandboxRootsAdmitted?: boolean;
  readonly invocationCredentials?: RunscInvocationCredentialResolverV1;
  readonly onRetire?: (retirement: RunscSessionRetirementV1) => void | Promise<void>;
  readonly onCompositeRetire?: (retirement: CompositeRunscSessionRetirementV1) => void | Promise<void>;
}
export interface CreateRunscSessionInputV1 {
  readonly sandboxId: string; readonly clientLeaseId: string;
  readonly workspaceId: string;
  readonly workspaceMountSource: TrustedWorkspaceMountSource;
  readonly image: string; readonly idleTtlMs?: number; readonly hardLifetimeMs?: number;
}
export interface CreateCompositeRunscSessionInputV1 {
  readonly sandboxId?: string; readonly clientLeaseId: string;
  readonly createDigest?: `sha256:${string}`; readonly workspaceId: string;
  readonly workspaceMountSource?: TrustedWorkspaceMountSource;
  readonly image: string; readonly idleTtlMs?: number; readonly hardLifetimeMs?: number;
}
export interface RunscSessionLeaseV1 {
  readonly sandboxId: string; readonly leaseExpiresAtMs: number;
  readonly hardExpiresAtMs: number;
}
export interface CompositeRunscSessionLeaseV1 extends RunscSessionLeaseV1 {
  readonly newlyAllocated: boolean;
}
type AnyCreateInputV1 = CreateRunscSessionInputV1 | CreateCompositeRunscSessionInputV1;
type AnySessionLeaseV1 = RunscSessionLeaseV1 | CompositeRunscSessionLeaseV1;
interface InvocationRecordV1 {
  readonly digest: `sha256:${string}`;
  state: "running" | "complete" | "secret-terminal"; result?: RemoteWorkerExecResponseV1;
}
interface SessionRecordV1 {
  readonly sandboxId: string; readonly clientLeaseId: string;
  readonly createDigest: `sha256:${string}`; readonly workspaceId: string;
  readonly workspaceMountSource: TrustedWorkspaceMountSource;
  readonly ownsWorkspaceMountSource: boolean; readonly image: string;
  createdAtMs: number; hardExpiresAtMs: number;
  readonly idleTtlMs: number; runtimeId: string; leaseExpiresAtMs: number;
  timer: ReturnType<typeof setTimeout>;
  activeExec: boolean; activeFs: boolean;
  invocations: Map<string, InvocationRecordV1>;
  retirement?: {
    readonly reason: RunscSessionRetirementReasonV1;
    readonly notify: boolean; attempts: number;
  };
}
interface InvocationHelperResponseV1 {
  readonly ok: true; readonly stdoutBase64: string; readonly stderrBase64: string;
  readonly exitCode: number; readonly durationMs: number;
  readonly truncated: boolean; readonly timedOut: boolean; readonly cleanupProven: boolean;
}
function isHelperResponse(value: unknown): value is InvocationHelperResponseV1 {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<InvocationHelperResponseV1>;
  return result.ok === true && typeof result.stdoutBase64 === "string" &&
    typeof result.stderrBase64 === "string" && Number.isInteger(result.exitCode) &&
    typeof result.durationMs === "number" && typeof result.truncated === "boolean" &&
    typeof result.timedOut === "boolean" && typeof result.cleanupProven === "boolean";
}
function runtimeId(): string { return randomBytes(16).toString("hex"); }
export class RunscSessionRuntimeV1 {
  private readonly state = new RunscSessionStateV1<SessionRecordV1>();
  private readonly pendingOperations = new Set<Promise<unknown>>();
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
  private shutdownOperation?: Promise<void>;
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
    return (
      this.options.sandboxRoots !== undefined &&
      this.options.multiSandboxRootsAdmitted === true
    );
  }
  async startupSweep(): Promise<void> {
    if (this.closed) this.unavailable();
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
    if (this.options.sandboxRoots) this.compositeAuthorityRequired();
    return this.createForMode(input, false) as Promise<RunscSessionLeaseV1>;
  }
  createComposite(
    input: CreateCompositeRunscSessionInputV1,
  ): Promise<CompositeRunscSessionLeaseV1> {
    if (!this.supportsMultiSandboxRoots) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.unqualified,
        "remote-worker multi-root runtime is not admitted",
      );
    }
    return this.createForMode(input, true) as Promise<CompositeRunscSessionLeaseV1>;
  }
  private createForMode(input: AnyCreateInputV1, multiRoot: boolean): Promise<AnySessionLeaseV1> {
    if (this.closed) this.unavailable();
    return this.state.create(input, multiRoot, this.maxConcurrentCreates,
      (normalized, digest) => this.track(this.createNew(normalized, digest, multiRoot)));
  }
  private async createNew(
    input: AnyCreateInputV1,
    digest: `sha256:${string}`,
    multiRoot: boolean,
  ): Promise<AnySessionLeaseV1> {
    const sandboxId = safeOpaqueId(
      input.sandboxId ?? this.sandboxIdFactory(),
      "sandbox id",
    );
    const sessionKey = multiRoot
      ? compositeSessionKey(input.workspaceId, sandboxId) : sandboxId;
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
      await this.options.quota.check(input.workspaceId);
      workspaceMountSource = input.workspaceMountSource;
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
      await this.startContainer(record);
      if (this.closed) this.unavailable();
      record.createdAtMs = this.now();
      record.hardExpiresAtMs = record.createdAtMs + hardLifetimeMs;
      record.leaseExpiresAtMs = Math.min(
        record.createdAtMs + idleTtlMs, record.hardExpiresAtMs,
      );
      this.state.bind(record);
      this.armTimer(record);
    } catch (error) {
      await this.retireFailedCreatePreservingError(record, error);
    }
    return this.state.lease(record, true);
  }
  async exec(
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
    await this.requireInvocationCapacity(record);
    const invocation: InvocationRecordV1 = { digest, state: "running" };
    record.invocations.set(request.invocationId, invocation);
    record.activeExec = true;
    this.activeExecs += 1;
    this.touch(record);
    const operation = this.track(
      this.executeInvocation(
        record,
        request.invocationId,
        invocation,
        request,
        signal,
        credentialScope,
      ),
    );
    return await operation;
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
      if (this.state.sessions.get(this.state.sessionKey(record)) === record) {
        this.touch(record);
      }
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
  async fs(
    sandboxId: string,
    workspaceOrOperation: string | RemoteWorkerWorkspaceOperationV1,
    operation?: RemoteWorkerWorkspaceOperationV1,
  ): Promise<RemoteWorkerWorkspaceResultV1> {
    const record = operation
      ? await this.activeSession(sandboxId, workspaceOrOperation as string)
      : await this.activeLegacySession(sandboxId);
    const request = operation ?? (workspaceOrOperation as RemoteWorkerWorkspaceOperationV1);
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
    const record = typeof workspaceOrIdleTtlMs === "string"
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
    const record = workspaceId === undefined
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
    try { await operation; this.shutdownComplete = true; }
    finally { this.shutdownOperation = undefined; }
  }
  private async shutdownOnce(): Promise<void> {
    for (const record of this.state.sessions.values()) clearTimeout(record.timer);
    await Promise.race([
      Promise.allSettled([...this.pendingOperations]),
      new Promise<void>((resolve) => setTimeout(resolve, RUNSC_RUNTIME_LIMITS_V1.shutdownDrainMs)),
    ]);
    const cleanup = await Promise.allSettled([...this.state.sessions.values()]
      .map(async (record) => await this.retire(record, "shutdown")));
    let rootFailure: unknown;
    try { await this.options.sandboxRoots?.close(); } catch (error) { rootFailure = error; }
    const failure = cleanup.find(
      (result): result is PromiseRejectedResult => result.status === "rejected");
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
    if (!isHelperResponse(parsed) || !parsed.cleanupProven) {
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
  private async requireActive(record: SessionRecordV1): Promise<SessionRecordV1> {
    if (record.retirement) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.sandboxDisposed,
        "remote-worker sandbox retirement is in progress",
      );
    }
    const nowMs = this.now();
    if (record.hardExpiresAtMs <= nowMs || record.leaseExpiresAtMs <= nowMs) {
      const hard = record.hardExpiresAtMs <= nowMs;
      await this.retire(record, hard ? "hard-expiry" : "idle");
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
        "remote-worker sandbox expired",
      );
    }
    return record;
  }
  private armTimer(record: SessionRecordV1): void {
    clearTimeout(record.timer);
    if (record.retirement) return;
    const deadline = Math.min(record.leaseExpiresAtMs, record.hardExpiresAtMs);
    record.timer = setTimeout(
      () => {
        const reason: RunscSessionRetirementReasonV1 =
          record.hardExpiresAtMs <= this.now() ? "hard-expiry" : "idle";
        void this.retire(record, reason).catch(() => undefined);
      },
      Math.max(0, deadline - this.now()),
    );
  }
  private touch(record: SessionRecordV1): void {
    if (record.retirement) return;
    record.leaseExpiresAtMs = Math.min(
      this.now() + record.idleTtlMs,
      record.hardExpiresAtMs,
    );
    this.armTimer(record);
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
  private track<T>(operation: Promise<T>): Promise<T> {
    this.pendingOperations.add(operation);
    const cleanup = (): void => {
      this.pendingOperations.delete(operation);
    };
    void operation.then(cleanup, cleanup);
    return operation;
  }
  private unavailable(): never { return sessionStateError("unavailable"); }
  private compositeAuthorityRequired(): never {
    return sessionStateError("composite-authority");
  }
  private sandboxNotFound(): never { return sessionStateError("not-found"); }
  private workspaceMismatch(): never {
    return sessionStateError("workspace-mismatch");
  }
  private idempotencyConflict(): never { return sessionStateError("conflict"); }
  private incompleteCleanup(): never {
    return sessionStateError("incomplete-cleanup");
  }
}

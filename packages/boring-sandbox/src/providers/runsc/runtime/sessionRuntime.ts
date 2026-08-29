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
import type { FixedProjectQuotaManagerV1 } from "./quota";
import {
  RunscSessionRetirementManagerV1,
  type RunscSessionRetirementReasonV1,
  type RunscSessionRetirementV1,
} from "./sessionRetirement";
import type { RunscSandboxRootLifecycleV1 } from "./sandboxRootLifecycle";
import { RunscWorkspaceHelperClientV1 } from "./workspaceHelperClient";

const MAX_INVOCATION_RECORDS = 256;
export type { RunscSessionRetirementV1 } from "./sessionRetirement";

export interface RunscSessionRuntimeOptionsV1 {
  readonly runner: DockerCommandRunner;
  readonly quota: Pick<FixedProjectQuotaManagerV1, "apply" | "check">;
  readonly maxConcurrentCreates?: number;
  readonly maxConcurrentExecs?: number;
  readonly now?: () => number;
  readonly runtimeIdFactory?: () => string;
  readonly sandboxIdFactory?: () => string;
  readonly sandboxRoots?: RunscSandboxRootLifecycleV1;
  readonly invocationCredentials?: RunscInvocationCredentialResolverV1;
  readonly onRetire?: (
    retirement: RunscSessionRetirementV1,
  ) => void | Promise<void>;
}

export interface CreateRunscSessionInputV1 {
  /** Legacy workers may supply an ID; multi-root workers allocate it server-side. */
  readonly sandboxId?: string;
  readonly clientLeaseId: string;
  readonly workspaceId: string;
  /** Required only by the legacy workspace-wide runtime. */
  readonly workspaceMountSource?: TrustedWorkspaceMountSource;
  readonly image: string;
  readonly idleTtlMs?: number;
  readonly hardLifetimeMs?: number;
}

export interface RunscSessionLeaseV1 {
  readonly sandboxId: string;
  readonly leaseExpiresAtMs: number;
  readonly hardExpiresAtMs: number;
}

interface InvocationRecordV1 {
  readonly digest: `sha256:${string}`;
  state: "running" | "complete" | "secret-terminal";
  result?: RemoteWorkerExecResponseV1;
}

interface SessionRecordV1 {
  readonly sandboxId: string;
  readonly clientLeaseId: string;
  readonly createDigest: `sha256:${string}`;
  readonly workspaceId: string;
  readonly workspaceMountSource: TrustedWorkspaceMountSource;
  readonly ownsWorkspaceMountSource: boolean;
  readonly image: string;
  readonly createdAtMs: number;
  readonly hardExpiresAtMs: number;
  readonly idleTtlMs: number;
  runtimeId: string;
  leaseExpiresAtMs: number;
  timer: ReturnType<typeof setTimeout>;
  activeExec: boolean;
  activeFs: boolean;
  invocations: Map<string, InvocationRecordV1>;
  retirement?: {
    readonly reason: RunscSessionRetirementReasonV1;
    readonly notify: boolean;
    attempts: number;
    containerRemoved: boolean;
    rootRemoved: boolean;
  };
}

interface InvocationHelperResponseV1 {
  readonly ok: true;
  readonly stdoutBase64: string;
  readonly stderrBase64: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly truncated: boolean;
  readonly timedOut: boolean;
  readonly cleanupProven: boolean;
}

function isHelperResponse(value: unknown): value is InvocationHelperResponseV1 {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<InvocationHelperResponseV1>;
  return (
    result.ok === true &&
    typeof result.stdoutBase64 === "string" &&
    typeof result.stderrBase64 === "string" &&
    Number.isInteger(result.exitCode) &&
    typeof result.durationMs === "number" &&
    typeof result.truncated === "boolean" &&
    typeof result.timedOut === "boolean" &&
    typeof result.cleanupProven === "boolean"
  );
}

function runtimeId(): string {
  return randomBytes(16).toString("hex");
}

function compositeKey(workspaceId: string, opaqueId: string): string {
  return `${workspaceId}\u0000${opaqueId}`;
}

function safeOpaqueId(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      `remote-worker ${label} is invalid`,
    );
  }
  return value;
}

export class RunscSessionRuntimeV1 {
  private readonly sessions = new Map<string, SessionRecordV1>();
  private readonly leaseBindings = new Map<string, SessionRecordV1>();
  private readonly legacyWorkspaceBindings = new Map<string, SessionRecordV1>();
  private readonly pendingLegacyWorkspaces = new Set<string>();
  private readonly pendingCreates = new Map<
    string,
    { digest: `sha256:${string}`; promise: Promise<RunscSessionLeaseV1> }
  >();
  private readonly pendingOperations = new Set<Promise<unknown>>();
  private readonly workspace: RunscWorkspaceHelperClientV1;
  private readonly retirement: RunscSessionRetirementManagerV1<SessionRecordV1>;
  private readonly now: () => number;
  private readonly runtimeIdFactory: () => string;
  private readonly sandboxIdFactory: () => string;
  private readonly maxConcurrentCreates: number;
  private readonly maxConcurrentExecs: number;
  private activeCreates = 0;
  private activeExecs = 0;
  private closed = false;

  constructor(private readonly options: RunscSessionRuntimeOptionsV1) {
    this.workspace = new RunscWorkspaceHelperClientV1(options.runner);
    this.retirement = new RunscSessionRetirementManagerV1({
      runner: options.runner,
      detach: (record) => this.detach(record),
      onRetire: options.onRetire,
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
    return this.options.sandboxRoots !== undefined;
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
    if (this.closed) this.unavailable();
    if (input.sandboxId !== undefined) safeOpaqueId(input.sandboxId, "sandbox id");
    safeOpaqueId(input.clientLeaseId, "client lease id");
    const digest = remoteWorkerRequestDigestV1({
      clientLeaseId: input.clientLeaseId,
      workspaceId: input.workspaceId,
      workspaceMountSource: input.workspaceMountSource,
      image: input.image,
      idleTtlMs: input.idleTtlMs,
      hardLifetimeMs: input.hardLifetimeMs,
    });
    const createKey = compositeKey(input.workspaceId, input.clientLeaseId);
    const existing = this.leaseBindings.get(createKey);
    if (existing) {
      if (existing.createDigest !== digest) this.idempotencyConflict();
      if (existing.retirement) this.incompleteCleanup();
      return Promise.resolve(this.lease(existing));
    }
    const pending = this.pendingCreates.get(createKey);
    if (pending) {
      if (pending.digest !== digest) this.idempotencyConflict();
      return pending.promise;
    }
    if (
      !this.options.sandboxRoots &&
      (this.legacyWorkspaceBindings.has(input.workspaceId) ||
        this.pendingLegacyWorkspaces.has(input.workspaceId))
    ) {
      this.idempotencyConflict();
    }
    if (this.activeCreates >= this.maxConcurrentCreates) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.createConcurrencyExhausted,
        "remote-worker create concurrency is exhausted",
      );
    }
    this.activeCreates += 1;
    if (!this.options.sandboxRoots) {
      this.pendingLegacyWorkspaces.add(input.workspaceId);
    }
    const operation = this.track(this.createNew(input, digest));
    this.pendingCreates.set(createKey, { digest, promise: operation });
    const finishCreate = (): void => {
      this.activeCreates -= 1;
      this.pendingCreates.delete(createKey);
      this.pendingLegacyWorkspaces.delete(input.workspaceId);
    };
    void operation.then(finishCreate, finishCreate);
    return operation;
  }

  private async createNew(
    input: CreateRunscSessionInputV1,
    digest: `sha256:${string}`,
  ): Promise<RunscSessionLeaseV1> {
    const sandboxId = safeOpaqueId(
      input.sandboxId ?? this.sandboxIdFactory(),
      "sandbox id",
    );
    if (this.sessions.has(compositeKey(input.workspaceId, sandboxId))) {
      this.idempotencyConflict();
    }
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
    await this.options.quota.apply(input.workspaceId);
    await this.options.quota.check(input.workspaceId);
    const workspaceMountSource = this.options.sandboxRoots
      ? await this.options.sandboxRoots.prepare(input.workspaceId, sandboxId)
      : input.workspaceMountSource;
    if (!workspaceMountSource) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
        "remote-worker workspace mount source is unavailable",
      );
    }
    const createdAtMs = this.now();
    const record: SessionRecordV1 = {
      sandboxId,
      clientLeaseId: input.clientLeaseId,
      createDigest: digest,
      workspaceId: input.workspaceId,
      workspaceMountSource,
      ownsWorkspaceMountSource: this.options.sandboxRoots !== undefined,
      image: input.image,
      createdAtMs,
      hardExpiresAtMs: createdAtMs + hardLifetimeMs,
      idleTtlMs,
      runtimeId: this.nextRuntimeId(),
      leaseExpiresAtMs: Math.min(
        createdAtMs + idleTtlMs,
        createdAtMs + hardLifetimeMs,
      ),
      timer: setTimeout(() => undefined, 1),
      activeExec: false,
      activeFs: false,
      invocations: new Map(),
    };
    clearTimeout(record.timer);
    try {
      await this.startContainer(record);
    } catch (error) {
      await this.retireFailedCreate(record);
      throw error;
    }
    if (this.closed) {
      await this.retireFailedCreate(record);
      this.unavailable();
    }
    this.bind(record);
    this.armTimer(record);
    return this.lease(record);
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
      if (this.sessions.get(this.sessionKey(record)) === record) this.touch(record);
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
      if (this.sessions.get(this.sessionKey(record)) === record) {
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
    const workspaceId = typeof workspaceOrOperation === "string"
      ? workspaceOrOperation
      : undefined;
    const request = operation ?? workspaceOrOperation as RemoteWorkerWorkspaceOperationV1;
    const record = await this.activeSession(sandboxId, workspaceId);
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

  async renew(sandboxId: string, idleTtlMs: number): Promise<RunscSessionLeaseV1>;
  async renew(
    sandboxId: string,
    workspaceId: string,
    idleTtlMs: number,
  ): Promise<RunscSessionLeaseV1>;
  async renew(
    sandboxId: string,
    workspaceOrTtl: string | number,
    idleTtlMs?: number,
  ): Promise<RunscSessionLeaseV1> {
    const workspaceId = typeof workspaceOrTtl === "string" ? workspaceOrTtl : undefined;
    const requestedTtl = idleTtlMs ?? workspaceOrTtl as number;
    const record = await this.activeSession(sandboxId, workspaceId);
    const bounded = boundedPositiveInteger(
      requestedTtl,
      RUNSC_RUNTIME_LIMITS_V1.idleTtlMs,
      "idle TTL",
    );
    record.leaseExpiresAtMs = Math.min(
      this.now() + bounded,
      record.hardExpiresAtMs,
    );
    this.armTimer(record);
    return this.lease(record);
  }

  async dispose(sandboxId: string): Promise<void>;
  async dispose(sandboxId: string, workspaceId: string): Promise<void>;
  async dispose(sandboxId: string, workspaceId?: string): Promise<void> {
    const record = this.findSession(sandboxId, workspaceId);
    if (!record) return;
    await this.retire(record, "cleanup", false);
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const record of this.sessions.values()) clearTimeout(record.timer);
    const drain = Promise.allSettled([...this.pendingOperations]);
    await Promise.race([
      drain,
      new Promise<void>((resolve) =>
        setTimeout(resolve, RUNSC_RUNTIME_LIMITS_V1.shutdownDrainMs),
      ),
    ]);
    const records = [...this.sessions.values()];
    const retirements = await Promise.allSettled(
      records.map(async (record) => await this.retire(record, "shutdown")),
    );
    const failure = retirements.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) {
      throw failure.reason;
    }
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
    workspaceId?: string,
  ): Promise<SessionRecordV1> {
    if (this.closed) this.unavailable();
    const record = this.findSession(sandboxId, workspaceId);
    if (!record) {
      await this.notifyMissing(workspaceId, sandboxId);
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound,
        "remote-worker sandbox was not found",
      );
    }
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

  private lease(record: SessionRecordV1): RunscSessionLeaseV1 {
    return Object.freeze({
      sandboxId: record.sandboxId,
      leaseExpiresAtMs: record.leaseExpiresAtMs,
      hardExpiresAtMs: record.hardExpiresAtMs,
    });
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

  private detach(record: SessionRecordV1): void {
    clearTimeout(record.timer);
    this.sessions.delete(this.sessionKey(record));
    const leaseKey = compositeKey(record.workspaceId, record.clientLeaseId);
    if (this.leaseBindings.get(leaseKey) === record) {
      this.leaseBindings.delete(leaseKey);
    }
    if (this.legacyWorkspaceBindings.get(record.workspaceId) === record) {
      this.legacyWorkspaceBindings.delete(record.workspaceId);
    }
    record.invocations.clear();
  }

  private bind(record: SessionRecordV1): void {
    this.sessions.set(this.sessionKey(record), record);
    this.leaseBindings.set(
      compositeKey(record.workspaceId, record.clientLeaseId),
      record,
    );
    if (!record.ownsWorkspaceMountSource) {
      this.legacyWorkspaceBindings.set(record.workspaceId, record);
    }
  }

  private sessionKey(record: Pick<SessionRecordV1, "workspaceId" | "sandboxId">): string {
    return compositeKey(record.workspaceId, record.sandboxId);
  }

  private findSession(
    sandboxId: string,
    workspaceId?: string,
  ): SessionRecordV1 | undefined {
    safeOpaqueId(sandboxId, "sandbox id");
    if (workspaceId !== undefined) {
      const exact = this.sessions.get(compositeKey(workspaceId, sandboxId));
      if (exact) return exact;
      if ([...this.sessions.values()].some((record) => record.sandboxId === sandboxId)) {
        throw runscRuntimeError(
          REMOTE_WORKER_ERROR_CODES_V1.sandboxWorkspaceMismatch,
          "remote-worker sandbox binding does not match the authorized workspace",
        );
      }
      return undefined;
    }
    const matches = [...this.sessions.values()].filter(
      (record) => record.sandboxId === sandboxId,
    );
    if (matches.length > 1) {
      throw runscRuntimeError(
        REMOTE_WORKER_ERROR_CODES_V1.sandboxWorkspaceMismatch,
        "remote-worker sandbox requires an authorized workspace",
      );
    }
    return matches[0];
  }

  private async retireFailedCreate(record: SessionRecordV1): Promise<void> {
    this.bind(record);
    await this.retire(record, "cleanup", false);
  }

  private async retire(
    record: SessionRecordV1,
    reason: RunscSessionRetirementReasonV1,
    notify = true,
  ): Promise<void> {
    await this.retirement.retire(record, reason, notify);
  }

  private async notifyMissing(
    workspaceId: string | undefined,
    sandboxId: string,
  ): Promise<void> {
    safeOpaqueId(sandboxId, "sandbox id");
    await this.retirement.notifyMissing(workspaceId, sandboxId);
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.pendingOperations.add(operation);
    const cleanup = (): void => {
      this.pendingOperations.delete(operation);
    };
    void operation.then(cleanup, cleanup);
    return operation;
  }

  private unavailable(): never {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.unavailable,
      "remote-worker runtime is unavailable",
    );
  }

  private idempotencyConflict(): never {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.idempotencyConflict,
      "remote-worker idempotency key conflicts with an existing request",
    );
  }

  private incompleteCleanup(): never {
    throw runscRuntimeError(
      REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
      "remote-worker invocation cleanup could not be proven",
    );
  }
}

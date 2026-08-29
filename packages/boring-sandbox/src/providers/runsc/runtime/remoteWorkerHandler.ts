import type { AuthorizedWorkspaceCredentialScopeV1 } from "@hachej/boring-agent/shared";
import {
  REMOTE_WORKER_ERROR_CODES_V1,
  REMOTE_WORKER_EXCLUSIVE_BINARY_CREATE_CAPABILITY_V1,
  REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1,
  REMOTE_WORKER_PROTOCOL_VERSION,
  REMOTE_WORKER_RUNTIME_CWD,
  RemoteWorkerCreateResponseSchemaV1,
  RemoteWorkerDeleteResponseSchemaV1,
  RemoteWorkerExecRequestSchemaV1,
  RemoteWorkerHealthResponseSchemaV1,
  RemoteWorkerRenewRequestSchemaV1,
  RemoteWorkerRenewResponseSchemaV1,
  RemoteWorkerWorkspaceOperationSchemaV1,
  negotiateRemoteWorkerHealthCapabilitiesV1,
  type RemoteWorkerCreateRequestV1,
  type RemoteWorkerCreateResponseV1,
  type RemoteWorkerDeleteResponseV1,
  type RemoteWorkerExecRequestV1,
  type RemoteWorkerExecResponseV1,
  type RemoteWorkerHealthResponseV1,
  type RemoteWorkerNegotiatedCapabilityV1,
  type RemoteWorkerRenewRequestV1,
  type RemoteWorkerRenewResponseV1,
  type RemoteWorkerWorkspaceOperationV1,
  type RemoteWorkerWorkspaceResultV1,
} from "../../../shared/remoteWorkerProtocolV1";
import { PROVIDER_CONTRACT_VERSION } from "../../../shared/providerMatrix";
import { SandboxProviderError } from "../../../shared/providerV1";
import {
  RemoteWorkerSandboxBindingRegistryV1,
  type RemoteWorkerAuthorizedEventStreamV1,
} from "../../remote-worker/bindingRegistry";
import { validateQuotaWorkspaceId } from "./quota";
import type { RunscSessionRuntimeOptionsV1 } from "./sessionRuntime";
import { RunscSessionRuntimeV1 } from "./sessionRuntime";
export interface RemoteWorkerRunscQualificationV1 {
  readonly evidenceDigest: `sha256:${string}`;
  readonly qualificationBundleDigest: `sha256:${string}`;
  readonly providerCohortDigest: `sha256:${string}`;
  readonly imageDigest: `sha256:${string}`;
  readonly qualificationRunId: string;
  readonly qualifiedAtMs: number;
}
export interface RemoteWorkerRunscHandlerOptionsV1 {
  readonly registry: RemoteWorkerSandboxBindingRegistryV1;
  readonly runtime: Omit<RunscSessionRuntimeOptionsV1, "onRetire">;
  readonly workloadImage: string;
  readonly qualification: RemoteWorkerRunscQualificationV1;
  readonly multiSandboxRootsQualified?: boolean;
  readonly credentialScopeForWorkspace?: (
    workspaceId: string,
  ) => AuthorizedWorkspaceCredentialScopeV1 | undefined;
  readonly openEvents: (input: {
    workspaceId: string;
    sandboxId: string;
  }) => RemoteWorkerAuthorizedEventStreamV1 | Promise<RemoteWorkerAuthorizedEventStreamV1>;
}
function strictParse<T>(
  parser: { parse(value: unknown): T },
  value: unknown,
): T {
  try {
    return parser.parse(value);
  } catch (error) {
    throw new SandboxProviderError(
      REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      "remote-worker handler input failed strict validation",
      { cause: error },
    );
  }
}
export class RemoteWorkerRunscHandlerV1 {
  readonly runtime: RunscSessionRuntimeV1;
  private readonly createTransactions = new Map<
    string,
    Promise<RemoteWorkerCreateResponseV1>
  >();

  constructor(private readonly options: RemoteWorkerRunscHandlerOptionsV1) {
    if (!options.workloadImage.endsWith(`@${options.qualification.imageDigest}`)) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
        "remote-worker workload image does not match its qualification",
      );
    }
    if (
      options.multiSandboxRootsQualified === true &&
      !options.runtime.sandboxRoots
    ) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
        "remote-worker multi-root qualification has no root lifecycle",
      );
    }
    this.runtime = new RunscSessionRuntimeV1({
      ...options.runtime,
      multiSandboxRootsAdmitted:
        options.runtime.sandboxRoots !== undefined &&
        options.multiSandboxRootsQualified === true,
      onRetire: async (retirement) => {
        options.registry.retireBinding(
          retirement.workspaceId,
          retirement.sandboxId,
        );
      },
    });
  }
  async health(input: {
    capabilityToken: string;
    requestedCapabilities?: string;
  }): Promise<RemoteWorkerHealthResponseV1> {
    const authorization = await this.options.registry.authorizeHealth({
      capabilityToken: input.capabilityToken,
      requestBody: {},
    });
    this.assertCanonicalWorkspace(authorization.workspaceId);
    const supported: RemoteWorkerNegotiatedCapabilityV1[] = [
      REMOTE_WORKER_EXCLUSIVE_BINARY_CREATE_CAPABILITY_V1,
    ];
    if (
      this.runtime.supportsMultiSandboxRoots &&
      this.options.multiSandboxRootsQualified === true
    ) {
      supported.push(REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1);
    }
    return RemoteWorkerHealthResponseSchemaV1.parse({
      protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
      providerContractVersion: PROVIDER_CONTRACT_VERSION,
      workerId: this.options.registry.authorizedWorkerId,
      ...this.options.qualification,
      isolation: "docker-runsc-systrap",
      capabilities: ["fs", "events", "exec", "renew", "delete"],
      ...negotiateRemoteWorkerHealthCapabilitiesV1(
        input.requestedCapabilities,
        supported,
      ),
    });
  }
  async create(input: {
    capabilityToken: string;
    request: RemoteWorkerCreateRequestV1;
  }): Promise<RemoteWorkerCreateResponseV1> {
    const authorization = await this.options.registry.authorizeCreate({
      request: input.request,
      capabilityToken: input.capabilityToken,
    });
    const request = authorization.request;
    this.assertCanonicalWorkspace(request.workspaceId);
    this.assertQualification(request);
    const transactionKey = JSON.stringify([
      request.workspaceId,
      request.clientLeaseId,
      authorization.requestDigest,
    ]);
    const existing = this.createTransactions.get(transactionKey);
    if (existing) return await existing;

    const transaction = (async (): Promise<RemoteWorkerCreateResponseV1> => {
      const lease = await this.runtime.create({
        clientLeaseId: request.clientLeaseId,
        createDigest: authorization.requestDigest,
        workspaceId: request.workspaceId,
        image: this.options.workloadImage,
        idleTtlMs: request.idleTimeoutMs,
      });
      try {
        const bindingReceipt = await this.options.registry.bindAuthorized({
          authorization,
          sandboxId: lease.sandboxId,
          leaseExpiresAtMs: lease.leaseExpiresAtMs,
        });
        return RemoteWorkerCreateResponseSchemaV1.parse({
          protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
          providerContractVersion: PROVIDER_CONTRACT_VERSION,
          workerId: this.options.registry.authorizedWorkerId,
          sandboxId: lease.sandboxId,
          runtimeCwd: REMOTE_WORKER_RUNTIME_CWD,
          leaseExpiresAtMs: bindingReceipt.payload.expiresAtMs,
          bindingReceipt,
        });
      } catch (error) {
        if (lease.newlyAllocated) {
          await this.runtime.dispose(lease.sandboxId, request.workspaceId);
        }
        throw error;
      }
    })();
    this.createTransactions.set(transactionKey, transaction);
    try {
      return await transaction;
    } finally {
      if (this.createTransactions.get(transactionKey) === transaction) {
        this.createTransactions.delete(transactionKey);
      }
    }
  }
  async fs(input: {
    capabilityToken: string;
    sandboxId: string;
    request: RemoteWorkerWorkspaceOperationV1;
  }): Promise<RemoteWorkerWorkspaceResultV1> {
    const request = strictParse(RemoteWorkerWorkspaceOperationSchemaV1, input.request);
    return await this.options.registry.authorize(
      {
        sandboxId: input.sandboxId,
        operation: "fs",
        requestBody: request,
        capabilityToken: input.capabilityToken,
      },
      async (binding) => {
        this.assertCanonicalWorkspace(binding.workspaceId);
        return await this.runtime.fs(
          binding.sandboxId,
          binding.workspaceId,
          request,
        );
      },
    );
  }
  async exec(input: {
    capabilityToken: string;
    sandboxId: string;
    request: RemoteWorkerExecRequestV1;
    signal?: AbortSignal;
  }): Promise<RemoteWorkerExecResponseV1> {
    const request = strictParse(RemoteWorkerExecRequestSchemaV1, input.request);
    return await this.options.registry.authorize(
      {
        sandboxId: input.sandboxId,
        operation: "exec",
        requestBody: request,
        capabilityToken: input.capabilityToken,
      },
      async (binding) => {
        this.assertCanonicalWorkspace(binding.workspaceId);
        return await this.runtime.exec(
          binding.sandboxId,
          binding.workspaceId,
          request,
          input.signal,
          this.options.credentialScopeForWorkspace?.(binding.workspaceId),
        );
      },
    );
  }
  async renew(input: {
    capabilityToken: string;
    sandboxId: string;
    request: RemoteWorkerRenewRequestV1;
  }): Promise<RemoteWorkerRenewResponseV1> {
    const request = strictParse(RemoteWorkerRenewRequestSchemaV1, input.request);
    return await this.options.registry.renew(
      {
        sandboxId: input.sandboxId,
        operation: "renew",
        requestBody: request,
        capabilityToken: input.capabilityToken,
      },
      async (binding) => {
        this.assertCanonicalWorkspace(binding.workspaceId);
        const lease = await this.runtime.renew(
          binding.sandboxId,
          binding.workspaceId,
          request.idleTimeoutMs,
        );
        return RemoteWorkerRenewResponseSchemaV1.parse({
          leaseExpiresAtMs: lease.leaseExpiresAtMs,
        });
      },
    );
  }
  async delete(input: {
    capabilityToken: string;
    sandboxId: string;
  }): Promise<RemoteWorkerDeleteResponseV1> {
    return await this.options.registry.dispose(
      {
        sandboxId: input.sandboxId,
        operation: "delete",
        requestBody: {},
        capabilityToken: input.capabilityToken,
      },
      async (binding) => {
        this.assertCanonicalWorkspace(binding.workspaceId);
        await this.runtime.dispose(binding.sandboxId, binding.workspaceId);
        return RemoteWorkerDeleteResponseSchemaV1.parse({ disposed: true });
      },
    );
  }
  async events(input: {
    capabilityToken: string;
    sandboxId: string;
  }): Promise<RemoteWorkerAuthorizedEventStreamV1> {
    return await this.options.registry.authorizeEventStream(
      {
        sandboxId: input.sandboxId,
        operation: "events",
        requestBody: {},
        capabilityToken: input.capabilityToken,
      },
      async (binding) => {
        this.assertCanonicalWorkspace(binding.workspaceId);
        return await this.options.openEvents(binding);
      },
    );
  }
  async startupSweep(): Promise<void> {
    await this.runtime.startupSweep();
  }
  async shutdown(): Promise<void> {
    await this.runtime.shutdown();
  }
  private assertCanonicalWorkspace(workspaceId: string): void {
    validateQuotaWorkspaceId(workspaceId);
  }

  private assertQualification(request: RemoteWorkerCreateRequestV1): void {
    const expected = this.options.qualification;
    if (
      request.expectedEvidenceDigest !== expected.evidenceDigest ||
      request.expectedQualificationBundleDigest !== expected.qualificationBundleDigest ||
      request.expectedProviderCohortDigest !== expected.providerCohortDigest ||
      request.expectedImageDigest !== expected.imageDigest
    ) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.unqualified,
        "remote-worker create request does not match qualification",
      );
    }
  }
}

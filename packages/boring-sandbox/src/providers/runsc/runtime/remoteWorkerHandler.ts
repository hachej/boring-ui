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

function snapshotQualification(
  workerId: string,
  qualification: RemoteWorkerRunscQualificationV1,
): Readonly<RemoteWorkerRunscQualificationV1> {
  let parsed: ReturnType<typeof RemoteWorkerHealthResponseSchemaV1.parse>;
  try {
    parsed = RemoteWorkerHealthResponseSchemaV1.parse({
      ...qualification,
      protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
      providerContractVersion: PROVIDER_CONTRACT_VERSION,
      workerId,
      isolation: "docker-runsc-systrap",
      capabilities: ["fs", "events", "exec", "renew", "delete"],
    });
  } catch (error) {
    throw new SandboxProviderError(
      REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
      "remote-worker qualification is invalid",
      { cause: error },
    );
  }
  return Object.freeze({
    evidenceDigest: parsed.evidenceDigest,
    qualificationBundleDigest: parsed.qualificationBundleDigest,
    providerCohortDigest: parsed.providerCohortDigest,
    imageDigest: parsed.imageDigest,
    qualificationRunId: parsed.qualificationRunId,
    qualifiedAtMs: parsed.qualifiedAtMs,
  }) as Readonly<RemoteWorkerRunscQualificationV1>;
}

export class RemoteWorkerRunscHandlerV1 {
  private readonly runtime: RunscSessionRuntimeV1;
  private readonly registry: RemoteWorkerSandboxBindingRegistryV1;
  private readonly workloadImage: string;
  private readonly qualification: Readonly<RemoteWorkerRunscQualificationV1>;
  private readonly multiSandboxRootsQualified: boolean;
  private readonly credentialScopeForWorkspace: RemoteWorkerRunscHandlerOptionsV1["credentialScopeForWorkspace"];
  private readonly openEvents: RemoteWorkerRunscHandlerOptionsV1["openEvents"];

  constructor(options: RemoteWorkerRunscHandlerOptionsV1) {
    this.registry = options.registry;
    this.workloadImage = options.workloadImage;
    this.qualification = snapshotQualification(
      this.registry.authorizedWorkerId,
      options.qualification,
    );
    this.multiSandboxRootsQualified =
      options.multiSandboxRootsQualified === true;
    this.credentialScopeForWorkspace = options.credentialScopeForWorkspace;
    this.openEvents = options.openEvents;
    if (!this.workloadImage.endsWith(`@${this.qualification.imageDigest}`)) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
        "remote-worker workload image does not match its qualification",
      );
    }
    if (this.multiSandboxRootsQualified && !options.runtime.sandboxRoots) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
        "remote-worker multi-root qualification has no root lifecycle",
      );
    }
    this.runtime = new RunscSessionRuntimeV1({
      ...options.runtime,
      multiSandboxRootsAdmitted:
        options.runtime.sandboxRoots !== undefined &&
        this.multiSandboxRootsQualified,
      onCompositeRetire: async (retirement) => {
        this.registry.retireBinding(
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
    const authorization = await this.registry.authorizeHealth({
      capabilityToken: input.capabilityToken,
      requestBody: {},
    });
    this.assertCanonicalWorkspace(authorization.workspaceId);
    const supported: RemoteWorkerNegotiatedCapabilityV1[] = [
      REMOTE_WORKER_EXCLUSIVE_BINARY_CREATE_CAPABILITY_V1,
    ];
    if (
      this.runtime.supportsMultiSandboxRoots &&
      this.multiSandboxRootsQualified
    ) {
      supported.push(REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1);
    }
    return RemoteWorkerHealthResponseSchemaV1.parse({
      protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
      providerContractVersion: PROVIDER_CONTRACT_VERSION,
      workerId: this.registry.authorizedWorkerId,
      ...this.qualification,
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
    let allocated:
      | {
          workspaceId: string;
          sandboxId: string;
          newlyAllocated: boolean;
        }
      | undefined;
    try {
      const bound = await this.registry.createBinding(
        input,
        async ({ request }) => {
          this.assertCanonicalWorkspace(request.workspaceId);
          this.assertQualification(request);
          const lease = await this.runtime.createComposite({
            clientLeaseId: request.clientLeaseId,
            workspaceId: request.workspaceId,
            image: this.workloadImage,
            idleTtlMs: request.idleTimeoutMs,
          });
          allocated = {
            workspaceId: request.workspaceId,
            sandboxId: lease.sandboxId,
            newlyAllocated: lease.newlyAllocated,
          };
          return {
            sandboxId: lease.sandboxId,
            leaseExpiresAtMs: lease.leaseExpiresAtMs,
            value: lease,
          };
        },
      );
      const lease = bound.value;
      return RemoteWorkerCreateResponseSchemaV1.parse({
        protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
        providerContractVersion: PROVIDER_CONTRACT_VERSION,
        workerId: this.registry.authorizedWorkerId,
        sandboxId: lease.sandboxId,
        runtimeCwd: REMOTE_WORKER_RUNTIME_CWD,
        leaseExpiresAtMs: bound.bindingReceipt.payload.expiresAtMs,
        bindingReceipt: bound.bindingReceipt,
      });
    } catch (error) {
      if (allocated?.newlyAllocated) {
        this.registry.retireBinding(allocated.workspaceId, allocated.sandboxId);
        await this.runtime.dispose(allocated.sandboxId, allocated.workspaceId);
      }
      throw error;
    }
  }
  async fs(input: {
    capabilityToken: string;
    sandboxId: string;
    request: RemoteWorkerWorkspaceOperationV1;
  }): Promise<RemoteWorkerWorkspaceResultV1> {
    return await this.registry.authorize(
      {
        sandboxId: input.sandboxId,
        operation: "fs",
        requestBody: input.request,
        capabilityToken: input.capabilityToken,
      },
      async (binding) => {
        const request = strictParse(
          RemoteWorkerWorkspaceOperationSchemaV1,
          input.request,
        );
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
    return await this.registry.authorize(
      {
        sandboxId: input.sandboxId,
        operation: "exec",
        requestBody: input.request,
        capabilityToken: input.capabilityToken,
      },
      async (binding) => {
        const request = strictParse(RemoteWorkerExecRequestSchemaV1, input.request);
        this.assertCanonicalWorkspace(binding.workspaceId);
        return await this.runtime.exec(
          binding.sandboxId,
          binding.workspaceId,
          request,
          input.signal,
          this.credentialScopeForWorkspace?.(binding.workspaceId),
        );
      },
    );
  }
  async renew(input: {
    capabilityToken: string;
    sandboxId: string;
    request: RemoteWorkerRenewRequestV1;
  }): Promise<RemoteWorkerRenewResponseV1> {
    return await this.registry.renew(
      {
        sandboxId: input.sandboxId,
        operation: "renew",
        requestBody: input.request,
        capabilityToken: input.capabilityToken,
      },
      async (binding) => {
        const request = strictParse(RemoteWorkerRenewRequestSchemaV1, input.request);
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
    return await this.registry.dispose(
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
    return await this.registry.authorizeEventStream(
      {
        sandboxId: input.sandboxId,
        operation: "events",
        requestBody: {},
        capabilityToken: input.capabilityToken,
      },
      async (binding) => {
        this.assertCanonicalWorkspace(binding.workspaceId);
        return await this.openEvents(binding);
      },
    );
  }
  async startupSweep(): Promise<void> {
    await this.runtime.startupSweep();
  }
  async shutdown(): Promise<void> {
    this.registry.close();
    await this.runtime.shutdown();
  }
  private assertCanonicalWorkspace(workspaceId: string): void {
    validateQuotaWorkspaceId(workspaceId);
  }

  private assertQualification(request: RemoteWorkerCreateRequestV1): void {
    const expected = this.qualification;
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

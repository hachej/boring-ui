import { randomUUID } from "node:crypto";

import {
  PROVIDER_CAPABILITIES,
  PROVIDER_CONTRACT_VERSION,
} from "../../shared/providerMatrix";
import {
  REMOTE_WORKER_ERROR_CODES_V1,
  REMOTE_WORKER_MAX_CAPABILITY_LIFETIME_MS,
  REMOTE_WORKER_PROTOCOL_VERSION,
  REMOTE_WORKER_RUNTIME_CWD,
  RemoteWorkerCreateRequestSchemaV1,
  RemoteWorkerOpaqueIdSchemaV1,
  type RemoteWorkerBindingReceiptV1,
  type RemoteWorkerCreateRequestV1,
} from "../../shared/remoteWorkerProtocolV1";
import {
  SandboxProviderError,
  type SandboxProviderV1,
  type WorkspaceSandboxPairV1,
} from "../../shared/providerV1";
import {
  parseRemoteWorkerFleetConfigV1,
  resolveRemoteWorkerPlacementV1,
  type RemoteWorkerFleetConfigV1,
  type RemoteWorkerFleetWorkerConfigV1,
} from "./fleetConfig";
import { createRemoteSandboxV1, createRemoteWorkspaceV1 } from "./pairProxies";
import {
  RemoteWorkerProtocolClientV1,
  parseRemoteWorkerRequestV1,
  type RemoteWorkerCapabilityIssuerV1,
} from "./protocolClient";
import { remoteWorkerRequestDigestV1 } from "./requestDigest";
import type { RemoteWorkerTransportV1 } from "./transport";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_CAPABILITY_LIFETIME_MS = 4 * 60 * 1000;
const DEFAULT_EVENT_STREAM_LIFETIME_MS = 4 * 60 * 1000;
const DEFAULT_DISPOSE_ATTEMPTS = 3;
const DEFAULT_QUALIFICATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface RemoteWorkerExecutionCredentialResolverStubV1 {
  // TODO reconcile with BYOK credential-injection contract (plan/820-byok-secret-vault)
  resolveCredentialRefForExecution(input: {
    workspaceId: string;
    credentialRef: string;
    purpose: string;
  }): Promise<never>;
}

export type {
  RemoteWorkerCapabilityIssuerInputV1,
  RemoteWorkerCapabilityIssuerV1,
} from "./protocolClient";

export interface RemoteWorkerBindingReceiptVerifierInputV1 {
  readonly worker: RemoteWorkerFleetWorkerConfigV1;
  readonly receipt: RemoteWorkerBindingReceiptV1;
}

export interface RemoteWorkerBindingReceiptVerifierV1 {
  verifyBindingReceipt(
    input: RemoteWorkerBindingReceiptVerifierInputV1,
  ): boolean | Promise<boolean>;
}

export interface RemoteWorkerSandboxProviderOptionsV1 {
  fleet: RemoteWorkerFleetConfigV1;
  capabilityIssuer: RemoteWorkerCapabilityIssuerV1;
  bindingReceiptVerifier: RemoteWorkerBindingReceiptVerifierV1;
  transport: RemoteWorkerTransportV1;
  now?: () => number;
  idFactory?: () => string;
  requestTimeoutMs?: number;
  execTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxOutputBytes?: number;
  capabilityLifetimeMs?: number;
  eventStreamLifetimeMs?: number;
  qualificationMaxAgeMs?: number;
  disposeAttempts?: number;
  /** Tests may pair a fake transport with an in-process cleartext loopback URL. */
  allowInsecureLoopback?: boolean;
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new SandboxProviderError(
      REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
      `${name} must be a positive integer`,
    );
  }
  return resolved;
}
function receiptMatchesCreate(input: {
  receipt: RemoteWorkerBindingReceiptV1;
  request: RemoteWorkerCreateRequestV1;
  requestDigest: `sha256:${string}`;
  workerId: string;
  sandboxId: string;
  leaseExpiresAtMs: number;
  nowMs: number;
}): boolean {
  const payload = input.receipt.payload;
  return (
    payload.workspaceId === input.request.workspaceId &&
    payload.clientLeaseId === input.request.clientLeaseId &&
    payload.workerId === input.workerId &&
    payload.sandboxId === input.sandboxId &&
    payload.requestDigest === input.requestDigest &&
    payload.expiresAtMs === input.leaseExpiresAtMs &&
    payload.expiresAtMs > input.nowMs
  );
}

async function deleteRemoteSandboxV1(
  destroy: () => Promise<unknown>,
  attempts: number,
): Promise<unknown | undefined> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await destroy();
      return undefined;
    } catch (error) {
      if (
        error instanceof SandboxProviderError &&
        error.code === REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound
      ) {
        return undefined;
      }
      lastError = error;
    }
  }
  return lastError;
}

export function createRemoteWorkerSandboxProviderV1(
  options: RemoteWorkerSandboxProviderOptionsV1,
): SandboxProviderV1 {
  const fleet = parseRemoteWorkerFleetConfigV1(options.fleet, {
    allowInsecureLoopback: options.allowInsecureLoopback,
  });
  const transport = options.transport;
  const now = options.now ?? Date.now;
  const idFactory = options.idFactory ?? randomUUID;
  const requestTimeoutMs = positiveInteger(
    options.requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    "requestTimeoutMs",
  );
  const execTimeoutMs = positiveInteger(
    options.execTimeoutMs,
    DEFAULT_EXEC_TIMEOUT_MS,
    "execTimeoutMs",
  );
  const idleTimeoutMs = positiveInteger(
    options.idleTimeoutMs,
    DEFAULT_IDLE_TIMEOUT_MS,
    "idleTimeoutMs",
  );
  const maxOutputBytes = positiveInteger(
    options.maxOutputBytes,
    DEFAULT_MAX_OUTPUT_BYTES,
    "maxOutputBytes",
  );
  const capabilityLifetimeMs = positiveInteger(
    options.capabilityLifetimeMs,
    DEFAULT_CAPABILITY_LIFETIME_MS,
    "capabilityLifetimeMs",
  );
  const eventStreamLifetimeMs = positiveInteger(
    options.eventStreamLifetimeMs,
    DEFAULT_EVENT_STREAM_LIFETIME_MS,
    "eventStreamLifetimeMs",
  );
  const qualificationMaxAgeMs = positiveInteger(
    options.qualificationMaxAgeMs,
    DEFAULT_QUALIFICATION_MAX_AGE_MS,
    "qualificationMaxAgeMs",
  );
  const disposeAttempts = positiveInteger(
    options.disposeAttempts,
    DEFAULT_DISPOSE_ATTEMPTS,
    "disposeAttempts",
  );
  if (
    capabilityLifetimeMs > REMOTE_WORKER_MAX_CAPABILITY_LIFETIME_MS ||
    eventStreamLifetimeMs > REMOTE_WORKER_MAX_CAPABILITY_LIFETIME_MS
  ) {
    throw new SandboxProviderError(
      REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
      "remote-worker capability and event stream lifetimes must not exceed five minutes",
    );
  }

  const activePairs = new Map<string, Set<() => Promise<void>>>();
  const pendingCreates = new Set<Promise<void>>();
  let closed = false;

  return {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: "remote-worker",
    capabilities: PROVIDER_CAPABILITIES["remote-worker"],
    resolveRuntimeRoot() {
      return REMOTE_WORKER_RUNTIME_CWD;
    },
    async create(context): Promise<WorkspaceSandboxPairV1> {
      let finishCreate = (): void => {};
      const pendingCreate = new Promise<void>((resolve) => {
        finishCreate = resolve;
      });
      pendingCreates.add(pendingCreate);
      try {
        if (closed) {
          throw new SandboxProviderError(
            REMOTE_WORKER_ERROR_CODES_V1.unavailable,
            "remote-worker provider is closed",
          );
        }
        const rawWorkspaceId = context.workspaceId?.trim();
        if (!rawWorkspaceId) {
          throw new SandboxProviderError(
            REMOTE_WORKER_ERROR_CODES_V1.authorizedWorkspaceRequired,
            "remote-worker provider requires an authorized workspaceId",
          );
        }
        const workspaceId = parseRemoteWorkerRequestV1(
          RemoteWorkerOpaqueIdSchemaV1,
          rawWorkspaceId,
          "workspaceId",
        );
        const sessionId = parseRemoteWorkerRequestV1(
          RemoteWorkerOpaqueIdSchemaV1,
          context.sessionId,
          "sessionId",
        );
        const worker = resolveRemoteWorkerPlacementV1(fleet, workspaceId);
        const client = new RemoteWorkerProtocolClientV1({
          worker,
          workspaceId,
          requestId: context.requestId ?? idFactory(),
          issuer: options.capabilityIssuer,
          transport,
          now,
          idFactory,
          requestTimeoutMs,
          capabilityLifetimeMs,
          eventStreamLifetimeMs,
        });

        const request = parseRemoteWorkerRequestV1(
          RemoteWorkerCreateRequestSchemaV1,
          {
            protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
            providerContractVersion: PROVIDER_CONTRACT_VERSION,
            workspaceId,
            sessionId,
            clientLeaseId: idFactory(),
            idleTimeoutMs,
            maxOutputBytes,
            expectedEvidenceDigest: worker.expectedEvidenceDigest,
            expectedQualificationBundleDigest:
              worker.expectedQualificationBundleDigest,
            expectedProviderCohortDigest: worker.expectedProviderCohortDigest,
            expectedImageDigest: worker.expectedImageDigest,
          },
          "create request",
        );

        const health = await client.health();
        if (
          health.workerId !== worker.workerId ||
          health.evidenceDigest !== worker.expectedEvidenceDigest ||
          health.qualificationBundleDigest !==
            worker.expectedQualificationBundleDigest ||
          health.providerCohortDigest !== worker.expectedProviderCohortDigest ||
          health.imageDigest !== worker.expectedImageDigest ||
          health.qualifiedAtMs > now() ||
          now() - health.qualifiedAtMs > qualificationMaxAgeMs ||
          !["fs", "events", "exec", "renew", "delete"].every((capability) =>
            health.capabilities.includes(
              capability as (typeof health.capabilities)[number],
            ),
          )
        ) {
          await client.close();
          throw new SandboxProviderError(
            REMOTE_WORKER_ERROR_CODES_V1.unqualified,
            "remote-worker qualification facts do not match static placement",
          );
        }

        const requestDigest = remoteWorkerRequestDigestV1(request);
        const createResponse = await client.create(request);
        let receiptIsValid = false;
        try {
          receiptIsValid =
            createResponse.workerId === worker.workerId &&
            receiptMatchesCreate({
              receipt: createResponse.bindingReceipt,
              request,
              requestDigest,
              workerId: worker.workerId,
              sandboxId: createResponse.sandboxId,
              leaseExpiresAtMs: createResponse.leaseExpiresAtMs,
              nowMs: now(),
            }) &&
            (await options.bindingReceiptVerifier.verifyBindingReceipt({
              worker,
              receipt: createResponse.bindingReceipt,
            }));
        } catch {
          receiptIsValid = false;
        }
        if (!receiptIsValid) {
          await deleteRemoteSandboxV1(
            () => client.provisionalDelete(createResponse.sandboxId),
            disposeAttempts,
          );
          await client.close();
          throw new SandboxProviderError(
            REMOTE_WORKER_ERROR_CODES_V1.bindingReceiptInvalid,
            "remote-worker create binding receipt is invalid",
          );
        }

        let leaseExpiresAtMs = createResponse.leaseExpiresAtMs;
        const leaseClient = client.bind(createResponse.sandboxId);
        const remoteWorkspace = createRemoteWorkspaceV1({
          client: leaseClient,
          leaseExpiresAtMs: () => leaseExpiresAtMs,
          now,
        });
        const sandbox = createRemoteSandboxV1({
          client: leaseClient,
          execTimeoutMs,
          maxOutputBytes,
          idFactory,
        });
        let disposed = false;
        let disposeInFlight: Promise<void> | undefined;
        const dispose = async (): Promise<void> => {
          if (disposed) return;
          if (disposeInFlight) return await disposeInFlight;
          const operation = (async () => {
            remoteWorkspace.closeWatcher();
            const lastError = await deleteRemoteSandboxV1(
              () => leaseClient.delete(),
              disposeAttempts,
            );
            if (lastError !== undefined) {
              throw new SandboxProviderError(
                REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
                "remote-worker sandbox cleanup could not be confirmed",
                { cause: lastError },
              );
            }
            disposed = true;
            await leaseClient.close();
            activePairs.get(workspaceId)?.delete(dispose);
            if (activePairs.get(workspaceId)?.size === 0)
              activePairs.delete(workspaceId);
          })();
          disposeInFlight = operation;
          try {
            await operation;
          } finally {
            if (disposeInFlight === operation) disposeInFlight = undefined;
          }
        };

        const pairSet =
          activePairs.get(workspaceId) ?? new Set<() => Promise<void>>();
        pairSet.add(dispose);
        activePairs.set(workspaceId, pairSet);

        return {
          workspace: remoteWorkspace.workspace,
          sandbox,
          async checkHealth() {
            if (disposed)
              return {
                state: "recreate",
                message: "remote-worker pair was disposed",
              };
            if (leaseExpiresAtMs <= now()) {
              return {
                state: "recreate",
                error: new SandboxProviderError(
                  REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
                  "remote-worker sandbox lease expired",
                ),
              };
            }
            try {
              const renewed = await leaseClient.renew({ idleTimeoutMs });
              if (renewed.leaseExpiresAtMs <= now()) {
                throw new SandboxProviderError(
                  REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
                  "remote-worker renewed lease is already expired",
                );
              }
              leaseExpiresAtMs = renewed.leaseExpiresAtMs;
              return { state: "ok" };
            } catch (error) {
              return { state: "recreate", error };
            }
          },
          dispose,
        };
      } finally {
        finishCreate();
        pendingCreates.delete(pendingCreate);
      }
    },
    async invalidate({ workspaceId }) {
      await Promise.allSettled(
        [...(activePairs.get(workspaceId) ?? [])].map((dispose) => dispose()),
      );
    },
    async close() {
      closed = true;
      await Promise.allSettled([...pendingCreates]);
      const disposers = [...activePairs.values()].flatMap((entries) => [
        ...entries,
      ]);
      await Promise.allSettled(disposers.map((dispose) => dispose()));
    },
  };
}

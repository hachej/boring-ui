import {
  REMOTE_WORKER_ERROR_CODES_V1,
  REMOTE_WORKER_MAX_CAPABILITY_LIFETIME_MS,
  REMOTE_WORKER_PROTOCOL_VERSION,
  RemoteWorkerBindingReceiptSchemaV1,
  RemoteWorkerCapabilityClaimsSchemaV1,
  RemoteWorkerCreateRequestSchemaV1,
  RemoteWorkerOpaqueIdSchemaV1,
  type RemoteWorkerBindingReceiptPayloadV1,
  type RemoteWorkerBindingReceiptV1,
  type RemoteWorkerCapabilityClaimsV1,
  type RemoteWorkerCreateRequestV1,
  type RemoteWorkerOperationV1,
} from "../../shared/remoteWorkerProtocolV1";
import { SandboxProviderError } from "../../shared/providerV1";
import { canonicalJson, remoteWorkerRequestDigestV1 } from "./requestDigest";
import { SingleUseNonceStoreV1 } from "./singleUseNonceStore";

const MAX_BOUND_REQUEST_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_LEASE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ACCEPTED_CAPABILITY_NONCES = 100_000;

interface RemoteWorkerSandboxBindingRecordV1 {
  readonly sandboxId: string;
  readonly workspaceId: string;
  readonly clientLeaseId: string;
  readonly workerId: string;
  readonly requestDigest: `sha256:${string}`;
  readonly expiresAtMs: number;
  readonly hardExpiresAtMs: number;
  readonly bindingReceipt: RemoteWorkerBindingReceiptV1;
}

export interface RemoteWorkerBindingReceiptAuthenticatorV1 {
  authenticate(
    payload: RemoteWorkerBindingReceiptPayloadV1,
  ): string | Promise<string>;
}

export interface RemoteWorkerCapabilityAuthenticatorV1 {
  authenticate(input: {
    token: string;
    workerId: string;
  }): unknown | Promise<unknown>;
}

export interface RemoteWorkerBindingSecurityEventV1 {
  readonly code: typeof REMOTE_WORKER_ERROR_CODES_V1.sandboxWorkspaceMismatch;
  readonly workerId: string;
  readonly operation: Exclude<RemoteWorkerOperationV1, "health" | "create">;
}

export interface RemoteWorkerSandboxBindingRegistryOptionsV1 {
  workerId: string;
  capabilityAuthenticator: RemoteWorkerCapabilityAuthenticatorV1;
  receiptAuthenticator: RemoteWorkerBindingReceiptAuthenticatorV1;
  eventStreamLifetimeMs?: number;
  maxLeaseLifetimeMs?: number;
  maxAcceptedCapabilityNonces?: number;
  now?: () => number;
  onSecurityViolation?: (event: RemoteWorkerBindingSecurityEventV1) => void;
}

export interface BindRemoteWorkerSandboxInputV1 {
  sandboxId: string;
  request: RemoteWorkerCreateRequestV1;
  capabilityToken: string;
  leaseExpiresAtMs: number;
}

type RemoteWorkerBoundOperationV1 = Exclude<
  RemoteWorkerOperationV1,
  "health" | "create"
>;

export interface AuthorizeRemoteWorkerSandboxInputV1<
  TOperation extends RemoteWorkerBoundOperationV1 =
    RemoteWorkerBoundOperationV1,
> {
  sandboxId: string;
  operation: TOperation;
  requestBody: unknown;
  capabilityToken: string;
}

export interface RemoteWorkerAuthorizedEventStreamV1 {
  closed: Promise<void>;
  close(): void;
}

function bindingError(
  code:
    | typeof REMOTE_WORKER_ERROR_CODES_V1.requestInvalid
    | typeof REMOTE_WORKER_ERROR_CODES_V1.capabilityExpired
    | typeof REMOTE_WORKER_ERROR_CODES_V1.sandboxWorkspaceMismatch
    | typeof REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound,
  message: string,
): SandboxProviderError {
  return new SandboxProviderError(code, message);
}

function parseBindingInput<T>(
  parser: { parse(value: unknown): T },
  value: unknown,
): T {
  try {
    return parser.parse(value);
  } catch (error) {
    throw new SandboxProviderError(
      REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      "remote-worker binding input failed strict validation",
      { cause: error },
    );
  }
}

function bindingRequestDigest(value: unknown): `sha256:${string}` {
  try {
    const encoded = new TextEncoder().encode(canonicalJson(value));
    if (encoded.byteLength > MAX_BOUND_REQUEST_BYTES) {
      throw bindingError(
        REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
        "remote-worker request exceeds its byte bound",
      );
    }
    return remoteWorkerRequestDigestV1(value);
  } catch (error) {
    if (error instanceof SandboxProviderError) throw error;
    throw new SandboxProviderError(
      REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      "remote-worker request cannot be canonicalized",
      { cause: error },
    );
  }
}

/**
 * Adapter-facing H5 guard for the future worker daemon.
 *
 * The daemon must call authorize() before any filesystem, event, exec, lease,
 * cache, or runtime adapter. This module intentionally owns no Docker/runtime
 * behavior; SBX1.3 and SBX1.4 provide those adapters later.
 */
export class RemoteWorkerSandboxBindingRegistryV1 {
  private readonly records = new Map<
    string,
    RemoteWorkerSandboxBindingRecordV1
  >();
  private readonly activeEventStreams = new Map<
    string,
    Set<RemoteWorkerAuthorizedEventStreamV1>
  >();
  private readonly workerId: string;
  private readonly acceptedCapabilityNonces: SingleUseNonceStoreV1;
  private readonly capabilityAuthenticator: RemoteWorkerCapabilityAuthenticatorV1;
  private readonly receiptAuthenticator: RemoteWorkerBindingReceiptAuthenticatorV1;
  private readonly eventStreamLifetimeMs: number;
  private readonly maxLeaseLifetimeMs: number;
  private readonly maxAcceptedCapabilityNonces: number;
  private readonly now: () => number;
  private readonly onSecurityViolation?: (
    event: RemoteWorkerBindingSecurityEventV1,
  ) => void;

  constructor(options: RemoteWorkerSandboxBindingRegistryOptionsV1) {
    this.workerId = options.workerId;
    this.capabilityAuthenticator = options.capabilityAuthenticator;
    this.receiptAuthenticator = options.receiptAuthenticator;
    this.eventStreamLifetimeMs =
      options.eventStreamLifetimeMs ?? REMOTE_WORKER_MAX_CAPABILITY_LIFETIME_MS;
    this.maxLeaseLifetimeMs =
      options.maxLeaseLifetimeMs ?? DEFAULT_MAX_LEASE_LIFETIME_MS;
    this.maxAcceptedCapabilityNonces =
      options.maxAcceptedCapabilityNonces ??
      DEFAULT_MAX_ACCEPTED_CAPABILITY_NONCES;
    if (
      !Number.isInteger(this.eventStreamLifetimeMs) ||
      this.eventStreamLifetimeMs <= 0 ||
      this.eventStreamLifetimeMs > REMOTE_WORKER_MAX_CAPABILITY_LIFETIME_MS
    ) {
      throw bindingError(
        REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
        "remote-worker event stream lifetime is invalid",
      );
    }
    if (
      !Number.isSafeInteger(this.maxLeaseLifetimeMs) ||
      this.maxLeaseLifetimeMs <= 0
    ) {
      throw bindingError(
        REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
        "remote-worker maximum lease lifetime is invalid",
      );
    }
    if (
      !Number.isSafeInteger(this.maxAcceptedCapabilityNonces) ||
      this.maxAcceptedCapabilityNonces <= 0
    ) {
      throw bindingError(
        REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
        "remote-worker capability nonce bound is invalid",
      );
    }
    this.acceptedCapabilityNonces = new SingleUseNonceStoreV1(
      this.maxAcceptedCapabilityNonces,
    );
    this.now = options.now ?? Date.now;
    this.onSecurityViolation = options.onSecurityViolation;
  }

  private consumeCapabilityNonce(
    capability: RemoteWorkerCapabilityClaimsV1,
  ): void {
    const nowMs = this.now();
    const result = this.acceptedCapabilityNonces.consume(
      capability.nonce,
      capability.expiresAtMs,
      nowMs,
    );
    if (result === "replay") {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.capabilityReplay,
        "remote-worker capability was already used",
      );
    }
    if (result === "exhausted") {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.capabilityNonceStoreExhausted,
        "remote-worker capability nonce capacity is exhausted",
      );
    }
  }

  private async authenticateCapability(
    token: string,
  ): Promise<RemoteWorkerCapabilityClaimsV1> {
    if (!token || token !== token.trim() || token.length > 8 * 1024) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.unauthenticated,
        "remote-worker capability is invalid",
      );
    }
    let authenticated: unknown;
    try {
      authenticated = await this.capabilityAuthenticator.authenticate({
        token,
        workerId: this.workerId,
      });
      const capability =
        RemoteWorkerCapabilityClaimsSchemaV1.parse(authenticated);
      const remainingMs = capability.expiresAtMs - this.now();
      if (
        capability.issuedAtMs > this.now() ||
        remainingMs <= 0 ||
        capability.expiresAtMs - capability.issuedAtMs >
          REMOTE_WORKER_MAX_CAPABILITY_LIFETIME_MS
      ) {
        throw bindingError(
          REMOTE_WORKER_ERROR_CODES_V1.capabilityExpired,
          "remote-worker capability lifetime is invalid",
        );
      }
      this.consumeCapabilityNonce(capability);
      return capability;
    } catch (error) {
      if (error instanceof SandboxProviderError) throw error;
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.unauthenticated,
        "remote-worker capability authentication failed",
      );
    }
  }

  async bind(
    input: BindRemoteWorkerSandboxInputV1,
  ): Promise<RemoteWorkerBindingReceiptV1> {
    const request = parseBindingInput(
      RemoteWorkerCreateRequestSchemaV1,
      input.request,
    );
    const sandboxId = parseBindingInput(
      RemoteWorkerOpaqueIdSchemaV1,
      input.sandboxId,
    );
    const requestDigest = bindingRequestDigest(request);
    return await this.finishBind({
      ...input,
      request,
      requestDigest,
      sandboxId,
    });
  }

  private existingBinding(
    sandboxId: string,
    request: RemoteWorkerCreateRequestV1,
    requestDigest: `sha256:${string}`,
  ): RemoteWorkerBindingReceiptV1 | undefined {
    const existing = this.records.get(sandboxId);
    if (!existing) return undefined;
    if (
      existing.workspaceId === request.workspaceId &&
      existing.clientLeaseId === request.clientLeaseId &&
      existing.requestDigest === requestDigest
    ) {
      return existing.bindingReceipt;
    }
    throw bindingError(
      REMOTE_WORKER_ERROR_CODES_V1.sandboxWorkspaceMismatch,
      "remote-worker sandbox binding does not match the authorized workspace",
    );
  }

  private async finishBind(input: {
    sandboxId: string;
    request: RemoteWorkerCreateRequestV1;
    requestDigest: `sha256:${string}`;
    capabilityToken: string;
    leaseExpiresAtMs: number;
  }): Promise<RemoteWorkerBindingReceiptV1> {
    const capability = await this.authenticateCapability(input.capabilityToken);
    const { request, requestDigest, sandboxId } = input;

    if (
      capability.operation !== "create" ||
      capability.workerId !== this.workerId ||
      capability.workspaceId !== request.workspaceId ||
      capability.requestDigest !== requestDigest
    ) {
      throw bindingError(
        REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
        "remote-worker create authorization does not match the request",
      );
    }
    const hardExpiresAtMs = this.now() + this.maxLeaseLifetimeMs;
    if (
      !Number.isSafeInteger(input.leaseExpiresAtMs) ||
      input.leaseExpiresAtMs <= this.now() ||
      input.leaseExpiresAtMs > hardExpiresAtMs
    ) {
      throw bindingError(
        REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
        "remote-worker lease expiry must be in the future",
      );
    }

    const existing = this.existingBinding(sandboxId, request, requestDigest);
    if (existing) return existing;

    const payload: RemoteWorkerBindingReceiptPayloadV1 = {
      protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
      workspaceId: request.workspaceId,
      clientLeaseId: request.clientLeaseId,
      workerId: this.workerId,
      sandboxId,
      requestDigest,
      expiresAtMs: input.leaseExpiresAtMs,
    };
    let authenticator: string;
    try {
      authenticator = await this.receiptAuthenticator.authenticate(payload);
    } catch {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.unauthenticated,
        "remote-worker binding receipt could not be authenticated",
      );
    }
    const receipt = parseBindingInput(
      RemoteWorkerBindingReceiptSchemaV1,
      Object.freeze({ payload: Object.freeze(payload), authenticator }),
    );
    const concurrentlyCreated = this.existingBinding(
      sandboxId,
      request,
      requestDigest,
    );
    if (concurrentlyCreated) return concurrentlyCreated;
    this.records.set(
      sandboxId,
      Object.freeze({
        sandboxId,
        workspaceId: request.workspaceId,
        clientLeaseId: request.clientLeaseId,
        workerId: this.workerId,
        requestDigest,
        expiresAtMs: input.leaseExpiresAtMs,
        hardExpiresAtMs,
        bindingReceipt: receipt,
      }),
    );
    return receipt;
  }

  private async authorizeInput(
    input: AuthorizeRemoteWorkerSandboxInputV1,
  ): Promise<{
    capability: RemoteWorkerCapabilityClaimsV1;
    record: RemoteWorkerSandboxBindingRecordV1;
  }> {
    const capability = await this.authenticateCapability(input.capabilityToken);
    const sandboxId = parseBindingInput(
      RemoteWorkerOpaqueIdSchemaV1,
      input.sandboxId,
    );
    const requestDigest = bindingRequestDigest(input.requestBody);
    const record = this.records.get(sandboxId);
    if (!record) {
      throw bindingError(
        REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound,
        "remote-worker sandbox was not found",
      );
    }
    const mismatched =
      capability.workerId !== record.workerId ||
      capability.workspaceId !== record.workspaceId ||
      !("sandboxId" in capability) ||
      capability.sandboxId !== record.sandboxId ||
      capability.operation !== input.operation ||
      capability.requestDigest !== requestDigest;
    if (mismatched) {
      try {
        this.onSecurityViolation?.({
          code: REMOTE_WORKER_ERROR_CODES_V1.sandboxWorkspaceMismatch,
          workerId: this.workerId,
          operation: input.operation,
        });
      } catch {
        // Observability cannot replace the stable security failure.
      }
      throw bindingError(
        REMOTE_WORKER_ERROR_CODES_V1.sandboxWorkspaceMismatch,
        "remote-worker sandbox binding does not match the authorized workspace",
      );
    }
    if (record.expiresAtMs <= this.now()) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
        "remote-worker sandbox lease expired",
      );
    }
    return { capability, record };
  }

  async authorize<T>(
    input: AuthorizeRemoteWorkerSandboxInputV1<"fs" | "exec">,
    effect: () => T | Promise<T>,
  ): Promise<T> {
    await this.authorizeInput(input);
    return await effect();
  }

  async renew<T extends { leaseExpiresAtMs: number }>(
    input: AuthorizeRemoteWorkerSandboxInputV1<"renew">,
    effect: () => T | Promise<T>,
  ): Promise<T> {
    const { record } = await this.authorizeInput(input);
    const result = await effect();
    if (
      !Number.isSafeInteger(result.leaseExpiresAtMs) ||
      result.leaseExpiresAtMs <= this.now() ||
      result.leaseExpiresAtMs > record.hardExpiresAtMs
    ) {
      throw bindingError(
        REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
        "remote-worker renewed lease expiry is invalid",
      );
    }
    const current = this.records.get(record.sandboxId);
    if (!current || current.bindingReceipt !== record.bindingReceipt) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.sandboxDisposed,
        "remote-worker sandbox was disposed while renewing",
      );
    }
    this.records.set(
      record.sandboxId,
      Object.freeze({
        ...current,
        expiresAtMs: Math.max(current.expiresAtMs, result.leaseExpiresAtMs),
      }),
    );
    return result;
  }

  async authorizeEventStream(
    input: AuthorizeRemoteWorkerSandboxInputV1<"events">,
    effect: () =>
      | RemoteWorkerAuthorizedEventStreamV1
      | Promise<RemoteWorkerAuthorizedEventStreamV1>,
  ): Promise<RemoteWorkerAuthorizedEventStreamV1> {
    const { capability, record } = await this.authorizeInput(input);
    const stream = await effect();
    const current = this.records.get(record.sandboxId);
    if (!current || current.bindingReceipt !== record.bindingReceipt) {
      stream.close();
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.sandboxDisposed,
        "remote-worker sandbox was disposed while opening events",
      );
    }
    if (current.expiresAtMs <= this.now()) {
      stream.close();
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
        "remote-worker sandbox expired while opening events",
      );
    }
    if (capability.expiresAtMs <= this.now()) {
      stream.close();
      throw bindingError(
        REMOTE_WORKER_ERROR_CODES_V1.capabilityExpired,
        "remote-worker capability expired while opening events",
      );
    }
    const streams = this.activeEventStreams.get(record.sandboxId) ?? new Set();
    streams.add(stream);
    this.activeEventStreams.set(record.sandboxId, streams);
    const deadlineMs = Math.min(
      capability.expiresAtMs,
      current.expiresAtMs,
      this.now() + this.eventStreamLifetimeMs,
    );
    const timer = setTimeout(() => stream.close(), deadlineMs - this.now());
    const cleanup = (): void => {
      clearTimeout(timer);
      streams.delete(stream);
      if (streams.size === 0) this.activeEventStreams.delete(record.sandboxId);
    };
    void stream.closed.then(cleanup, cleanup);
    return stream;
  }

  async dispose<T>(
    input: AuthorizeRemoteWorkerSandboxInputV1<"delete">,
    effect: () => T | Promise<T>,
  ): Promise<T> {
    await this.authorizeInput(input);
    const result = await effect();
    for (const stream of this.activeEventStreams.get(input.sandboxId) ?? []) {
      stream.close();
    }
    this.activeEventStreams.delete(input.sandboxId);
    this.records.delete(input.sandboxId);
    return result;
  }
}

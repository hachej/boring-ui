import { PROVIDER_CONTRACT_VERSION } from "../../shared/providerMatrix";
import {
  REMOTE_WORKER_ERROR_CODES_V1,
  REMOTE_WORKER_HEADERS_V1,
  REMOTE_WORKER_EXCLUSIVE_BINARY_CREATE_CAPABILITY_V1,
  REMOTE_WORKER_MAX_CAPABILITY_LIFETIME_MS,
  REMOTE_WORKER_MAX_WORKSPACE_ENVELOPE_BYTES_V1,
  REMOTE_WORKER_PROTOCOL_VERSION,
  RemoteWorkerCapabilityClaimsSchemaV1,
  RemoteWorkerCreateResponseSchemaV1,
  RemoteWorkerDeleteResponseSchemaV1,
  RemoteWorkerExecResponseSchemaV1,
  RemoteWorkerHealthResponseSchemaV1,
  RemoteWorkerRenewRequestSchemaV1,
  RemoteWorkerRenewResponseSchemaV1,
  RemoteWorkerWorkspaceResultSchemaV1,
  type RemoteWorkerCapabilityClaimsV1,
  type RemoteWorkerCreateRequestV1,
  type RemoteWorkerCreateResponseV1,
  type RemoteWorkerExecRequestV1,
  type RemoteWorkerExecResponseV1,
  type RemoteWorkerFsEventEnvelopeV1,
  type RemoteWorkerHealthResponseV1,
  type RemoteWorkerNegotiatedCapabilityV1,
  type RemoteWorkerOperationV1,
  type RemoteWorkerRenewRequestV1,
  type RemoteWorkerRenewResponseV1,
  type RemoteWorkerWorkspaceOperationV1,
  type RemoteWorkerWorkspaceResultV1,
} from "../../shared/remoteWorkerProtocolV1";
import { SandboxProviderError } from "../../shared/providerV1";
import type { RemoteWorkerFleetWorkerConfigV1 } from "./fleetConfig";
import { canonicalJson, remoteWorkerRequestDigestV1 } from "./requestDigest";
import type {
  RemoteWorkerEventStreamV1,
  RemoteWorkerTransportV1,
} from "./transport";

const remoteWorkerErrorCodes = new Set<string>(
  Object.values(REMOTE_WORKER_ERROR_CODES_V1),
);

export function asRemoteWorkerProviderErrorV1(
  error: unknown,
): SandboxProviderError | undefined {
  if (error instanceof SandboxProviderError) return error;
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "SandboxProviderError" &&
    "code" in error &&
    typeof error.code === "string" &&
    remoteWorkerErrorCodes.has(error.code)
  ) {
    return new SandboxProviderError(
      error.code as SandboxProviderError["code"],
      "remote-worker returned a stable provider failure",
    );
  }
  return undefined;
}

interface StrictParser<T> {
  parse(value: unknown): T;
}

interface ClientRequestBase<T> {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  schema: StrictParser<T>;
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Readonly<Record<string, string>>;
}

type ClientRequestInput<T> = ClientRequestBase<T> &
  (
    | { operation: "health" | "create"; sandboxId?: never }
    | {
        operation: Exclude<RemoteWorkerOperationV1, "health" | "create">;
        sandboxId: string;
      }
  );

export interface RemoteWorkerCapabilityIssuerInputV1 {
  readonly worker: RemoteWorkerFleetWorkerConfigV1;
  readonly claims: RemoteWorkerCapabilityClaimsV1;
}

export interface RemoteWorkerCapabilityIssuerV1 {
  issueCapability(input: RemoteWorkerCapabilityIssuerInputV1): Promise<string>;
}

export interface RemoteWorkerProtocolClientOptionsV1 {
  worker: RemoteWorkerFleetWorkerConfigV1;
  workspaceId: string;
  requestId: string;
  issuer: RemoteWorkerCapabilityIssuerV1;
  transport: RemoteWorkerTransportV1;
  now: () => number;
  idFactory: () => string;
  requestTimeoutMs: number;
  capabilityLifetimeMs: number;
  eventStreamLifetimeMs: number;
  requiredCapabilities?: readonly RemoteWorkerNegotiatedCapabilityV1[];
}

export type RemoteWorkerNormalizedHealthResponseV1 = Omit<
  RemoteWorkerHealthResponseV1,
  "capabilities" | "negotiatedCapabilities"
> & {
  readonly capabilities: ReadonlyArray<
    RemoteWorkerHealthResponseV1["capabilities"][number]
  >;
  readonly negotiatedCapabilities: readonly RemoteWorkerNegotiatedCapabilityV1[];
};

export function parseRemoteWorkerRequestV1<T>(
  schema: StrictParser<T>,
  value: unknown,
  label: string,
): T {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new SandboxProviderError(
      REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      `remote-worker ${label} failed strict validation`,
    );
  }
}

function parseResponse<T>(
  schema: StrictParser<T>,
  value: unknown,
  label: string,
): T {
  try {
    return schema.parse(value);
  } catch (error) {
    const response =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : undefined;
    const mismatch =
      (typeof response?.protocolVersion === "string" &&
        response.protocolVersion !== REMOTE_WORKER_PROTOCOL_VERSION) ||
      (typeof response?.providerContractVersion === "string" &&
        response.providerContractVersion !== PROVIDER_CONTRACT_VERSION);
    throw new SandboxProviderError(
      mismatch
        ? REMOTE_WORKER_ERROR_CODES_V1.protocolMismatch
        : REMOTE_WORKER_ERROR_CODES_V1.responseInvalid,
      `remote-worker returned an invalid ${label} response`,
    );
  }
}

export class RemoteWorkerProtocolClientV1 {
  private readonly activeStreams = new Set<RemoteWorkerEventStreamV1>();
  private readonly activeControllers = new Set<AbortController>();
  private readonly pending = new Set<Promise<unknown>>();
  private closed = false;
  private closeComplete = false;
  private closeInFlight?: Promise<void>;

  constructor(private readonly options: RemoteWorkerProtocolClientOptionsV1) {}

  private async capability(
    operation: RemoteWorkerOperationV1,
    requestDigest: `sha256:${string}`,
    sandboxId?: string,
  ): Promise<{ token: string; claims: RemoteWorkerCapabilityClaimsV1 }> {
    const issuedAtMs = this.options.now();
    const claims = parseRemoteWorkerRequestV1(
      RemoteWorkerCapabilityClaimsSchemaV1,
      {
        protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
        workerId: this.options.worker.workerId,
        workspaceId: this.options.workspaceId,
        ...(sandboxId ? { sandboxId } : {}),
        operation,
        requestDigest,
        issuedAtMs,
        expiresAtMs: issuedAtMs + this.options.capabilityLifetimeMs,
        nonce: this.options.idFactory(),
      },
      "capability claims",
    );
    if (
      claims.expiresAtMs <= issuedAtMs ||
      claims.expiresAtMs - issuedAtMs > REMOTE_WORKER_MAX_CAPABILITY_LIFETIME_MS
    ) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.capabilityExpired,
        "remote-worker capability lifetime is invalid",
      );
    }
    let token: string;
    try {
      token = (
        await this.options.issuer.issueCapability({
          worker: this.options.worker,
          claims,
        })
      ).trim();
    } catch {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.unauthenticated,
        "remote-worker capability could not be issued",
      );
    }
    if (!token || token.length > 8 * 1024) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.unauthenticated,
        "remote-worker capability issuer returned an invalid token",
      );
    }
    if (claims.expiresAtMs <= this.options.now()) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.capabilityExpired,
        "remote-worker capability expired before use",
      );
    }
    return { token, claims };
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.then(
      () => this.pending.delete(promise),
      () => this.pending.delete(promise),
    );
    return promise;
  }

  private async request<T>(input: ClientRequestInput<T>): Promise<T> {
    if (this.closed) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.unavailable,
        "remote-worker provider is closed",
      );
    }
    const requestBody = input.body ?? {};
    if (
      new TextEncoder().encode(canonicalJson(requestBody)).byteLength >
      REMOTE_WORKER_MAX_WORKSPACE_ENVELOPE_BYTES_V1
    ) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
        "remote-worker request body exceeds its bound",
      );
    }
    const capability = await this.capability(
      input.operation,
      remoteWorkerRequestDigestV1(requestBody),
      input.sandboxId,
    );
    if (this.closed) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.unavailable,
        "remote-worker provider is closed",
      );
    }
    const controller = new AbortController();
    this.activeControllers.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, input.timeoutMs ?? this.options.requestTimeoutMs);
    const abort = (): void => controller.abort();
    if (input.signal?.aborted) controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });

    const operation = (async () => {
      try {
        const response = await this.options.transport.request({
          worker: this.options.worker,
          method: input.method,
          path: input.path,
          headers: {
            [REMOTE_WORKER_HEADERS_V1.capability]: capability.token,
            [REMOTE_WORKER_HEADERS_V1.requestId]: this.options.requestId,
            [REMOTE_WORKER_HEADERS_V1.protocolVersion]:
              REMOTE_WORKER_PROTOCOL_VERSION,
            ...input.headers,
          },
          body: input.body,
          signal: controller.signal,
        });
        return parseResponse(input.schema, response, input.operation);
      } catch (error) {
        if (timedOut) {
          if (input.operation === "exec") {
            throw new SandboxProviderError(
              REMOTE_WORKER_ERROR_CODES_V1.outcomeUnknown,
              "remote-worker exec outcome is unknown after client timeout",
            );
          }
          throw new SandboxProviderError(
            REMOTE_WORKER_ERROR_CODES_V1.timeout,
            "remote-worker request timed out",
          );
        }
        const providerError = asRemoteWorkerProviderErrorV1(error);
        if (
          input.operation === "exec" &&
          (!providerError ||
            providerError.code === REMOTE_WORKER_ERROR_CODES_V1.unavailable ||
            providerError.code === "ABORTED")
        ) {
          throw new SandboxProviderError(
            REMOTE_WORKER_ERROR_CODES_V1.outcomeUnknown,
            "remote-worker exec outcome is unknown after transport loss",
          );
        }
        if (providerError) throw providerError;
        throw new SandboxProviderError(
          REMOTE_WORKER_ERROR_CODES_V1.unavailable,
          "remote-worker is unavailable",
        );
      } finally {
        clearTimeout(timer);
        this.activeControllers.delete(controller);
        input.signal?.removeEventListener("abort", abort);
      }
    })();
    return await this.track(operation);
  }

  async health(): Promise<RemoteWorkerNormalizedHealthResponseV1> {
    const requestedCapabilities = [
      ...new Set([
        REMOTE_WORKER_EXCLUSIVE_BINARY_CREATE_CAPABILITY_V1,
        ...(this.options.requiredCapabilities ?? []),
      ]),
    ].sort();
    const response = await this.request({
      operation: "health",
      method: "GET",
      path: "/internal/v1/health",
      headers: {
        [REMOTE_WORKER_HEADERS_V1.requestedCapabilities]:
          requestedCapabilities.join(","),
      },
      schema: RemoteWorkerHealthResponseSchemaV1,
    });
    return Object.freeze({
      ...response,
      capabilities: Object.freeze([...response.capabilities]),
      negotiatedCapabilities: Object.freeze(
        [...(response.negotiatedCapabilities ?? [])].sort(),
      ),
    });
  }

  async create(
    request: RemoteWorkerCreateRequestV1,
  ): Promise<RemoteWorkerCreateResponseV1> {
    const createOnce = (): Promise<RemoteWorkerCreateResponseV1> =>
      this.request({
        operation: "create",
        method: "POST",
        path: "/internal/v1/sandboxes",
        body: request,
        schema: RemoteWorkerCreateResponseSchemaV1,
      });
    try {
      return await createOnce();
    } catch (error) {
      const providerError = asRemoteWorkerProviderErrorV1(error);
      const recoverable =
        providerError !== undefined &&
        (providerError.code === REMOTE_WORKER_ERROR_CODES_V1.unavailable ||
          providerError.code === REMOTE_WORKER_ERROR_CODES_V1.timeout ||
          providerError.code === REMOTE_WORKER_ERROR_CODES_V1.responseInvalid);
      if (!recoverable) {
        throw providerError ?? new SandboxProviderError(
          REMOTE_WORKER_ERROR_CODES_V1.unavailable,
          "remote-worker is unavailable",
        );
      }
      return await createOnce();
    }
  }

  bind(sandboxId: string): RemoteWorkerLeaseClientV1 {
    return new RemoteWorkerLeaseClientV1(this, sandboxId);
  }

  provisionalDelete(sandboxId: string): Promise<unknown> {
    return this.boundRequest({
      operation: "delete",
      method: "DELETE",
      path: `/internal/v1/sandboxes/${encodeURIComponent(sandboxId)}`,
      sandboxId,
      schema: RemoteWorkerDeleteResponseSchemaV1,
    });
  }

  boundRequest<T>(input: ClientRequestInput<T>): Promise<T> {
    return this.request(input);
  }

  async openEvents(
    sandboxId: string,
    leaseExpiresAtMs: number,
    onEvent: (event: RemoteWorkerFsEventEnvelopeV1) => void,
  ): Promise<RemoteWorkerEventStreamV1> {
    if (this.closed) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.unavailable,
        "remote-worker provider is closed",
      );
    }
    const capability = await this.capability(
      "events",
      remoteWorkerRequestDigestV1({}),
      sandboxId,
    );
    if (this.closed) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.unavailable,
        "remote-worker provider is closed",
      );
    }
    const controller = new AbortController();
    this.activeControllers.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.options.requestTimeoutMs);
    let stream: RemoteWorkerEventStreamV1;
    try {
      stream = await this.track(
        this.options.transport.openEventStream({
          worker: this.options.worker,
          method: "GET",
          path: `/internal/v1/sandboxes/${encodeURIComponent(sandboxId)}/fs/events`,
          headers: {
            [REMOTE_WORKER_HEADERS_V1.capability]: capability.token,
            [REMOTE_WORKER_HEADERS_V1.requestId]: this.options.requestId,
            [REMOTE_WORKER_HEADERS_V1.protocolVersion]:
              REMOTE_WORKER_PROTOCOL_VERSION,
          },
          signal: controller.signal,
          onEvent,
        }),
      );
    } catch (error) {
      if (timedOut) {
        throw new SandboxProviderError(
          REMOTE_WORKER_ERROR_CODES_V1.timeout,
          "remote-worker event stream connection timed out",
        );
      }
      const providerError = asRemoteWorkerProviderErrorV1(error);
      if (providerError) throw providerError;
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.unavailable,
        "remote-worker event stream is unavailable",
      );
    } finally {
      clearTimeout(timer);
      this.activeControllers.delete(controller);
    }
    const transportStream = stream;
    let lifetimeTimer: ReturnType<typeof setTimeout> | undefined;
    let closeStarted = false;
    let settleLocalClose!: () => void;
    const localClosed = new Promise<void>((resolve) => {
      settleLocalClose = resolve;
    });
    const cleanup = (): void => {
      if (lifetimeTimer) clearTimeout(lifetimeTimer);
      lifetimeTimer = undefined;
      this.activeStreams.delete(stream);
    };
    const closeStream = (): void => {
      if (closeStarted) return;
      closeStarted = true;
      cleanup();
      settleLocalClose();
      try {
        void Promise.resolve(transportStream.close()).catch(() => undefined);
      } catch {
        // Local stream cleanup cannot retain remote sandbox authority.
      }
    };
    const transportClosed = transportStream.closed.catch((error: unknown) => {
      const providerError = asRemoteWorkerProviderErrorV1(error);
      throw (
        providerError ??
        new SandboxProviderError(
          REMOTE_WORKER_ERROR_CODES_V1.unavailable,
          "remote-worker event stream closed unexpectedly",
        )
      );
    });
    stream = {
      close: closeStream,
      closed: Promise.race([transportClosed, localClosed]),
    };
    this.activeStreams.add(stream);
    const deadlineMs = Math.min(
      capability.claims.expiresAtMs,
      leaseExpiresAtMs,
      this.options.now() + this.options.eventStreamLifetimeMs,
    );
    lifetimeTimer = setTimeout(closeStream, Math.max(0, deadlineMs - this.options.now()));
    void stream.closed.then(cleanup, cleanup);
    return stream;
  }

  closeEventStreams(): void {
    for (const stream of this.activeStreams) stream.close();
  }

  async close(): Promise<void> {
    if (this.closeComplete) return;
    this.closed = true;
    if (this.closeInFlight) return await this.closeInFlight;
    const operation = (async () => {
      for (const controller of this.activeControllers) controller.abort();
      this.closeEventStreams();
      await Promise.allSettled([...this.pending]);
      this.closeComplete = true;
    })();
    this.closeInFlight = operation;
    try {
      await operation;
    } finally {
      if (this.closeInFlight === operation) this.closeInFlight = undefined;
    }
  }
}

export class RemoteWorkerLeaseClientV1 {
  constructor(
    private readonly client: RemoteWorkerProtocolClientV1,
    readonly sandboxId: string,
  ) {}

  fs(
    operation: RemoteWorkerWorkspaceOperationV1,
  ): Promise<RemoteWorkerWorkspaceResultV1> {
    return this.client.boundRequest({
      operation: "fs",
      method: "POST",
      path: `/internal/v1/sandboxes/${encodeURIComponent(this.sandboxId)}/fs`,
      sandboxId: this.sandboxId,
      body: operation,
      schema: RemoteWorkerWorkspaceResultSchemaV1,
    });
  }

  exec(
    body: RemoteWorkerExecRequestV1,
    signal?: AbortSignal,
  ): Promise<RemoteWorkerExecResponseV1> {
    return this.client.boundRequest({
      operation: "exec",
      method: "POST",
      path: `/internal/v1/sandboxes/${encodeURIComponent(this.sandboxId)}/exec`,
      sandboxId: this.sandboxId,
      body,
      schema: RemoteWorkerExecResponseSchemaV1,
      timeoutMs: body.timeoutMs + 15_000,
      signal,
    });
  }

  renew(input: unknown): Promise<RemoteWorkerRenewResponseV1> {
    const body: RemoteWorkerRenewRequestV1 = parseRemoteWorkerRequestV1(
      RemoteWorkerRenewRequestSchemaV1,
      input,
      "renew request",
    );
    return this.client.boundRequest({
      operation: "renew",
      method: "POST",
      path: `/internal/v1/sandboxes/${encodeURIComponent(this.sandboxId)}/renew`,
      sandboxId: this.sandboxId,
      body,
      schema: RemoteWorkerRenewResponseSchemaV1,
    });
  }

  delete(): Promise<unknown> {
    return this.client.provisionalDelete(this.sandboxId);
  }

  openEvents(
    leaseExpiresAtMs: number,
    onEvent: (event: RemoteWorkerFsEventEnvelopeV1) => void,
  ): Promise<RemoteWorkerEventStreamV1> {
    return this.client.openEvents(this.sandboxId, leaseExpiresAtMs, onEvent);
  }

  closeEventStreams(): void {
    this.client.closeEventStreams();
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

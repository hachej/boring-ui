import { type RemoteWorkerFsEventEnvelopeV1 } from "../../shared/remoteWorkerProtocolV1";
import type { RemoteWorkerFleetWorkerConfigV1 } from "./fleetConfig";

export interface RemoteWorkerTransportRequestV1 {
  /** Carries the selected box's CA/server-name facts to the TLS transport. */
  readonly worker: RemoteWorkerFleetWorkerConfigV1;
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export interface RemoteWorkerEventStreamV1 {
  readonly closed: Promise<void>;
  close(): void;
}

export interface RemoteWorkerOpenEventStreamInputV1 extends RemoteWorkerTransportRequestV1 {
  onEvent(event: RemoteWorkerFsEventEnvelopeV1): void;
}

export interface RemoteWorkerTransportV1 {
  /**
   * The SBX1.4 transport must enforce TLS identity, bounded JSON/SSE reads, and
   * stable redacted SandboxProviderError failures. Unknown errors are still
   * sanitized by the protocol client at this boundary.
   */
  request(input: RemoteWorkerTransportRequestV1): Promise<unknown>;
  openEventStream(
    input: RemoteWorkerOpenEventStreamInputV1,
  ): Promise<RemoteWorkerEventStreamV1>;
}

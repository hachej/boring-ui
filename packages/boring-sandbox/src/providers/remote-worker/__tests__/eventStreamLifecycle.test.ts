import { afterEach, describe, expect, test, vi } from "vitest";

import {
  REMOTE_WORKER_ERROR_CODES_V1,
  REMOTE_WORKER_PROTOCOL_VERSION,
  type RemoteWorkerCapabilityClaimsV1,
} from "../../../shared/remoteWorkerProtocolV1";
import { createRemoteWorkspaceV1 } from "../pairProxies";
import { parseRemoteWorkerFleetConfigV1 } from "../fleetConfig";
import { RemoteWorkerProtocolClientV1 } from "../protocolClient";
import type {
  RemoteWorkerEventStreamV1,
  RemoteWorkerOpenEventStreamInputV1,
  RemoteWorkerTransportRequestV1,
  RemoteWorkerTransportV1,
} from "../transport";

const digest = `sha256:${"a".repeat(64)}` as const;
const nowMs = 100_000;
type CloseMode = "resolve" | "reject" | "never";

interface ControlledStream extends RemoteWorkerEventStreamV1 {
  readonly close: () => void | Promise<void>;
  settle(): void;
  fail(error: unknown): void;
}

class EventStreamTransport implements RemoteWorkerTransportV1 {
  readonly streams: RemoteWorkerOpenEventStreamInputV1[] = [];
  readonly handles: ControlledStream[] = [];
  closeMode: CloseMode = "resolve";
  openError?: unknown;

  async request(_input: RemoteWorkerTransportRequestV1): Promise<unknown> {
    throw new Error("event-stream test transport does not accept requests");
  }

  async openEventStream(
    input: RemoteWorkerOpenEventStreamInputV1,
  ): Promise<RemoteWorkerEventStreamV1> {
    this.streams.push(input);
    if (this.openError) throw this.openError;
    let settle!: () => void;
    let fail!: (error: unknown) => void;
    const closed = new Promise<void>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    const handle: ControlledStream = {
      closed,
      settle,
      fail,
      close: vi.fn(() => {
        if (this.closeMode === "never") return new Promise<void>(() => {});
        if (this.closeMode === "reject")
          return Promise.reject(new Error("raw stream close failed"));
        settle();
      }),
    };
    this.handles.push(handle);
    return handle;
  }
}

function worker() {
  return parseRemoteWorkerFleetConfigV1({
    protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
    bucketCount: 256,
    workers: [
      {
        workerId: "worker-1",
        baseUrl: "https://worker-1.example.test",
        tokenFile: "/run/boring/worker-1.token",
        caFile: "/run/boring/fleet.ca",
        tlsServerName: "worker-1.example.test",
        expectedEvidenceDigest: digest,
        expectedQualificationBundleDigest: digest,
        expectedProviderCohortDigest: digest,
        expectedImageDigest: digest,
        buckets: Array.from({ length: 256 }, (_, index) => index),
      },
    ],
  }).workers[0]!;
}

function client(
  transport: EventStreamTransport,
  now: () => number = () => nowMs,
  issuedClaims: RemoteWorkerCapabilityClaimsV1[] = [],
): RemoteWorkerProtocolClientV1 {
  let sequence = 0;
  return new RemoteWorkerProtocolClientV1({
    worker: worker(),
    workspaceId: "workspace-a",
    requestId: "request-events",
    issuer: {
      async issueCapability({ claims }) {
        issuedClaims.push(claims);
        return `capability-events-${claims.nonce}`;
      },
    },
    transport,
    now,
    idFactory: () => `nonce-events-${(sequence += 1)}`,
    requestTimeoutMs: 5_000,
    capabilityLifetimeMs: 1_000,
    eventStreamLifetimeMs: 5_000,
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function watchedWorkspace(
  protocol: RemoteWorkerProtocolClientV1,
  leaseExpiresAtMs: () => number,
  now: () => number,
) {
  const proxy = createRemoteWorkspaceV1({
    client: protocol.bind("sandbox-1"),
    leaseExpiresAtMs,
    now,
    supportsExclusiveBinaryCreate: false,
  });
  const onControlEvent = vi.fn();
  const watcher = proxy.workspace.watch!();
  watcher.subscribe(vi.fn(), { onControlEvent });
  return { ...proxy, onControlEvent };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("remote-worker managed event stream lifecycle", () => {
  test("lifetime expiry settles a never-closing transport stream and reconnects", async () => {
    vi.useFakeTimers();
    const transport = new EventStreamTransport();
    transport.closeMode = "never";
    const claims: RemoteWorkerCapabilityClaimsV1[] = [];
    const protocol = client(transport, () => nowMs, claims);
    const watched = watchedWorkspace(
      protocol,
      () => nowMs + 10_000,
      () => nowMs,
    );
    await flushMicrotasks();
    expect(transport.streams).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.handles[0]?.close).toHaveBeenCalledOnce();
    expect(watched.onControlEvent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(transport.streams).toHaveLength(2);
    expect(claims).toHaveLength(2);
    expect(claims[0]?.nonce).not.toBe(claims[1]?.nonce);

    watched.closeWatcher();
    await protocol.close();
  });

  test("rejecting local close is handled and reconnects without unhandled rejection", async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const transport = new EventStreamTransport();
      transport.closeMode = "reject";
      const protocol = client(transport);
      const watched = watchedWorkspace(
        protocol,
        () => nowMs + 10_000,
        () => nowMs,
      );
      await flushMicrotasks();

      await vi.advanceTimersByTimeAsync(1_000);
      await flushMicrotasks();
      expect(unhandled).not.toHaveBeenCalled();
      expect(watched.onControlEvent).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(250);
      expect(transport.streams).toHaveLength(2);

      watched.closeWatcher();
      await protocol.close();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  test("concurrent explicit and lifetime close settle once and resync once", async () => {
    vi.useFakeTimers();
    const transport = new EventStreamTransport();
    const protocol = client(transport);
    const watched = watchedWorkspace(
      protocol,
      () => nowMs + 10_000,
      () => nowMs,
    );
    await flushMicrotasks();
    setTimeout(() => protocol.closeEventStreams(), 1_000);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.handles[0]?.close).toHaveBeenCalledOnce();
    expect(watched.onControlEvent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(transport.streams).toHaveLength(2);

    watched.closeWatcher();
    await protocol.close();
  });

  test("late old transport rejection cannot clear its replacement", async () => {
    vi.useFakeTimers();
    const transport = new EventStreamTransport();
    transport.closeMode = "never";
    const protocol = client(transport);
    const watched = watchedWorkspace(
      protocol,
      () => nowMs + 10_000,
      () => nowMs,
    );
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(1_250);
    expect(transport.streams).toHaveLength(2);
    expect(watched.onControlEvent).toHaveBeenCalledTimes(1);
    transport.handles[0]?.fail(new Error("late old stream failure"));
    await flushMicrotasks();
    expect(watched.onControlEvent).toHaveBeenCalledTimes(1);

    transport.handles[1]?.settle();
    await flushMicrotasks();
    expect(watched.onControlEvent).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(transport.streams).toHaveLength(3);

    watched.closeWatcher();
    await protocol.close();
  });

  test("normalizes terminal event-stream open and closure failures", async () => {
    const transport = new EventStreamTransport();
    const foreignExpired = {
      name: "SandboxProviderError",
      code: REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
      message: "foreign secret",
    };
    transport.openError = foreignExpired;
    const protocol = client(transport);
    const lease = protocol.bind("sandbox-1");

    await expect(
      lease.openEvents(nowMs + 10_000, vi.fn()),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
      message: "remote-worker returned a stable provider failure",
    });

    transport.openError = undefined;
    const stream = await lease.openEvents(nowMs + 10_000, vi.fn());
    transport.handles[0]?.fail(foreignExpired);
    await expect(stream.closed).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
      message: "remote-worker returned a stable provider failure",
    });
    await protocol.close();
  });

  test("terminal transport closure resyncs without reconnecting", async () => {
    vi.useFakeTimers();
    const transport = new EventStreamTransport();
    const protocol = client(transport);
    const watched = watchedWorkspace(
      protocol,
      () => nowMs + 10_000,
      () => nowMs,
    );
    await flushMicrotasks();
    transport.handles[0]?.fail({
      name: "SandboxProviderError",
      code: REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
      message: "foreign secret",
    });
    await flushMicrotasks();

    expect(watched.onControlEvent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport.streams).toHaveLength(1);

    watched.closeWatcher();
    await protocol.close();
  });

  test("lease expiry resyncs without reconnecting", async () => {
    vi.useFakeTimers();
    let clockMs = nowMs;
    const transport = new EventStreamTransport();
    const protocol = client(transport, () => clockMs);
    const watched = watchedWorkspace(
      protocol,
      () => nowMs + 1_000,
      () => clockMs,
    );
    await flushMicrotasks();
    clockMs += 1_000;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(watched.onControlEvent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport.streams).toHaveLength(1);

    watched.closeWatcher();
    await protocol.close();
  });
});

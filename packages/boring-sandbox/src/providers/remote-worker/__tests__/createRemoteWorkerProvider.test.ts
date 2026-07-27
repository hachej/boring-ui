import { describe, expect, test, vi } from "vitest";

import {
  REMOTE_WORKER_ERROR_CODES_V1,
  REMOTE_WORKER_PROTOCOL_VERSION,
  type RemoteWorkerBindingReceiptPayloadV1,
  type RemoteWorkerCapabilityClaimsV1,
  type RemoteWorkerCreateRequestV1,
  type RemoteWorkerExecRequestV1,
  type RemoteWorkerWorkspaceOperationV1,
} from "../../../shared/remoteWorkerProtocolV1";
import { PROVIDER_CONTRACT_VERSION } from "../../../shared/providerMatrix";
import { SandboxProviderError } from "../../../shared/providerV1";
import {
  createRemoteWorkerSandboxProviderV1,
  type RemoteWorkerSandboxProviderOptionsV1,
} from "../createRemoteWorkerProvider";
import { parseRemoteWorkerFleetConfigV1 } from "../fleetConfig";
import { remoteWorkerRequestDigestV1 } from "../requestDigest";
import type {
  RemoteWorkerEventStreamV1,
  RemoteWorkerOpenEventStreamInputV1,
  RemoteWorkerTransportRequestV1,
  RemoteWorkerTransportV1,
} from "../transport";

const digest = `sha256:${"a".repeat(64)}` as const;
const nowMs = 100_000;

function bindingAuthenticator(
  payload: RemoteWorkerBindingReceiptPayloadV1,
): string {
  return `binding:${remoteWorkerRequestDigestV1(payload)}`;
}

function fleet() {
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
  });
}

class FakeTransport implements RemoteWorkerTransportV1 {
  readonly requests: RemoteWorkerTransportRequestV1[] = [];
  readonly streams: RemoteWorkerOpenEventStreamInputV1[] = [];
  readonly streamHandles: Array<
    RemoteWorkerEventStreamV1 & { close: ReturnType<typeof vi.fn> }
  > = [];
  swappedWorkspaceId?: string;
  createResponseWorkerId = "worker-1";
  protocolVersion: string = REMOTE_WORKER_PROTOCOL_VERSION;
  deleteFailures = 0;
  execStdout = "";
  qualifiedAtMs = nowMs - 1;
  leaseExpiresAtMs = nowMs + 60_000;
  renewLeaseExpiresAtMs = nowMs + 120_000;
  rawRequestError?: Error;
  rawExecError?: Error;
  createFailures = 0;

  async request(input: RemoteWorkerTransportRequestV1): Promise<unknown> {
    this.requests.push(input);
    if (this.rawRequestError) throw this.rawRequestError;
    if (input.path === "/internal/v1/health") {
      return {
        protocolVersion: this.protocolVersion,
        providerContractVersion: PROVIDER_CONTRACT_VERSION,
        workerId: "worker-1",
        evidenceDigest: digest,
        qualificationBundleDigest: digest,
        providerCohortDigest: digest,
        imageDigest: digest,
        qualificationRunId: "qualification-run-1",
        isolation: "docker-runsc-systrap",
        qualifiedAtMs: this.qualifiedAtMs,
        capabilities: ["fs", "events", "exec", "renew", "delete"],
      };
    }
    if (input.path === "/internal/v1/sandboxes") {
      if (this.createFailures > 0) {
        this.createFailures -= 1;
        throw new Error("ambiguous create response loss");
      }
      const request = input.body as RemoteWorkerCreateRequestV1;
      const payload: RemoteWorkerBindingReceiptPayloadV1 = {
        protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
        workspaceId: this.swappedWorkspaceId ?? request.workspaceId,
        clientLeaseId: request.clientLeaseId,
        workerId: "worker-1",
        sandboxId: "sandbox-1",
        requestDigest: remoteWorkerRequestDigestV1(request),
        expiresAtMs: this.leaseExpiresAtMs,
      };
      return {
        protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
        providerContractVersion: PROVIDER_CONTRACT_VERSION,
        workerId: this.createResponseWorkerId,
        sandboxId: "sandbox-1",
        runtimeCwd: "/workspace",
        leaseExpiresAtMs: this.leaseExpiresAtMs,
        bindingReceipt: {
          payload,
          authenticator: bindingAuthenticator(payload),
        },
      };
    }
    if (input.path.endsWith("/fs")) {
      const operation = input.body as RemoteWorkerWorkspaceOperationV1;
      if (operation.op === "readFile") return { content: "tenant-file" };
      return { ok: true };
    }
    if (input.path.endsWith("/exec")) {
      if (this.rawExecError) throw this.rawExecError;
      const request = input.body as RemoteWorkerExecRequestV1;
      return {
        stdoutBase64: Buffer.from(
          this.execStdout || `ran:${request.command}`,
        ).toString("base64"),
        stderrBase64: "",
        exitCode: 0,
        durationMs: 2,
        truncated: false,
        stdoutEncoding: "utf-8",
        stderrEncoding: "utf-8",
      };
    }
    if (input.path.endsWith("/renew")) {
      return { leaseExpiresAtMs: this.renewLeaseExpiresAtMs };
    }
    if (input.method === "DELETE") {
      if (this.deleteFailures > 0) {
        this.deleteFailures -= 1;
        throw new SandboxProviderError(
          REMOTE_WORKER_ERROR_CODES_V1.unavailable,
          "fake unavailable",
        );
      }
      return { disposed: true };
    }
    throw new Error(`unexpected fake transport path: ${input.path}`);
  }

  async openEventStream(
    input: RemoteWorkerOpenEventStreamInputV1,
  ): Promise<RemoteWorkerEventStreamV1> {
    this.streams.push(input);
    let close!: () => void;
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    const handle = { closed, close: vi.fn(close) };
    this.streamHandles.push(handle);
    return handle;
  }
}

function providerOptions(
  transport: FakeTransport,
  capturedClaims: RemoteWorkerCapabilityClaimsV1[] = [],
): RemoteWorkerSandboxProviderOptionsV1 {
  let sequence = 0;
  return {
    fleet: fleet(),
    transport,
    now: () => nowMs,
    idFactory: () => `opaque-${(sequence += 1)}`,
    capabilityIssuer: {
      async issueCapability({ claims }) {
        capturedClaims.push(claims);
        return `capability-${claims.nonce}`;
      },
    },
    bindingReceiptVerifier: {
      verifyBindingReceipt({ receipt }) {
        return receipt.authenticator === bindingAuthenticator(receipt.payload);
      },
    },
  };
}

describe("remote-worker SandboxProviderV1 placement binding", () => {
  test("acquires one receipt-bound pair and performs lifecycle operations", async () => {
    const transport = new FakeTransport();
    const claims: RemoteWorkerCapabilityClaimsV1[] = [];
    const provider = createRemoteWorkerSandboxProviderV1(
      providerOptions(transport, claims),
    );

    const pair = await provider.create({
      workspaceRoot: "/host/path-is-not-used",
      workspaceId: "workspace-a",
      sessionId: "session-a",
      requestId: "request-a",
    });
    expect(provider.providerId).toBe("remote-worker");
    expect(
      provider.resolveRuntimeRoot({
        workspaceRoot: "/host/path-is-not-used",
        workspaceId: "workspace-a",
        sessionId: "session-a",
      }),
    ).toBe("/workspace");
    expect(pair.workspace.root).toBe("/workspace");
    expect(pair.sandbox.id).toBe("sandbox-1");
    await expect(pair.workspace.readFile("hello.txt")).resolves.toBe(
      "tenant-file",
    );
    const result = await pair.sandbox.exec("printf ok");
    expect(Buffer.from(result.stdout).toString("utf8")).toBe("ran:printf ok");
    await expect(pair.checkHealth?.()).resolves.toEqual({ state: "ok" });
    await pair.dispose();
    await pair.dispose();

    expect(claims.map((claim) => claim.operation)).toEqual([
      "health",
      "create",
      "fs",
      "exec",
      "renew",
      "delete",
    ]);
    expect(claims.every((claim) => claim.workspaceId === "workspace-a")).toBe(
      true,
    );
    expect(
      claims.every((claim) => claim.expiresAtMs - nowMs <= 5 * 60_000),
    ).toBe(true);
    expect(
      transport.requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(1);
  });

  test("recovers an ambiguous create with the same client lease request", async () => {
    const transport = new FakeTransport();
    transport.createFailures = 1;
    const provider = createRemoteWorkerSandboxProviderV1(
      providerOptions(transport),
    );
    const pair = await provider.create({
      workspaceRoot: "/unused",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    });
    const creates = transport.requests.filter(
      (request) => request.path === "/internal/v1/sandboxes",
    );

    expect(creates).toHaveLength(2);
    expect(creates[0]?.body).toEqual(creates[1]?.body);
    await pair.dispose();
  });

  test("fails closed when the authorized workspace is missing", async () => {
    const transport = new FakeTransport();
    const provider = createRemoteWorkerSandboxProviderV1(
      providerOptions(transport),
    );

    await expect(
      provider.create({
        workspaceRoot: "/unused",
        sessionId: "session-a",
      }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.authorizedWorkspaceRequired,
    });
    expect(transport.requests).toHaveLength(0);
  });

  test("refuses a validly authenticated but swapped create receipt", async () => {
    const transport = new FakeTransport();
    transport.swappedWorkspaceId = "workspace-b";
    const provider = createRemoteWorkerSandboxProviderV1(
      providerOptions(transport),
    );

    await expect(
      provider.create({
        workspaceRoot: "/unused",
        workspaceId: "workspace-a",
        sessionId: "session-a",
      }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.bindingReceiptInvalid,
    } satisfies Partial<SandboxProviderError>);
    expect(
      transport.requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(1);
  });

  test("refuses a create response from a different worker", async () => {
    const transport = new FakeTransport();
    transport.createResponseWorkerId = "worker-2";
    const provider = createRemoteWorkerSandboxProviderV1(
      providerOptions(transport),
    );

    await expect(
      provider.create({
        workspaceRoot: "/unused",
        workspaceId: "workspace-a",
        sessionId: "session-a",
      }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.bindingReceiptInvalid,
    });
  });

  test("maps protocol drift to the stable mismatch code", async () => {
    const transport = new FakeTransport();
    transport.protocolVersion = "boring.remote-worker.v0";
    const provider = createRemoteWorkerSandboxProviderV1(
      providerOptions(transport),
    );

    await expect(
      provider.create({
        workspaceRoot: "/unused",
        workspaceId: "workspace-a",
        sessionId: "session-a",
      }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.protocolMismatch,
    });
  });

  test("sanitizes an unknown transport failure", async () => {
    const transport = new FakeTransport();
    transport.rawRequestError = new Error(
      "https://worker/?token=must-never-escape",
    );
    const provider = createRemoteWorkerSandboxProviderV1(
      providerOptions(transport),
    );

    const failure = await provider
      .create({
        workspaceRoot: "/unused",
        workspaceId: "workspace-a",
        sessionId: "session-a",
      })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.unavailable,
    });
    expect(String(failure)).not.toContain("must-never-escape");
  });

  test("rejects a stale qualification receipt", async () => {
    const transport = new FakeTransport();
    transport.qualifiedAtMs = nowMs - 1_001;
    const provider = createRemoteWorkerSandboxProviderV1({
      ...providerOptions(transport),
      qualificationMaxAgeMs: 1_000,
    });

    await expect(
      provider.create({
        workspaceRoot: "/unused",
        workspaceId: "workspace-a",
        sessionId: "session-a",
      }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.unqualified,
    });
  });

  test("rejects exec output beyond the requested combined byte bound", async () => {
    const transport = new FakeTransport();
    transport.execStdout = "too large";
    const provider = createRemoteWorkerSandboxProviderV1(
      providerOptions(transport),
    );
    const pair = await provider.create({
      workspaceRoot: "/unused",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    });

    await expect(
      pair.sandbox.exec("id", { maxOutputBytes: 2 }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.responseInvalid,
    });
    await pair.dispose();
  });

  test("maps ambiguous exec transport loss to a terminal redacted outcome", async () => {
    const transport = new FakeTransport();
    const provider = createRemoteWorkerSandboxProviderV1(
      providerOptions(transport),
    );
    const pair = await provider.create({
      workspaceRoot: "/unused",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    });
    transport.rawExecError = new Error("token=must-never-escape");

    const failure = await pair.sandbox
      .exec("touch side-effect")
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.outcomeUnknown,
    });
    expect(String(failure)).not.toContain("must-never-escape");
    transport.rawExecError = undefined;
    await pair.dispose();
  });

  test("does not renew an expired lease or accept an expired renewal", async () => {
    let clockMs = nowMs;
    const expiredTransport = new FakeTransport();
    expiredTransport.leaseExpiresAtMs = nowMs + 1_000;
    const expiredProvider = createRemoteWorkerSandboxProviderV1({
      ...providerOptions(expiredTransport),
      now: () => clockMs,
    });
    const expiredPair = await expiredProvider.create({
      workspaceRoot: "/unused",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    });
    clockMs = nowMs + 1_001;

    await expect(expiredPair.checkHealth?.()).resolves.toMatchObject({
      state: "recreate",
      error: { code: REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired },
    });
    expect(
      expiredTransport.requests.filter((request) =>
        request.path.endsWith("/renew"),
      ),
    ).toHaveLength(0);

    const pastRenewTransport = new FakeTransport();
    pastRenewTransport.renewLeaseExpiresAtMs = nowMs - 1;
    const pastRenewProvider = createRemoteWorkerSandboxProviderV1(
      providerOptions(pastRenewTransport),
    );
    const pastRenewPair = await pastRenewProvider.create({
      workspaceRoot: "/unused",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    });
    await expect(pastRenewPair.checkHealth?.()).resolves.toMatchObject({
      state: "recreate",
      error: { code: REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired },
    });

    await expiredPair.dispose();
    await pastRenewPair.dispose();
  });

  test("retains teardown ownership after incomplete cleanup", async () => {
    const transport = new FakeTransport();
    transport.deleteFailures = 3;
    const provider = createRemoteWorkerSandboxProviderV1(
      providerOptions(transport),
    );
    const pair = await provider.create({
      workspaceRoot: "/unused",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    });

    await expect(pair.dispose()).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
    });
    await expect(pair.dispose()).resolves.toBeUndefined();
    expect(
      transport.requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(4);
  });

  test("rejects capabilities configured beyond the five-minute bound", () => {
    const transport = new FakeTransport();
    expect(() =>
      createRemoteWorkerSandboxProviderV1({
        ...providerOptions(transport),
        capabilityLifetimeMs: 5 * 60_000 + 1,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
      }),
    );
  });

  test("closes an event stream at its bounded capability lifetime", async () => {
    vi.useFakeTimers();
    try {
      const transport = new FakeTransport();
      const claims: RemoteWorkerCapabilityClaimsV1[] = [];
      const provider = createRemoteWorkerSandboxProviderV1({
        ...providerOptions(transport, claims),
        capabilityLifetimeMs: 1_000,
        eventStreamLifetimeMs: 5_000,
      });
      const pair = await provider.create({
        workspaceRoot: "/unused",
        workspaceId: "workspace-a",
        sessionId: "session-a",
      });
      const watcher = pair.workspace.watch?.();
      const unsubscribe = watcher?.subscribe(vi.fn());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(transport.streams).toHaveLength(1);
      const stream = transport.streamHandles[0]!;

      await vi.advanceTimersByTimeAsync(1_000);
      expect(stream.close).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(250);
      expect(transport.streams).toHaveLength(2);
      const eventClaims = claims.filter(
        (claim) => claim.operation === "events",
      );
      expect(eventClaims).toHaveLength(2);
      expect(eventClaims[0]?.nonce).not.toBe(eventClaims[1]?.nonce);

      unsubscribe?.();
      watcher?.close();
      await pair.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not reconnect an event stream after local lease expiry", async () => {
    vi.useFakeTimers();
    let clockMs = nowMs;
    try {
      const transport = new FakeTransport();
      transport.leaseExpiresAtMs = nowMs + 1_000;
      const provider = createRemoteWorkerSandboxProviderV1({
        ...providerOptions(transport),
        now: () => clockMs,
      });
      const pair = await provider.create({
        workspaceRoot: "/unused",
        workspaceId: "workspace-a",
        sessionId: "session-a",
      });
      const watcher = pair.workspace.watch?.();
      watcher?.subscribe(vi.fn());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(transport.streams).toHaveLength(1);

      clockMs += 1_000;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(transport.streams).toHaveLength(1);
      watcher?.close();
      await pair.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

import { describe, expect, test, vi } from "vitest";

import {
  REMOTE_WORKER_ERROR_CODES_V1,
  REMOTE_WORKER_EXCLUSIVE_BINARY_CREATE_CAPABILITY_V1,
  REMOTE_WORKER_HEADERS_V1,
  REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1,
  REMOTE_WORKER_PROTOCOL_VERSION,
  type RemoteWorkerBindingReceiptPayloadV1,
  type RemoteWorkerCapabilityClaimsV1,
  type RemoteWorkerCreateRequestV1,
  type RemoteWorkerExecRequestV1,
  type RemoteWorkerWorkspaceOperationV1,
} from "../../../shared/remoteWorkerProtocolV1";
import { PROVIDER_CONTRACT_VERSION } from "../../../shared/providerMatrix";
import { SandboxProviderError } from "../../../shared/providerV1";
import { expectDisposableProviderProfile } from "../../__tests__/conformance/disposableProvider";
import { createStaticSandboxProvidersV1 } from "../../static";
import {
  createRemoteWorkerSandboxProviderV1,
  type RemoteWorkerSandboxProviderOptionsV1,
} from "../createRemoteWorkerProvider";
import { parseRemoteWorkerFleetConfigV1 } from "../fleetConfig";
import { RemoteWorkerProtocolClientV1 } from "../protocolClient";
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

function fleet(requiredMultiSandboxRoots = false) {
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
        ...(requiredMultiSandboxRoots
          ? {
              requiredCapabilities: [
                REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1,
              ],
            }
          : {}),
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
  rawCreateError?: Error;
  rawExecError?: Error;
  streamCloseFailures = 0;
  streamCloseNeverSettles = false;
  createFailures = 0;
  advertiseExclusiveBinaryCreate = false;
  advertiseMultiSandboxRoots = false;
  negotiatedCapabilitiesOverride?: unknown;

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
        ...(
          this.negotiatedCapabilitiesOverride !== undefined
            ? { negotiatedCapabilities: this.negotiatedCapabilitiesOverride }
            : this.advertiseExclusiveBinaryCreate ||
                this.advertiseMultiSandboxRoots
              ? {
                  negotiatedCapabilities: [
                    ...(this.advertiseExclusiveBinaryCreate
                      ? [REMOTE_WORKER_EXCLUSIVE_BINARY_CREATE_CAPABILITY_V1]
                      : []),
                    ...(this.advertiseMultiSandboxRoots
                      ? [REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1]
                      : []),
                  ],
                }
              : {}
        ),
      };
    }
    if (input.path === "/internal/v1/sandboxes") {
      if (this.rawCreateError) throw this.rawCreateError;
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
    const handle = {
      closed,
      close: vi.fn(() => {
        if (this.streamCloseNeverSettles) return new Promise<void>(() => {});
        if (this.streamCloseFailures > 0) {
          this.streamCloseFailures -= 1;
          throw new Error("raw event stream close failure");
        }
        close?.();
      }),
    };
    this.streamHandles.push(handle);
    return handle;
  }
}

function providerOptions(
  transport: FakeTransport,
  capturedClaims: RemoteWorkerCapabilityClaimsV1[] = [],
  requiredMultiSandboxRoots = false,
): RemoteWorkerSandboxProviderOptionsV1 {
  let sequence = 0;
  return {
    fleet: fleet(requiredMultiSandboxRoots),
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
  test("requires qualified multi-root placement for disposable mode", async () => {
    const unavailable = new FakeTransport();
    expect(() => createRemoteWorkerSandboxProviderV1({
      ...providerOptions(unavailable), leaseMode: 'disposable',
    })).toThrow('requires the qualified multi-sandbox root capability');
    expect(unavailable.requests).toHaveLength(0);

    const transport = new FakeTransport();
    transport.advertiseMultiSandboxRoots = true;
    const provider = createRemoteWorkerSandboxProviderV1({
      ...providerOptions(transport, [], true), leaseMode: 'disposable',
    });
    expectDisposableProviderProfile(provider, 'remote-worker');
    const pair = await provider.create({
      workspaceRoot: '/unused', workspaceId: 'workspace-a',
      sessionId: 'session-a', requestId: 'request-a',
    });
    await pair.dispose();
    await provider.close?.();
    expect(transport.requests.filter((request) => request.method === 'DELETE')).toHaveLength(1);
  });

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

  test("binds negotiated requirements into provider and static identity", () => {
    const defaultProvider = createRemoteWorkerSandboxProviderV1(
      providerOptions(new FakeTransport()),
    );
    const requiredProvider = createRemoteWorkerSandboxProviderV1(
      providerOptions(new FakeTransport(), [], true),
    );
    const staticProviders = createStaticSandboxProvidersV1({
      remoteWorker: providerOptions(new FakeTransport()),
    });

    expect(defaultProvider.providerConfigDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(requiredProvider.providerConfigDigest).not.toBe(
      defaultProvider.providerConfigDigest,
    );
    expect(staticProviders["remote-worker"]?.providerConfigDigest).toBe(
      defaultProvider.providerConfigDigest,
    );
  });

  test("new client omits exclusive create against an old worker", async () => {
    const transport = new FakeTransport();
    const provider = createRemoteWorkerSandboxProviderV1(providerOptions(transport));
    const pair = await provider.create({
      workspaceRoot: "/unused",
      workspaceId: "workspace-old-worker",
      sessionId: "session-a",
    });

    expect(pair.workspace.createBinaryFile).toBeUndefined();
    expect(transport.requests[0]?.headers[
      REMOTE_WORKER_HEADERS_V1.requestedCapabilities
    ]).toBe(REMOTE_WORKER_EXCLUSIVE_BINARY_CREATE_CAPABILITY_V1);
    await pair.dispose();
  });

  test("requires explicit multi-root negotiation only for qualified placements", async () => {
    const oldWorker = new FakeTransport();
    const gated = createRemoteWorkerSandboxProviderV1(
      providerOptions(oldWorker, [], true),
    );
    await expect(
      gated.create({
        workspaceRoot: "/unused",
        workspaceId: "workspace-gated",
        sessionId: "session-a",
      }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.unqualified,
    });
    expect(oldWorker.requests).toHaveLength(1);
    expect(
      oldWorker.requests[0]?.headers[
        REMOTE_WORKER_HEADERS_V1.requestedCapabilities
      ],
    ).toBe(
      `${REMOTE_WORKER_EXCLUSIVE_BINARY_CREATE_CAPABILITY_V1},${REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1}`,
    );
    expect(
      oldWorker.requests.filter(
        (request) => request.path === "/internal/v1/sandboxes",
      ),
    ).toHaveLength(0);

    const qualifiedWorker = new FakeTransport();
    qualifiedWorker.advertiseMultiSandboxRoots = true;
    const admitted = createRemoteWorkerSandboxProviderV1(
      providerOptions(qualifiedWorker, [], true),
    );
    const pair = await admitted.create({
      workspaceRoot: "/unused",
      workspaceId: "workspace-qualified",
      sessionId: "session-a",
    });
    await pair.dispose();
  });

  test.each([
    ["unknown", ["unknown-capability"]],
    [
      "duplicate",
      [
        REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1,
        REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1,
      ],
    ],
  ])("rejects %s advertised capabilities before create", async (_label, values) => {
    const transport = new FakeTransport();
    transport.negotiatedCapabilitiesOverride = values;
    const provider = createRemoteWorkerSandboxProviderV1(
      providerOptions(transport),
    );

    await expect(
      provider.create({
        workspaceRoot: "/unused",
        workspaceId: "workspace-invalid-capabilities",
        sessionId: "session-a",
      }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.responseInvalid,
    });
    expect(
      transport.requests.filter(
        (request) => request.path === "/internal/v1/sandboxes",
      ),
    ).toHaveLength(0);
  });

  test("normalizes missing advertised capabilities into immutable health facts", async () => {
    const transport = new FakeTransport();
    const client = new RemoteWorkerProtocolClientV1({
      worker: fleet().workers[0]!,
      workspaceId: "workspace-health",
      requestId: "request-health",
      issuer: { issueCapability: async () => "capability-health" },
      transport,
      now: () => nowMs,
      idFactory: () => "nonce-health",
      requestTimeoutMs: 5_000,
      capabilityLifetimeMs: 1_000,
      eventStreamLifetimeMs: 5_000,
    });

    const health = await client.health();
    expect(health.negotiatedCapabilities).toEqual([]);
    expect(Object.isFrozen(health)).toBe(true);
    expect(Object.isFrozen(health.capabilities)).toBe(true);
    expect(Object.isFrozen(health.negotiatedCapabilities)).toBe(true);
    await client.close();
  });

  test("new worker negotiation exposes exclusive create without changing legacy operations", async () => {
    const transport = new FakeTransport();
    transport.advertiseExclusiveBinaryCreate = true;
    const provider = createRemoteWorkerSandboxProviderV1(providerOptions(transport));
    const pair = await provider.create({
      workspaceRoot: "/unused",
      workspaceId: "workspace-new-worker",
      sessionId: "session-a",
    });

    await expect(
      pair.workspace.createBinaryFile?.(
        "new.bin",
        new Uint8Array(10 * 1024 * 1024),
      ),
    ).resolves.toBeUndefined();
    expect(transport.requests.some((request) =>
      (request.body as { op?: unknown } | undefined)?.op === "createBinaryFile"
    )).toBe(true);
    await pair.dispose();
  });

  test("preserves a stable foreign provider error without retrying it", async () => {
    const transport = new FakeTransport();
    transport.rawCreateError = Object.assign(new Error("foreign bundle"), {
      name: "SandboxProviderError",
      code: REMOTE_WORKER_ERROR_CODES_V1.pathPrimitiveUnavailable,
    });
    const provider = createRemoteWorkerSandboxProviderV1(providerOptions(transport));

    const failure = await provider
      .create({
        workspaceRoot: "/unused",
        workspaceId: "workspace-foreign-error",
        sessionId: "session-foreign-error",
        requestId: "request-foreign-error",
      })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.pathPrimitiveUnavailable,
      message: "remote-worker returned a stable provider failure",
    });
    expect(JSON.stringify(failure)).not.toContain("foreign bundle");
    expect(
      transport.requests.filter(
        (request) => request.path === "/internal/v1/sandboxes",
      ),
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

  test("retains invalid-attestation cleanup for provider reconciliation", async () => {
    const transport = new FakeTransport();
    transport.swappedWorkspaceId = "workspace-b";
    transport.deleteFailures = 3;
    const provider = createRemoteWorkerSandboxProviderV1(providerOptions(transport));

    await expect(
      provider.create({
        workspaceRoot: "/unused",
        workspaceId: "workspace-a",
        sessionId: "session-a",
      }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.bindingReceiptInvalid,
    });
    expect(
      transport.requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(3);
    await expect(provider.close!()).resolves.toBeUndefined();
    expect(
      transport.requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(4);
  });

  test("retries retained invalid-attestation cleanup across provider close", async () => {
    const transport = new FakeTransport();
    transport.swappedWorkspaceId = "workspace-b";
    transport.deleteFailures = 6;
    const provider = createRemoteWorkerSandboxProviderV1(providerOptions(transport));

    await expect(
      provider.create({
        workspaceRoot: "/unused",
        workspaceId: "workspace-a",
        sessionId: "session-a",
      }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.bindingReceiptInvalid,
    });
    await expect(provider.close!()).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
    });
    await expect(provider.close!()).resolves.toBeUndefined();
    expect(
      transport.requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(7);
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

  test("keeps DELETE authoritative when event stream close throws", async () => {
    const transport = new FakeTransport();
    transport.streamCloseFailures = 1;
    const provider = createRemoteWorkerSandboxProviderV1(providerOptions(transport));
    const pair = await provider.create({
      workspaceRoot: "/unused",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    });
    pair.workspace.watch?.().subscribe(vi.fn());
    await vi.waitFor(() => expect(transport.streamHandles).toHaveLength(1));

    await expect(pair.dispose()).resolves.toBeUndefined();
    expect(transport.streamHandles[0]?.close).toHaveBeenCalledOnce();
    expect(
      transport.requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(1);
  });

  test("does not await a never-settling event stream close before DELETE", async () => {
    const transport = new FakeTransport();
    transport.streamCloseNeverSettles = true;
    const provider = createRemoteWorkerSandboxProviderV1(providerOptions(transport));
    const pair = await provider.create({
      workspaceRoot: "/unused",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    });
    pair.workspace.watch?.().subscribe(vi.fn());
    await vi.waitFor(() => expect(transport.streamHandles).toHaveLength(1));

    await expect(pair.dispose()).resolves.toBeUndefined();
    expect(transport.streamHandles[0]?.close).toHaveBeenCalledOnce();
    expect(
      transport.requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(1);
  });

  test("provider close retries DELETE after stream close and delete both fail", async () => {
    const transport = new FakeTransport();
    transport.streamCloseFailures = 2;
    transport.deleteFailures = 3;
    const provider = createRemoteWorkerSandboxProviderV1(providerOptions(transport));
    const pair = await provider.create({
      workspaceRoot: "/unused",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    });
    pair.workspace.watch?.().subscribe(vi.fn());
    await vi.waitFor(() => expect(transport.streamHandles).toHaveLength(1));

    await expect(provider.close!()).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
      message: "remote-worker sandbox cleanup could not be confirmed",
    });
    await expect(provider.close!()).resolves.toBeUndefined();
    expect(
      transport.requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(4);
  });

  test("memoizes successful DELETE despite stream cleanup failure", async () => {
    const transport = new FakeTransport();
    transport.streamCloseFailures = 2;
    const provider = createRemoteWorkerSandboxProviderV1(providerOptions(transport));
    const pair = await provider.create({
      workspaceRoot: "/unused",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    });
    pair.workspace.watch?.().subscribe(vi.fn());
    await vi.waitFor(() => expect(transport.streamHandles).toHaveLength(1));

    await expect(pair.dispose()).resolves.toBeUndefined();
    await expect(pair.dispose()).resolves.toBeUndefined();
    expect(
      transport.requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(1);
  });

  test("joins concurrent pair disposal and stream close", async () => {
    const transport = new FakeTransport();
    const provider = createRemoteWorkerSandboxProviderV1(providerOptions(transport));
    const pair = await provider.create({
      workspaceRoot: "/unused",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    });
    pair.workspace.watch?.().subscribe(vi.fn());
    await vi.waitFor(() => expect(transport.streamHandles).toHaveLength(1));

    await Promise.all([pair.dispose(), pair.dispose()]);
    expect(transport.streamHandles[0]?.close).toHaveBeenCalledTimes(1);
    expect(
      transport.requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(1);
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

});

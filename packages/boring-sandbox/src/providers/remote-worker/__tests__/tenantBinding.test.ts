import { describe, expect, test, vi } from "vitest";

import { PROVIDER_CONTRACT_VERSION } from "../../../shared/providerMatrix";
import {
  REMOTE_WORKER_ERROR_CODES_V1,
  REMOTE_WORKER_PROTOCOL_VERSION,
  RemoteWorkerCapabilityClaimsSchemaV1,
  type RemoteWorkerCapabilityClaimsV1,
  type RemoteWorkerCreateRequestV1,
  type RemoteWorkerOperationV1,
} from "../../../shared/remoteWorkerProtocolV1";
import { SandboxProviderError } from "../../../shared/providerV1";
import {
  RemoteWorkerSandboxBindingRegistryV1,
  type RemoteWorkerBindingSecurityEventV1,
} from "../bindingRegistry";
import { remoteWorkerRequestDigestV1 } from "../requestDigest";

const digest = `sha256:${"a".repeat(64)}` as const;
const nowMs = 10_000;
let capabilitySequence = 0;

function createRequest(
  workspaceId: string,
  clientLeaseId: string,
): RemoteWorkerCreateRequestV1 {
  return {
    protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
    providerContractVersion: PROVIDER_CONTRACT_VERSION,
    workspaceId,
    sessionId: `session-${workspaceId}`,
    clientLeaseId,
    idleTimeoutMs: 60_000,
    maxOutputBytes: 1024,
    expectedEvidenceDigest: digest,
    expectedQualificationBundleDigest: digest,
    expectedProviderCohortDigest: digest,
    expectedImageDigest: digest,
  };
}

function capability(input: {
  workspaceId: string;
  operation: RemoteWorkerOperationV1;
  requestDigest: `sha256:${string}`;
  sandboxId?: string;
}): RemoteWorkerCapabilityClaimsV1 {
  return RemoteWorkerCapabilityClaimsSchemaV1.parse({
    protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
    workerId: "worker-1",
    workspaceId: input.workspaceId,
    ...(input.sandboxId ? { sandboxId: input.sandboxId } : {}),
    operation: input.operation,
    requestDigest: input.requestDigest,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 5_000,
    nonce: `nonce-${input.workspaceId}-${input.operation}-${(capabilitySequence += 1)}`,
  });
}

function authenticatedRegistry(
  options: {
    now?: () => number;
    onSecurityViolation?: (event: RemoteWorkerBindingSecurityEventV1) => void;
    eventStreamLifetimeMs?: number;
  } = {},
) {
  const tokens = new Map<string, RemoteWorkerCapabilityClaimsV1>();
  let sequence = 0;
  const tokenFor = (claims: RemoteWorkerCapabilityClaimsV1): string => {
    const token = `authenticated-capability-${(sequence += 1)}`;
    tokens.set(token, claims);
    return token;
  };
  return {
    tokenFor,
    registry: new RemoteWorkerSandboxBindingRegistryV1({
      workerId: "worker-1",
      now: options.now ?? (() => nowMs),
      eventStreamLifetimeMs: options.eventStreamLifetimeMs,
      capabilityAuthenticator: {
        authenticate: ({ token }) => {
          const claims = tokens.get(token);
          if (!claims) throw new Error("invalid fake capability");
          return claims;
        },
      },
      receiptAuthenticator: {
        authenticate: (payload) =>
          `authenticated:${remoteWorkerRequestDigestV1(payload)}`,
      },
      onSecurityViolation: options.onSecurityViolation,
    }),
  };
}

async function bindTenant(
  registry: RemoteWorkerSandboxBindingRegistryV1,
  tokenFor: (claims: RemoteWorkerCapabilityClaimsV1) => string,
  workspaceId: string,
  sandboxId: string,
): Promise<void> {
  const request = createRequest(workspaceId, `lease-${workspaceId}`);
  const requestDigest = remoteWorkerRequestDigestV1(request);
  await registry.bind({
    sandboxId,
    request,
    capabilityToken: tokenFor(
      capability({ workspaceId, operation: "create", requestDigest }),
    ),
    leaseExpiresAtMs: nowMs + 60_000,
  });
}

describe("H5 sandboxId <-> authorized workspaceId tenant binding", () => {
  test("atomically rejects concurrent capability nonce replay", async () => {
    const { registry, tokenFor } = authenticatedRegistry();
    const request = createRequest("workspace-a", "lease-a");
    const claims = capability({
      workspaceId: "workspace-a",
      operation: "create",
      requestDigest: remoteWorkerRequestDigestV1(request),
    });
    const token = tokenFor(claims);
    const attempt = (sandboxId: string) =>
      registry.bind({
        sandboxId,
        request,
        capabilityToken: token,
        leaseExpiresAtMs: nowMs + 60_000,
      });

    const results = await Promise.allSettled([
      attempt("sandbox-a"),
      attempt("sandbox-b"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({
          code: REMOTE_WORKER_ERROR_CODES_V1.capabilityReplay,
        }),
      }),
    ]);
  });

  test("evicts a consumed nonce only after its capability expires", async () => {
    let clock = nowMs;
    const { registry, tokenFor } = authenticatedRegistry({ now: () => clock });
    const request = createRequest("workspace-a", "lease-a");
    const original = capability({
      workspaceId: "workspace-a",
      operation: "create",
      requestDigest: remoteWorkerRequestDigestV1(request),
    });
    await registry.bind({
      sandboxId: "sandbox-a",
      request,
      capabilityToken: tokenFor(original),
      leaseExpiresAtMs: nowMs + 60_000,
    });
    await expect(
      registry.bind({
        sandboxId: "sandbox-a",
        request,
        capabilityToken: tokenFor(original),
        leaseExpiresAtMs: nowMs + 60_000,
      }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.capabilityReplay,
    });

    clock = original.expiresAtMs;
    await expect(
      registry.bind({
        sandboxId: "sandbox-a",
        request,
        capabilityToken: tokenFor(original),
        leaseExpiresAtMs: nowMs + 60_000,
      }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.capabilityExpired,
    });
  });

  test("tenant A's exec cannot address tenant B's sandbox before the exec adapter", async () => {
    const securityCounter = vi.fn(() => {
      throw new Error("observer must not replace the stable mismatch");
    });
    const { registry, tokenFor } = authenticatedRegistry({
      onSecurityViolation: securityCounter,
    });
    await bindTenant(registry, tokenFor, "workspace-a", "sandbox-a");
    await bindTenant(registry, tokenFor, "workspace-b", "sandbox-b");

    const execAdapter = vi.fn(async () => "executed");
    const execDigest = remoteWorkerRequestDigestV1({ command: "id" });
    const tenantACapability = capability({
      workspaceId: "workspace-a",
      sandboxId: "sandbox-b",
      operation: "exec",
      requestDigest: execDigest,
    });
    const tenantBCapability = capability({
      workspaceId: "workspace-b",
      sandboxId: "sandbox-a",
      operation: "exec",
      requestDigest: execDigest,
    });

    for (const crossTenantInput of [
      { sandboxId: "sandbox-b", capabilityToken: tokenFor(tenantACapability) },
      { sandboxId: "sandbox-a", capabilityToken: tokenFor(tenantBCapability) },
    ]) {
      await expect(
        registry.authorize(
          {
            ...crossTenantInput,
            operation: "exec",
            requestBody: { command: "id" },
          },
          execAdapter,
        ),
      ).rejects.toMatchObject({
        code: REMOTE_WORKER_ERROR_CODES_V1.sandboxWorkspaceMismatch,
      } satisfies Partial<SandboxProviderError>);
    }

    expect(execAdapter).not.toHaveBeenCalled();
    expect(securityCounter).toHaveBeenCalledTimes(2);
  });

  test.each(["fs", "events", "renew", "delete"] as const)(
    "rejects the two-tenant x two-sandbox %s cross-product before its adapter",
    async (operation) => {
      const { registry, tokenFor } = authenticatedRegistry();
      await bindTenant(registry, tokenFor, "workspace-a", "sandbox-a");
      await bindTenant(registry, tokenFor, "workspace-b", "sandbox-b");
      const effect = vi.fn(() => ({
        closed: Promise.resolve(),
        close: vi.fn(),
        leaseExpiresAtMs: nowMs + 60_000,
      }));
      const requestBody = { operation };
      const operationDigest = remoteWorkerRequestDigestV1(requestBody);

      for (const [workspaceId, sandboxId] of [
        ["workspace-a", "sandbox-b"],
        ["workspace-b", "sandbox-a"],
      ] as const) {
        const capabilityToken = tokenFor(
          capability({
            workspaceId,
            sandboxId,
            operation,
            requestDigest: operationDigest,
          }),
        );
        const authorization =
          operation === "events"
            ? registry.authorizeEventStream(
                {
                  sandboxId,
                  operation,
                  requestBody,
                  capabilityToken,
                },
                effect,
              )
            : operation === "delete"
              ? registry.dispose(
                  {
                    sandboxId,
                    operation,
                    requestBody,
                    capabilityToken,
                  },
                  effect,
                )
              : operation === "renew"
                ? registry.renew(
                    {
                      sandboxId,
                      operation,
                      requestBody,
                      capabilityToken,
                    },
                    effect,
                  )
                : registry.authorize(
                    {
                      sandboxId,
                      operation,
                      requestBody,
                      capabilityToken,
                    },
                    effect,
                  );
        await expect(authorization).rejects.toMatchObject({
          code: REMOTE_WORKER_ERROR_CODES_V1.sandboxWorkspaceMismatch,
        });
      }
      expect(effect).not.toHaveBeenCalled();
    },
  );

  test("authenticates capabilities and recomputes the bounded request digest", async () => {
    const { registry, tokenFor } = authenticatedRegistry();
    await bindTenant(registry, tokenFor, "workspace-a", "sandbox-a");
    const effect = vi.fn();
    const authorizedBody = { command: "id" };
    const claims = capability({
      workspaceId: "workspace-a",
      sandboxId: "sandbox-a",
      operation: "exec",
      requestDigest: remoteWorkerRequestDigestV1(authorizedBody),
    });

    await expect(
      registry.authorize(
        {
          sandboxId: "sandbox-a",
          operation: "exec",
          requestBody: { command: "cat /different" },
          capabilityToken: tokenFor(claims),
        },
        effect,
      ),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.sandboxWorkspaceMismatch,
    });
    await expect(
      registry.authorize(
        {
          sandboxId: "sandbox-a",
          operation: "exec",
          requestBody: authorizedBody,
          capabilityToken: "not-authenticated",
        },
        effect,
      ),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.unauthenticated,
    });
    expect(effect).not.toHaveBeenCalled();
  });

  test("rejects overlong capabilities and expired sandbox leases before effects", async () => {
    let clockMs = nowMs;
    const { registry, tokenFor } = authenticatedRegistry({
      now: () => clockMs,
    });
    await bindTenant(registry, tokenFor, "workspace-a", "sandbox-a");
    const requestBody = { command: "id" };
    const effect = vi.fn();
    const claims = capability({
      workspaceId: "workspace-a",
      sandboxId: "sandbox-a",
      operation: "exec",
      requestDigest: remoteWorkerRequestDigestV1(requestBody),
    });

    await expect(
      registry.authorize(
        {
          sandboxId: "sandbox-a",
          operation: "exec",
          requestBody,
          capabilityToken: tokenFor(
            RemoteWorkerCapabilityClaimsSchemaV1.parse({
              ...claims,
              expiresAtMs: clockMs + 5 * 60_000 + 1,
            }),
          ),
        },
        effect,
      ),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.capabilityExpired,
    });

    clockMs = nowMs + 60_000;
    await expect(
      registry.authorize(
        {
          sandboxId: "sandbox-a",
          operation: "exec",
          requestBody,
          capabilityToken: tokenFor(
            RemoteWorkerCapabilityClaimsSchemaV1.parse({
              ...claims,
              issuedAtMs: clockMs,
              expiresAtMs: clockMs + 5_000,
              nonce: "fresh-after-lease-expiry",
            }),
          ),
        },
        effect,
      ),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
    });
    expect(effect).not.toHaveBeenCalled();
  });

  test("serializes conflicting concurrent create bindings", async () => {
    let releaseReceipt!: () => void;
    const receiptGate = new Promise<void>((resolve) => {
      releaseReceipt = resolve;
    });
    const tokens = new Map<string, RemoteWorkerCapabilityClaimsV1>();
    const registry = new RemoteWorkerSandboxBindingRegistryV1({
      workerId: "worker-1",
      now: () => nowMs,
      capabilityAuthenticator: {
        authenticate: ({ token }) => tokens.get(token),
      },
      receiptAuthenticator: {
        async authenticate() {
          await receiptGate;
          return "authenticated-binding-receipt";
        },
      },
    });
    const requestA = createRequest("workspace-a", "lease-a");
    const requestB = createRequest("workspace-b", "lease-b");
    tokens.set(
      "token-a",
      capability({
        workspaceId: "workspace-a",
        operation: "create",
        requestDigest: remoteWorkerRequestDigestV1(requestA),
      }),
    );
    tokens.set(
      "token-b",
      capability({
        workspaceId: "workspace-b",
        operation: "create",
        requestDigest: remoteWorkerRequestDigestV1(requestB),
      }),
    );
    const first = registry.bind({
      sandboxId: "sandbox-shared",
      request: requestA,
      capabilityToken: "token-a",
      leaseExpiresAtMs: nowMs + 60_000,
    });
    const second = registry.bind({
      sandboxId: "sandbox-shared",
      request: requestB,
      capabilityToken: "token-b",
      leaseExpiresAtMs: nowMs + 60_000,
    });
    releaseReceipt();

    await expect(first).resolves.toMatchObject({
      payload: { workspaceId: "workspace-a" },
    });
    await expect(second).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.sandboxWorkspaceMismatch,
    });
  });

  test("atomically extends the H5 lease record through authorized renewal", async () => {
    let clockMs = nowMs;
    const { registry, tokenFor } = authenticatedRegistry({
      now: () => clockMs,
    });
    const request = createRequest("workspace-a", "lease-a");
    await registry.bind({
      sandboxId: "sandbox-a",
      request,
      capabilityToken: tokenFor(
        capability({
          workspaceId: "workspace-a",
          operation: "create",
          requestDigest: remoteWorkerRequestDigestV1(request),
        }),
      ),
      leaseExpiresAtMs: nowMs + 1_000,
    });
    clockMs = nowMs + 500;
    const renewBody = { idleTimeoutMs: 2_000 };
    await registry.renew(
      {
        sandboxId: "sandbox-a",
        operation: "renew",
        requestBody: renewBody,
        capabilityToken: tokenFor(
          capability({
            workspaceId: "workspace-a",
            sandboxId: "sandbox-a",
            operation: "renew",
            requestDigest: remoteWorkerRequestDigestV1(renewBody),
          }),
        ),
      },
      () => ({ leaseExpiresAtMs: nowMs + 2_500 }),
    );

    const execBody = { command: "id" };
    const execClaims = capability({
      workspaceId: "workspace-a",
      sandboxId: "sandbox-a",
      operation: "exec",
      requestDigest: remoteWorkerRequestDigestV1(execBody),
    });
    clockMs = nowMs + 1_001;
    await expect(
      registry.authorize(
        {
          sandboxId: "sandbox-a",
          operation: "exec",
          requestBody: execBody,
          capabilityToken: tokenFor(
            RemoteWorkerCapabilityClaimsSchemaV1.parse({
              ...execClaims,
              issuedAtMs: clockMs,
              expiresAtMs: clockMs + 5_000,
              nonce: "fresh-after-renewed-lease-expiry",
            }),
          ),
        },
        () => "executed",
      ),
    ).resolves.toBe("executed");

    clockMs = nowMs + 2_500;
    await expect(
      registry.authorize(
        {
          sandboxId: "sandbox-a",
          operation: "exec",
          requestBody: execBody,
          capabilityToken: tokenFor(execClaims),
        },
        () => "must-not-run",
      ),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
    });
  });

  test("bounds worker event streams, reconnects with fresh auth, and closes on delete", async () => {
    vi.useFakeTimers();
    let clockMs = nowMs;
    try {
      const { registry, tokenFor } = authenticatedRegistry({
        now: () => clockMs,
        eventStreamLifetimeMs: 5_000,
      });
      await bindTenant(registry, tokenFor, "workspace-a", "sandbox-a");
      const requestBody = {};
      const stream = () => {
        let close!: () => void;
        const closed = new Promise<void>((resolve) => {
          close = resolve;
        });
        return { closed, close: vi.fn(close) };
      };
      const first = stream();
      await registry.authorizeEventStream(
        {
          sandboxId: "sandbox-a",
          operation: "events",
          requestBody,
          capabilityToken: tokenFor(
            RemoteWorkerCapabilityClaimsSchemaV1.parse({
              ...capability({
                workspaceId: "workspace-a",
                sandboxId: "sandbox-a",
                operation: "events",
                requestDigest: remoteWorkerRequestDigestV1(requestBody),
              }),
              expiresAtMs: nowMs + 1_000,
              nonce: "first-event-capability",
            }),
          ),
        },
        () => first,
      );
      clockMs += 1_000;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(first.close).toHaveBeenCalledOnce();

      const second = stream();
      await registry.authorizeEventStream(
        {
          sandboxId: "sandbox-a",
          operation: "events",
          requestBody,
          capabilityToken: tokenFor(
            RemoteWorkerCapabilityClaimsSchemaV1.parse({
              ...capability({
                workspaceId: "workspace-a",
                sandboxId: "sandbox-a",
                operation: "events",
                requestDigest: remoteWorkerRequestDigestV1(requestBody),
              }),
              issuedAtMs: clockMs,
              expiresAtMs: clockMs + 2_000,
              nonce: "fresh-event-capability",
            }),
          ),
        },
        () => second,
      );
      const deleteBody = {};
      await registry.dispose(
        {
          sandboxId: "sandbox-a",
          operation: "delete",
          requestBody: deleteBody,
          capabilityToken: tokenFor(
            capability({
              workspaceId: "workspace-a",
              sandboxId: "sandbox-a",
              operation: "delete",
              requestDigest: remoteWorkerRequestDigestV1(deleteBody),
            }),
          ),
        },
        () => undefined,
      );
      expect(second.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  test("closes an event stream that finishes opening after concurrent delete", async () => {
    const { registry, tokenFor } = authenticatedRegistry();
    await bindTenant(registry, tokenFor, "workspace-a", "sandbox-a");
    const requestBody = {};
    const eventToken = tokenFor(
      capability({
        workspaceId: "workspace-a",
        sandboxId: "sandbox-a",
        operation: "events",
        requestDigest: remoteWorkerRequestDigestV1(requestBody),
      }),
    );
    let finishOpen!: (stream: { closed: Promise<void>; close(): void }) => void;
    let effectStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      effectStarted = resolve;
    });
    const opening = registry.authorizeEventStream(
      {
        sandboxId: "sandbox-a",
        operation: "events",
        requestBody,
        capabilityToken: eventToken,
      },
      () => {
        effectStarted();
        return new Promise((resolve) => {
          finishOpen = resolve;
        });
      },
    );
    await started;
    await registry.dispose(
      {
        sandboxId: "sandbox-a",
        operation: "delete",
        requestBody,
        capabilityToken: tokenFor(
          capability({
            workspaceId: "workspace-a",
            sandboxId: "sandbox-a",
            operation: "delete",
            requestDigest: remoteWorkerRequestDigestV1(requestBody),
          }),
        ),
      },
      () => undefined,
    );
    const lateStream = { closed: Promise.resolve(), close: vi.fn() };
    finishOpen(lateStream);

    await expect(opening).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.sandboxDisposed,
    });
    expect(lateStream.close).toHaveBeenCalledOnce();
  });
});

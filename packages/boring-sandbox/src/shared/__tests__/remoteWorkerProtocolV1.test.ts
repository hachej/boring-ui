import { describe, expect, test } from "vitest";

import { PROVIDER_CONTRACT_VERSION } from "../providerMatrix";
import {
  REMOTE_WORKER_PROTOCOL_VERSION,
  RemoteWorkerCapabilityClaimsSchemaV1,
  RemoteWorkerCreateRequestSchemaV1,
  RemoteWorkerCreateResponseSchemaV1,
} from "../remoteWorkerProtocolV1";

const digest = `sha256:${"a".repeat(64)}`;

describe("remote-worker V1 shared protocol", () => {
  test("strictly accepts the versioned create contract", () => {
    const request = RemoteWorkerCreateRequestSchemaV1.parse({
      protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
      providerContractVersion: PROVIDER_CONTRACT_VERSION,
      workspaceId: "workspace-a",
      sessionId: "session-a",
      clientLeaseId: "lease-a",
      idleTimeoutMs: 60_000,
      maxOutputBytes: 1024,
      expectedEvidenceDigest: digest,
      expectedQualificationBundleDigest: digest,
      expectedProviderCohortDigest: digest,
      expectedImageDigest: digest,
    });

    expect(request.workspaceId).toBe("workspace-a");
    expect(() =>
      RemoteWorkerCreateRequestSchemaV1.parse({
        ...request,
        unreviewedField: true,
      }),
    ).toThrow();
    expect(() =>
      RemoteWorkerCreateRequestSchemaV1.parse({
        ...request,
        protocolVersion: "boring.remote-worker.v0",
      }),
    ).toThrow();
  });

  test("requires sandbox-bound claims after create", () => {
    const claims = RemoteWorkerCapabilityClaimsSchemaV1.parse({
      protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
      workerId: "worker-a",
      workspaceId: "workspace-a",
      sandboxId: "sandbox-a",
      operation: "exec",
      requestDigest: digest,
      issuedAtMs: 5_000,
      expiresAtMs: 10_000,
      nonce: "nonce-a",
    });
    expect("sandboxId" in claims && claims.sandboxId).toBe("sandbox-a");
    expect(() =>
      RemoteWorkerCapabilityClaimsSchemaV1.parse({
        ...claims,
        operation: "docker",
      }),
    ).toThrow();
    expect(() =>
      RemoteWorkerCapabilityClaimsSchemaV1.parse({
        ...claims,
        sandboxId: undefined,
      }),
    ).toThrow();
    expect(() =>
      RemoteWorkerCapabilityClaimsSchemaV1.parse({
        ...claims,
        operation: "create",
      }),
    ).toThrow();
  });

  test("rejects a create response without an authenticated binding receipt", () => {
    expect(() =>
      RemoteWorkerCreateResponseSchemaV1.parse({
        protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
        providerContractVersion: PROVIDER_CONTRACT_VERSION,
        workerId: "worker-a",
        sandboxId: "sandbox-a",
        runtimeCwd: "/workspace",
        leaseExpiresAtMs: 20_000,
      }),
    ).toThrow();
  });
});

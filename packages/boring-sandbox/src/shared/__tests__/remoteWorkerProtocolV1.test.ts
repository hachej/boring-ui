import { describe, expect, test } from "vitest";

import {
  negotiateRemoteWorkerHealthCapabilitiesV1,
  REMOTE_WORKER_EXCLUSIVE_BINARY_CREATE_CAPABILITY_V1,
  REMOTE_WORKER_HEADERS_V1,
  REMOTE_WORKER_MAX_WORKSPACE_ENVELOPE_BYTES_V1,
} from "../index";
import { PROVIDER_CONTRACT_VERSION } from "../providerMatrix";
import {
  REMOTE_WORKER_PROTOCOL_VERSION,
  RemoteWorkerCapabilityClaimsSchemaV1,
  RemoteWorkerCreateRequestSchemaV1,
  RemoteWorkerCreateResponseSchemaV1,
  RemoteWorkerErrorPayloadSchemaV1,
  RemoteWorkerExecRequestSchemaV1,
  RemoteWorkerHealthResponseSchemaV1,
  RemoteWorkerWorkspaceOperationSchemaV1,
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

  test("accepts only value-free credential references", () => {
    const request = RemoteWorkerExecRequestSchemaV1.parse({
      invocationId: "invocation-a",
      command: "tool",
      credentialRefs: [
        {
          deliveryAttemptId: "delivery-a",
          ref: {
            contractVersion: "boring.provider-credential-ref.v1",
            providerId: "search-provider",
            executionId: "invocation-a",
            bindingId: "search-tool",
          },
          fields: [{ name: "TOOL_CREDENTIAL", fieldId: "api-key" }],
        },
      ],
      timeoutMs: 30_000,
      maxOutputBytes: 1024,
    });

    expect(request.credentialRefs?.[0]?.ref.contractVersion).toBe(
      "boring.provider-credential-ref.v1",
    );
    expect(() =>
      RemoteWorkerExecRequestSchemaV1.parse({
        ...request,
        credentialRefs: [
          {
            ...request.credentialRefs?.[0],
            value: "not-allowed-on-wire",
            kind: "sandbox-invocation-secret",
          },
        ],
      }),
    ).toThrow();
  });

  test("rejects an ordinary-env model key", () => {
    expect(() =>
      RemoteWorkerExecRequestSchemaV1.parse({
        invocationId: "invocation-a",
        command: "tool",
        env: { OPENAI_API_KEY: "sk-model-key" },
        timeoutMs: 30_000,
        maxOutputBytes: 1024,
      }),
    ).toThrow();
  });

  test("accepts old-worker health and explicitly negotiated new-worker health", () => {
    const legacyHealth = {
      protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
      providerContractVersion: PROVIDER_CONTRACT_VERSION,
      workerId: "worker-a",
      evidenceDigest: digest,
      qualificationBundleDigest: digest,
      providerCohortDigest: digest,
      imageDigest: digest,
      qualificationRunId: "run-a",
      isolation: "docker-runsc-systrap",
      qualifiedAtMs: 1,
      capabilities: ["fs", "events", "exec", "renew", "delete"],
    }
    expect(RemoteWorkerHealthResponseSchemaV1.parse(legacyHealth).negotiatedCapabilities)
      .toBeUndefined()
    expect(RemoteWorkerHealthResponseSchemaV1.parse({
      ...legacyHealth,
      negotiatedCapabilities: [REMOTE_WORKER_EXCLUSIVE_BINARY_CREATE_CAPABILITY_V1],
    }).negotiatedCapabilities).toEqual([
      REMOTE_WORKER_EXCLUSIVE_BINARY_CREATE_CAPABILITY_V1,
    ])
    expect(REMOTE_WORKER_MAX_WORKSPACE_ENVELOPE_BYTES_V1).toBe(15 * 1024 * 1024)
  });

  test("new workers omit negotiated capabilities for old health requests", () => {
    const oldStrictHealthSchema = RemoteWorkerHealthResponseSchemaV1
      .omit({ negotiatedCapabilities: true })
      .strict();
    const healthBase = {
      protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
      providerContractVersion: PROVIDER_CONTRACT_VERSION,
      workerId: "worker-a",
      evidenceDigest: digest,
      qualificationBundleDigest: digest,
      providerCohortDigest: digest,
      imageDigest: digest,
      qualificationRunId: "run-a",
      isolation: "docker-runsc-systrap" as const,
      qualifiedAtMs: 1,
      capabilities: ["fs", "events", "exec", "renew", "delete"] as const,
    };
    const respondAsNewWorker = (headers: Record<string, string>) => ({
      ...healthBase,
      ...negotiateRemoteWorkerHealthCapabilitiesV1(
        headers[REMOTE_WORKER_HEADERS_V1.requestedCapabilities],
      ),
    });

    const responseToOldClient = respondAsNewWorker({});
    expect(responseToOldClient).not.toHaveProperty("negotiatedCapabilities");
    expect(oldStrictHealthSchema.parse(responseToOldClient).workerId).toBe("worker-a");

    const responseToNewClient = respondAsNewWorker({
      [REMOTE_WORKER_HEADERS_V1.requestedCapabilities]:
        REMOTE_WORKER_EXCLUSIVE_BINARY_CREATE_CAPABILITY_V1,
    });
    expect(RemoteWorkerHealthResponseSchemaV1.parse(responseToNewClient).negotiatedCapabilities)
      .toEqual([REMOTE_WORKER_EXCLUSIVE_BINARY_CREATE_CAPABILITY_V1]);
  });

  test("validates exclusive binary creates on the workspace wire", () => {
    expect(RemoteWorkerWorkspaceOperationSchemaV1.parse({
      op: "createBinaryFile",
      path: "nested/file.bin",
      dataBase64: "eA==",
    })).toEqual({ op: "createBinaryFile", path: "nested/file.bin", dataBase64: "eA==" });
    expect(() => RemoteWorkerWorkspaceOperationSchemaV1.parse({
      op: "createBinaryFile",
      path: "nested/file.bin",
      dataBase64: "eA==",
      overwrite: true,
    })).toThrow();
  });

  test("restricts wire errors to the stable remote-worker code union", () => {
    expect(
      RemoteWorkerErrorPayloadSchemaV1.parse({
        error: {
          code: "REMOTE_WORKER_INCOMPLETE_CLEANUP",
          message: "cleanup incomplete",
        },
      }).error.code,
    ).toBe("REMOTE_WORKER_INCOMPLETE_CLEANUP");
    expect(() =>
      RemoteWorkerErrorPayloadSchemaV1.parse({
        error: {
          code: "RAW_CALLBACK_FAILURE",
          message: "host path leaked",
        },
      }),
    ).toThrow();
  });
});

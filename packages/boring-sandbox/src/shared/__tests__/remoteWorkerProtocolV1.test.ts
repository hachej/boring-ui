import { describe, expect, test } from "vitest";

import { PROVIDER_CONTRACT_VERSION } from "../providerMatrix";
import {
  REMOTE_WORKER_PROTOCOL_VERSION,
  RemoteWorkerCapabilityClaimsSchemaV1,
  RemoteWorkerCreateRequestSchemaV1,
  RemoteWorkerCreateResponseSchemaV1,
  RemoteWorkerErrorPayloadSchemaV1,
  RemoteWorkerExecRequestSchemaV1,
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

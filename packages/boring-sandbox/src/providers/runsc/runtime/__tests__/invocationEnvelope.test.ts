import { describe, expect, test } from "vitest";

import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../../shared/remoteWorkerProtocolV1";
import { prepareInvocationEnvelopeV1 } from "../invocationEnvelope";

const base = {
  invocationId: "invocation-a",
  command: "printf ok",
  timeoutMs: 30_000,
  maxOutputBytes: 1024,
};

const credential = {
  deliveryAttemptId: "delivery-a",
  ref: {
    contractVersion: "boring.provider-credential-ref.v1" as const,
    providerId: "search-provider",
    executionId: "invocation-a",
    bindingId: "search-tool",
  },
  fields: [{ name: "TOOL_CREDENTIAL", fieldId: "api-key" }],
};

function resolvedCredential(value = "canary-value") {
  return {
    bindingId: "search-tool",
    fieldId: "api-key",
    name: "TOOL_CREDENTIAL",
    value: new TextEncoder().encode(value),
  };
}

describe("bounded invocation stdin envelope", () => {
  test("delivers a trusted resolved credential only in the JSON bytes", () => {
    const prepared = prepareInvocationEnvelopeV1({
      workspaceId: "workspace-a",
      request: { ...base, credentialRefs: [credential] },
      resolvedCredentialFields: [resolvedCredential()],
    });
    expect(prepared.secretBearing).toBe(true);
    const decoded = JSON.parse(new TextDecoder().decode(prepared.bytes));
    expect(decoded.env.TOOL_CREDENTIAL).toBe("canary-value");
    expect(Object.keys(decoded)).not.toContain("credentialRefs");
  });

  test("rejects forged raw-value classification and execution mismatch", () => {
    expect(() =>
      prepareInvocationEnvelopeV1({
        workspaceId: "workspace-a",
        request: {
          ...base,
          secretEnv: [
            {
              name: "TOOL_CREDENTIAL",
              value: "forged-model-key",
              reference: { kind: "sandbox-invocation-secret" },
            },
          ],
        } as never,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      }),
    );
    expect(() =>
      prepareInvocationEnvelopeV1({
        workspaceId: "workspace-a",
        request: {
          ...base,
          credentialRefs: [
            {
              ...credential,
              ref: { ...credential.ref, executionId: "another-invocation" },
            },
          ],
        },
        resolvedCredentialFields: [resolvedCredential()],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
      }),
    );
  });

  test.each(["PATH", "LD_PRELOAD", "BORING_WORKER_TOKEN", "bad-name"])(
    "rejects reserved or malformed credential env name %s",
    (name) => {
      expect(() =>
        prepareInvocationEnvelopeV1({
          workspaceId: "workspace-a",
          request: {
            ...base,
            credentialRefs: [
              {
                ...credential,
                fields: [{ name, fieldId: "api-key" }],
              },
            ],
          },
          resolvedCredentialFields: [
            { ...resolvedCredential(), name },
          ],
        }),
      ).toThrow();
    },
  );

  test("rejects ordinary raw env, including a model key", () => {
    expect(() =>
      prepareInvocationEnvelopeV1({
        workspaceId: "workspace-a",
        request: {
          ...base,
          env: { OPENAI_API_KEY: "sk-model-key" },
        } as never,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      }),
    );
  });

  test("rejects cwd escape and oversized output policy", () => {
    expect(() =>
      prepareInvocationEnvelopeV1({
        workspaceId: "workspace-a",
        request: { ...base, cwd: "/workspace/../etc" },
      }),
    ).toThrowError(
      expect.objectContaining({ code: REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe }),
    );
    expect(() =>
      prepareInvocationEnvelopeV1({
        workspaceId: "workspace-a",
        request: { ...base, maxOutputBytes: 4 * 1024 * 1024 + 1 },
      }),
    ).toThrow();
  });
});

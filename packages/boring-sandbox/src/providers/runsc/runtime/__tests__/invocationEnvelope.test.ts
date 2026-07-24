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
  test("keeps trusted credential bytes out of JSON and frames them for fd3", () => {
    const prepared = prepareInvocationEnvelopeV1({
      workspaceId: "workspace-a",
      request: { ...base, credentialRefs: [credential] },
      resolvedCredentialFields: [resolvedCredential()],
    });
    expect(prepared.secretBearing).toBe(true);
    expect(new TextDecoder().decode(prepared.bytes.subarray(0, 4))).toBe(
      "BRI1",
    );
    const view = new DataView(
      prepared.bytes.buffer,
      prepared.bytes.byteOffset,
      prepared.bytes.byteLength,
    );
    const metadataLength = view.getUint32(4, false);
    const credentialLength = view.getUint32(8, false);
    const metadataBytes = prepared.bytes.subarray(12, 12 + metadataLength);
    const metadataText = new TextDecoder().decode(metadataBytes);
    const metadata = JSON.parse(metadataText);
    expect(Object.keys(metadata)).not.toContain("credentialRefs");
    expect(Object.keys(metadata)).not.toContain("env");
    expect(metadataText).not.toContain("canary-value");

    const credentialBytes = prepared.bytes.subarray(12 + metadataLength);
    expect(credentialBytes).toHaveLength(credentialLength);
    expect(new TextDecoder().decode(credentialBytes.subarray(0, 4))).toBe(
      "BRC1",
    );
    const credentialView = new DataView(
      credentialBytes.buffer,
      credentialBytes.byteOffset,
      credentialBytes.byteLength,
    );
    expect(credentialView.getUint16(4, false)).toBe(1);
    const nameLength = credentialView.getUint16(6, false);
    const valueLength = credentialView.getUint32(8, false);
    expect(
      new TextDecoder().decode(credentialBytes.subarray(12, 12 + nameLength)),
    ).toBe("TOOL_CREDENTIAL");
    expect(
      new TextDecoder().decode(
        credentialBytes.subarray(
          12 + nameLength,
          12 + nameLength + valueLength,
        ),
      ),
    ).toBe("canary-value");
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
          resolvedCredentialFields: [{ ...resolvedCredential(), name }],
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
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe,
      }),
    );
    expect(() =>
      prepareInvocationEnvelopeV1({
        workspaceId: "workspace-a",
        request: { ...base, maxOutputBytes: 4 * 1024 * 1024 + 1 },
      }),
    ).toThrow();
  });
});

import { describe, expect, test } from "vitest";

import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../../shared/remoteWorkerProtocolV1";
import { prepareInvocationEnvelopeV1 } from "../invocationEnvelope";

const base = {
  invocationId: "invocation-a",
  command: "printf ok",
  timeoutMs: 30_000,
  maxOutputBytes: 1024,
};

function secret(kind: "sandbox-invocation-secret" | "model-provider-credential") {
  return {
    name: "TOOL_CREDENTIAL",
    value: "canary-value",
    reference: {
      contractVersion: "boring.invocation-secret-reference.v1" as const,
      kind,
      referenceId: "reference-a",
      workspaceId: "workspace-a",
      purpose: "tool request",
      sensitivity: "secret" as const,
    },
  };
}

describe("bounded invocation stdin envelope", () => {
  test("delivers a trusted non-model secret only in the JSON bytes", () => {
    const prepared = prepareInvocationEnvelopeV1({
      workspaceId: "workspace-a",
      request: { ...base, secretEnv: [secret("sandbox-invocation-secret")] },
    });
    expect(prepared.secretBearing).toBe(true);
    const decoded = JSON.parse(new TextDecoder().decode(prepared.bytes));
    expect(decoded.env.TOOL_CREDENTIAL).toBe("canary-value");
    expect(Object.keys(decoded)).not.toContain("secretEnv");
  });

  test("rejects model credentials and cross-workspace references", () => {
    expect(() =>
      prepareInvocationEnvelopeV1({
        workspaceId: "workspace-a",
        request: { ...base, secretEnv: [secret("model-provider-credential")] },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
      }),
    );
    expect(() =>
      prepareInvocationEnvelopeV1({
        workspaceId: "workspace-b",
        request: { ...base, secretEnv: [secret("sandbox-invocation-secret")] },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
      }),
    );
  });

  test.each(["PATH", "LD_PRELOAD", "BORING_WORKER_TOKEN", "bad-name"])(
    "rejects reserved or malformed env name %s",
    (name) => {
      expect(() =>
        prepareInvocationEnvelopeV1({
          workspaceId: "workspace-a",
          request: { ...base, env: { [name]: "value" } },
        }),
      ).toThrow();
    },
  );

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

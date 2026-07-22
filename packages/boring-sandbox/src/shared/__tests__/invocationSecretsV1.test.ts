import { describe, expect, test } from "vitest";

import { InvocationSecretReferenceSchemaV1 } from "../invocationSecretsV1";

const base = {
  contractVersion: "boring.invocation-secret-reference.v1",
  referenceId: "reference-a",
  workspaceId: "workspace-a",
  purpose: "bounded tool request",
  sensitivity: "secret",
} as const;

describe("purpose-typed invocation secret references", () => {
  test.each(["sandbox-invocation-secret", "model-provider-credential"] as const)(
    "accepts the trusted %s purpose",
    (kind) => {
      expect(InvocationSecretReferenceSchemaV1.parse({ ...base, kind }).kind).toBe(
        kind,
      );
    },
  );

  test("does not infer classification from a reference name", () => {
    expect(
      InvocationSecretReferenceSchemaV1.parse({
        ...base,
        kind: "sandbox-invocation-secret",
        referenceId: "looks_like_a_TOKEN",
      }).kind,
    ).toBe("sandbox-invocation-secret");
    expect(() =>
      InvocationSecretReferenceSchemaV1.parse({
        ...base,
        kind: "sandbox-invocation-secret",
        sensitivity: "public",
      }),
    ).toThrow();
  });
});

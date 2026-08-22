import { describe, expect, test } from "vitest";

import { ProviderCredentialRefSchemaV1 } from "../invocationSecretsV1";

const base = {
  contractVersion: "boring.provider-credential-ref.v1",
  providerId: "search-provider",
  executionId: "invocation-a",
  bindingId: "search-tool",
} as const;

describe("value-free provider credential references", () => {
  test("accepts only the landed 16f.1 reference shape", () => {
    expect(ProviderCredentialRefSchemaV1.parse(base)).toEqual(base);
  });

  test("rejects caller-authored classification and raw material", () => {
    expect(() =>
      ProviderCredentialRefSchemaV1.parse({
        ...base,
        kind: "sandbox-invocation-secret",
        value: "forged-model-key",
      }),
    ).toThrow();
  });
});

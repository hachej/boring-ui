import { z } from "zod";

export const INVOCATION_SECRET_REFERENCE_VERSION_V1 =
  "boring.invocation-secret-reference.v1" as const;

const boundedIdentifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const referenceBase = {
  contractVersion: z.literal(INVOCATION_SECRET_REFERENCE_VERSION_V1),
  referenceId: boundedIdentifier,
  workspaceId: boundedIdentifier,
  purpose: z.string().min(1).max(256),
  sensitivity: z.literal("secret"),
};

export const InvocationSecretReferenceSchemaV1 = z.discriminatedUnion("kind", [
  z
    .object({
      ...referenceBase,
      kind: z.literal("sandbox-invocation-secret"),
    })
    .strict(),
  z
    .object({
      ...referenceBase,
      kind: z.literal("model-provider-credential"),
    })
    .strict(),
]);

export type InvocationSecretReferenceV1 = z.infer<
  typeof InvocationSecretReferenceSchemaV1
>;

export type SandboxInvocationSecretReferenceV1 = Extract<
  InvocationSecretReferenceV1,
  { kind: "sandbox-invocation-secret" }
>;

export type ModelProviderCredentialReferenceV1 = Extract<
  InvocationSecretReferenceV1,
  { kind: "model-provider-credential" }
>;
